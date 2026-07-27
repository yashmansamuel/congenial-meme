import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "../lib/auth.js";

const UPLOAD_BUCKET = "neo-uploads";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

function sanitizeFileName(fileName) {
    const original = String(fileName || "file").trim().toLowerCase();
    const dotIndex = original.lastIndexOf(".");
    const extension = dotIndex >= 0 
        ? original.slice(dotIndex + 1).replace(/[^a-z0-9]/g, "").slice(0, 10) 
        : "";
    const baseName = (dotIndex >= 0 ? original.slice(0, dotIndex) : original)
        .normalize("NFKD")
        .replace(/[^\w.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[.-]+|[.-]+$/g, "")
        .slice(0, 80) || "file";
    return extension ? `${baseName}.${extension}` : baseName;
}

export default async (req, res) => {
    try {
        const auth = getAuthenticatedUser(req);
        if (!auth?.userId) {
            return res.status(401).json({ error: "Authentication required." });
        }

        const { filename, mimeType, size } = req.body;
        if (!filename || !size) {
            return res.status(400).json({ error: "Missing file name or size." });
        }

        const safeName = sanitizeFileName(filename);
        const objectPath = [
            "users",
            auth.userId,
            "uploads",
            `${crypto.randomUUID()}-${safeName}`
        ].join("/");

        const { data, error } = await supabase
            .storage
            .from(UPLOAD_BUCKET)
            .createSignedUploadUrl(objectPath);

        if (error) {
            console.error("Supabase signed URL error:", error);
            throw new Error(error.message);
        }

        return res.json({
            upload: {
                bucket: UPLOAD_BUCKET,
                path: data.path,
                token: data.token
            }
        });

    } catch (error) {
        console.error("Upload error:", error);
        return res.status(500).json({ error: error.message });
    }
};
