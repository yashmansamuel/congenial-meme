// api/history.js

import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser } from '../lib/auth.js';
import { isAllowedOrigin } from '../lib/http.js';

const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 200;
const MAX_TITLE_LENGTH = 80;

function setResponseHeaders(res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate'
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function createSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing required Supabase environment variables.'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function parseRequestBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === 'object') {
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

function cleanString(value, maxLength = 200) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxLength);
}

function getHistoryLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HISTORY_LIMIT;
  }

  return Math.min(parsed, MAX_HISTORY_LIMIT);
}

function normalizeAction(value) {
  const action = cleanString(value, 40).toLowerCase();

  const aliases = {
    history: 'list',
    conversations: 'list',
    gethistory: 'list',

    load: 'get',
    open: 'get',
    messages: 'get',
    conversation: 'get',

    remove: 'delete',

    update: 'rename',
    title: 'rename'
  };

  return aliases[action] || action;
}

function getConversationId(req, body) {
  return cleanString(
    body?.conversationId ||
      body?.conversation_id ||
      req.query?.conversationId ||
      req.query?.conversation_id ||
      '',
    100
  );
}

function safeConversation(conversation) {
  return {
    id: String(conversation.id),
    title:
      typeof conversation.title === 'string' &&
      conversation.title.trim()
        ? conversation.title.trim()
        : 'New Chat',
    model:
      conversation.model_used ||
      conversation.model ||
      null,
    createdAt:
      conversation.created_at || null,
    updatedAt:
      conversation.updated_at ||
      conversation.created_at ||
      null
  };
}

function safeMessage(message) {
  return {
    id: String(message.id),
    role: message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        : '',
    createdAt: message.created_at || null
  };
}

async function verifyConversationOwnership(
  supabase,
  conversationId,
  userId
) {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('*')
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
    .select('*')
    .eq('user_id', userId)
    .order('created_at', {
      ascending: false
    })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data || []).map(safeConversation);
}

async function loadConversationMessages(
  supabase,
  conversationId
) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', {
      ascending: true
    });

  if (error) {
    throw error;
  }

  return (data || []).map(safeMessage);
}

async function deleteConversation(
  supabase,
  conversationId,
  userId
) {
  const conversation =
    await verifyConversationOwnership(
      supabase,
      conversationId,
      userId
    );

  if (!conversation) {
    return false;
  }

  /*
   * Delete messages first so this works even when the database
   * does not have ON DELETE CASCADE configured.
   */
  const { error: messageDeleteError } =
    await supabase
      .from('chat_messages')
      .delete()
      .eq('conversation_id', conversationId);

  if (messageDeleteError) {
    throw messageDeleteError;
  }

  const { error: conversationDeleteError } =
    await supabase
      .from('chat_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', userId);

  if (conversationDeleteError) {
    throw conversationDeleteError;
  }

  return true;
}

