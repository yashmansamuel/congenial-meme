// api/history.js
// Handles conversation history: list, get, delete, rename

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Clean a string: trim, truncate, remove control chars
function cleanString(str, maxLength = 50000) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\x00-\x1F\x7F]/g, '')   // remove control characters
    .trim()
    .slice(0, maxLength);
}

// ----------------------------------------------------------------
// REPLACED safeMessage() – with attachment handling
// ----------------------------------------------------------------
function safeMessage(message) {
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
        .slice(0, 5)
        .map(file => ({
          provider: "supabase",
          bucket: "uploads",
          path: String(file?.path || "").trim(),
          name: String(file?.name || "Attached file")
            .replace(/[\\/]/g, "-")
            .slice(0, 180),
          mimeType: String(
            file?.mimeType ||
            file?.type ||
            "application/octet-stream"
          ).slice(0, 120),
          type: String(
            file?.mimeType ||
            file?.type ||
            "application/octet-stream"
          ).slice(0, 120),
          category: String(file?.category || "text")
            .toLowerCase()
            .slice(0, 20),
          size: Number.isFinite(Number(file?.size))
            ? Math.max(0, Number(file.size))
            : 0
        }))
        .filter(file => {
          return (
            file.path &&
            !file.path.startsWith("/") &&
            !file.path.includes("..") &&
            !file.path.startsWith("http") &&
            !file.path.startsWith("data:") &&
            !file.path.startsWith("blob:")
          );
        })
    : [];

  return {
    id: String(message.id),

    role:
      message.role === "assistant"
        ? "assistant"
        : message.role === "user"
        ? "user"
        : "system",

    content: cleanString(
      message.content,
      50_000
    ),

    attachments,

    createdAt:
      message.created_at || null
  };
}
// ----------------------------------------------------------------

// GET /api/history – list all conversations for the authenticated user
async function listConversations(userId) {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

// GET /api/history/:conversationId – get full conversation
async function getConversation(conversationId, userId) {
  // Verify ownership
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .single();

  if (convError || !conv) {
    throw new Error('Conversation not found or access denied');
  }

  // Fetch messages with attachments
  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('id, role, content, attachments, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (msgError) throw new Error(msgError.message);

  return messages.map(safeMessage);
}

// DELETE /api/history/:conversationId
async function deleteConversation(conversationId, userId) {
  // Verify ownership
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .single();

  if (convError || !conv) {
    throw new Error('Conversation not found or access denied');
  }

  // Delete messages first (cascade would also work)
  const { error: msgError } = await supabase
    .from('messages')
    .delete()
    .eq('conversation_id', conversationId);

  if (msgError) throw new Error(msgError.message);

  const { error: convError2 } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId);

  if (convError2) throw new Error(convError2.message);
}

// RENAME /api/history/:conversationId (optional)
async function renameConversation(conversationId, userId, newTitle) {
  const { error } = await supabase
    .from('conversations')
    .update({ title: cleanString(newTitle, 100) })
    .eq('id', conversationId)
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
}

// Main handler
module.exports = async (req, res) => {
  try {
    // Extract authenticated user from session (assume middleware sets req.user)
    const user = req.user;
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { method, query, body } = req;
    const { action, conversationId, title } = body || {};

    // GET /api/history
    if (method === 'GET') {
      const conversations = await listConversations(user.id);
      return res.json({ conversations });
    }

    // POST /api/history – actions: get, delete, rename
    if (method === 'POST') {
      if (!action) {
        return res.status(400).json({ error: 'Missing action' });
      }

      switch (action) {
        case 'get':
          if (!conversationId) {
            return res.status(400).json({ error: 'Missing conversationId' });
          }
          const messages = await getConversation(conversationId, user.id);
          return res.json({ messages });

        case 'delete':
          if (!conversationId) {
            return res.status(400).json({ error: 'Missing conversationId' });
          }
          await deleteConversation(conversationId, user.id);
          return res.json({ success: true });

        case 'rename':
          if (!conversationId || !title) {
            return res.status(400).json({ error: 'Missing conversationId or title' });
          }
          await renameConversation(conversationId, user.id, title);
          return res.json({ success: true });

        default:
          return res.status(400).json({ error: 'Invalid action' });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('History API error:', error);
    return res.status(500).json({ error: error.message });
  }
};
