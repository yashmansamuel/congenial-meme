import { createClient } from '@supabase/supabase-js';

import { getAuthenticatedUser } from '../lib/auth.js';

import {
  setJsonHeaders,
  parseJsonBody,
  isAllowedOrigin,
  positiveInteger
} from '../lib/http.js';

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 100;
const MAX_TITLE_LENGTH = 80;

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

  const parsedUrl = new URL(supabaseUrl);

  if (
    process.env.NODE_ENV === 'production' &&
    parsedUrl.protocol !== 'https:'
  ) {
    throw new Error('Supabase must use HTTPS in production.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      headers: {
        'X-Client-Info': 'signaturesi-neo-history'
      }
    }
  });
}

function cleanString(value, maxLength = 200) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxLength);
}

function normalizeAction(value) {
  const action = cleanString(value, 40).toLowerCase();

  const aliases = {
    history: 'list',
    conversations: 'list',
    load: 'get',
    open: 'get',
    messages: 'get',
    remove: 'delete',
    update: 'rename',
    title: 'rename'
  };

  return aliases[action] || action;
}

function getHistoryLimit(value) {
  return Math.min(
    positiveInteger(value, DEFAULT_HISTORY_LIMIT),
    MAX_HISTORY_LIMIT
  );
}

function validateConversationId(value) {
  const id = cleanString(value, 100);

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(id)) {
    return '';
  }

  return id;
}

function getConversationId(req, body) {
  return validateConversationId(
    body?.conversationId ||
      body?.conversation_id ||
      req.query?.conversationId ||
      req.query?.conversation_id ||
      ''
  );
}

function safeConversation(conversation) {
  return {
    id: String(conversation.id),
    title:
      cleanString(conversation.title, MAX_TITLE_LENGTH) ||
      'New Chat',
    model:
      conversation.model_used ||
      conversation.model ||
      null,
    createdAt: conversation.created_at || null,
    updatedAt:
      conversation.updated_at ||
      conversation.created_at ||
      null
  };
}

// ---------- UPDATED safeMessage with attachments ----------
function safeMessage(message) {
  return {
    id: String(message.id),
    role:
      message.role === 'assistant'
        ? 'assistant'
        : message.role === 'user'
        ? 'user'
        : 'system',
    content: cleanString(message.content, 50_000),
    attachments: Array.isArray(message.attachments)
      ? message.attachments
      : [],
    createdAt: message.created_at || null
  };
}
// ----------------------------------------------------------

async function verifyConversationOwnership(
  supabase,
  conversationId,
  userId
) {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select(
      'id, title, model_used, created_at, updated_at'
    )
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function listConversations(
  supabase,
  userId,
  limit
) {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select(
      'id, title, model_used, created_at, updated_at'
    )
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data || []).map(safeConversation);
}

// ---------- UPDATED loadConversationMessages with attachments ----------
async function loadConversationMessages(
  supabase,
  conversationId
) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, attachments, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) {
    throw error;
  }

  return (data || []).map(safeMessage);
}
// ----------------------------------------------------------------------

async function renameConversation(
  supabase,
  conversationId,
  userId,
  title
) {
  const cleanTitle = cleanString(
    title,
    MAX_TITLE_LENGTH
  ).replace(/\s+/g, ' ');

  if (!cleanTitle) {
    throw new Error('A conversation title is required.');
  }

  const { data, error } = await supabase
    .from('chat_conversations')
    .update({
      title: cleanTitle,
      updated_at: new Date().toISOString()
    })
    .eq('id', conversationId)
    .eq('user_id', userId)
    .select(
      'id, title, model_used, created_at, updated_at'
    )
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function deleteConversation(
  supabase,
  conversationId,
  userId
) {
  const { data, error } = await supabase.rpc(
    'delete_own_conversation',
    {
      p_user_id: userId,
      p_conversation_id: conversationId
    }
  );

  if (error) {
    throw error;
  }

  return data === true;
}

function methodAllowsAction(method, action) {
  if (method === 'GET') {
    return ['list', 'get'].includes(action);
  }

  if (method === 'DELETE') {
    return action === 'delete';
  }

  if (method === 'PATCH') {
    return action === 'rename';
  }

  if (method === 'POST') {
    return ['list', 'get', 'delete', 'rename'].includes(
      action
    );
  }

  return false;
}

export default async function handler(req, res) {
  setJsonHeaders(res);

  const allowedMethods = ['GET', 'POST', 'DELETE', 'PATCH'];

  if (!allowedMethods.includes(req.method)) {
    res.setHeader('Allow', allowedMethods.join(', '));

    return res.status(405).json({
      error: 'Method Not Allowed'
    });
  }

  const authUser = getAuthenticatedUser(req);

  if (!authUser?.userId) {
    return res.status(401).json({
      error: 'Authentication required. Please log in.'
    });
  }

  if (req.method !== 'GET') {
    try {
      if (!isAllowedOrigin(req)) {
        return res.status(403).json({
          error: 'Request origin is not allowed.'
        });
      }
    } catch {
      return res.status(500).json({
        error: 'History service is not configured safely.'
      });
    }
  }

  const body =
    req.method === 'GET'
      ? {}
      : parseJsonBody(req);

  if (!body) {
    return res.status(400).json({
      error: 'Invalid JSON request.'
    });
  }

  const conversationId = getConversationId(req, body);

  let action = normalizeAction(
    body.action || req.query?.action || ''
  );

  if (!action) {
    if (req.method === 'DELETE') {
      action = 'delete';
    } else if (req.method === 'PATCH') {
      action = 'rename';
    } else if (conversationId) {
      action = 'get';
    } else {
      action = 'list';
    }
  }

  if (!methodAllowsAction(req.method, action)) {
    return res.status(405).json({
      error: 'This method cannot perform the requested action.'
    });
  }

  if (
    ['get', 'delete', 'rename'].includes(action) &&
    !conversationId
  ) {
    return res.status(400).json({
      error: 'A valid conversation ID is required.'
    });
  }

  let supabase;

  try {
    supabase = createSupabaseAdmin();

    if (action === 'list') {
      const conversations = await listConversations(
        supabase,
        authUser.userId,
        getHistoryLimit(body.limit || req.query?.limit)
      );

      return res.status(200).json({
        success: true,
        conversations,
        count: conversations.length
      });
    }

    if (action === 'get') {
      const conversation =
        await verifyConversationOwnership(
          supabase,
          conversationId,
          authUser.userId
        );

      if (!conversation) {
        return res.status(404).json({
          error: 'Conversation not found.'
        });
      }

      const messages = await loadConversationMessages(
        supabase,
        conversationId
      );

      return res.status(200).json({
        success: true,
        conversation: safeConversation(conversation),
        messages
      });
    }

    if (action === 'rename') {
      const conversation =
        await renameConversation(
          supabase,
          conversationId,
          authUser.userId,
          body.title
        );

      if (!conversation) {
        return res.status(404).json({
          error: 'Conversation not found.'
        });
      }

      return res.status(200).json({
        success: true,
        conversation: safeConversation(conversation)
      });
    }

    if (action === 'delete') {
      const deleted = await deleteConversation(
        supabase,
        conversationId,
        authUser.userId
      );

      if (!deleted) {
        return res.status(404).json({
          error: 'Conversation not found.'
        });
      }

      return res.status(200).json({
        success: true,
        deleted: true,
        conversationId
      });
    }

    return res.status(400).json({
      error: 'Invalid history action.'
    });
  } catch (error) {
    console.error('History request failed:', {
      message: error?.message,
      code: error?.code
    });

    return res.status(500).json({
      error: 'Unable to process conversation history.'
    });
  }
}
