// api/auth.js

import { createClient } from "@supabase/supabase-js";
import { createHash, timingSafeEqual } from "node:crypto";

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
} from "../lib/auth.js";

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

const OPTIONAL_SCHEMA_ERRORS = new Set([
  "42P01", // Undefined table
  "42703"  // Undefined column
]);

const memoryRateLimits =
  globalThis.__signaturesiAuthRateLimits || new Map();

globalThis.__signaturesiAuthRateLimits =
  memoryRateLimits;

/* =========================================================
   ENVIRONMENT
   ========================================================= */

function cleanEnvironmentValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .replace(/^["']|["']$/g, "");
}

function getEnvironment() {
  const supabaseUrl = cleanEnvironmentValue(
    process.env.SUPABASE_URL
  );

  const serviceRoleKey = cleanEnvironmentValue(
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const jwtSecret = cleanEnvironmentValue(
    process.env.JWT_SECRET
  );

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is missing.");
  }

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing."
    );
  }

  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error(
      "JWT_SECRET must contain at least 32 characters."
    );
  }

  try {
    new URL(supabaseUrl);
  } catch {
    throw new Error("SUPABASE_URL is invalid.");
  }

  return {
    supabaseUrl,
    serviceRoleKey
  };
}

function createSupabaseAdmin() {
  const {
    supabaseUrl,
    serviceRoleKey
  } = getEnvironment();

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      global: {
        headers: {
          "X-Client-Info": "signaturesi-neo-auth"
        }
      }
    }
  );
}

/* =========================================================
   RESPONSE SECURITY
   ========================================================= */

function setSecurityHeaders(res) {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );

  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  res.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );

  res.setHeader(
    "X-Frame-Options",
    "DENY"
  );

  res.setHeader(
    "Referrer-Policy",
    "no-referrer"
  );

  res.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=()"
  );
}

/* =========================================================
   REQUEST HELPERS
   ========================================================= */

function parseRequestBody(req) {
  if (
    req.body &&
    typeof req.body === "object" &&
    !Array.isArray(req.body)
  ) {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body);

      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        return parsed;
      }

      return null;
    } catch {
      return null;
    }
  }

  return {};
}

function cleanLegacyUsername(value) {
  const username = normalizeUsername(value);

  return username.endsWith("@bean")
    ? username.slice(0, -5)
    : username;
}

function safeUser(user) {
  return {
    id: String(user.id),
    username: cleanLegacyUsername(
      user.username
    )
  };
}

