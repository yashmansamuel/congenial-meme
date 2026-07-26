// api/upload.js

import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "../lib/auth.js";
import {
  setJsonHeaders,
  parseJsonBody,
  isAllowedOrigin,
  positiveInteger
} from "../lib/http.js";

const UPLOAD_BUCKET = "neo-uploads";

const FREE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const PRO_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/json",

  "video/mp4",
  "video/webm",
  "video/quicktime",

  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav"
]);

function cleanEnv(value) {
  return typeof value === "string"
    ? value.trim().replace(/^["']|["']$/g, "")
    : "";
}

function cleanText(value, maxLength = 160) {
  return typeof value === "string"
    ? value
        .replace(/\u0000/g, "")
        .trim()
        .slice(0, maxLength)
    : "";
}

function createAdmin() {
  const url = cleanEnv(process.env.SUPABASE_URL);
  const serviceRoleKey = cleanEnv(
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase configuration is missing.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function isProPlan(planType) {
  return [
    "pro",
    "neo_pro",
    "neo-pro",
    "premium",
    "business"
  ].includes(
    String(planType || "")
      .trim()
      .toLowerCase()
  );
}

function safeFilename(filename) {
  const cleaned = cleanText(filename, 120)
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || "upload";
}

function extensionForType(mimeType) {
  const types = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/html": "html",
    "text/css": "css",
    "text/javascript": "js",
    "application/javascript": "js",
    "application/json": "json",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav"
  };

  return types[mimeType] || "bin";
}

export default async function handler(req, res) {
  setJsonHeaders(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  try {
    if (!isAllowedOrigin(req)) {
      return res.status(403).json({
        error: "Request origin is not allowed."
      });
    }
  } catch (error) {
    console.error("Upload origin configuration error:", error);

    return res.status(500).json({
      error: "Upload service configuration is invalid."
    });
  }

  const auth = getAuthenticatedUser(req);

  if (!auth?.userId) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  const body = parseJsonBody(req);

  if (!body) {
    return res.status(400).json({
      error: "Invalid upload request."
    });
  }

  const filename = safeFilename(body.filename);

  const mimeType = cleanText(body.mimeType, 100)
    .toLowerCase();

  const size = Number(body.size);

  if (!filename || !mimeType || !Number.isFinite(size) || size <= 0) {
    return res.status(400).json({
      error: "File information is incomplete."
    });
  }

  if (!ALLOWED_TYPES.has(mimeType)) {
    return res.status(415).json({
      error:
        "Unsupported file. Use JPG, PNG, WebP, PDF, TXT, MP4, MP3, or WAV."
    });
  }

  let supabase;

  try {
    supabase = createAdmin();
  } catch (error) {
    console.error("Upload configuration error:", error);

    return res.status(500).json({
      error: "Upload service is not configured."
    });
  }

  try {
    const { data: account, error: accountError } = await supabase
      .from("app_users")
      .select("plan_type, status")
      .eq("id", auth.userId)
      .maybeSingle();

    if (accountError) {
      throw accountError;
    }

    if (!account || account.status !== "active") {
      return res.status(403).json({
        error: "Your account is unavailable."
      });
    }

    const pro = isProPlan(account.plan_type);

    const maxBytes = positiveInteger(
      pro
        ? process.env.PRO_MAX_UPLOAD_BYTES
        : process.env.FREE_MAX_UPLOAD_BYTES,
      pro ? PRO_MAX_BYTES : FREE_MAX_BYTES
    );

    if (size > maxBytes) {
      const maxMb = Math.floor(maxBytes / 1024 / 1024);

      return res.status(413).json({
        error: `This file is too large. Your limit is ${maxMb}MB.`,
        code: "FILE_TOO_LARGE"
      });
    }

    const now = new Date();
    const random = crypto.randomUUID();
    const extension = extensionForType(mimeType);

    const nameWithExtension = filename.includes(".")
      ? filename
      : `${filename}.${extension}`;

    const path =
      `users/${auth.userId}/` +
      `${now.getUTCFullYear()}/` +
      `${String(now.getUTCMonth() + 1).padStart(2, "0")}/` +
      `${Date.now()}-${random}-${nameWithExtension}`;

    const { data, error } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .createSignedUploadUrl(path);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,

      upload: {
        bucket: UPLOAD_BUCKET,
        path: data.path,
        token: data.token,
        signedUrl: data.signedUrl,

        filename: nameWithExtension,
        mimeType,
        size,

        expiresInMinutes: 120
      },

      limits: {
        maxBytes,
        maxMegabytes: Math.floor(maxBytes / 1024 / 1024),
        plan: pro ? "pro" : "free"
      }
    });
  } catch (error) {
    console.error("Upload request failed:", {
      message: error?.message,
      code: error?.code,
      details: error?.details
    });

    return res.status(500).json({
      error: "Unable to prepare the upload. Please try again."
    });
  }
}
