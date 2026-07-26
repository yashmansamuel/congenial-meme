import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const config = {
  api: {
    bodyParser: false
  }
};

const HANDLED_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_resumed',
  'subscription_expired',
  'subscription_paused',
  'subscription_unpaused'
]);

function cleanEnv(value) {
  return typeof value === 'string'
    ? value.trim().replace(/^["']|["']$/g, '')
    : '';
}

function isNumericId(value) {
  return /^\d+$/.test(String(value || '').trim());
}

function createSupabaseAdmin() {
  const url = cleanEnv(process.env.SUPABASE_URL);
  const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url || !key) {
    throw new Error('Supabase configuration is missing.');
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      headers: {
        'X-Client-Info': 'signaturesi-lemon-webhook'
      }
    }
  });
}

async function readRawBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk);

    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      throw new Error('Webhook payload is too large.');
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function getHeader(req, name) {
  const value = req.headers[String(name).toLowerCase()];

  if (Array.isArray(value)) {
    return value[0] || '';
  }

  return typeof value === 'string' ? value : '';
}

function verifySignature(rawBody, receivedSignature, signingSecret) {
  if (!rawBody || !receivedSignature || !signingSecret) {
    return false;
  }

  const expectedSignature = createHmac('sha256', signingSecret)
    .update(rawBody)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(
    String(receivedSignature).trim(),
    'utf8'
  );

  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function toIsoDate(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : null;
}

function hasNeoProAccess(status, endsAt) {
  const normalizedStatus = String(status || '')
    .trim()
    .toLowerCase();

  if (
    normalizedStatus === 'active' ||
    normalizedStatus === 'on_trial'
  ) {
    return true;
  }

  if (normalizedStatus === 'cancelled' && endsAt) {
    return new Date(endsAt).getTime() > Date.now();
  }

  return false;
}

async function getActiveUser(supabase, rawUserId) {
  const userId = String(rawUserId || '').trim();

  if (!isNumericId(userId)) {
    return null;
  }

  const { data, error } = await supabase
    .from('app_users')
    .select('id, username, plan_type, status')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data || data.status !== 'active') {
    return null;
  }

  return data;
}

async function resolveUser(supabase, payload, subscriptionId) {
  const customUserId = String(
    payload?.meta?.custom_data?.user_id || ''
  ).trim();

  const customUser = await getActiveUser(
    supabase,
    customUserId
  );

  if (customUser) {
    return customUser;
  }

  if (!subscriptionId) {
    return null;
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('provider_subscription_id', subscriptionId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return getActiveUser(supabase, data?.user_id);
}

async function saveSubscription(
  supabase,
  {
    userId,
    customerId,
    subscriptionId,
    status,
    variantId,
    renewsAt,
    endsAt,
    planType
  }
) {
  const { error } = await supabase
    .from('subscriptions')
    .upsert(
      {
        user_id: userId,
        provider: 'lemon_squeezy',
        provider_customer_id: customerId || null,
        provider_subscription_id: subscriptionId,
        status,
        variant_id: variantId,
        renews_at: renewsAt,
        ends_at: endsAt,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: 'user_id'
      }
    );

  if (error) {
    throw error;
  }

  const { error: userUpdateError } = await supabase
    .from('app_users')
    .update({
      plan_type: planType,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)
    .eq('status', 'active');

  if (userUpdateError) {
    throw userUpdateError;
  }
}

async function createPlanNotification(
  supabase,
  userId,
  planType,
  status
) {
  const title =
    planType === 'pro'
      ? 'NEO Pro is active'
      : 'NEO Pro access updated';

  const message =
    planType === 'pro'
      ? 'Your NEO Pro access is now active.'
      : `Your NEO Pro subscription status is ${status}.`;

  const { error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      type: 'subscription',
      title,
      message,
      metadata: {
        provider: 'lemon_squeezy',
        plan_type: planType,
        status
      }
    });

  if (error) {
    console.warn('Notification save failed:', error.message);
  }
}

export default async function handler(req, res) {
  res.setHeader(
    'Content-Type',
    'application/json; charset=utf-8'
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      error: 'Method Not Allowed'
    });
  }

  const signingSecret = cleanEnv(
    process.env.LEMON_SQUEEZY_WEBHOOK_SECRET
  );

  const configuredVariantId = cleanEnv(
    process.env.LEMON_SQUEEZY_VARIANT_ID
  );

  if (!signingSecret || !configuredVariantId) {
    console.error('Lemon webhook environment is incomplete.');

    return res.status(503).json({
      error: 'Webhook endpoint is not configured.'
    });
  }

  try {
    const rawBody = await readRawBody(req);

    const isValidSignature = verifySignature(
      rawBody,
      getHeader(req, 'x-signature'),
      signingSecret
    );

    if (!isValidSignature) {
      return res.status(401).json({
        error: 'Invalid webhook signature.'
      });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));

    const eventName = String(
      payload?.meta?.event_name || ''
    ).trim();

    if (!HANDLED_EVENTS.has(eventName)) {
      return res.status(200).json({
        received: true,
        handled: false
      });
    }

    const subscription = payload?.data;

    if (subscription?.type !== 'subscriptions') {
      return res.status(400).json({
        error: 'Invalid subscription payload.'
      });
    }

    const attributes = subscription.attributes || {};
    const subscriptionId = String(subscription.id || '').trim();
    const variantId = String(
      attributes.variant_id || ''
    ).trim();

    if (!subscriptionId) {
      return res.status(400).json({
        error: 'Subscription ID is missing.'
      });
    }

    if (variantId !== configuredVariantId) {
      return res.status(200).json({
        received: true,
        handled: false,
        reason: 'unmanaged_variant'
      });
    }

    const supabase = createSupabaseAdmin();

    const user = await resolveUser(
      supabase,
      payload,
      subscriptionId
    );

    if (!user) {
      console.error(
        'Lemon webhook user mapping was not found.',
        { subscriptionId }
      );

      return res.status(200).json({
        received: true,
        handled: false,
        reason: 'user_mapping_missing'
      });
    }

    const status = String(
      attributes.status || 'inactive'
    ).trim().toLowerCase();

    const renewsAt = toIsoDate(attributes.renews_at);
    const endsAt = toIsoDate(attributes.ends_at);

    const nextPlanType = hasNeoProAccess(status, endsAt)
      ? 'pro'
      : 'free';

    const planChanged = user.plan_type !== nextPlanType;

    await saveSubscription(supabase, {
      userId: String(user.id),
      customerId: String(attributes.customer_id || '').trim(),
      subscriptionId,
      status,
      variantId,
      renewsAt,
      endsAt,
      planType: nextPlanType
    });

    // Repeated Lemon events do not create notification spam.
    if (planChanged) {
      await createPlanNotification(
        supabase,
        String(user.id),
        nextPlanType,
        status
      );
    }

    return res.status(200).json({
      received: true,
      handled: true
    });
  } catch (error) {
    console.error('Lemon webhook failed:', {
      message: error?.message
    });

    return res.status(500).json({
      error: 'Webhook processing failed.'
    });
  }
}
