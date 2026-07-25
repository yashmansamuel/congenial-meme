import { createClient } from '@supabase/supabase-js';
import {
  createHmac,
  timingSafeEqual
} from 'node:crypto';

/*
 * Required for raw-body HMAC signature verification.
 */
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

function createSupabaseAdmin() {
  const supabaseUrl = cleanEnv(process.env.SUPABASE_URL);
  const serviceRoleKey = cleanEnv(
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase configuration is missing.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
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

async function readRawBody(req, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk);

    size += buffer.length;

    if (size > maxBytes) {
      throw new Error('Webhook payload is too large.');
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0] || '';
  }

  return typeof value === 'string'
    ? value
    : '';
}

function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) {
    return false;
  }

  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(
    signature.trim(),
    'utf8'
  );

  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim()
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

  /*
   * Cancellation keeps Pro active until the paid period ends.
   */
  if (normalizedStatus === 'cancelled' && endsAt) {
    return new Date(endsAt).getTime() > Date.now();
  }

  return false;
}

async function findUserId(
  supabase,
  payload,
  providerSubscriptionId
) {
  const customUserId =
    payload?.meta?.custom_data?.user_id;

  if (isUuid(customUserId)) {
    return String(customUserId);
  }

  /*
   * Later lifecycle events can still be matched by an already
   * saved provider subscription ID.
   */
  if (!providerSubscriptionId) {
    return null;
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq(
      'provider_subscription_id',
      providerSubscriptionId
    )
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.user_id || null;
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
  const { error: subscriptionError } = await supabase
    .from('subscriptions')
    .upsert(
      {
        user_id: userId,
        provider: 'lemon_squeezy',
        provider_customer_id: customerId,
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

  if (subscriptionError) {
    throw subscriptionError;
  }

  const { error: userError } = await supabase
    .from('app_users')
    .update({
      plan_type: planType,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)
    .eq('status', 'active');

  if (userError) {
    throw userError;
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
      : 'NEO Pro status updated';

  const message =
    planType === 'pro'
      ? 'Your NEO Pro access is now active.'
      : `Your subscription status is ${status}.`;

  const { error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      type: 'subscription',
      title,
      message,
      metadata: {
        plan_type: planType,
        provider: 'lemon_squeezy',
        status
      }
    });

  if (error) {
    console.warn(
      'Subscription notification could not be saved:',
      error.message
    );
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

  if (!signingSecret) {
    console.error(
      'LEMON_SQUEEZY_WEBHOOK_SECRET is missing.'
    );

    return res.status(503).json({
      error: 'Webhook endpoint is not configured.'
    });
  }

  try {
    const rawBody = await readRawBody(req);

    const signature = getHeader(
      req,
      'x-signature'
    );

    if (
      !verifySignature(
        rawBody,
        signature,
        signingSecret
      )
    ) {
      return res.status(401).json({
        error: 'Invalid webhook signature.'
      });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));

    const eventName = String(
      payload?.meta?.event_name || ''
    );

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

    const configuredVariantId = cleanEnv(
      process.env.LEMON_SQUEEZY_VARIANT_ID
    );

    const variantId = String(
      attributes.variant_id || ''
    );

    /*
     * This endpoint only manages the NEO Pro variant.
     * Other Lemon Squeezy products are safely ignored.
     */
    if (
      !configuredVariantId ||
      variantId !== configuredVariantId
    ) {
      return res.status(200).json({
        received: true,
        handled: false,
        reason: 'unmanaged_variant'
      });
    }

    const providerSubscriptionId = String(
      subscription.id || ''
    );

    if (!providerSubscriptionId) {
      return res.status(400).json({
        error: 'Subscription ID is missing.'
      });
    }

    const supabase = createSupabaseAdmin();

    const userId = await findUserId(
      supabase,
      payload,
      providerSubscriptionId
    );

    if (!userId) {
      /*
       * Return 200 so fake/repeated requests do not reveal
       * whether a user exists in your system.
       */
      console.error(
        'Webhook user mapping is missing:',
        providerSubscriptionId
      );

      return res.status(200).json({
        received: true,
        handled: false,
        reason: 'user_mapping_missing'
      });
    }

    const status = String(
      attributes.status || 'inactive'
    ).toLowerCase();

    const renewsAt = toIsoDate(
      attributes.renews_at
    );

    const endsAt = toIsoDate(
      attributes.ends_at
    );

    const planType = hasNeoProAccess(
      status,
      endsAt
    )
      ? 'pro'
      : 'free';

    await saveSubscription(supabase, {
      userId,
      customerId: String(
        attributes.customer_id || ''
      ),
      subscriptionId: providerSubscriptionId,
      status,
      variantId,
      renewsAt,
      endsAt,
      planType
    });

    await createPlanNotification(
      supabase,
      userId,
      planType,
      status
    );

    return res.status(200).json({
      received: true,
      handled: true
    });
  } catch (error) {
    console.error('Lemon Squeezy webhook failed:', {
      message: error?.message
    });

    return res.status(500).json({
      error: 'Webhook processing failed.'
    });
  }
}
