// api/upload.js

import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "../lib/auth.js";

const UPLOAD_BUCKET = "neo-uploads";

function cleanEnv(value) {
  return typeof value === "string"
    ? value.trim().replace(/^["']|["']$/g, "")
    : "";
}

function createSupabaseAdmin() {
  const supabaseUrl = cleanEnv(
    process.env.SUPABASE_URL
  );

  const serviceRoleKey = cleanEnv(
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase upload configuration is missing."
    );
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );
}

function sanitizeFileName(fileName) {
  const original = String(
    fileName || "file"
  ).trim();

  const dotIndex =
    original.lastIndexOf(".");

  const extension =
    dotIndex >= 0
      ? original
          .slice(dotIndex + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 20)
      : "";

  const baseName =
    (
      dotIndex >= 0
        ? original.slice(0, dotIndex)
        : original
    )
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 100) || "file";

  return extension
    ? `${baseName}.${extension}`
    : baseName;
}

function getRequestBody(req) {
  if (
    req.body &&
    typeof req.body === "object"
  ) {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  try {
    const auth =
      getAuthenticatedUser(req);

    if (!auth?.userId) {
      return res.status(401).json({
        error:
          "Authentication required."
      });
    }

    const body =
      getRequestBody(req);

    if (!body) {
      return res.status(400).json({
        error:
          "Invalid upload request."
      });
    }

    const filename =
      String(
        body.filename || ""
      ).trim();

    const mimeType =
      String(
        body.mimeType ||
        "application/octet-stream"
      )
        .trim()
        .toLowerCase();

    const size =
      Number(body.size);

    if (
      !filename ||
      !Number.isFinite(size) ||
      size <= 0
    ) {
      return res.status(400).json({
        error:
          "Missing file name or size."
      });
    }

    const supabase =
      createSupabaseAdmin();

    const safeName =
      sanitizeFileName(filename);

    const now =
      new Date();

    const objectPath = [
      "users",
      String(auth.userId),
      String(now.getUTCFullYear()),
      String(
        now.getUTCMonth() + 1
      ).padStart(2, "0"),
      `${Date.now()}-${crypto.randomUUID()}-${safeName}`
    ].join("/");

    const { data, error } =
      await supabase.storage
        .from(UPLOAD_BUCKET)
        .createSignedUploadUrl(
          objectPath
        );

    if (error) {
      console.error(
        "Supabase signed upload error:",
        error
      );

      throw new Error(
        error.message ||
        "Unable to create upload URL."
      );
    }

    if (
      !data?.path ||
      !data?.token
    ) {
      throw new Error(
        "Upload information was not returned."
      );
    }

    return res.status(200).json({
      success: true,

      upload: {
        bucket:
          UPLOAD_BUCKET,

        path:
          data.path,

        token:
          data.token,

        signedUrl:
          data.signedUrl || null,

        filename:
          safeName,

        mimeType,

        size
      }
    });
  } catch (error) {
    console.error(
      "Upload error:",
      {
        message:
          error?.message,

        code:
          error?.code,

        details:
          error?.details
      }
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Unable to prepare the upload."
    });
  }
}