async function renameConversation(
  supabase,
  conversationId,
  userId,
  title
) {
  const conversation =
    await verifyConversationOwnership(
      supabase,
      conversationId,
      userId
    );

  if (!conversation) {
    return null;
  }

  const cleanTitle = cleanString(
    title,
    MAX_TITLE_LENGTH
  ).replace(/\s+/g, ' ');

  if (!cleanTitle) {
    throw new Error('INVALID_TITLE');
  }

  const { data, error } = await supabase
    .from('chat_conversations')
    .update({
      title: cleanTitle
    })
    .eq('id', conversationId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return safeConversation(data);
}

export default async function handler(req, res) {
  setResponseHeaders(res);

  const allowedMethods = [
    'GET',
    'POST',
    'DELETE',
    'PATCH'
  ];

  if (!allowedMethods.includes(req.method)) {
    res.setHeader(
      'Allow',
      allowedMethods.join(', ')
    );

    return res.status(405).json({
      error: 'Method Not Allowed'
    });
  }

  /*
   * Identity always comes from the signed HttpOnly cookie.
   * userId or username supplied by the frontend is ignored.
   */
  const authUser = getAuthenticatedUser(req);

  if (!authUser?.userId) {
    return res.status(401).json({
      error: 'Authentication required. Please log in.',
      authenticated: false
    });
  }

  if (req.method !== 'GET') {
    try {
      if (!isAllowedOrigin(req)) {
        return res.status(403).json({ error: 'Request origin is not allowed.' });
      }
    } catch (error) {
      console.error('History origin configuration error:', error.message);
      return res.status(500).json({ error: 'History is not configured safely.' });
    }
  }

  const body =
    req.method === 'GET'
      ? {}
      : parseRequestBody(req);

  if (body === null) {
    return res.status(400).json({
      error: 'Invalid JSON request payload.'
    });
  }

  let action = normalizeAction(
    body?.action || req.query?.action || ''
  );

  /*
   * Sensible defaults:
   * GET without conversationId = list
   * GET with conversationId = get
   * DELETE = delete
   * PATCH = rename
   */
  const conversationId =
    getConversationId(req, body);

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

  let supabase;

  try {
    supabase = createSupabaseAdmin();
  } catch (error) {
    console.error(
      'History configuration error:',
      error.message
    );

    return res.status(500).json({
      error:
        'The conversation history service is not configured.'
    });
  }

  const userId = authUser.userId;

  try {
    /*
     * LIST USER CONVERSATIONS
     *
     * Supported:
     * GET /api/history
     * GET /api/history?action=list
     * POST { action: "list" }
     */
    if (action === 'list') {
      const limit = getHistoryLimit(
        body?.limit || req.query?.limit
      );

      const conversations =
        await listConversations(
          supabase,
          userId,
          limit
        );

      return res.status(200).json({
        success: true,
        conversations,
        history: conversations,
        count: conversations.length
      });
    }

    /*
     * LOAD ONE CONVERSATION
     *
     * Supported:
     * GET /api/history?conversationId=...
     * POST {
     *   action: "get",
     *   conversationId: "..."
     * }
     */
    if (action === 'get') {
      if (!conversationId) {
        return res.status(400).json({
          error: 'Conversation ID is required.'
        });
      }

      const conversation =
        await verifyConversationOwnership(
          supabase,
          conversationId,
          userId
        );

      if (!conversation) {
        return res.status(404).json({
          error: 'Conversation not found.'
        });
      }

      const messages =
        await loadConversationMessages(
          supabase,
          conversationId
        );

      return res.status(200).json({
        success: true,
        conversation:
          safeConversation(conversation),
        messages
      });
    }

    /*
     * DELETE ONE CONVERSATION
     *
     * Supported:
     * DELETE /api/history?conversationId=...
     * POST {
     *   action: "delete",
     *   conversationId: "..."
     * }
     */
    if (action === 'delete') {
      if (!conversationId) {
        return res.status(400).json({
          error: 'Conversation ID is required.'
        });
      }

      const deleted =
        await deleteConversation(
          supabase,
          conversationId,
          userId
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

    /*
     * RENAME ONE CONVERSATION
     *
     * Supported:
     * PATCH {
     *   conversationId: "...",
     *   title: "New title"
     * }
     *
     * POST {
     *   action: "rename",
     *   conversationId: "...",
     *   title: "New title"
     * }
     */
    if (action === 'rename') {
      if (!conversationId) {
        return res.status(400).json({
          error: 'Conversation ID is required.'
        });
      }

      const title = cleanString(
        body?.title,
        MAX_TITLE_LENGTH
      );

      if (!title) {
        return res.status(400).json({
          error: 'A valid conversation title is required.'
        });
      }

      const updatedConversation =
        await renameConversation(
          supabase,
          conversationId,
          userId,
          title
        );

      if (!updatedConversation) {
        return res.status(404).json({
          error: 'Conversation not found.'
        });
      }

      return res.status(200).json({
        success: true,
        conversation: updatedConversation
      });
    }

    return res.status(400).json({
      error: 'Invalid history action.'
    });
  } catch (error) {
    console.error('History API error:', {
      message: error?.message,
      code: error?.code
    });

    if (error?.message === 'INVALID_TITLE') {
      return res.status(400).json({
        error: 'A valid conversation title is required.'
      });
    }

    return res.status(500).json({
      error:
        'Unable to process conversation history. Please try again.'
    });
  }
}
