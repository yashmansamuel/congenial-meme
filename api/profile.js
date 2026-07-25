// api/profile.js

import { createClient } from '@supabase/supabase-js';

import { getAuthenticatedUser } from '../lib/auth.js';
import {
  isAllowedOrigin,
  parseJsonBody,
  setJsonHeaders
} from '../lib/http.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '3mb'
    }
  }
};

const AVATAR_BUCKET = 'avatars';
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

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
        'X-Client-Info': 'signaturesi-neo-profile'
      }
    }
  });
}

function cleanUsername(value) {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/^@/, '')
        .replace(/@bean$/i, '')
    : '';
}

function getAvatarPath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const cleanValue = value.trim();

  /*
   * Old code may have stored either:
   * - avatar-file.png
   * - avatars/avatar-file.png
   * - full public Storage URL
   */
  if (cleanValue.startsWith('http')) {
    try {
      const url = new URL(cleanValue);
      const marker = '/avatars/';

      if (!url.pathname.includes(marker)) {
        return null;
      }

      return decodeURIComponent(
        url.pathname.split(marker).pop() || ''
      );
    } catch {
      return null;
    }
  }

  return cleanValue
    .replace(/^avatars\//i, '')
    .replace(/^\/+/, '');
}

function isSafeAvatarPath(value) {
  return (
    typeof value === 'string' &&
    /^[a-zA-Z0-9._-]{1,180}$/.test(value)
  );
}

function parseAvatarDataUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i
  );

  if (!match) {
    return null;
  }

  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, '');

  let buffer;

  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    return null;
  }

  if (
    !buffer.length ||
    buffer.length > MAX_AVATAR_BYTES
  ) {
    return null;
  }

  const isJpeg =
    mimeType === 'image/jpeg' &&
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;

  const isPng =
    mimeType === 'image/png' &&
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a
      ])
    );

  const isWebp =
    mimeType === 'image/webp' &&
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (!isJpeg && !isPng && !isWebp) {
    return null;
  }

  return {
    buffer,
    mimeType,
    extension: isJpeg ? 'jpg' : isPng ? 'png' : 'webp'
  };
}

async function getActiveUser(supabase, userId) {
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

async function findLegacyProfile(supabase, username) {
  const baseUsername = cleanUsername(username);

  const candidates = [
    username,
    baseUsername,
    `${baseUsername}@bean`
  ].filter(Boolean);

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('username', candidates)
    .limit(1);

  if (error) {
    throw error;
  }

  return data?.[0] || null;
}

function getPublicAvatarUrl(supabase, avatarUrl) {
  const avatarPath = getAvatarPath(avatarUrl);

  if (!isSafeAvatarPath(avatarPath)) {
    return null;
  }

  const { data } = supabase.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(avatarPath);

  return data?.publicUrl || null;
}

function profileResponse(supabase, user, profile) {
  const username = cleanUsername(user.username);

  return {
    user: {
      id: String(user.id),
      username,
      planType: String(user.plan_type || 'free')
    },
    profile: {
      avatarUrl: getPublicAvatarUrl(
        supabase,
        profile?.avatar_url
      ),
      hasLegacyProfile: Boolean(profile)
    }
  };
}

async function updateAvatarUrl(
  supabase,
  profileId,
  avatarUrl
) {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      avatar_url: avatarUrl
    })
    .eq('id', profileId)
    .select('id, username, avatar_url')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function uploadAvatar(supabase, userId, avatar) {
  const safeUserId = String(userId).replace(
    /[^a-zA-Z0-9_-]/g,
    ''
  );

  const avatarName =
    `neo-avatar-${safeUserId}-${Date.now()}.${avatar.extension}`;

  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(avatarName, avatar.buffer, {
      contentType: avatar.mimeType,
      cacheControl: '3600',
      upsert: false
    });

  if (error) {
    throw error;
  }

  return avatarName;
}

async function removeAvatarFile(supabase, avatarUrl) {
  const avatarPath = getAvatarPath(avatarUrl);

  if (!isSafeAvatarPath(avatarPath)) {
    return;
  }

  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .remove([avatarPath]);

  if (error) {
    console.warn(
      'Previous avatar could not be removed:',
      error.message
    );
  }
}

export default async function handler(req, res) {
  setJsonHeaders(res);

  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');

    return res.status(405).json({
      error: 'Method Not Allowed'
    });
  }

  const sessionUser = getAuthenticatedUser(req);

  if (!sessionUser?.userId) {
    return res.status(401).json({
      error: 'Authentication required.'
    });
  }

  if (req.method === 'PATCH') {
    try {
      if (!isAllowedOrigin(req)) {
        return res.status(403).json({
          error: 'Request origin is not allowed.'
        });
      }
    } catch {
      return res.status(500).json({
        error: 'Profile service is not configured safely.'
      });
    }
  }

  try {
    const supabase = createSupabaseAdmin();

    const user = await getActiveUser(
      supabase,
      sessionUser.userId
    );

    if (!user) {
      return res.status(401).json({
        error: 'Your account is no longer active.'
      });
    }

    const profile = await findLegacyProfile(
      supabase,
      user.username
    );

    if (req.method === 'GET') {
      return res.status(200).json({
        success: true,
        ...profileResponse(supabase, user, profile)
      });
    }

    const body = parseJsonBody(req);

    if (!body) {
      return res.status(400).json({
        error: 'Invalid JSON request.'
      });
    }

    if (!profile?.id) {
      return res.status(409).json({
        error:
          'Your legacy profile was not found. Do not create a new account; contact support so we can safely link it.'
      });
    }

    const wantsRemoval = body.removeAvatar === true;
    const hasAvatarUpload =
      Object.prototype.hasOwnProperty.call(
        body,
        'avatarDataUrl'
      );

    if (!wantsRemoval && !hasAvatarUpload) {
      return res.status(400).json({
        error: 'Choose an avatar image or remove the current avatar.'
      });
    }

    let updatedProfile;

    if (wantsRemoval) {
      updatedProfile = await updateAvatarUrl(
        supabase,
        profile.id,
        null
      );

      await removeAvatarFile(
        supabase,
        profile.avatar_url
      );
    } else {
      const avatar = parseAvatarDataUrl(body.avatarDataUrl);

      if (!avatar) {
        return res.status(400).json({
          error:
            'Avatar must be JPG, PNG, or WebP and smaller than 2 MB.'
        });
      }

      const newAvatarName = await uploadAvatar(
        supabase,
        user.id,
        avatar
      );

      try {
        updatedProfile = await updateAvatarUrl(
          supabase,
          profile.id,
          newAvatarName
        );
      } catch (error) {
        await removeAvatarFile(
          supabase,
          newAvatarName
        );

        throw error;
      }

      await removeAvatarFile(
        supabase,
        profile.avatar_url
      );
    }

    return res.status(200).json({
      success: true,
      ...profileResponse(
        supabase,
        user,
        updatedProfile
      )
    });
  } catch (error) {
    console.error('Profile API error:', {
      message: error?.message,
      code: error?.code
    });

    return res.status(500).json({
      error:
        'Unable to load or update your profile. Please try again.'
    });
  }
}
