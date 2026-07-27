// api/chat.js
// Handles chat completion and media uploads

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Gemini API configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

// ----------------------------------------------------------------
// 1. BUCKET NAME – must match frontend
// ----------------------------------------------------------------
const UPLOAD_BUCKET = "uploads";

const MAX_ATTACHMENTS = 5;
const MAX_MESSAGE_LENGTH = 50000;
const MAX_HISTORY_MESSAGES = 50;

// Helper: clean string
function cleanString(str, maxLength = MAX_MESSAGE_LENGTH) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, maxLength);
}

// Helper: validate and sanitize attachment list
function validAttachmentList(attachments, userId, maxAttachments = MAX_ATTACHMENTS) {
  if (!Array.isArray(attachments)) return [];

  return attachments
    .slice(0, maxAttachments)
    .map(file => ({
      provider: String(file.provider || 'supabase'),
      bucket: String(file.bucket || UPLOAD_BUCKET),
      path: String(file.path || '').trim(),
      name: String(file.name || 'Attached file')
        .replace(/[\\/]/g, '-')
        .slice(0, 180),
      mimeType: String(
        file.mimeType || file.type || 'application/octet-stream'
      ).slice(0, 120),
      type: String(
        file.mimeType || file.type || 'application/octet-stream'
      ).slice(0, 120),
      category: String(file.category || 'text').toLowerCase().slice(0, 20),
      size: Number.isFinite(Number(file.size)) ? Math.max(0, Number(file.size)) : 0
    }))
    .filter(file => {
      // Security: only allow safe paths inside the user's folder
      return (
        file.path &&
        file.path.startsWith(`users/${userId}/`) &&
        !file.path.includes('..') &&
        !file.path.startsWith('/') &&
        !file.path.startsWith('http') &&
        !file.path.startsWith('data:') &&
        !file.path.startsWith('blob:')
      );
    });
}