function getClientIp(req) {
  const forwarded =
    req.headers["x-forwarded-for"];

  if (typeof forwarded === "string") {
    const firstIp =
      forwarded.split(",")[0]?.trim();

    if (firstIp) {
      return firstIp;
    }
  }

  const realIp =
    req.headers["x-real-ip"];

  if (typeof realIp === "string") {
    return realIp.trim();
  }

  return (
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function createRateLimitKey(req) {
  const salt =
    cleanEnvironmentValue(
      process.env.RATE_LIMIT_SALT
    ) ||
    cleanEnvironmentValue(
      process.env.JWT_SECRET
    );

  return createHash("sha256")
    .update(`${salt}:${getClientIp(req)}`)
    .digest("hex");
}

/* =========================================================
   ORIGIN SECURITY
   ========================================================= */

function isAllowedOrigin(req) {
  const configuredOrigin =
    cleanEnvironmentValue(
      process.env.APP_ORIGIN
    );

  if (!configuredOrigin) {
    if (
      process.env.NODE_ENV === "production"
    ) {
      throw new Error(
        "APP_ORIGIN is required in production."
      );
    }

    return true;
  }

  const requestOrigin =
    req.headers.origin;

  // Direct browser navigation and server requests may
  // not include an Origin header.
  if (!requestOrigin) {
    return true;
  }

  try {
    return (
      new URL(requestOrigin).origin ===
      new URL(configuredOrigin).origin
    );
  } catch {
    return false;
  }
}

function isOptionalSchemaError(error) {
  return OPTIONAL_SCHEMA_ERRORS.has(
    String(error?.code || "")
  );
}

/* =========================================================
   MEMORY RATE-LIMIT FALLBACK
   ========================================================= */

function memoryRateLimitId(key, action) {
  return `${action}:${key}`;
}

function pruneMemoryEntries(
  key,
  action,
  windowSeconds
) {
  const id = memoryRateLimitId(
    key,
    action
  );

  const cutoff =
    Date.now() -
    windowSeconds * 1000;

  const current =
    memoryRateLimits.get(id) || [];

  const active = current.filter(
    timestamp => timestamp >= cutoff
  );

  memoryRateLimits.set(id, active);

  return active;
}

function checkMemoryRateLimit(
  key,
  action
) {
  const config =
    RATE_LIMITS[action];

  const active =
    pruneMemoryEntries(
      key,
      action,
      config.windowSeconds
    );

  return {
    allowed:
      active.length <
      config.maximum,

    remaining:
      Math.max(
        0,
        config.maximum -
        active.length
      ),

    retryAfter:
      config.windowSeconds,

    storage: "memory"
  };
}

function recordMemoryRateLimit(
  key,
  action
) {
  const config =
    RATE_LIMITS[action];

  const active =
    pruneMemoryEntries(
      key,
      action,
      config.windowSeconds
    );

  active.push(Date.now());

  memoryRateLimits.set(
    memoryRateLimitId(
      key,
      action
    ),
    active
  );
}

function clearMemoryRateLimit(
  key,
  action
) {
  memoryRateLimits.delete(
    memoryRateLimitId(
      key,
      action
    )
  );
}

/* =========================================================
   DATABASE RATE LIMITING
   ========================================================= */

async function removeExpiredRateLimits(
  supabase,
  key,
  action,
  windowSeconds
) {
  const cutoff = new Date(
    Date.now() -
    windowSeconds * 1000
  ).toISOString();

  const { error } =
    await supabase
      .from("auth_rate_limits")
      .delete()
      .eq("key", key)
      .eq("action", action)
      .lt("created_at", cutoff);

  if (error) {
    throw error;
  }
}

async function countRateLimits(
  supabase,
  key,
  action,
  windowSeconds
) {
  const cutoff = new Date(
    Date.now() -
    windowSeconds * 1000
  ).toISOString();

  const {
    count,
    error
  } = await supabase
    .from("auth_rate_limits")
    .select("id", {
      count: "exact",
      head: true
    })
    .eq("key", key)
    .eq("action", action)
    .gte("created_at", cutoff);

  if (error) {
    throw error;
  }

  return count || 0;
}

async function insertRateLimit(
  supabase,
  key,
  action
) {
  const { error } =
    await supabase
      .from("auth_rate_limits")
      .insert({
        key,
        action
      });

  if (error) {
    throw error;
  }
}

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

  try {
    await removeExpiredRateLimits(
      supabase,
      key,
      action,
      config.windowSeconds
    );

    const attempts =
      await countRateLimits(
        supabase,
        key,
        action,
        config.windowSeconds
      );

    return {
      allowed:
        attempts <
        config.maximum,

      remaining:
        Math.max(
          0,
          config.maximum -
          attempts
        ),

      retryAfter:
        config.windowSeconds,

      storage: "database"
    };
  } catch (error) {
    if (!isOptionalSchemaError(error)) {
      throw error;
    }

    console.warn(
      "auth_rate_limits table is unavailable. Using temporary memory rate limiting."
    );

    return checkMemoryRateLimit(
      key,
      action
    );
  }
}

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

  if (result.storage === "memory") {
    recordMemoryRateLimit(
      key,
      action
    );
  } else {
    await insertRateLimit(
      supabase,
      key,
      action
    );
  }

  return {
    ...result,
    remaining:
      Math.max(
        0,
        result.remaining - 1
      )
  };
}

async function recordFailedLogin(
  supabase,
  key
) {
  const result =
    await checkRateLimit(
      supabase,
      key,
      "login"
    );

  if (result.storage === "memory") {
    recordMemoryRateLimit(
      key,
      "login"
    );
  } else {
    await insertRateLimit(
      supabase,
      key,
      "login"
    );
  }
}

