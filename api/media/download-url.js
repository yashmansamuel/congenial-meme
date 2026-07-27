import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = "uploads";
const EXPIRY = 300;

export default async (req, res) => {
    try {
        const user = req.user;
        if (!user || !user.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { path, expiresIn } = req.body;
        if (!path) {
            return res.status(400).json({ error: 'Path required' });
        }

        // Security: only allow files inside user's folder
        if (!path.startsWith(`users/${user.id}/`)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { data, error } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(path, expiresIn || EXPIRY);

        if (error) throw new Error(error.message);

        return res.json({ signedUrl: data.signedUrl });
    } catch (error) {
        console.error('Download URL error:', error);
        return res.status(500).json({ error: error.message });
    }
};
