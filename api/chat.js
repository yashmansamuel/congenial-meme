import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "../lib/auth.js";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    }
);

const GEMINI_API_KEY = cleanEnv(process.env.GEMINI_API_KEY);
const UPLOAD_BUCKET = "neo-uploads";
const MAX_ATTACHMENTS = 5;
const MAX_MESSAGE_LENGTH = 50000;
const MAX_HISTORY_MESSAGES = 50;

// === System instruction for clean markdown + math formatting ===
const NEO_RESPONSE_FORMAT = `
You are NEO, a premium conversational assistant.

Always return clean, valid GitHub-flavored Markdown.

Formatting rules:
- Write readable paragraphs with a blank line between them.
- Use ## for main section headings.
- Use ### only for smaller subsections.
- Every heading must be on its own line.
- Every numbered-list item must be on its own line.
- Every bullet item must be on its own line.
- Never join headings, numbering, links, or paragraphs together.
- Never produce malformed text like "Heading1." or "sentence.2.".
- Use bold only for short labels and important phrases.
- Never bold complete paragraphs.
- Keep paragraphs concise and naturally readable.
- Use [Website name](https://example.com) for clickable links.
- Do not expose raw Markdown symbols inside normal sentences.
- Do not use tables unless they genuinely improve clarity.
- Avoid unnecessary introductions and repeated disclaimers.

Math and science formatting rules:
- Use \( ... \) for short inline mathematics.
- Use \[ ... \] for important equations on their own line.
- Never show raw LaTeX without math delimiters.
- Put each major equation on a separate line.
- After an equation, explain every important symbol using a clean bullet list.
- Do not place long equations inside bold text.
- Use Unicode symbols only for very simple expressions.
- Never use $...$, ($...$), or [$...$]. Always use \( ... \) for inline math and \[ ... \] for display equations.
`;

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

async function deleteGeminiFile(apiKey, fileName) {
    if (!fileName || !apiKey) return;
    const safeName = String(fileName).replace(/^\/+/, "");
    try {
        await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${safeName}?key=${encodeURIComponent(apiKey)}`,
            { method: "DELETE" }
        );
    } catch (error) {
        console.warn("Gemini temporary file deletion failed:", error);
    }
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
            planType: auth.planType || "free"
        };

        const { messages, conversationId, isDeepResearch, title } = req.body;

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

        // --- Upload attachments to Gemini (resumable) ---
        if (attachments.length > 0 && GEMINI_API_KEY) {
            const lastGeminiMessage = geminiMessages[geminiMessages.length - 1];
            if (!lastGeminiMessage) {
                throw new Error("Unable to prepare attachment message.");
            }

            const originalText = cleanString(lastMsg.content || "Please analyze the attached file.");
            const attachmentParts = [];

            for (const file of attachments) {
                const geminiFile = await uploadSupabaseFileToGemini(file);
                if (!geminiFile?.uri) continue;
                geminiFiles.push(geminiFile.name);
                attachmentParts.push({
                    fileData: {
                        mimeType: geminiFile.mimeType,
                        fileUri: geminiFile.uri
                    }
                });
            }

            // Preserve user text and append file parts
            lastGeminiMessage.parts = [
                { text: originalText },
                ...attachmentParts
            ];
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

        // --- Model mapping (Pro vs Free) ---
        const isPro = user.planType === 'pro';
        const model = isPro
            ? cleanEnv(process.env.GEMINI_PRO_MODEL) || "gemini-3.5-flash-lite"
            : cleanEnv(process.env.GEMINI_FREE_MODEL) || "gemini-3.1-flash-lite";

        // --- Call Gemini (updated with system instruction) ---
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
// HELPER FUNCTIONS (Gemini resumable upload & API call)
// ================================================================

async function uploadSupabaseFileToGemini(file) {
    const { data: storedFile, error } = await supabase.storage
        .from(file.bucket || UPLOAD_BUCKET)
        .download(file.path);

    if (error || !storedFile) {
        throw new Error(error?.message || `Unable to read ${file.name}.`);
    }

    const mimeType = file.mimeType || storedFile.type || "application/octet-stream";
    const bytes = await storedFile.arrayBuffer();

    // Start resumable upload
    const startResponse = await fetch(
        `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(GEMINI_API_KEY)}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
                "X-Goog-Upload-Header-Content-Type": mimeType
            },
            body: JSON.stringify({
                file: { displayName: file.name || "NEO attachment" }
            })
        }
    );

    if (!startResponse.ok) {
        const details = await startResponse.text().catch(() => "");
        throw new Error(details || "Gemini upload initialization failed.");
    }

    const uploadUrl = startResponse.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
        throw new Error("Gemini upload URL was not returned.");
    }

    // Upload bytes and finalize
    const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
            "Content-Length": String(bytes.byteLength),
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize"
        },
        body: bytes
    });

    const uploadData = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok) {
        throw new Error(uploadData?.error?.message || "Gemini file upload failed.");
    }

    const geminiFile = uploadData?.file;
    if (!geminiFile?.name || !geminiFile?.uri) {
        throw new Error("Gemini file information was not returned.");
    }

    if (geminiFile.state === "PROCESSING") {
        return await waitForGeminiFile(geminiFile.name, mimeType);
    }

    if (geminiFile.state === "FAILED") {
        throw new Error(`Gemini could not process ${file.name}.`);
    }

    return {
        name: geminiFile.name,
        uri: geminiFile.uri,
        mimeType: geminiFile.mimeType || mimeType
    };
}

async function waitForGeminiFile(fileName, fallbackMimeType) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${encodeURIComponent(GEMINI_API_KEY)}`
        );
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data?.error?.message || "Unable to check Gemini file status.");
        }

        if (data.state === "ACTIVE") {
            return {
                name: data.name,
                uri: data.uri,
                mimeType: data.mimeType || fallbackMimeType
            };
        }
        if (data.state === "FAILED") {
            throw new Error("Gemini could not process this file.");
        }
    }
    throw new Error("Gemini file processing timed out.");
}

// === Updated callGemini with system instruction ===
async function callGemini(
    messages,
    model,
    isDeepResearch
) {
    if (!GEMINI_API_KEY) {
        throw new Error(
            "Gemini API configuration is missing."
        );
    }

    const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const body = {
        systemInstruction: {
            parts: [
                {
                    text: NEO_RESPONSE_FORMAT
                }
            ]
        },

        contents: messages,

        generationConfig: {
            temperature:
                isDeepResearch
                    ? 0.55
                    : 0.65,

            maxOutputTokens:
                isDeepResearch
                    ? 8192
                    : 4096
        }
    };

    const response = await fetch(url, {
        method: "POST",

        headers: {
            "Content-Type":
                "application/json"
        },

        body: JSON.stringify(body)
    });

    const data = await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
        console.error(
            "Gemini API Error:",
            data
        );

        throw new Error(
            data?.error?.message ||
            "Gemini API error"
        );
    }

    return data;
}
