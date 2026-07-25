// api/auth.js

import { createClient } from '@supabase/supabase-js';
import { createHash, timingSafeEqual } from 'node:crypto';

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

const RATE_LIMITS = Object.freeze({
  check_username: { maximum: 30, windowSeconds: 60 },
  signup: { maximum: 5, windowSeconds: 60 * 60 },
  login: { maximum: 5, windowSeconds: 15 * 60 }
});

const OPTIONAL_SCHEMA_CODES = new Set([
  '42P01', // undefined_table
  '42703'  // undefined_column
]);

const memoryRateLimits =
  globalThis.__signaturesiAuthRateLimits instanceof Map
    ? globalThis.__signaturesiAuthRateLimits
    : new Map();

globalThis.__signaturesiAuthRateLimits = memoryRateLimits;

function cleanEnv(value) {
  return typeof value === 'string'
    ? value.trim().replace(/^["']|["']$/g, '')
    : '';
}

function getAuthEnvironment() {
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

  let parsedUrl;

  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error('SUPABASE_URL is not a valid URL.');
  }

  if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
    throw new Error('SUPABASE_URL must use HTTP or HTTPS.');
  }

  return { supabaseUrl, serviceRoleKey };
}

function createSupabaseAdmin() {
  const { supabaseUrl, serviceRoleKey } = getAuthEnvironment();

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

function setSecurityHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate'
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), geolocation=(), microphone=()'
  );
}

function parseBody(req) {
  if (
    req.body &&
    typeof req.body === 'object' &&
    !Array.isArray(req.body)
  ) {
    return req.body;
  }

  if (typeof req.body === 'string') {
    try {
      const value = JSON.parse(req.body);

      return (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      )
        ? value
        : null;
    } catch {
      return null;
    }
  }

  return {};
}

function cleanLegacyUsername(value) {
  const username = normalizeUsername(value);

  return username.endsWith('@bean')
    ? username.slice(0, -5)
    : username;
}

function publicUser(user) {
  return {
    id: String(user.id),
    username: cleanLegacyUsername(user.username)
  };
}

function normalizeOrigin(value) {
  const cleaned = cleanEnv(value);

  if (!cleaned) {
    return null;
  }

  const withProtocol =
    cleaned.startsWith('http://') ||
    cleaned.startsWith('https://')
      ? cleaned
      : `https://${cleaned}`;

  return new URL(withProtocol).origin;
}

function allowedOrigins() {
  const origins = new Set([
    'https://signaturesi.com',
    'https://www.signaturesi.com'
  ]);

  const configured = [
    process.env.APP_ORIGIN,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
  ];

  for (const value of configured) {
    try {
      const origin = normalizeOrigin(value);

      if (origin) {
        origins.add(origin);
      }
    } catch {
      if (value === process.env.APP_ORIGIN) {
        throw new Error('APP_ORIGIN is invalid.');
      }
    }
  }

  if (
    process.env.NODE_ENV !== 'production'
  ) {
    origins.add('http://localhost:3000');
    origins.add('http://localhost:5173');
  }

  return origins;
}

function isAllowedOrigin(req) {
  const origin =
    typeof req.headers.origin === 'string'
      ? req.headers.origin.trim()
      : '';

  // Direct navigation and non-browser requests may omit Origin.
  if (!origin) {
    return true;
  }

  try {
    return allowedOrigins().has(new URL(origin).origin);
  } catch {
    return false;
  }
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];

  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim();

    if (first) {
      return first;
    }
  }

  const realIp = req.headers['x-real-ip'];

  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }

  return req.socket?.remoteAddress || 'unknown';
}

function createRateLimitKey(req) {
  const salt =
    cleanEnv(process.env.RATE_LIMIT_SALT) ||
    cleanEnv(process.env.JWT_SECRET);

  return createHash('sha256')
    .update(`${salt}:${getClientIp(req)}`)
    .digest('hex');
}

function isOptionalSchemaError(error) {
  return OPTIONAL_SCHEMA_CODES.has(String(error?.code || ''));
}

function memoryId(key, action) {
  return `${action}:${key}`;
}

function activeMemoryEntries(key, action, windowSeconds) {
  const id = memoryId(key, action);
  const cutoff = Date.now() - windowSeconds * 1000;
  const current = memoryRateLimits.get(id) || [];
  const active = current.filter((timestamp) => timestamp >= cutoff);

  memoryRateLimits.set(id, active);

  return active;
}

function checkMemoryLimit(key, action) {
  const config = RATE_LIMITS[action];
  const entries = activeMemoryEntries(
    key,
    action,
    config.windowSeconds
  );

  return {
    allowed: entries.length < config.maximum,
    remaining: Math.max(0, config.maximum - entries.length),
    retryAfter: config.windowSeconds,
    storage: 'memory'
  };
}

