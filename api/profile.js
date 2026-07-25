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

function isLegacyAssetPath(value) {
  return (
    typeof value === 'string' &&
    /^\/assets\/avatars\/[a-zA-Z0-9@._-]{1,200}$/.test(
      value.trim()
    )
  );
}

function isSafeStoragePath(value) {
  return (
    typeof value === 'string' &&
    /^[a-zA-Z0-9._-]{1,180}$/.test(value)
  );
}

function getStoragePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const rawValue = value.trim();

  if (isLegacyAssetPath(rawValue)) {
    return null;
  }

  if (
    rawValue.startsWith(
      '/storage/v1/object/public/avatars/'
    )
  ) {
    return decodeURIComponent(
      rawValue.split('/avatars/').pop() || ''
    );
  }

  if (rawValue.startsWith('/avatars/')) {
    return decodeURIComponent(
      rawValue.replace(/^\/avatars\//, '')
    );
  }

  if (rawValue.startsWith('http')) {
    try {
      const url = new URL(rawValue);
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

  return rawValue.replace(/^avatars\//i, '');
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
    baseUsername,
    `${baseUsername}@bean`,
    `@${baseUsername}`
  ];

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('username', candidates);

  if (error) {
    throw error;
  }

  if (!data?.length) {
    return null;
  }

  /*
   * Prefer the original Bean record:
   * username@bean, then plain username.
   */
  return (
    data.find(
      profile =>
        String(profile.username || '').toLowerCase() ===
        `${baseUsername}@bean`
    ) ||
    data.find(
      profile =>
        cleanUsername(profile.username) === baseUsername
    ) ||
    data[0]
  );
}

function getPublicAvatarUrl(supabase, avatarUrl) {
  if (
    typeof avatarUrl !== 'string' ||
    !avatarUrl.trim()
  ) {
    return null;
  }

  const rawAvatarUrl = avatarUrl.trim();

  /*
   * Existing legacy avatar already lives on this website.
   */
  if (isLegacyAssetPath(rawAvatarUrl)) {
    return rawAvatarUrl;
  }

  /*
   * New uploaded avatars use Supabase Storage bucket "avatars".
   */
  const storagePath = getStoragePath(rawAvatarUrl);

  if (!isSafeStoragePath(storagePath)) {
    return null;
  }

  const { data } = supabase.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(storagePath);

  return data?.publicUrl || null;
}

function publicResponse(supabase, user, profile) {
  return {
    user: {
      id: String(user.id),
      username: cleanUsername(user.username),
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
  profile,
  avatarUrl
) {
  let query = supabase
    .from('profiles')
    .update({
      avatar_url: avatarUrl
    });

  /*
   * Your old profiles table has id = NULL,
   * therefore username is the safe record identifier.
   */
  if (
    profile?.id !== null &&
    profile?.id !== undefined &&
    profile?.id !== ''
  ) {
    query = query.eq('id', profile.id);
  } else {
    query = query.eq('username', profile.username);
  }

  const { data, error } = await query
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

  const fileName =
    `neo-avatar-${safeUserId}-${Date.now()}.${avatar.extension}`;

  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(fileName, avatar.buffer, {
      contentType: avatar.mimeType,
      cacheControl: '3600',
      upsert: false
    });

  if (error) {
    throw error;
  }

  return fileName;
}

async function removeStorageAvatar(supabase, avatarUrl) {
  if (isLegacyAssetPath(avatarUrl)) {
    return;
  }

  const storagePath = getStoragePath(avatarUrl);

  if (!isSafeStoragePath(storagePath)) {
    return;
  }

  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .remove([storagePath]);

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
        ...publicResponse(supabase, user, profile)
      });
    }

    const body = parseJsonBody(req);

    if (!body) {
      return res.status(400).json({
        error: 'Invalid JSON request.'
      });
    }

    if (!profile) {
      return res.status(409).json({
        error:
          'Profile record was not found. Please contact support before changing your avatar.'
      });
    }

    const wantsRemoval = body.removeAvatar === true;
    const hasNewAvatar =
      Object.prototype.hasOwnProperty.call(
        body,
        'avatarDataUrl'
      );

    if (!wantsRemoval && !hasNewAvatar) {
      return res.status(400).json({
        error: 'Choose a new avatar or remove the current avatar.'
      });
    }

    let updatedProfile;

    if (wantsRemoval) {
      updatedProfile = await updateAvatarUrl(
        supabase,
        profile,
        null
      );

      await removeStorageAvatar(
        supabase,
        profile.avatar_url
      );
    } else {
      const avatar = parseAvatarDataUrl(body.avatarDataUrl);

      if (!avatar) {
        return res.status(400).json({
          error:
            'Avatar must be a JPG, PNG, or WebP image smaller than 2 MB.'
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
          profile,
          newAvatarName
        );
      } catch (error) {
        await removeStorageAvatar(
          supabase,
          newAvatarName
        );

        throw error;
      }

      await removeStorageAvatar(
        supabase,
        profile.avatar_url
      );
    }

    return res.status(200).json({
      success: true,
      ...publicResponse(
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
