import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

import {
  normalizeUsername,
  validateUsername,
  validatePassword,
  hashPassword,
  verifyPassword,
  isBcryptHash,
  createSessionToken,
  getAuthenticatedUser,
  buildSessionCookie,
  buildLogoutCookie
} from '../lib/auth.js';

import {
  setJsonHeaders,
  parseJsonBody,
  isAllowedOrigin
} from '../lib/http.js';

const RATE_LIMITS = Object.freeze({
  check_username: {
    maximum: 30,
    windowSeconds: 60
  },
  signup: {
    maximum: 5,
    windowSeconds: 60 * 60
  },
  login: {
    maximum: 5,
    windowSeconds: 15 * 60
  }
});

const OPTIONAL_SCHEMA_CODES = new Set([
  '42P01',
  '42703'
]);

function cleanEnv(value) {
  return typeof value === 'string'
    ? value.trim().replace(/^["']|["']$/g, '')
    : '';
}

function getEnvironment() {
  const supabaseUrl = cleanEnv(process.env.SUPABASE_URL);
  const serviceRoleKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const jwtSecret = cleanEnv(process.env.JWT_SECRET);

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is missing.');
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing.');
  }

  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters.');
  }

  const parsedUrl = new URL(supabaseUrl);

  if (
    process.env.NODE_ENV === 'production' &&
    parsedUrl.protocol !== 'https:'
  ) {
    throw new Error('SUPABASE_URL must use HTTPS in production.');
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    jwtSecret
  };
}

function createSupabaseAdmin() {
  const { supabaseUrl, serviceRoleKey } = getEnvironment();

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      headers: {
        'X-Client-Info': 'signaturesi-neo-auth'
      }
    }
  });
}

function cleanUsername(value) {
  const username = normalizeUsername(value);

  return username.endsWith('@bean')
    ? username.slice(0, -5)
    : username;
}

function isOptionalSchemaError(error) {
  return OPTIONAL_SCHEMA_CODES.has(String(error?.code || ''));
}

function publicUser(user) {
  return {
    id: String(user.id),
    username: cleanUsername(user.username),
    planType: String(user.plan_type || 'free')
  };
}

function getTrustedClientIp(req) {
  /*
   * On Vercel, x-vercel-forwarded-for is preferred.
   * Never trust an arbitrary browser-provided IP header in local development.
   */
  const vercelIp = req.headers['x-vercel-forwarded-for'];

  if (typeof vercelIp === 'string' && vercelIp.trim()) {
    return vercelIp.split(',')[0].trim();
  }

  if (process.env.VERCEL === '1') {
    const forwarded = req.headers['x-forwarded-for'];

    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
  }

  return req.socket?.remoteAddress || 'unknown';
}

function createRateLimitKey(req, username = '') {
  const salt =
    cleanEnv(process.env.RATE_LIMIT_SALT) ||
    cleanEnv(process.env.JWT_SECRET);

  return createHash('sha256')
    .update(
      `${salt}:${getTrustedClientIp(req)}:${cleanUsername(username)}`
    )
    .digest('hex');
}

async function consumeRateLimit(
  supabase,
  key,
  action
) {
  const config = RATE_LIMITS[action];

  if (!config) {
    throw new Error('Unknown rate-limit action.');
  }

  const { data, error } = await supabase
    .rpc('check_and_record_auth_limit', {
      p_key: key,
      p_action: action,
      p_maximum: config.maximum,
      p_window: `${config.windowSeconds} seconds`
    })
    .single();

  if (error) {
    throw error;
  }

  return {
    allowed: data?.allowed === true,
    remaining: Number(data?.remaining || 0),
    retryAfter: Number(
      data?.retry_after_seconds || config.windowSeconds
    )
  };
}

function rateLimitResponse(res, retryAfter, message) {
  res.setHeader('Retry-After', String(retryAfter));

  return res.status(429).json({
    error: message
  });
}

async function findAppUser(supabase, username) {
  const { data, error } = await supabase
    .from('app_users')
    .select(
      'id, username, password_hash, plan_type, status'
    )
    .eq('username', username)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function findLegacyProfile(supabase, username) {
  for (const candidate of [username, `${username}@bean`]) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, password')
      .eq('username', candidate)
      .maybeSingle();

    if (error) {
      if (isOptionalSchemaError(error)) {
        return null;
      }

      throw error;
    }

    if (data) {
      return data;
    }
  }

  return null;
}

async function usernameExists(supabase, username) {
  const appUser = await findAppUser(supabase, username);

  if (appUser) {
    return true;
  }

  return Boolean(
    await findLegacyProfile(supabase, username)
  );
}

function setSession(res, status, user) {
  const token = createSessionToken(user);

  res.setHeader(
    'Set-Cookie',
    buildSessionCookie(token)
  );

  return res.status(status).json({
    success: true,
    authenticated: true,
    user: publicUser(user)
  });
}

