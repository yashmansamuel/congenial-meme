import { createClient } from '@supabase/supabase-js';

import { getAuthenticatedUser } from '../lib/auth.js';

import {
  setJsonHeaders,
  isAllowedOrigin
} from '../lib/http.js';

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
        'X-Client-Info': 'signaturesi-neo-checkout'
      }
    }
  });
}

function isPaidPlan(plan) {
  return [
    'pro',
    'business',
    'suite'
  ].includes(String(plan || '').toLowerCase());
}

function getSafeRedirectUrl() {
  const appOrigin = cleanEnv(process.env.APP_ORIGIN);

  if (!appOrigin) {
    throw new Error('APP_ORIGIN is missing.');
  }

  const appUrl = new URL(appOrigin);
  const configuredSuccessUrl = cleanEnv(
    process.env.LEMON_SQUEEZY_SUCCESS_URL
  );

  if (!configuredSuccessUrl) {
    return new URL('/neo.html?checkout=success', appUrl).toString();
  }

  const successUrl = new URL(configuredSuccessUrl);

  if (successUrl.origin !== appUrl.origin) {
    throw new Error(
      'LEMON_SQUEEZY_SUCCESS_URL must use APP_ORIGIN.'
    );
  }

  return successUrl.toString();
}

async function createLemonCheckout({
  apiKey,
  storeId,
  variantId,
  redirectUrl,
  user
}) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    20_000
  );

  try {
    const response = await fetch(
      'https://api.lemonsqueezy.com/v1/checkouts',
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          Authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          data: {
            type: 'checkouts',
            attributes: {
              checkout_data: {
                custom: {
                  user_id: String(user.id),
                  bean_id: String(user.username || '')
                }
              },
              product_options: {
                redirect_url: redirectUrl
              }
            },
            relationships: {
              store: {
                data: {
                  type: 'stores',
                  id: String(storeId)
                }
              },
              variant: {
                data: {
                  type: 'variants',
                  id: String(variantId)
                }
              }
            }
          }
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data?.errors?.[0]?.detail ||
          `Checkout provider request failed (${response.status}).`
      );
    }

    const checkoutUrl = data?.data?.attributes?.url;

    if (!checkoutUrl) {
      throw new Error('Checkout URL was not returned.');
    }

    return checkoutUrl;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  setJsonHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      error: 'Method Not Allowed'
    });
  }

  try {
    if (!isAllowedOrigin(req)) {
      return res.status(403).json({
        error: 'Request origin is not allowed.'
      });
    }
  } catch {
    return res.status(500).json({
      error: 'Checkout is not configured safely.'
    });
  }

  const authUser = getAuthenticatedUser(req);

  if (!authUser?.userId) {
    return res.status(401).json({
      error: 'Authentication required. Please log in.'
    });
  }

  const apiKey = cleanEnv(
    process.env.LEMON_SQUEEZY_API_KEY
  );

  const storeId = cleanEnv(
    process.env.LEMON_SQUEEZY_STORE_ID
  );

  const variantId = cleanEnv(
    process.env.LEMON_SQUEEZY_VARIANT_ID
  );

  if (!apiKey || !storeId || !variantId) {
    return res.status(503).json({
      error: 'NEO Pro checkout is not available yet.'
    });
  }

  try {
    const supabase = createSupabaseAdmin();

    const { data: user, error } = await supabase
      .from('app_users')
      .select('id, username, plan_type, status')
      .eq('id', authUser.userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!user || user.status !== 'active') {
      return res.status(403).json({
        error: 'Your account is unavailable.'
      });
    }

    if (isPaidPlan(user.plan_type)) {
      return res.status(409).json({
        error: 'NEO Pro is already active on this account.',
        code: 'PLAN_ALREADY_ACTIVE'
      });
    }

    const redirectUrl = getSafeRedirectUrl();

    const checkoutUrl = await createLemonCheckout({
      apiKey,
      storeId,
      variantId,
      redirectUrl,
      user
    });

    return res.status(200).json({
      success: true,
      url: checkoutUrl
    });
  } catch (error) {
    console.error('Checkout creation failed:', {
      message: error?.message,
      code: error?.code
    });

    return res.status(502).json({
      error:
        'Unable to start checkout. Please try again.'
    });
  }
}
