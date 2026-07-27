// api/history.js – Conversation history management
// Includes detailed error logging to help debug 500 errors

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

function cleanString(str, max = 50000) {
    if (typeof str !== 'string') return '';
    return str.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);
}

// ---- safeMessage with attachments ----
function safeMessage(message) {
    const attachments = Array.isArray(message.attachments)
        ? message.attachments.slice(0, 5).map(file => ({
            provider: "supabase",
            bucket: "uploads",
            path: String(file?.path || "").trim(),
            name: String(file?.name || "Attached file").replace(/[\\/]/g, "-").slice(0, 180),
            mimeType: String(file?.mimeType || file?.type || "application/octet-stream").slice(0, 120),
            type: String(file?.mimeType || file?.type || "application/octet-stream").slice(0, 120),
            category: String(file?.category || "text").toLowerCase().slice(0, 20),
            size: Number.isFinite(Number(file?.size)) ? Math.max(0, Number(file.size)) : 0
        }))
        .filter(f => {
            return f.path &&
                !f.path.startsWith("/") &&
                !f.path.includes("..") &&
                !f.path.startsWith("http") &&
                !f.path.startsWith("data:") &&
                !f.path.startsWith("blob:");
        })
        : [];

    return {
        id: String(message.id),
        role: message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : "system",
        content: cleanString(message.content, 50000),
        displayContent: cleanString(message.content, 50000),
        attachments,
        createdAt: message.created_at || null
    };
}

// ---- List conversations ----
async function listConversations(userId) {
    const { data, error } = await supabase
        .from('conversations')
        .select('id, title, created_at, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
}

// ---- Get conversation messages ----
async function getConversation(convId, userId) {
    const { data: conv, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', convId)
        .eq('user_id', userId)
        .single();
    if (convError || !conv) throw new Error('Conversation not found');
    const { data: messages, error: msgError } = await supabase
        .from('messages')
        .select('id, role, content, attachments, created_at')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });
    if (msgError) throw new Error(msgError.message);
    return messages.map(safeMessage);
}

// ---- Delete conversation ----
async function deleteConversation(convId, userId) {
    const { data: conv, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', convId)
        .eq('user_id', userId)
        .single();
    if (convError || !conv) throw new Error('Conversation not found');
    await supabase.from('messages').delete().eq('conversation_id', convId);
    await supabase.from('conversations').delete().eq('id', convId);
}

// ---- Rename conversation ----
async function renameConversation(convId, userId, newTitle) {
    const { error } = await supabase
        .from('conversations')
        .update({ title: cleanString(newTitle, 100) })
        .eq('id', convId)
        .eq('user_id', userId);
    if (error) throw new Error(error.message);
}

// ---- Main handler with detailed error debugging ----
module.exports = async (req, res) => {
    try {
        // Log environment check (remove after debugging)
        console.log('=== /api/history called ===');
        console.log('SUPABASE_URL set:', !!process.env.SUPABASE_URL);
        console.log('SUPABASE_ANON_KEY set:', !!process.env.SUPABASE_ANON_KEY);

        const user = req.user;
        if (!user || !user.id) {
            console.error('Auth error: req.user is missing or has no id');
            return res.status(401).json({ 
                error: 'Unauthorized - User session not found',
                debug: { hasUser: !!user, hasId: user?.id ? true : false }
            });
        }

        const { method, body } = req;
        const { action, conversationId, title } = body || {};

        if (method === 'GET') {
            const conversations = await listConversations(user.id);
            return res.json({ conversations });
        }

        if (method === 'POST') {
            if (!action) return res.status(400).json({ error: 'Missing action' });

            switch (action) {
                case 'get':
                    if (!conversationId) return res.status(400).json({ error: 'Missing conversationId' });
                    const messages = await getConversation(conversationId, user.id);
                    return res.json({ messages });
                case 'delete':
                    if (!conversationId) return res.status(400).json({ error: 'Missing conversationId' });
                    await deleteConversation(conversationId, user.id);
                    return res.json({ success: true });
                case 'rename':
                    if (!conversationId || !title) return res.status(400).json({ error: 'Missing conversationId or title' });
                    await renameConversation(conversationId, user.id, title);
                    return res.json({ success: true });
                default:
                    return res.status(400).json({ error: 'Invalid action' });
            }
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('=== HISTORY API ERROR ===');
        console.error(error);
        // Return detailed error to frontend for debugging
        return res.status(500).json({
            error: error.message,
            stack: error.stack,
            // Include helpful debug info
            debug: {
                hasUser: !!req.user,
                hasBody: !!req.body,
                method: req.method,
                action: req.body?.action || 'none'
            }
        });
    }
};
