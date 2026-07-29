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
const MAX_URL_CONTEXT_SOURCES = 5;

// === Refined system instruction for natural, human-like responses ===
const NEO_RESPONSE_FORMAT = `
You are NEO, a natural, intelligent conversational assistant.

VOICE AND TONE
- Match the user's language, tone, and level of formality.
- When the user writes Roman Urdu, respond in natural Roman Urdu.
- Sound human, direct, calm, and confident.
- Avoid generic openings such as:
  "Bilkul honest jawab deta hoon",
  "Great question",
  "Certainly",
  or "As an AI".
- Do not sound corporate, scripted, overly cheerful, or robotic.
- Use emojis only when they genuinely fit the user's tone, with a maximum of one.
- Do not repeat the user's question before answering.
- Do not end every answer with a question or invitation.

ORGANIZATION
- Keep the structure proportional to the request.
- For simple questions, use one or two natural paragraphs.
- Use headings only when the answer has genuinely different sections.
- Avoid excessive bullet points, checkmarks, numbered lists, and separators.
- Prefer short paragraphs over template-style lists.
- Do not restate the same idea in multiple sections.

ACCURACY AND JUDGMENT
- Do not invent the user's education, job, personality, background, or intentions.
- Only make personal inferences when directly supported by the conversation.
- Clearly label uncertain observations as impressions, not facts.
- Avoid exaggerated certainty.
- Answer the actual question first.

WRITING QUALITY
- Use clean, valid GitHub-flavored Markdown.
- Put every heading on its own line.
- Put each list item on its own line.
- Use bold only for short labels or genuinely important phrases.
- Never bold entire paragraphs.
- Use fenced code blocks with the correct language.
- Use [Website name](https://example.com) for links.
- Keep paragraphs readable and naturally paced.

MATH AND SCIENCE
- Use \\( ... \\) for inline mathematics.
- Use \\[ ... \\] for display equations.
- Put major equations on separate lines.
- Explain important symbols clearly after the equation.
- Never expose raw LaTeX without delimiters.

STYLE EXAMPLE
User: "Kya meri baaton se main human lagta hoon?"

Good response:
"Haan, bilkul. Aapka style direct, spontaneous aur feedback-driven hai, jo natural human conversation jaisa lagta hai. Aap kabhi formal ho jate ho, lekin overall bot-like feel nahi aati."

Bad response:
"Bilkul honest jawab deta hoon! Here are several observations about your personality and professional background..."
`;

// Helper: clean strings (PRESERVES newlines and tabs)
function cleanString(str, max = MAX_MESSAGE_LENGTH) {
    if (typeof str !== "string") {
        return "";
    }

    return str
        .replace(/\r\n?/g, "\n")
        .replace(
            /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
            ""
        )
        .trim()
        .slice(0, max);
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

// ================================================================
// URL CONTEXT HELPERS
// ================================================================

function extractUrlsFromText(text) {
    if (!text) return [];
    const urlRegex = /https?:\/\/[^\s<>"']+/g;
    const matches = text.match(urlRegex) || [];
    return matches.filter(url => {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' && 
                   !parsed.hostname.includes('localhost') &&
                   !parsed.hostname.match(/^127\.\d+\.\d+\.\d+$/) &&
                   !parsed.hostname.match(/^192\.168\./) &&
                   !parsed.hostname.match(/^10\./) &&
                   !parsed.hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./);
        } catch {
            return false;
        }
    });
}

function normalizeUrl(url) {
    try {
        const parsed = new URL(url);
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return url;
    }
}