function recordMemoryLimit(key, action) {
  const config = RATE_LIMITS[action];
  const entries = activeMemoryEntries(
    key,
    action,
    config.windowSeconds
  );

  entries.push(Date.now());
  memoryRateLimits.set(memoryId(key, action), entries);
}

function clearMemoryLimit(key, action) {
  memoryRateLimits.delete(memoryId(key, action));
}

async function checkDatabaseLimit(
  supabase,
  key,
  action,
  config
) {
  const cutoff = new Date(
    Date.now() - config.windowSeconds * 1000
  ).toISOString();

  const { error: cleanupError } = await supabase
    .from('auth_rate_limits')
    .delete()
    .eq('key', key)
    .eq('action', action)
    .lt('created_at', cutoff);

  if (cleanupError) {
    throw cleanupError;
  }

  const { count, error } = await supabase
    .from('auth_rate_limits')
    .select('id', {
      count: 'exact',
      head: true
    })
    .eq('key', key)
    .eq('action', action)
    .gte('created_at', cutoff);

  if (error) {
    throw error;
  }

  const attempts = count || 0;

  return {
    allowed: attempts < config.maximum,
    remaining: Math.max(0, config.maximum - attempts),
    retryAfter: config.windowSeconds,
    storage: 'database'
  };
}

async function checkRateLimit(supabase, key, action) {
  const config = RATE_LIMITS[action];

  if (!config) {
    throw new Error(`Unknown rate-limit action: ${action}`);
  }

  try {
    return await checkDatabaseLimit(
      supabase,
      key,
      action,
      config
    );
  } catch (error) {
    if (!isOptionalSchemaError(error)) {
      throw error;
    }

    console.warn(
      'auth_rate_limits is unavailable; using temporary in-memory limiting.'
    );

    return checkMemoryLimit(key, action);
  }
}

async function recordLimit(supabase, key, action, storage) {
  if (storage === 'memory') {
    recordMemoryLimit(key, action);
    return;
  }

  const { error } = await supabase
    .from('auth_rate_limits')
    .insert({ key, action });

  if (error) {
    throw error;
  }
}

async function consumeRateLimit(supabase, key, action) {
  const result = await checkRateLimit(
    supabase,
    key,
    action
  );

  if (!result.allowed) {
    return result;
  }

  await recordLimit(
    supabase,
    key,
    action,
    result.storage
  );

  return {
    ...result,
    remaining: Math.max(0, result.remaining - 1)
  };
}

async function clearLoginLimits(supabase, key) {
  clearMemoryLimit(key, 'login');

  const { error } = await supabase
    .from('auth_rate_limits')
    .delete()
    .eq('key', key)
    .eq('action', 'login');

  if (error && !isOptionalSchemaError(error)) {
    throw error;
  }
}

function rateLimitResponse(res, retryAfter, message) {
  res.setHeader('Retry-After', String(retryAfter));

  return res.status(429).json({ error: message });
}

async function findAppUser(supabase, username) {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, username, password_hash, status')
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
  if (await findAppUser(supabase, username)) {
    return true;
  }

  return Boolean(
    await findLegacyProfile(supabase, username)
  );
}

async function verifyStoredPassword(
  plainPassword,
  storedPassword
) {
  if (
    typeof storedPassword !== 'string' ||
    storedPassword.length === 0
  ) {
    return false;
  }

  if (isBcryptHash(storedPassword)) {
    return verifyPassword(plainPassword, storedPassword);
  }

  // Temporary migration support for legacy plaintext records.
  const plain = Buffer.from(plainPassword, 'utf8');
  const stored = Buffer.from(storedPassword, 'utf8');

  return (
    plain.length === stored.length &&
    timingSafeEqual(plain, stored)
  );
}