// Helper: delete temporary Gemini file
async function deleteGeminiFile(apiKey, fileUri) {
  if (!fileUri) return;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/${fileUri}?key=${apiKey}`;
    await fetch(url, { method: 'DELETE' });
  } catch (err) {
    console.warn('Failed to delete Gemini file:', fileUri, err.message);
  }
}

// ----------------------------------------------------------------
//  MAIN CHAT HANDLER
// ----------------------------------------------------------------
module.exports = async (req, res) => {
  try {
    const user = req.user;
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { messages, conversationId, model, isDeepResearch, title } = req.body;

    // Basic validation
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== 'user') {
      return res.status(400).json({ error: 'Last message must be from user' });
    }

    // ----------------------------------------------------------------
    // 2. REPLACED: Extract attachments from last user message or top-level
    // ----------------------------------------------------------------
    const lastUserMessage =
      Array.isArray(messages)
        ? messages.at(-1)
        : null;

    const receivedAttachments =
      Array.isArray(req.body.attachments)
        ? req.body.attachments
        : Array.isArray(lastUserMessage?.attachments)
        ? lastUserMessage.attachments
        : [];

    let attachments = validAttachmentList(
      receivedAttachments,
      user.id,
      MAX_ATTACHMENTS
    );

    // Limit conversation history to prevent token blow‑up
    const historyMessages = messages.slice(-MAX_HISTORY_MESSAGES);

    // Prepare Gemini‑compatible messages
    const geminiMessages = [];
    for (const msg of historyMessages) {
      if (!msg.role || !['user', 'model', 'system'].includes(msg.role)) continue;
      const content = cleanString(msg.content || '');
      if (!content && !msg.attachments?.length) continue;

      // Gemini uses "model" instead of "assistant"
      const role = msg.role === 'assistant' ? 'model' : msg.role;
      geminiMessages.push({ role, parts: [{ text: content }] });
    }

    // If there are attachments, upload them to Gemini temporary storage
    const geminiFiles = [];
    const geminiParts = [];

    if (attachments.length > 0) {
      for (const file of attachments) {
        // Download the file from Supabase Storage using a signed URL
        const signedUrl = await getSignedDownloadUrl(file.path, file.bucket);
        if (!signedUrl) {
          console.warn('Could not get signed URL for:', file.path);
          continue;
        }

        // Upload to Gemini temporary storage
        const geminiFile = await uploadToGemini(signedUrl, file.mimeType, file.name);
        if (geminiFile) {
          geminiFiles.push(geminiFile.uri);
          geminiParts.push({
            fileData: {
              mimeType: geminiFile.mimeType,
              fileUri: geminiFile.uri
            }
          });
        }
      }
    }

    // Add the user text part (if any)
    const lastText = cleanString(lastMessage.content || '');
    if (lastText) {
      geminiParts.unshift({ text: lastText });
    }

    // Replace the last user message with the combined parts (if we have file parts)
    if (geminiParts.length > 0) {
      geminiMessages[geminiMessages.length - 1].parts = geminiParts;
    }

    // ----------------------------------------------------------------
    // 3. REPLACED: savedUserText – keep it clean
    // ----------------------------------------------------------------
    const savedUserText =
      lastText ||
      (attachments.length
        ? "User uploaded an attachment."
        : "");

    // ----------------------------------------------------------------
    //  SAVE USER MESSAGE TO DATABASE
    // ----------------------------------------------------------------
    let conversationId = conversationId || null;
    if (!conversationId) {
      // Create new conversation
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          user_id: user.id,
          title: cleanString(title || 'New conversation', 100)
        })
        .select('id')
        .single();

      if (convError) throw new Error(convError.message);
      conversationId = newConv.id;
    }

    // Save user message with attachments
    await saveMessage(
      supabase,
      conversationId,
      'user',
      savedUserText,
      attachments
    );

    // ----------------------------------------------------------------
    //  CALL GEMINI
    // ----------------------------------------------------------------
    const geminiResponse = await callGemini(
      geminiMessages,
      model || GEMINI_MODEL,
      isDeepResearch
    );

    const reply = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!reply) {
      throw new Error('Gemini returned empty response');
    }

    // Save assistant reply
    await saveMessage(
      supabase,
      conversationId,
      'assistant',
      reply,
      [] // assistant messages have no attachments
    );

    // Return response to frontend
    res.json({
      reply,
      conversationId,
      // send back attachments metadata (without preview)
      attachments: attachments.map(f => ({
        ...f,
        previewUrl: null
      }))
    });

  } catch (error) {
    console.error('Chat API error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    // ----------------------------------------------------------------
    // 4. REPLACED: Only delete Gemini temporary files, NOT Supabase storage
    // ----------------------------------------------------------------
    await Promise.all(
      geminiFiles.map(fileUri =>
        deleteGeminiFile(GEMINI_API_KEY, fileUri)
      )
    );
    // DO NOT call deleteStorageFiles() – Supabase originals stay.
  }
};

// ----------------------------------------------------------------
//  HELPER FUNCTIONS (unchanged except bucket name)
// ----------------------------------------------------------------

async function getSignedDownloadUrl(path, bucket = UPLOAD_BUCKET) {
  try {
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .createSignedUrl(path, 300); // 5 minutes

    if (error) throw error;
    return data?.signedUrl;
  } catch (err) {
    console.warn('Signed URL error:', err.message);
    return null;
  }
}

async function uploadToGemini(fileUrl, mimeType, fileName) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/files?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          file: {
            mimeType,
            uri: fileUrl
          }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Gemini upload failed');

    const fileUri = data.file?.uri;
    if (!fileUri) throw new Error('No file URI returned');

    // Poll until state is 'ACTIVE'
    let attempts = 0;
    while (attempts < 10) {
      const statusRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${fileUri}?key=${GEMINI_API_KEY}`
      );
      const statusData = await statusRes.json();
      if (statusData.file?.state === 'ACTIVE') {
        return { uri: fileUri, mimeType };
      }
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    }
    throw new Error('Gemini file processing timed out');
  } catch (err) {
    console.warn('Gemini upload error:', err.message);
    return null;
  }
}

async function callGemini(messages, model, isDeepResearch) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: messages,
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  };

  // Deep research: use higher temperature and more tokens
  if (isDeepResearch) {
    body.generationConfig = {
      temperature: 0.7,
      maxOutputTokens: 8192,
      topK: 40,
      topP: 0.95
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok) {
    const errorMsg = data.error?.message || 'Gemini API error';
    throw new Error(errorMsg);
  }
  return data;
}

async function saveMessage(supabase, conversationId, role, content, attachments) {
  const { error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content: cleanString(content, MAX_MESSAGE_LENGTH),
      attachments: attachments || []
    });

  if (error) throw new Error(error.message);
}