export default async function handler(req, res) {
  setJsonHeaders(res);

  if (req.method === 'GET') {
    const sessionUser = getAuthenticatedUser(req);

    if (!sessionUser?.userId) {
      return res.status(200).json({
        authenticated: false,
        user: null
      });
    }

    try {
      const supabase = createSupabaseAdmin();

      const { data: user, error } = await supabase
        .from('app_users')
        .select('id, username, plan_type, status')
        .eq('id', sessionUser.userId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!user || user.status !== 'active') {
        res.setHeader(
          'Set-Cookie',
          buildLogoutCookie()
        );

        return res.status(200).json({
          authenticated: false,
          user: null
        });
      }

      return res.status(200).json({
        authenticated: true,
        user: publicUser(user)
      });
    } catch (error) {
      console.error('Session verification failed:', {
        message: error?.message,
        code: error?.code
      });

      return res.status(500).json({
        error: 'Unable to verify the current session.'
      });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');

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
      error: 'Authentication service is not configured safely.'
    });
  }

  const body = parseJsonBody(req);

  if (!body) {
    return res.status(400).json({
      error: 'Invalid JSON request.'
    });
  }

  const action =
    typeof body.action === 'string'
      ? body.action.trim().toLowerCase()
      : '';

  if (action === 'logout') {
    res.setHeader(
      'Set-Cookie',
      buildLogoutCookie()
    );

    return res.status(200).json({
      success: true
    });
  }

  if (
    !['check_username', 'signup', 'login'].includes(action)
  ) {
    return res.status(400).json({
      error: 'Invalid authentication action.'
    });
  }

  const username = cleanUsername(body.username);

  if (!validateUsername(username)) {
    return res.status(400).json({
      available: false,
      error:
        'Username must contain 3–20 lowercase letters, numbers, or underscores.'
    });
  }

  let supabase;

  try {
    supabase = createSupabaseAdmin();
  } catch (error) {
    console.error('Authentication configuration failed:', error.message);

    return res.status(500).json({
      error: 'Authentication service is not configured.'
    });
  }

  try {
    const rateLimitKey = createRateLimitKey(
      req,
      action === 'login' ? username : ''
    );

    const limit = await consumeRateLimit(
      supabase,
      rateLimitKey,
      action
    );

    if (!limit.allowed) {
      const messages = {
        check_username:
          'Too many Bean ID checks. Please wait before trying again.',
        signup:
          'Too many signup attempts. Please try again later.',
        login:
          'Too many login attempts. Please try again later.'
      };

      return rateLimitResponse(
        res,
        limit.retryAfter,
        messages[action]
      );
    }

    if (action === 'check_username') {
      const exists = await usernameExists(
        supabase,
        username
      );

      return res.status(200).json({
        available: !exists
      });
    }

    const password = body.password;

    if (typeof password !== 'string') {
      return res.status(400).json({
        error: 'Username and password are required.'
      });
    }

    if (action === 'signup') {
      if (!validatePassword(password)) {
        return res.status(400).json({
          error:
            'Password must contain 8–100 characters.'
        });
      }

      if (await usernameExists(supabase, username)) {
        return res.status(409).json({
          error: `${username}@bean is already taken.`
        });
      }

      const passwordHash = await hashPassword(password);

      const { data: user, error } = await supabase
        .from('app_users')
        .insert({
          username,
          password_hash: passwordHash,
          plan_type: 'free',
          status: 'active'
        })
        .select(
          'id, username, plan_type, status'
        )
        .single();

      if (error) {
        if (String(error.code) === '23505') {
          return res.status(409).json({
            error: `${username}@bean is already taken.`
          });
        }

        throw error;
      }

      return setSession(res, 201, user);
    }

    if (
      password.length < 1 ||
      password.length > 100
    ) {
      return res.status(401).json({
        error: 'Invalid username or password.'
      });
    }

    const user = await findAppUser(supabase, username);

    if (!user || user.status !== 'active') {
      return res.status(401).json({
        error: 'Invalid username or password.'
      });
    }

    /*
     * Production rule:
     * plaintext passwords are never accepted.
     * Existing legacy plaintext users must reset/migrate separately.
     */
    if (!isBcryptHash(user.password_hash)) {
      console.error(
        `Blocked legacy password record for user ${user.id}.`
      );

      return res.status(401).json({
        error:
          'Your account needs a password reset before you can log in.'
      });
    }

    const passwordMatches = await verifyPassword(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        error: 'Invalid username or password.'
      });
    }

    return setSession(res, 200, user);
  } catch (error) {
    console.error('Authentication request failed:', {
      message: error?.message,
      code: error?.code
    });

    return res.status(500).json({
      error: isOptionalSchemaError(error)
        ? 'Authentication database tables are not ready. Run the Supabase migrations.'
        : 'Authentication request failed. Please try again.'
    });
  }
}
