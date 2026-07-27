import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

function cleanString(str, max = 50000) {
    if (typeof str !== 'string') return '';
    return str.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);
}

function safeMessage(message) {
    const attachments = Array.isArray(message.attachments)
        ? message.attachments.slice(0, 5).map(f => ({
            provider: "supabase",
            bucket: "uploads",
            path: String(f.path || "").trim(),
            name: String(f.name || "Attached file").slice(0, 180),
            mimeType: String(f.mimeType || f.type || "application/octet-stream").slice(0, 120),
            category: String(f.category || "text").toLowerCase().slice(0, 20),
            size: Number.isFinite(Number(f.size)) ? Math.max(0, Number(f.size)) : 0
        }))
        .filter(f => f.path && !f.path.includes('..'))
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

// ------ Main Handler ------
export default async (req, res) => {
    try {
        const user = req.user;
        if (!user || !user.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { method, body } = req;
        const { action, conversationId, title } = body || {};

        // GET: Fetch all conversations
        if (method === 'GET') {
            const { data, error } = await supabase
                .from('conversations')
                .select('id, title, created_at, updated_at')
                .eq('user_id', user.id)
                .order('updated_at', { ascending: false });

            if (error) throw new Error(error.message);
            return res.json({ conversations: data || [] });
        }

        // POST: actions (get, delete, rename)
        if (method === 'POST') {
            if (!action) return res.status(400).json({ error: 'Missing action' });

            switch (action) {
                case 'get': {
                    if (!conversationId) return res.status(400).json({ error: 'Missing conversationId' });
                    
                    const { data: conv, error: convError } = await supabase
                        .from('conversations')
                        .select('id')
                        .eq('id', conversationId)
                        .eq('user_id', user.id)
                        .single();
                    if (convError || !conv) throw new Error('Conversation not found');

                    const { data: messages, error: msgError } = await supabase
                        .from('messages')
                        .select('id, role, content, attachments, created_at')
                        .eq('conversation_id', conversationId)
                        .order('created_at', { ascending: true });
                    if (msgError) throw new Error(msgError.message);

                    return res.json({ messages: messages.map(safeMessage) });
                }

                case 'delete': {
                    if (!conversationId) return res.status(400).json({ error: 'Missing conversationId' });
                    
                    const { error: delError } = await supabase
                        .from('conversations')
                        .delete()
                        .eq('id', conversationId)
                        .eq('user_id', user.id);
                    if (delError) throw new Error(delError.message);

                    return res.json({ success: true });
                }

                case 'rename': {
                    if (!conversationId || !title) return res.status(400).json({ error: 'Missing conversationId or title' });
                    
                    const { error: renError } = await supabase
                        .from('conversations')
                        .update({ title: cleanString(title, 100) })
                        .eq('id', conversationId)
                        .eq('user_id', user.id);
                    if (renError) throw new Error(renError.message);

                    return res.json({ success: true });
                }

                default:
                    return res.status(400).json({ error: 'Invalid action' });
            }
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('History error:', error);
        return res.status(500).json({ error: error.message });
    }
};
