import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "../lib/auth.js";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const UPLOAD_BUCKET = "uploads";
const MAX_ATTACHMENTS = 5;
const MAX_MESSAGE_LENGTH = 50000;
const MAX_HISTORY_MESSAGES = 50;

// Helper: clean strings
function cleanString(str, max = MAX_MESSAGE_LENGTH) {
    if (typeof str !== 'string') return '';
    return str.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);
}

// Helper: clean env var
function cleanEnv(value) {
    return typeof value === 'string' ? value.trim() : '';
}

// Helper: validate attachments
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
    const { error } = await supabase.from('chat_messages').insert({
        conversation_id: conversationId,
        role,
        content: cleanString(content, MAX_MESSAGE_LENGTH),
        attachments: attachments || []
    });
    if (error) throw new Error(error.message);
}

export default async (req, res) => {
    const geminiFiles = [];

    try {
        // --- AUTH ---
        const auth = getAuthenticatedUser(req);
        if (!auth?.userId) {
            return res.status(401).json({ error: "Authentication required. Please log in." });
        }
        const user = {
            id: auth.userId,
            username: auth.username || "user",
            planType: auth.planType || "free" // assuming auth returns planType
        };

        const { messages, conversationId, isDeepResearch, title } = req.body;
        // ⚠️ `model` from req.body is IGNORED — it's just a UI label (l1.0 / l1.2)

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'Messages array required' });
        }

        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role !== 'user') {
            return res.status(400).json({ error: 'Last message must be user' });
        }

        // --- Attachments extraction ---
        const receivedAttachments = Array.isArray(req.body.attachments) 
            ? req.body.attachments 
            : (lastMsg?.attachments || []);
        
        let attachments = validAttachmentList(receivedAttachments, user.id);

        // --- Prepare Gemini messages ---
        const history = messages.slice(-MAX_HISTORY_MESSAGES);
        const geminiMessages = history.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : msg.role,
            parts: [{ text: cleanString(msg.content || '') }]
        })).filter(m => m.parts[0].text || m.attachments?.length);

        // --- Upload attachments to Gemini ---
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

        // --- Create conversation if new ---
        let convId = conversationId || null;
        if (!convId) {
            const { data: newConv, error: convError } = await supabase
                .from('chat_conversations')
                .insert({ user_id: user.id, title: cleanString(title || 'New conversation', 100) })
                .select('id')
                .single();
            if (convError) throw new Error(convError.message);
            convId = newConv.id;
        }

        // --- Save user message ---
        const userText = cleanString(lastMsg.content || "");
        await saveMessage(supabase, convId, 'user', userText || "Attachment", attachments);

        // ================================================================
        // ✅ MODEL MAPPING FIX (User plan se real Gemini model decide karo)
        // ================================================================
        const isPro = user.planType === 'pro';
        const model = isPro
            ? cleanEnv(process.env.GEMINI_PRO_MODEL) || "gemini-3.5-flash-lite"
            : cleanEnv(process.env.GEMINI_FREE_MODEL) || "gemini-3.1-flash-lite";
        // ================================================================

        // --- Call Gemini with correct model ---
        const geminiResponse = await callGemini(geminiMessages, model, isDeepResearch);
        const reply = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!reply) throw new Error('Gemini returned empty response');

        // --- Save assistant message ---
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

// ================================================================
// HELPER FUNCTIONS (Gemini API Calls with corrected URL)
// ================================================================

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
    // ✅ Safe URL encoding
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
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
    if (!res.ok) {
        // Detailed error logging for debugging
        console.error('Gemini API Error:', data);
        throw new Error(data.error?.message || 'Gemini API error');
    }
    return data;
}