function deduplicateUrls(urls) {
    const seen = new Set();
    return urls.filter(url => {
        const normalized = normalizeUrl(url);
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
    });
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

async function saveMessage(supabase, conversationId, role, content, attachments, sources) {
    const { error } = await supabase.from('chat_messages').insert({
        conversation_id: conversationId,
        role,
        content: cleanString(content, MAX_MESSAGE_LENGTH),
        attachments: attachments || [],
        sources: sources || []
    });
    if (error) throw new Error(error.message);
}

// ================================================================
// MAIN HANDLER
// ================================================================

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
        await saveMessage(supabase, convId, 'user', userText || "Attachment", attachments, []);

        // --- Model mapping (Pro vs Free) ---
        const isPro = user.planType === 'pro';
        const model = isPro
            ? cleanEnv(process.env.GEMINI_PRO_MODEL) || "gemini-3.5-flash-lite"
            : cleanEnv(process.env.GEMINI_FREE_MODEL) || "gemini-3.1-flash-lite";

        // --- URL Context logic ---
        let usedUrlContext = false;
        let sources = [];
        let reply = '';

        const userMessageText = cleanString(lastMsg.content || '');
        const extractedUrls = extractUrlsFromText(userMessageText);
        const uniqueUrls = deduplicateUrls(extractedUrls).slice(0, MAX_URL_CONTEXT_SOURCES);

        // Check if this is a "current" / "real-time" / "compare" query
        const lowerQuery = userMessageText.toLowerCase();
        const isCurrentQuery = /\b(current|now|latest|today|this month|july|august|202[4-9]|real[- ]time)\b/.test(lowerQuery);
        const isUrlQuery = uniqueUrls.length > 0;
        const isCompareQuery = /\b(compare|difference|versus|vs|different|which|between)\b/.test(lowerQuery);
        const isSpecificQuery = /\b(how much|what is|value|price|net worth|population|weather|stock|price|rate|exchange)\b/.test(lowerQuery);

        // Determine if we should use URL Context
        const shouldUseUrlContext = (isUrlQuery && (isCurrentQuery || isCompareQuery || isSpecificQuery)) || 
                                    (isCurrentQuery && isCompareQuery) ||
                                    (userMessageText.includes('read') && userMessageText.includes('link'));

        // --- First call: normal generation (without URL Context) ---
        let normalResponse = null;
        let candidateUrls = [];

        if (shouldUseUrlContext && GEMINI_API_KEY) {
            try {
                // First, get the normal response to extract candidate URLs
                const firstGeminiResponse = await callGemini(geminiMessages, model, isDeepResearch);
                const firstReply = firstGeminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                
                if (firstReply) {
                    normalResponse = firstReply;
                    
                    // Try to extract candidate URLs from the first response
                    const responseUrls = extractUrlsFromText(firstReply);
                    const uniqueResponseUrls = deduplicateUrls(responseUrls).slice(0, MAX_URL_CONTEXT_SOURCES);
                    
                    // Also use any URLs from the user's message if the model didn't suggest any
                    if (uniqueResponseUrls.length > 0) {
                        candidateUrls = uniqueResponseUrls;
                    } else if (uniqueUrls.length > 0) {
                        candidateUrls = uniqueUrls;
                    }
                    
                    // If we have candidate URLs, make a second call with URL Context
                    if (candidateUrls.length > 0) {
                        const contextResponse = await callGeminiWithUrlContext(
                            geminiMessages,
                            model,
                            isDeepResearch,
                            candidateUrls,
                            userMessageText
                        );
                        
                        const contextReply = contextResponse?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        
                        if (contextReply) {
                            reply = contextReply;
                            usedUrlContext = true;
                            
                            // Extract metadata from URL Context response
                            const urlMetadata = contextResponse?.candidates?.[0]?.url_context_metadata?.url_metadata || [];
                            if (Array.isArray(urlMetadata)) {
                                sources = urlMetadata
                                    .filter(m => m.url_retrieval_status === 'URL_RETRIEVAL_STATUS_SUCCESS')
                                    .map(m => ({
                                        title: m.url || 'Source',
                                        url: m.url,
                                        status: 'success'
                                    }));
                            }
                            
                            // If no metadata from Gemini, use candidate URLs as sources
                            if (sources.length === 0) {
                                sources = candidateUrls.map(url => ({
                                    title: new URL(url).hostname.replace(/^www\./, ''),
                                    url: url,
                                    status: 'success'
                                }));
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn('URL Context attempt failed, falling back to normal response:', error);
                // Fall through to normal response
            }
        }

        // If we don't have a reply yet (URL Context didn't work or wasn't needed), use normal response
        if (!reply) {
            const geminiResponse = await callGemini(geminiMessages, model, isDeepResearch);
            reply = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (!reply) throw new Error('Gemini returned empty response');
        }

        // --- Save assistant message ---
        await saveMessage(supabase, convId, 'assistant', reply, [], sources);

        return res.json({
            reply,
            conversationId: convId,
            usedUrlContext,
            sources: sources.length > 0 ? sources : undefined
        });

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
// HELPER FUNCTIONS (Gemini API calls)
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

// === Standard Gemini call ===
async function callGemini(
    messages,
    model,
    isDeepResearch
) {
    if (!GEMINI_API_KEY) {
        throw new Error("Gemini API configuration is missing.");
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
            temperature: isDeepResearch ? 0.55 : 0.65,
            maxOutputTokens: isDeepResearch ? 8192 : 4096
        }
    };

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        console.error("Gemini API Error:", data);
        throw new Error(data?.error?.message || "Gemini API error");
    }

    return data;
}

// === Gemini call with URL Context (no Google Search) ===
async function callGeminiWithUrlContext(
    messages,
    model,
    isDeepResearch,
    urls,
    originalQuery
) {
    if (!GEMINI_API_KEY) {
        throw new Error("Gemini API configuration is missing.");
    }

    // Build a focused prompt asking Gemini to read the provided URLs
    const urlContextPrompt = `
Read only these URLs and answer the user's question based on their content:

${urls.map((url, i) => `${i + 1}. ${url}`).join('\n')}

Original question: ${originalQuery}

Rules:
- Extract only the requested information from these URLs.
- If a URL returns an error or cannot be accessed, note that.
- Do not search the web or add information from other sources.
- Cite the source for each piece of information.
- If multiple sources show different values, explain the difference.
- Be concise and answer the actual question first.
`;

    const contextMessages = [
        ...messages.slice(0, -1),
        {
            role: 'user',
            parts: [{ text: urlContextPrompt }]
        }
    ];

    const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const body = {
        systemInstruction: {
            parts: [{ text: NEO_RESPONSE_FORMAT }]
        },
        contents: contextMessages,
        tools: [
            {
                url_context: {}
            }
        ],
        generationConfig: {
            temperature: isDeepResearch ? 0.5 : 0.6,
            maxOutputTokens: isDeepResearch ? 8192 : 4096
        }
    };

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        console.error("Gemini API Error (URL Context):", data);
        throw new Error(data?.error?.message || "Gemini API error");
    }

    return data;
}
