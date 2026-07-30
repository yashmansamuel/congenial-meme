import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "../lib/auth.js";
import { randomUUID } from "crypto";

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

export default async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const auth = getAuthenticatedUser(req);
        if (!auth?.userId) {
            return res.status(401).json({
                error: "Authentication required"
            });
        }

        const zoneId = String(process.env.MONETAG_ZONE_ID || "").trim();
        if (!zoneId) {
            return res.status(500).json({
                error: "Ad service not configured"
            });
        }

        const userId = String(auth.userId);
        const adEventId = randomUUID();

        const { error } = await supabase
            .from("ad_sessions")
            .insert({
                user_id: userId,
                ad_event_id: adEventId,
                status: "pending"
            });

        if (error) {
            console.error("Ad session insert error:", error);
            return res.status(500).json({
                error: "Unable to create ad session"
            });
        }

        return res.status(200).json({
            adEventId,
            zoneId
        });

    } catch (error) {
        console.error("Ad session error:", error);
        return res.status(500).json({
            error: "Internal server error"
        });
    }
}
