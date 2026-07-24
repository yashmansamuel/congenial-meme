// lib/auth.js

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const COOKIE_NAME = 'neo_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const JWT_ISSUER = 'signaturesi-neo';
const JWT_AUDIENCE = 'neo-web';
const BCRYPT_ROUNDS = 12;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be configured with at least 32 characters.'
    );
  }

  return secret;
}

export function normalizeUsername(username) {
  return typeof username === 'string'
    ? username.trim().toLowerCase()
    : '';
}

export function validateUsername(username) {
  const normalizedUsername = normalizeUsername(username);

  return /^[a-z0-9_]{3,20}$/.test(normalizedUsername);
}

export function validatePassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    password.length <= 100
  );
}

export async function hashPassword(password) {
  if (!validatePassword(password)) {
    throw new TypeError(
      'Password must be between 8 and 100 characters.'
    );
  }

  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password, passwordHash) {
  if (
    typeof password !== 'string' ||
    typeof passwordHash !== 'string'
  ) {
    return false;
  }

  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}

export function isBcryptHash(value) {
  return (
    typeof value === 'string' &&
    /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value)
  );
}

export function createSessionToken(user) {
  const userId = user?.id ?? user?.user_id;
  const username = normalizeUsername(user?.username);

  if (!userId || !validateUsername(username)) {
    throw new TypeError(
      'A valid user id and username are required.'
    );
  }

  return jwt.sign(
    {
      sub: String(userId),
      username
    },
    getJwtSecret(),
    {
      algorithm: 'HS256',
      expiresIn: SESSION_TTL_SECONDS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    }
  );
}

export function verifySessionToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });

    if (
      typeof payload !== 'object' ||
      typeof payload.sub !== 'string' ||
      !validateUsername(payload.username)
    ) {
      return null;
    }

    return {
      userId: payload.sub,
      username: normalizeUsername(payload.username)
    };
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const cookieHeader = req?.headers?.cookie;
  const cookies = Object.create(null);

  if (
    typeof cookieHeader !== 'string' ||
    cookieHeader.length === 0
  ) {
    return cookies;
  }

  for (const item of cookieHeader.split(';')) {
    const separatorIndex = item.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const name = item.slice(0, separatorIndex).trim();
    const rawValue = item.slice(separatorIndex + 1).trim();

    if (!name) {
      continue;
    }

    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }

  return cookies;
}

export function getAuthenticatedUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];

  return verifySessionToken(token);
}

function serializeSessionCookie(value, maxAgeSeconds) {
  const isProduction = process.env.NODE_ENV === 'production';

  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];

  if (isProduction) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

export function buildSessionCookie(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new TypeError('A session token is required.');
  }

  return serializeSessionCookie(
    token,
    SESSION_TTL_SECONDS
  );
}

export function buildLogoutCookie() {
  const attributes = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];

  if (process.env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
export const SESSION_MAX_AGE_SECONDS =
  SESSION_TTL_SECONDS;
