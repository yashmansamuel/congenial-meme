// api/auth.js

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

/*
|--------------------------------------------------------------------------
| Supabase server client
|--------------------------------------------------------------------------
|
| SUPABASE_SERVICE_ROLE_KEY must exist only in Vercel Environment Variables.
| Never expose this key in frontend JavaScript.
|
*/

function createSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing required Supabase environment variables.'
    );
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );
}

/*
|--------------------------------------------------------------------------
| Response helpers
|--------------------------------------------------------------------------
*/

function setSecurityHeaders(res) {
  res.setHeader(
    'Content-Type',
    'application/json; charset=utf-8'
  );

  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate'
  );

  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  res.setHeader(
    'X-Content-Type-Options',
    'nosniff'
  );

  res.setHeader(
    'X-Frame-Options',
    'DENY'
  );

  res.setHeader(
    'Referrer-Policy',
    'no-referrer'
  );
}

function parseRequestBody(req) {
  if (!req.body) {
    return {};
  }

  if (
    typeof req.body === 'object' &&
    !Array.isArray(req.body)
  ) {
    return req.body;
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| Username helpers
|--------------------------------------------------------------------------
*/

function cleanLegacyUsername(value) {
  const normalized =
    normalizeUsername(value);

  return normalized.endsWith('@bean')
    ? normalized.slice(0, -5)
    : normalized;
}

function safeUser(user) {
  return {
    id: String(user.id),
    username: cleanLegacyUsername(
      user.username
    )
  };
}

/*
|--------------------------------------------------------------------------
| Client/IP helpers
|--------------------------------------------------------------------------
*/

function getClientIp(req) {
  const forwarded =
    req.headers['x-forwarded-for'];

  if (typeof forwarded === 'string') {
    const firstIp =
      forwarded.split(',')[0]?.trim();

    if (firstIp) {
      return firstIp;
    }
  }

  const realIp =
    req.headers['x-real-ip'];

  if (typeof realIp === 'string') {
    return realIp.trim();
  }

  return (
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/*
 * We do not store raw IP addresses.
 *
 * Add RATE_LIMIT_SALT in Vercel Environment Variables.
 * JWT_SECRET is used only as a fallback.
 */
function createRateLimitKey(req) {
  const ip = getClientIp(req);

  const salt =
    process.env.RATE_LIMIT_SALT ||
    process.env.JWT_SECRET ||
    'signaturesi-rate-limit';

  return createHash('sha256')
    .update(`${salt}:${ip}`)
    .digest('hex');
}

/*
|--------------------------------------------------------------------------
| Origin protection
|--------------------------------------------------------------------------
|
| This blocks normal cross-site browser POST requests.
| Configure APP_ORIGIN in Vercel:
|
| https://your-domain.com
|
*/

function isAllowedOrigin(req) {
  const allowedOrigin =
    process.env.APP_ORIGIN;

  /*
   * During local development or initial deployment,
   * requests are allowed when APP_ORIGIN is not configured.
   */
  if (!allowedOrigin) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('APP_ORIGIN is required in production.');
    }
    return true;
  }

  const origin = req.headers.origin;

  /*
   * Server-to-server requests may not include Origin.
   */
  if (!origin) {
    return true;
  }

  try {
    return (
      new URL(origin).origin ===
      new URL(allowedOrigin).origin
    );
  } catch {
    return false;
  }
}

/*
|--------------------------------------------------------------------------
| Rate limiting
|--------------------------------------------------------------------------
|
| Required Supabase table:
|
| public.auth_rate_limits
|
| Columns:
| - id
| - key
| - action
| - created_at
|
*/

const RATE_LIMITS = {
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
};

async function removeExpiredRateLimitEntries(
  supabase,
  key,
  action,
  windowSeconds
) {
  const cutoff =
    new Date(
      Date.now() -
      windowSeconds * 1000
    ).toISOString();

  const { error } = await supabase
    .from('auth_rate_limits')
    .delete()
    .eq('key', key)
    .eq('action', action)
    .lt('created_at', cutoff);

  if (error) {
    throw error;
  }
}

async function countRateLimitEntries(
  supabase,
  key,
  action,
  windowSeconds
) {
  const cutoff =
    new Date(
      Date.now() -
      windowSeconds * 1000
    ).toISOString();

  const {
    count,
    error
  } = await supabase
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

  return count || 0;
}

async function recordRateLimitEntry(
  supabase,
  key,
  action
) {
  const { error } = await supabase
    .from('auth_rate_limits')
    .insert({
      key,
      action
    });

  if (error) {
    throw error;
  }
}

async function clearRateLimitEntries(
  supabase,
  key,
  action
) {
  const { error } = await supabase
    .from('auth_rate_limits')
    .delete()
    .eq('key', key)
    .eq('action', action);

  if (error) {
    throw error;
  }
}

/*
 * Checks the current limit without recording a new attempt.
 *
 * Used for login because only failed logins should be recorded.
 */
async function checkRateLimit(
  supabase,
  key,
  action
) {
  const config =
    RATE_LIMITS[action];

  if (!config) {
    throw new Error(
      `Unknown rate-limit action: ${action}`
    );
  }

  await removeExpiredRateLimitEntries(
    supabase,
    key,
    action,
    config.windowSeconds
  );

  const attempts =
    await countRateLimitEntries(
      supabase,
      key,
      action,
      config.windowSeconds
    );

  return {
    allowed:
      attempts < config.maximum,

    remaining:
      Math.max(
        0,
        config.maximum - attempts
      ),

    retryAfter:
      config.windowSeconds
  };
}

/*
 * Checks the limit and records the current request.
 *
 * Used for username checks and signup requests.
 */
async function consumeRateLimit(
  supabase,
  key,
  action
) {
  const result =
    await checkRateLimit(
      supabase,
      key,
      action
    );

  if (!result.allowed) {
    return result;
  }

  await recordRateLimitEntry(
    supabase,
    key,
    action
  );

  return {
    ...result,
    remaining:
      Math.max(
        0,
        result.remaining - 1
      )
  };
}

function sendRateLimitResponse(
  res,
  retryAfter,
  message
) {
  res.setHeader(
    'Retry-After',
    String(retryAfter)
  );

  return res.status(429).json({
    error: message
  });
}

/*
|--------------------------------------------------------------------------
| Database user helpers
|--------------------------------------------------------------------------
*/

async function findAppUser(
  supabase,
  username
) {
  const {
    data,
    error
  } = await supabase
    .from('app_users')
    .select(
      'id, username, password_hash'
    )
    .eq('username', username)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/*
 * Legacy accounts may store:
 *
 * leo
 *
 * or:
 *
 * leo@bean
 */
async function findLegacyProfile(
  supabase,
  username,
  beanUsername
) {
  let result =
    await supabase
      .from('profiles')
      .select(
        'id, username, password'
      )
      .eq('username', username)
      .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  if (result.data) {
    return result.data;
  }

  result =
    await supabase
      .from('profiles')
      .select(
        'id, username, password'
      )
      .eq('username', beanUsername)
      .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

async function usernameExists(
  supabase,
  username
) {
  const appUser =
    await findAppUser(
      supabase,
      username
    );

  if (appUser) {
    return true;
  }

  const legacyProfile =
    await findLegacyProfile(
      supabase,
      username,
      `${username}@bean`
    );

  return Boolean(legacyProfile);
}

/*
|--------------------------------------------------------------------------
| Password helpers
|--------------------------------------------------------------------------
*/

async function migrateAppUserPassword(
  supabase,
  userId,
  plainPassword
) {
  const newPasswordHash =
    await hashPassword(
      plainPassword
    );

  const { error } =
    await supabase
      .from('app_users')
      .update({
        password_hash:
          newPasswordHash
      })
      .eq('id', userId);

  if (error) {
    throw error;
  }

  return newPasswordHash;
}

/*
 * Supports bcrypt and temporary legacy plaintext passwords.
 *
 * Remove the plaintext comparison after all legacy accounts
 * have been migrated.
 */
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

  if (
    isBcryptHash(storedPassword)
  ) {
    return verifyPassword(
      plainPassword,
      storedPassword
    );
  }

  return (
    storedPassword ===
    plainPassword
  );
}

/*
|--------------------------------------------------------------------------
| Main API handler
|--------------------------------------------------------------------------
*/

export default async function handler(
  req,
  res
) {
  setSecurityHeaders(res);

  let supabase;

  try {
    supabase =
      createSupabaseAdmin();
  } catch (error) {
    console.error(
      'Auth configuration error:',
      error?.message
    );

    return res.status(500).json({
      error:
        'Authentication service is not configured.'
    });
  }

  /*
  |--------------------------------------------------------------------------
  | GET — current authenticated session
  |--------------------------------------------------------------------------
  */

  if (req.method === 'GET') {
    const sessionUser =
      getAuthenticatedUser(req);

    if (!sessionUser) {
      return res.status(401).json({
        authenticated: false,
        user: null
      });
    }

    try {
      const {
        data: currentUser,
        error
      } = await supabase
        .from('app_users')
        .select('id, username')
        .eq(
          'id',
          sessionUser.userId
        )
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!currentUser) {
        res.setHeader(
          'Set-Cookie',
          buildLogoutCookie()
        );

        return res.status(401).json({
          authenticated: false,
          user: null
        });
      }

      return res.status(200).json({
        authenticated: true,
        user: safeUser(
          currentUser
        )
      });
    } catch (error) {
      console.error(
        'Session lookup error:',
        {
          message: error?.message,
          code: error?.code
        }
      );

      return res.status(500).json({
        error:
          'Unable to verify the current session.'
      });
    }
  }

  /*
  |--------------------------------------------------------------------------
  | POST-only actions
  |--------------------------------------------------------------------------
  */

  if (req.method !== 'POST') {
    res.setHeader(
      'Allow',
      'GET, POST'
    );

    return res.status(405).json({
      error:
        'Method Not Allowed'
    });
  }

  try {
    if (!isAllowedOrigin(req)) {
      return res.status(403).json({ error: 'Request origin is not allowed.' });
    }
  } catch (error) {
    console.error('Origin configuration error:', error.message);
    return res.status(500).json({ error: 'Authentication is not configured safely.' });
  }

  const body =
    parseRequestBody(req);

  if (!body) {
    return res.status(400).json({
      error:
        'Invalid JSON request.'
    });
  }

  const action =
    typeof body.action === 'string'
      ? body.action
          .trim()
          .toLowerCase()
      : '';

  /*
  |--------------------------------------------------------------------------
  | Logout
  |--------------------------------------------------------------------------
  */

  if (action === 'logout') {
    res.setHeader(
      'Set-Cookie',
      buildLogoutCookie()
    );

    return res.status(200).json({
      success: true
    });
  }

  const rateLimitKey =
    createRateLimitKey(req);

  /*
  |--------------------------------------------------------------------------
  | Username availability
  |--------------------------------------------------------------------------
  */

  if (
    action ===
    'check_username'
  ) {
    const username =
      cleanLegacyUsername(
        body.username
      );

    if (
      !validateUsername(username)
    ) {
      return res.status(400).json({
        available: false,
        error:
          'Username must contain 3–20 letters, numbers, or underscores.'
      });
    }

    try {
      const rateLimit =
        await consumeRateLimit(
          supabase,
          rateLimitKey,
          'check_username'
        );

      if (!rateLimit.allowed) {
        return sendRateLimitResponse(
          res,
          rateLimit.retryAfter,
          'Too many Bean ID checks. Please wait before trying again.'
        );
      }

      const exists =
        await usernameExists(
          supabase,
          username
        );

      return res.status(200).json({
        available: !exists
      });
    } catch (error) {
      console.error(
        'Username availability error:',
        {
          message: error?.message,
          code: error?.code
        }
      );

      return res.status(500).json({
        available: false,
        error:
          'Unable to check Bean ID.'
      });
    }
  }

  const username =
    cleanLegacyUsername(
      body.username
    );

  const password =
    body.password;

  if (
    !validateUsername(username)
  ) {
    return res.status(400).json({
      error:
        'Username must contain 3–20 letters, numbers, or underscores.'
    });
  }

  if (
    typeof password !== 'string'
  ) {
    return res.status(400).json({
      error:
        'Username and password are required.'
    });
  }

  try {
    /*
    |--------------------------------------------------------------------------
    | Signup
    |--------------------------------------------------------------------------
    */

    if (action === 'signup') {
      const rateLimit =
        await consumeRateLimit(
          supabase,
          rateLimitKey,
          'signup'
        );

      if (!rateLimit.allowed) {
        return sendRateLimitResponse(
          res,
          rateLimit.retryAfter,
          'Too many signup attempts. Please try again later.'
        );
      }

      if (
        !validatePassword(password)
      ) {
        return res.status(400).json({
          error:
            'Password must contain 8–100 characters.'
        });
      }

      const exists =
        await usernameExists(
          supabase,
          username
        );

      if (exists) {
        return res.status(409).json({
          error:
            `${username}@bean is already taken.`
        });
      }

      const passwordHash =
        await hashPassword(
          password
        );

      const {
        data: newUser,
        error: insertError
      } = await supabase
        .from('app_users')
        .insert({
          username,
          password_hash:
            passwordHash
        })
        .select('id, username')
        .single();

      if (insertError) {
        /*
         * PostgreSQL duplicate-key error.
         */
        if (
          insertError.code ===
          '23505'
        ) {
          return res.status(409).json({
            error:
              `${username}@bean is already taken.`
          });
        }

        throw insertError;
      }

      const token =
        createSessionToken(
          newUser
        );

      res.setHeader(
        'Set-Cookie',
        buildSessionCookie(token)
      );

      return res.status(201).json({
        success: true,
        authenticated: true,
        user: safeUser(newUser)
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Login
    |--------------------------------------------------------------------------
    */

    if (action === 'login') {
      const loginLimit =
        await checkRateLimit(
          supabase,
          rateLimitKey,
          'login'
        );

      if (!loginLimit.allowed) {
        return sendRateLimitResponse(
          res,
          loginLimit.retryAfter,
          'Too many failed login attempts. Please try again later.'
        );
      }

      const invalidLoginResponse =
        async () => {
          await recordRateLimitEntry(
            supabase,
            rateLimitKey,
            'login'
          );

          return res.status(401).json({
            error:
              'Invalid username or password.'
          });
        };

      if (
        password.length === 0 ||
        password.length > 100
      ) {
        return invalidLoginResponse();
      }

      let appUser =
        await findAppUser(
          supabase,
          username
        );

      /*
       * Current app_users account
       */
      if (appUser) {
        const passwordMatches =
          await verifyStoredPassword(
            password,
            appUser.password_hash
          );

        if (!passwordMatches) {
          return invalidLoginResponse();
        }

        /*
         * Upgrade old plaintext password after successful login.
         */
        if (
          !isBcryptHash(
            appUser.password_hash
          )
        ) {
          await migrateAppUserPassword(
            supabase,
            appUser.id,
            password
          );
        }

        await clearRateLimitEntries(
          supabase,
          rateLimitKey,
          'login'
        );

        const token =
          createSessionToken(
            appUser
          );

        res.setHeader(
          'Set-Cookie',
          buildSessionCookie(token)
        );

        return res.status(200).json({
          success: true,
          authenticated: true,
          user: safeUser(appUser)
        });
      }

      /*
       * Legacy profiles account
       */
      const legacyProfile =
        await findLegacyProfile(
          supabase,
          username,
          `${username}@bean`
        );

      if (!legacyProfile) {
        return invalidLoginResponse();
      }

      const legacyPasswordMatches =
        await verifyStoredPassword(
          password,
          legacyProfile.password
        );

      if (!legacyPasswordMatches) {
        return invalidLoginResponse();
      }

      /*
       * Migrate successful legacy login to app_users.
       */
      const migratedPasswordHash =
        await hashPassword(
          password
        );

      const {
        data: migratedUser,
        error: migrationError
      } = await supabase
        .from('app_users')
        .upsert(
          {
            username,
            password_hash:
              migratedPasswordHash
          },
          {
            onConflict:
              'username'
          }
        )
        .select('id, username')
        .single();

      if (migrationError) {
        throw migrationError;
      }

      appUser = migratedUser;

      await clearRateLimitEntries(
        supabase,
        rateLimitKey,
        'login'
      );

      const token =
        createSessionToken(
          appUser
        );

      res.setHeader(
        'Set-Cookie',
        buildSessionCookie(token)
      );

      return res.status(200).json({
        success: true,
        authenticated: true,
        user: safeUser(appUser)
      });
    }

    return res.status(400).json({
      error:
        'Invalid authentication action.'
    });
  } catch (error) {
    console.error(
      'Auth API error:',
      {
        message: error?.message,
        code: error?.code
      }
    );

    return res.status(500).json({
      error:
        'Authentication request failed. Please try again.'
    });
  }
}