async function updatePasswordHash(
  supabase,
  userId,
  password
) {
  const passwordHash = await hashPassword(password);

  const { error } = await supabase
    .from('app_users')
    .update({
      password_hash: passwordHash,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);

  if (error) {
    throw error;
  }
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
  setSecurityHeaders(res);

  /*
   * A logged-out session check is intentionally answered before
   * database initialization. The public signup page therefore
   * remains usable even when a deployment is being configured.
   */
  if (req.method === 'GET') {
    const sessionUser = getAuthenticatedUser(req);

    if (!sessionUser) {
      return res.status(200).json({
        authenticated: false,
        user: null
      });
    }

    let supabase;

    try {
      supabase = createSupabaseAdmin();
    } catch (error) {
      console.error('Auth configuration error:', error?.message);

      return res.status(500).json({
        error: 'Authentication service is not configured.'
      });
    }

    try {
      const { data: user, error } = await supabase
        .from('app_users')
        .select('id, username, status')
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
      console.error('Session lookup error:', {
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
  } catch (error) {
    console.error('Origin configuration error:', error?.message);

    return res.status(500).json({
      error: 'Authentication origin configuration is invalid.'
    });
  }

  let supabase;

  try {
    supabase = createSupabaseAdmin();
  } catch (error) {
    console.error('Auth configuration error:', error?.message);

    return res.status(500).json({
      error: 'Authentication service is not configured.'
    });
  }

  const body = parseBody(req);

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

  const rateLimitKey = createRateLimitKey(req);

  if (action === 'check_username') {
    const username = cleanLegacyUsername(
      body.username
    );

    if (!validateUsername(username)) {
      return res.status(400).json({
        available: false,
        error:
          'Username must contain 3–20 letters, numbers, or underscores.'
      });
    }

    try {
      const limit = await consumeRateLimit(
        supabase,
        rateLimitKey,
        'check_username'
      );

      if (!limit.allowed) {
        return rateLimitResponse(
          res,
          limit.retryAfter,
          'Too many Bean ID checks. Please wait before trying again.'
        );
      }

      const exists = await usernameExists(
        supabase,
        username
      );

      return res.status(200).json({
        available: !exists
      });
    } catch (error) {
      console.error('Username availability error:', {
        message: error?.message,
        code: error?.code
      });

      return res.status(500).json({
        available: false,
        error: 'Unable to check Bean ID.'
      });
    }
  }

  const username = cleanLegacyUsername(
    body.username
  );

  const password = body.password;

  if (!validateUsername(username)) {
    return res.status(400).json({
      error:
        'Username must contain 3–20 letters, numbers, or underscores.'
    });
  }

  if (typeof password !== 'string') {
    return res.status(400).json({
      error: 'Username and password are required.'
    });
  }

  try {
    if (action === 'signup') {
      const limit = await consumeRateLimit(
        supabase,
        rateLimitKey,
        'signup'
      );

      if (!limit.allowed) {
        return rateLimitResponse(
          res,
          limit.retryAfter,
          'Too many signup attempts. Please try again later.'
        );
      }

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
        .select('id, username, status')
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

    if (action === 'login') {
      const limit = await checkRateLimit(
        supabase,
        rateLimitKey,
        'login'
      );

      if (!limit.allowed) {
        return rateLimitResponse(
          res,
          limit.retryAfter,
          'Too many failed login attempts. Please try again later.'
        );
      }

      const invalidLogin = async () => {
        await recordLimit(
          supabase,
          rateLimitKey,
          'login',
          limit.storage
        );

        return res.status(401).json({
          error: 'Invalid username or password.'
        });
      };

      if (
        password.length === 0 ||
        password.length > 100
      ) {
        return invalidLogin();
      }

      const appUser = await findAppUser(
        supabase,
        username
      );

      if (appUser) {
        if (appUser.status !== 'active') {
          return res.status(403).json({
            error: 'This account is unavailable.'
          });
        }

        const matches = await verifyStoredPassword(
          password,
          appUser.password_hash
        );

        if (!matches) {
          return invalidLogin();
        }

        if (!isBcryptHash(appUser.password_hash)) {
          await updatePasswordHash(
            supabase,
            appUser.id,
            password
          );
        }

        await clearLoginLimits(
          supabase,
          rateLimitKey
        );

        return setSession(
          res,
          200,
          appUser
        );
      }

      const legacy = await findLegacyProfile(
        supabase,
        username
      );

      if (
        !legacy ||
        !(await verifyStoredPassword(
          password,
          legacy.password
        ))
      ) {
        return invalidLogin();
      }

      const migratedHash = await hashPassword(password);

      const {
        data: migratedUser,
        error: migrationError
      } = await supabase
        .from('app_users')
        .upsert(
          {
            username,
            password_hash: migratedHash,
            plan_type: 'free',
            status: 'active',
            updated_at: new Date().toISOString()
          },
          {
            onConflict: 'username'
          }
        )
        .select('id, username, status')
        .single();

      if (migrationError) {
        throw migrationError;
      }

      await clearLoginLimits(
        supabase,
        rateLimitKey
      );

      return setSession(
        res,
        200,
        migratedUser
      );
    }

    return res.status(400).json({
      error: 'Invalid authentication action.'
    });
  } catch (error) {
    console.error('Auth API error:', {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint
    });

    return res.status(500).json({
      error: isOptionalSchemaError(error)
        ? 'Authentication database tables are not ready. Run the Supabase migrations.'
        : 'Authentication request failed. Please try again.'
    });
  }
}
