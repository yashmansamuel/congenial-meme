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

const PERSONALITIES = new Set([
  'balanced',
  'researcher',
  'strategist',
  'creative',
  'teacher',
  'coding_expert',
  'business_advisor',
  'deep_thinker',
  'warm_companion'
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

function cleanDisplayName(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
}

function getStoragePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const raw = value.trim();

  if (raw.startsWith('/assets/avatars/')) {
    return decodeURIComponent(
      raw.split('/').pop() || ''
    );
  }

  if (
    raw.startsWith(
      '/storage/v1/object/public/avatars/'
    )
  ) {
    return decodeURIComponent(
      raw.split('/avatars/').pop() || ''
    );
  }

  if (raw.startsWith('/avatars/')) {
    return decodeURIComponent(
      raw.replace(/^\/avatars\//, '')
    );
  }

  if (raw.startsWith('http')) {
    try {
      const url = new URL(raw);

      if (!url.pathname.includes('/avatars/')) {
        return null;
      }

      return decodeURIComponent(
        url.pathname.split('/avatars/').pop() || ''
      );
    } catch {
      return null;
    }
  }

  return raw.replace(/^avatars\//i, '');
}

function isSafeStoragePath(value) {
  return (
    typeof value === 'string' &&
    /^[a-zA-Z0-9@._-]{1,180}$/.test(value)
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
    buffer.length === 0 ||
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
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a
      ])
    );

  const isWebp =
    mimeType === 'image/webp' &&
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') ===
      'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') ===
      'WEBP';

  if (!isJpeg && !isPng && !isWebp) {
    return null;
  }

  return {
    buffer,
    mimeType,
    extension: isJpeg
      ? 'jpg'
      : isPng
        ? 'png'
        : 'webp'
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

async function findProfile(supabase, username) {
  const baseUsername = cleanUsername(username);

  const candidates = [
    `${baseUsername}@bean`,
    baseUsername,
    `@${baseUsername}`
  ];

  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, username, avatar_url, display_name, selected_personality, notifications_enabled, product_updates_enabled'
    )
    .in('username', candidates);

  if (error) {
    throw error;
  }

  if (!data?.length) {
    return null;
  }

  return (
    data.find(
      row =>
        String(row.username || '').toLowerCase() ===
        `${baseUsername}@bean`
    ) ||
    data.find(
      row =>
        cleanUsername(row.username) === baseUsername
    ) ||
    data[0]
  );
}

function getPublicAvatarUrl(
  supabase,
  avatarValue
) {
  const storagePath = getStoragePath(avatarValue);

  if (!isSafeStoragePath(storagePath)) {
    return null;
  }

  const { data } = supabase.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(storagePath);

  return data?.publicUrl || null;
}

function publicResponse(
  supabase,
  user,
  profile
) {
  const username = cleanUsername(user.username);

  const personality = PERSONALITIES.has(
    profile?.selected_personality
  )
    ? profile.selected_personality
    : 'balanced';

  return {
    user: {
      id: String(user.id),
      username,
      planType: String(
        user.plan_type || 'free'
      )
    },

    profile: {
      displayName:
        cleanDisplayName(
          profile?.display_name
        ) || username,

      avatarUrl: getPublicAvatarUrl(
        supabase,
        profile?.avatar_url
      ),

      selectedPersonality: personality,

      notificationsEnabled:
        profile?.notifications_enabled !== false,

      productUpdatesEnabled:
        profile?.product_updates_enabled === true,

      hasLegacyProfile: Boolean(profile)
    }
  };
}

async function updateProfile(
  supabase,
  profile,
  values
) {
  const { data, error } = await supabase
    .from('profiles')
    .update(values)
    .eq('username', profile.username)
    .select(
      'id, username, avatar_url, display_name, selected_personality, notifications_enabled, product_updates_enabled'
    )
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function uploadAvatar(
  supabase,
  userId,
  avatar
) {
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

async function removeAvatar(
  supabase,
  avatarValue
) {
  const storagePath =
    getStoragePath(avatarValue);

  if (!isSafeStoragePath(storagePath)) {
    return;
  }

  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .remove([storagePath]);

  if (error) {
    console.warn(
      'Avatar cleanup failed:',
      error.message
    );
  }
}

export default async function handler(
  req,
  res
) {
  setJsonHeaders(res);

  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');

    return res.status(405).json({
      error: 'Method Not Allowed'
    });
  }

  const sessionUser =
    getAuthenticatedUser(req);

  if (!sessionUser?.userId) {
    return res.status(401).json({
      error: 'Authentication required.'
    });
  }

  if (req.method === 'PATCH') {
    try {
      if (!isAllowedOrigin(req)) {
        return res.status(403).json({
          error:
            'Request origin is not allowed.'
        });
      }
    } catch {
      return res.status(500).json({
        error:
          'Profile service is not configured safely.'
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
        error:
          'Your account is no longer active.'
      });
    }

    const profile = await findProfile(
      supabase,
      user.username
    );

    if (req.method === 'GET') {
      return res.status(200).json({
        success: true,
        ...publicResponse(
          supabase,
          user,
          profile
        )
      });
    }

    if (!profile) {
      return res.status(409).json({
        error:
          'Your profile is not linked yet. Please contact support.'
      });
    }

    const body = parseJsonBody(req);

    if (!body) {
      return res.status(400).json({
        error: 'Invalid JSON request.'
      });
    }

    const updates = {};
    let uploadedAvatar = null;
    const previousAvatar = profile.avatar_url;

    if (
      Object.prototype.hasOwnProperty.call(
        body,
        'displayName'
      )
    ) {
      const displayName =
        cleanDisplayName(body.displayName);

      if (!displayName) {
        return res.status(400).json({
          error:
            'Display name must contain 1–50 valid characters.'
        });
      }

      updates.display_name = displayName;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        body,
        'selectedPersonality'
      )
    ) {
      const personality =
        typeof body.selectedPersonality ===
        'string'
          ? body.selectedPersonality
              .trim()
              .toLowerCase()
          : '';

      if (!PERSONALITIES.has(personality)) {
        return res.status(400).json({
          error: 'Invalid NEO personality.'
        });
      }

      updates.selected_personality =
        personality;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        body,
        'notificationsEnabled'
      )
    ) {
      if (
        typeof body.notificationsEnabled !==
        'boolean'
      ) {
        return res.status(400).json({
          error:
            'Notification preference must be true or false.'
        });
      }

      updates.notifications_enabled =
        body.notificationsEnabled;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        body,
        'productUpdatesEnabled'
      )
    ) {
      if (
        typeof body.productUpdatesEnabled !==
        'boolean'
      ) {
        return res.status(400).json({
          error:
            'Product update preference must be true or false.'
        });
      }

      updates.product_updates_enabled =
        body.productUpdatesEnabled;
    }

    if (body.removeAvatar === true) {
      updates.avatar_url = null;
    } else if (
      Object.prototype.hasOwnProperty.call(
        body,
        'avatarDataUrl'
      )
    ) {
      const avatar = parseAvatarDataUrl(
        body.avatarDataUrl
      );

      if (!avatar) {
        return res.status(400).json({
          error:
            'Avatar must be JPG, PNG, or WebP and smaller than 2 MB.'
        });
      }

      uploadedAvatar = await uploadAvatar(
        supabase,
        user.id,
        avatar
      );

      updates.avatar_url = uploadedAvatar;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({
        error:
          'No profile changes were provided.'
      });
    }

    let savedProfile;

    try {
      savedProfile = await updateProfile(
        supabase,
        profile,
        updates
      );
    } catch (error) {
      if (uploadedAvatar) {
        await removeAvatar(
          supabase,
          uploadedAvatar
        );
      }

      throw error;
    }

    if (
      previousAvatar &&
      (
        uploadedAvatar ||
        body.removeAvatar === true
      )
    ) {
      await removeAvatar(
        supabase,
        previousAvatar
      );
    }

    return res.status(200).json({
      success: true,
      ...publicResponse(
        supabase,
        user,
        savedProfile
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
