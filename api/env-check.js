// api/env-check.js

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  return res.status(200).json({
    environment: process.env.NODE_ENV || null,

    variables: {
      APP_ORIGIN: Boolean(
        process.env.APP_ORIGIN?.trim()
      ),

      SUPABASE_URL: Boolean(
        process.env.SUPABASE_URL?.trim()
      ),

      SUPABASE_SERVICE_ROLE_KEY: Boolean(
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
      ),

      JWT_SECRET: Boolean(
        process.env.JWT_SECRET?.trim()
      ),

      RATE_LIMIT_SALT: Boolean(
        process.env.RATE_LIMIT_SALT?.trim()
      )
    },

    jwtLength:
      process.env.JWT_SECRET?.trim().length || 0,

    supabaseUrlStart:
      process.env.SUPABASE_URL
        ?.trim()
        .slice(0, 8) || null
  });
}