async function clearLoginRateLimits(
  supabase,
  key
) {
  clearMemoryRateLimit(
    key,
    "login"
  );

  try {
    const { error } =
      await supabase
        .from("auth_rate_limits")
        .delete()
        .eq("key", key)
        .eq("action", "login");

    if (
      error &&
      !isOptionalSchemaError(error)
    ) {
      throw error;
    }
  } catch (error) {
    if (!isOptionalSchemaError(error)) {
      throw error;
    }
  }
}

function sendRateLimitResponse(
  res,
  retryAfter,
  message
) {
  res.setHeader(
    "Retry-After",
    String(retryAfter)
  );

  return res
    .status(429)
    .json({
      error: message
    });
}

/* =========================================================
   USER DATABASE HELPERS
   ========================================================= */

async function findAppUser(
  supabase,
  username
) {
  const {
    data,
    error
  } = await supabase
    .from("app_users")
    .select(
      "id, username, password_hash, status"
    )
    .eq("username", username)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function findLegacyProfile(
  supabase,
  username
) {
  const candidates = [
    username,
    `${username}@bean`
  ];

  for (const candidate of candidates) {
    const {
      data,
      error
    } = await supabase
      .from("profiles")
      .select(
        "id, username, password"
      )
      .eq("username", candidate)
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
      username
    );

  return Boolean(legacyProfile);
}

async function createAppUser(
  supabase,
  username,
  passwordHash
) {
  const {
    data,
    error
  } = await supabase
    .from("app_users")
    .insert({
      username,
      password_hash:
        passwordHash,
      plan_type: "free",
      status: "active"
    })
    .select(
      "id, username, status"
    )
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/* =========================================================
   PASSWORD HELPERS
   ========================================================= */

async function verifyStoredPassword(
  plainPassword,
  storedPassword
) {
  if (
    typeof storedPassword !== "string" ||
    storedPassword.length === 0
  ) {
    return false;
  }

  if (isBcryptHash(storedPassword)) {
    return verifyPassword(
      plainPassword,
      storedPassword
    );
  }

  // Temporary support for legacy plaintext passwords.
  const plainBuffer =
    Buffer.from(
      plainPassword,
      "utf8"
    );

  const storedBuffer =
    Buffer.from(
      storedPassword,
      "utf8"
    );

  if (
    plainBuffer.length !==
    storedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    plainBuffer,
    storedBuffer
  );
}

async function migratePassword(
  supabase,
  userId,
  plainPassword
) {
  const passwordHash =
    await hashPassword(
      plainPassword
    );

  const { error } =
    await supabase
      .from("app_users")
      .update({
        password_hash:
          passwordHash,
        updated_at:
          new Date().toISOString()
      })
      .eq("id", userId);

  if (error) {
    throw error;
  }
}

/* =========================================================
   SESSION
   ========================================================= */

function sendSession(
  res,
  status,
  user
) {
  const token =
    createSessionToken(user);

  res.setHeader(
    "Set-Cookie",
    buildSessionCookie(token)
  );

  return res
    .status(status)
    .json({
      success: true,
      authenticated: true,
      user: safeUser(user)
    });
}

/* =========================================================
   MAIN HANDLER
   ========================================================= */

export default async function handler(
  req,
  res
) {
  setSecurityHeaders(res);

  /* -------------------------------------------------------
     GET CURRENT SESSION
     ------------------------------------------------------- */

  if (req.method === "GET") {
    const sessionUser =
      getAuthenticatedUser(req);

    // Important: public signup page must not receive 401/500.
    if (!sessionUser) {
      return res
        .status(200)
        .json({
          authenticated: false,
          user: null
        });
    }

    let supabase;

    try {
      supabase =
        createSupabaseAdmin();
    } catch (error) {
      console.error(
        "Auth configuration error:",
        error?.message
      );

      return res
        .status(500)
        .json({
          error:
            "Authentication service is not configured."
        });
    }

    try {
      const {
        data: currentUser,
        error
      } = await supabase
        .from("app_users")
        .select(
          "id, username, status"
        )
        .eq(
          "id",
          sessionUser.userId
        )
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (
        !currentUser ||
        currentUser.status !== "active"
      ) {
        res.setHeader(
          "Set-Cookie",
          buildLogoutCookie()
        );

        return res
          .status(200)
          .json({
            authenticated: false,
            user: null
          });
      }

      return res
        .status(200)
        .json({
          authenticated: true,
          user: safeUser(
            currentUser
          )
        });
    } catch (error) {
      console.error(
        "Session lookup error:",
        {
          message: error?.message,
          code: error?.code
        }
      );

      return res
        .status(500)
        .json({
          error:
            "Unable to verify the current session."
        });
    }
  }

  /* -------------------------------------------------------
     METHODS
     ------------------------------------------------------- */

  if (req.method !== "POST") {
    res.setHeader(
      "Allow",
      "GET, POST"
    );

    return res
      .status(405)
      .json({
        error: "Method Not Allowed"
      });
  }

  /* -------------------------------------------------------
     ORIGIN CHECK
     ------------------------------------------------------- */

  try {
    if (!isAllowedOrigin(req)) {
      return res
        .status(403)
        .json({
          error:
            "Request origin is not allowed."
        });
    }
  } catch (error) {
    console.error(
      "Origin configuration error:",
      error?.message
    );

    return res
      .status(500)
      .json({
        error:
          "Authentication is not configured safely."
      });
  }

  let supabase;

  try {
    supabase =
      createSupabaseAdmin();
  } catch (error) {
    console.error(
      "Auth configuration error:",
      error?.message
    );

    return res
      .status(500)
      .json({
        error:
          "Authentication service is not configured."
      });
  }

  const body =
    parseRequestBody(req);

  if (!body) {
    return res
      .status(400)
      .json({
        error:
          "Invalid JSON request."
      });
  }

  const action =
    typeof body.action === "string"
      ? body.action
          .trim()
          .toLowerCase()
      : "";

  /* -------------------------------------------------------
     LOGOUT
     ------------------------------------------------------- */

  if (action === "logout") {
    res.setHeader(
      "Set-Cookie",
      buildLogoutCookie()
    );

    return res
      .status(200)
      .json({
        success: true
      });
  }

  const rateLimitKey =
    createRateLimitKey(req);

  /* -------------------------------------------------------
     USERNAME AVAILABILITY
     ------------------------------------------------------- */

  if (action === "check_username") {
    const username =
      cleanLegacyUsername(
        body.username
      );

    if (!validateUsername(username)) {
      return res
        .status(400)
        .json({
          available: false,
          error:
            "Username must contain 3–20 letters, numbers, or underscores."
        });
    }

    try {
      const rateLimit =
        await consumeRateLimit(
          supabase,
          rateLimitKey,
          "check_username"
        );

      if (!rateLimit.allowed) {
        return sendRateLimitResponse(
          res,
          rateLimit.retryAfter,
          "Too many Bean ID checks. Please wait before trying again."
        );
      }

      const exists =
        await usernameExists(
          supabase,
          username
        );

      return res
        .status(200)
        .json({
          available: !exists
        });
    } catch (error) {
      console.error(
        "Username availability error:",
        {
          message: error?.message,
          code: error?.code
        }
      );

      return res
        .status(500)
        .json({
          available: false,
          error:
            "Unable to check Bean ID."
        });
    }
  }

  const username =
    cleanLegacyUsername(
      body.username
    );

  const password =
    body.password;

  if (!validateUsername(username)) {
    return res
      .status(400)
      .json({
        error:
          "Username must contain 3–20 letters, numbers, or underscores."
      });
  }

  if (typeof password !== "string") {
    return res
      .status(400)
      .json({
        error:
          "Username and password are required."
      });
  }

  try {
    /* -----------------------------------------------------
       SIGNUP
       ----------------------------------------------------- */

    if (action === "signup") {
      const rateLimit =
        await consumeRateLimit(
          supabase,
          rateLimitKey,
          "signup"
        );

      if (!rateLimit.allowed) {
        return sendRateLimitResponse(
          res,
          rateLimit.retryAfter,
          "Too many signup attempts. Please try again later."
        );
      }

      if (!validatePassword(password)) {
        return res
          .status(400)
          .json({
            error:
              "Password must contain 8–100 characters."
          });
      }

      const exists =
        await usernameExists(
          supabase,
          username
        );

      if (exists) {
        return res
          .status(409)
          .json({
            error:
              `${username}@bean is already taken.`
          });
      }

      const passwordHash =
        await hashPassword(
          password
        );

      let newUser;

      try {
        newUser =
          await createAppUser(
            supabase,
            username,
            passwordHash
          );
      } catch (error) {
        if (
          String(error?.code) ===
          "23505"
        ) {
          return res
            .status(409)
            .json({
              error:
                `${username}@bean is already taken.`
            });
        }

        throw error;
      }

      return sendSession(
        res,
        201,
        newUser
      );
    }

    /* -----------------------------------------------------
       LOGIN
       ----------------------------------------------------- */

    if (action === "login") {
      const loginLimit =
        await checkRateLimit(
          supabase,
          rateLimitKey,
          "login"
        );

      if (!loginLimit.allowed) {
        return sendRateLimitResponse(
          res,
          loginLimit.retryAfter,
          "Too many failed login attempts. Please try again later."
        );
      }

      const invalidLogin =
        async () => {
          await recordFailedLogin(
            supabase,
            rateLimitKey
          );

          return res
            .status(401)
            .json({
              error:
                "Invalid username or password."
            });
        };

      if (
        password.length === 0 ||
        password.length > 100
      ) {
        return invalidLogin();
      }

      let appUser =
        await findAppUser(
          supabase,
          username
        );

      if (appUser) {
        if (
          appUser.status !== "active"
        ) {
          return res
            .status(403)
            .json({
              error:
                "This account is unavailable."
            });
        }

        const passwordMatches =
          await verifyStoredPassword(
            password,
            appUser.password_hash
          );

        if (!passwordMatches) {
          return invalidLogin();
        }

        if (
          !isBcryptHash(
            appUser.password_hash
          )
        ) {
          await migratePassword(
            supabase,
            appUser.id,
            password
          );
        }

        await clearLoginRateLimits(
          supabase,
          rateLimitKey
        );

        return sendSession(
          res,
          200,
          appUser
        );
      }

      /* ---------------------------------------------------
         LEGACY PROFILE LOGIN
         --------------------------------------------------- */

      const legacyProfile =
        await findLegacyProfile(
          supabase,
          username
        );

      if (!legacyProfile) {
        return invalidLogin();
      }

      const legacyMatches =
        await verifyStoredPassword(
          password,
          legacyProfile.password
        );

      if (!legacyMatches) {
        return invalidLogin();
      }

      const migratedHash =
        await hashPassword(
          password
        );

      const {
        data: migratedUser,
        error: migrationError
      } = await supabase
        .from("app_users")
        .upsert(
          {
            username,
            password_hash:
              migratedHash,
            plan_type: "free",
            status: "active",
            updated_at:
              new Date().toISOString()
          },
          {
            onConflict: "username"
          }
        )
        .select(
          "id, username, status"
        )
        .single();

      if (migrationError) {
        throw migrationError;
      }

      await clearLoginRateLimits(
        supabase,
        rateLimitKey
      );

      return sendSession(
        res,
        200,
        migratedUser
      );
    }

    return res
      .status(400)
      .json({
        error:
          "Invalid authentication action."
      });
  } catch (error) {
    console.error(
      "Auth API error:",
      {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint
      }
    );

    const schemaError =
      isOptionalSchemaError(error);

    return res
      .status(500)
      .json({
        error: schemaError
          ? "Authentication database tables are not ready. Run the Supabase migrations."
          : "Authentication request failed. Please try again."
      });
  }
}
