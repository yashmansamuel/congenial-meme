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

        const { adEventId } = req.body;
        if (!adEventId || typeof adEventId !== "string" || adEventId.trim().length === 0) {
            return res.status(400).json({
                error: "Invalid ad event ID"
            });
        }

        const userId = String(auth.userId);
        const eventId = adEventId.trim();

        // 1. Verify pending session exists for this user
        const { data: session, error: sessionError } = await supabase
            .from("ad_sessions")
            .select("id, status")
            .eq("ad_event_id", eventId)
            .eq("user_id", userId)
            .eq("status", "pending")
            .maybeSingle();

        if (sessionError) {
            console.error("Session verification error:", sessionError);
            return res.status(500).json({
                error: "Unable to verify ad session"
            });
        }

        if (!session) {
            return res.status(409).json({
                error: "Invalid or already used ad event"
            });
        }

        // 2. Mark session as used
        const { error: updateError } = await supabase
            .from("ad_sessions")
            .update({
                status: "used",
                used_at: new Date().toISOString()
            })
            .eq("id", session.id);

        if (updateError) {
            console.error("Session marking error:", updateError);
            return res.status(500).json({
                error: "Unable to complete reward process"
            });
        }

        // 3. Call the atomic reward RPC
        const { data: result, error: rpcError } = await supabase
            .rpc("claim_ad_reward", {
                p_user_id: userId,
                p_ad_event_id: eventId
            });

        if (rpcError) {
            console.error("Ad reward RPC error:", rpcError);
            // Note: the session is already marked used; but we can still attempt a refund or log.
            // For simplicity, we return a 500; the frontend can retry if needed.
            return res.status(500).json({
                error: "Unable to claim reward"
            });
        }

        // result: positive = new reward_messages_available, -1 = daily limit, -2 = duplicate (shouldn't happen)
        if (result === -1) {
            return res.status(409).json({
                error: "You have already claimed your daily ad reward."
            });
        }
        if (result === -2) {
            return res.status(409).json({
                error: "This ad reward has already been claimed."
            });
        }

        return res.status(200).json({
            success: true,
            creditsRemaining: result
        });

    } catch (error) {
        console.error("Ad reward endpoint error:", error);
        return res.status(500).json({
            error: "Internal server error"
        });
    }
}
