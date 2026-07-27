import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const UPLOAD_BUCKET = "uploads";
const MAX_ATTACHMENTS = 5;
const MAX_MESSAGE_LENGTH = 50000;
const MAX_HISTORY_MESSAGES = 50;

// Helpers
function cleanString(str, max = MAX_MESSAGE_LENGTH) {
    if (typeof str !== 'string') return '';
    return str.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);
}

function validAttachmentList(attachments, userId, max = MAX_ATTACHMENTS) {
    if (!Array.isArray(attachments)) return [];
    return attachments.slice(0, max).map(f => ({
        provider: "supabase",
        bucket: UPLOAD_BUCKET,
        path: String(f.path || "").trim(),
        name: String(f.name || "Attached file").replace(/[\\/]/g, "-").slice(0, 180),
        mimeType: String(f.mimeType || f.type || "application/octet-stream").slice(0, 120),
        type: String(f.mimeType || f.type || "application/octet-stream").slice(0, 120),
        category: String(f.category || "text").toLowerCase().slice(0, 20),
        size: Number.isFinite(Number(f.size)) ? Math.max(0, Number(f.size)) : 0
    })).filter(f => f.path && f.path.startsWith(`users/${userId}/`) && !f.path.includes('..'));
}

async function deleteGeminiFile(apiKey, fileUri) {
    if (!fileUri || !apiKey) return;
    try {
        await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileUri}?key=${apiKey}`, { method: 'DELETE' });
    } catch {}
}

async function saveMessage(supabase, conversationId, role, content, attachments) {
    const { error } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        role,
        content: cleanString(content, MAX_MESSAGE_LENGTH),
        attachments: attachments || []
    });
    if (error) throw new Error(error.message);
}

// ------ Main Handler ------
export default async (req, res) => {
    const geminiFiles = [];

    try {
        const user = req.user;
        if (!user || !user.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { messages, conversationId, model, isDeepResearch, title } = req.body;
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'Messages array required' });
        }

        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role !== 'user') {
            return res.status(400).json({ error: 'Last message must be user' });
        }

        // Attachments extraction
        const receivedAttachments = Array.isArray(req.body.attachments) 
            ? req.body.attachments 
            : (lastMsg?.attachments || []);
        
        let attachments = validAttachmentList(receivedAttachments, user.id);

        // Prepare Gemini messages
        const history = messages.slice(-MAX_HISTORY_MESSAGES);
        const geminiMessages = history.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : msg.role,
            parts: [{ text: cleanString(msg.content || '') }]
        })).filter(m => m.parts[0].text || m.attachments?.length);

        // Upload attachments to Gemini
        if (attachments.length > 0 && GEMINI_API_KEY) {
            const lastMsgGeminiParts = [];
            for (const file of attachments) {
                const signedUrl = await getSignedDownloadUrl(file.path, file.bucket);
                if (!signedUrl) continue;
                
                const geminiFile = await uploadToGemini(signedUrl, file.mimeType, file.name);
                if (geminiFile) {
                    geminiFiles.push(geminiFile.uri);
                    lastMsgGeminiParts.push({
                        fileData: { mimeType: geminiFile.mimeType, fileUri: geminiFile.uri }
                    });
                }
            }
            if (lastMsgGeminiParts.length > 0) {
                geminiMessages[geminiMessages.length - 1].parts = lastMsgGeminiParts;
            }
        }

        // Create conversation if new
        let convId = conversationId || null;
        if (!convId) {
            const { data: newConv, error: convError } = await supabase
                .from('conversations')
                .insert({ user_id: user.id, title: cleanString(title || 'New conversation', 100) })
                .select('id')
                .single();
            if (convError) throw new Error(convError.message);
            convId = newConv.id;
        }

        // Save user message
        const userText = cleanString(lastMsg.content || "");
        await saveMessage(supabase, convId, 'user', userText || "Attachment", attachments);

        // Call Gemini
        const geminiResponse = await callGemini(geminiMessages, model, isDeepResearch);
        const reply = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!reply) throw new Error('Gemini returned empty response');

        // Save assistant message
        await saveMessage(supabase, convId, 'assistant', reply, []);

        return res.json({ reply, conversationId: convId });

    } catch (error) {
        console.error('Chat error:', error);
        return res.status(500).json({ error: error.message });
    } finally {
        if (geminiFiles.length > 0 && GEMINI_API_KEY) {
            await Promise.all(geminiFiles.map(uri => deleteGeminiFile(GEMINI_API_KEY, uri)));
        }
    }
};

// ---------- Helper Functions ----------
async function getSignedDownloadUrl(path, bucket = UPLOAD_BUCKET) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
    if (error) return null;
    return data?.signedUrl;
}

async function uploadToGemini(fileUrl, mimeType) {
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/files?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: { mimeType, uri: fileUrl } })
        });
        const data = await res.json();
        if (!res.ok) return null;
        return data.file ? { uri: data.file.uri, mimeType } : null;
    } catch {
        return null;
    }
}

async function callGemini(messages, model, isDeepResearch) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-pro'}:generateContent?key=${GEMINI_API_KEY}`;
    const body = { contents: messages };
    if (isDeepResearch) {
        body.generationConfig = { temperature: 0.7, maxOutputTokens: 8192 };
    }
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Gemini API error');
    return data;
}
