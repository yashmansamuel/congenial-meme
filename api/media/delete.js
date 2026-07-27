import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = "uploads";

export default async (req, res) => {
    try {
        const user = req.user;
        if (!user || !user.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { path } = req.body;
        if (!path) {
            return res.status(400).json({ error: 'Path required' });
        }

        // Security: only allow deleting files inside user's folder
        if (!path.startsWith(`users/${user.id}/`)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { error } = await supabase.storage
            .from(BUCKET)
            .remove([path]);

        if (error) throw new Error(error.message);

        return res.json({ success: true });
    } catch (error) {
        console.error('Delete error:', error);
        return res.status(500).json({ error: error.message });
    }
};
