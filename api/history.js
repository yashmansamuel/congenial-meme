import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "../lib/auth.js";

function cleanEnv(value) {
  return typeof value === "string"
    ? value.trim().replace(/^["']|["']$/g, "")
    : "";
}

function createSupabaseAdmin() {
  const supabaseUrl = cleanEnv(process.env.SUPABASE_URL);
  const serviceRoleKey = cleanEnv(
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase configuration is missing.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function cleanString(str, max = 50000) {
  if (typeof str !== "string") return "";

  return str
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, max);
}

function safeMessage(message) {
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
        .slice(0, 5)
        .map(file => ({
          provider: "supabase",
          bucket: String(file?.bucket || "neo-uploads").trim(),
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
        .filter(file => file.path && !file.path.includes(".."))
    : [];

  return {
    id: String(message.id),
    role:
      message.role === "assistant"
        ? "assistant"
        : message.role === "user"
        ? "user"
        : "system",
    content: cleanString(message.content, 50000),
    displayContent: cleanString(message.content, 50000),
    attachments,
    createdAt: message.created_at || null
  };
}

export default async function handler(req, res) {
  try {
    const auth = getAuthenticatedUser(req);

    if (!auth?.userId) {
      return res.status(401).json({
        error: "Authentication required."
      });
    }

    const supabase = createSupabaseAdmin();
    const userId = String(auth.userId);

    const body =
      req.method === "GET"
        ? {}
        : typeof req.body === "object"
        ? req.body
        : {};

    const action = body.action;
    const conversationId = body.conversationId;
    const title = body.title;

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("chat_conversations")
        .select("id, title, created_at, updated_at")
        .eq("user_id", userId)
        .order("updated_at", {
          ascending: false
        });

      if (error) {
        throw error;
      }

      return res.status(200).json({
        conversations: data || []
      });
    }

    if (req.method === "POST") {
      if (!action) {
        return res.status(400).json({
          error: "Missing action"
        });
      }

      if (action === "get") {
        if (!conversationId) {
          return res.status(400).json({
            error: "Missing conversationId"
          });
        }

        const { data: conversation, error: conversationError } =
          await supabase
            .from("chat_conversations")
            .select("id")
            .eq("id", conversationId)
            .eq("user_id", userId)
            .maybeSingle();

        if (conversationError) {
          throw conversationError;
        }

        if (!conversation) {
          return res.status(404).json({
            error: "Conversation not found"
          });
        }

        const { data: messages, error: messagesError } =
          await supabase
            .from("chat_messages")
            .select(
              "id, role, content, attachments, created_at"
            )
            .eq("conversation_id", conversationId)
            .order("created_at", {
              ascending: true
            });

        if (messagesError) {
          throw messagesError;
        }

        return res.status(200).json({
          messages: (messages || []).map(safeMessage)
        });
      }

      if (action === "delete") {
        if (!conversationId) {
          return res.status(400).json({
            error: "Missing conversationId"
          });
        }

        const { error } = await supabase
          .from("chat_conversations")
          .delete()
          .eq("id", conversationId)
          .eq("user_id", userId);

        if (error) {
          throw error;
        }

        return res.status(200).json({
          success: true
        });
      }

      if (action === "rename") {
        if (!conversationId || !title) {
          return res.status(400).json({
            error: "Missing conversationId or title"
          });
        }

        const { error } = await supabase
          .from("chat_conversations")
          .update({
            title: cleanString(title, 100),
            updated_at: new Date().toISOString()
          })
          .eq("id", conversationId)
          .eq("user_id", userId);

        if (error) {
          throw error;
        }

        return res.status(200).json({
          success: true
        });
      }

      return res.status(400).json({
        error: "Invalid action"
      });
    }

    res.setHeader("Allow", "GET, POST");

    return res.status(405).json({
      error: "Method not allowed"
    });
  } catch (error) {
    console.error("History error:", error);

    return res.status(500).json({
      error:
        error?.message ||
        "Unable to load conversation history."
    });
  }
}
