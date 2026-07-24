# NEO Phase 1

Production-oriented NEO AI chat application. The approved existing visual identity is preserved.

## Setup
1. Install Node.js 20+.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and configure secrets.
4. Apply SQL files in `supabase/migrations` in numeric order.
5. Run `npx vercel dev`.
6. Run `npm run check` before every deployment.

## Phase 1 limits
- NEO Free: 15 successful AI responses in a rolling 3-hour window.
- NEO Free: 5 successfully processed files per UTC day.
- Failed AI calls do not consume usage.
- NEO Pro checkout is created server-side through Lemon Squeezy.

## Security
- Never place service-role, Gemini, JWT, or Lemon Squeezy secrets in browser code.
- Production requires `APP_ORIGIN` and a strong `JWT_SECRET`.
- Browser database writes are disabled; protected operations use server APIs.
- Keep a production rollback deployment before each release.

## Deployment acceptance
Run syntax checks, test two-user ownership isolation, test free limits, verify all routes, then complete mobile and desktop regression checks.

## Vite frontend setup

```bash
npm install
npm run dev
```

- `npm run dev` starts the Vite frontend at `http://localhost:5173`.
- `npm run dev:full` starts the complete Vercel environment, including `/api` routes.
- `npm run build` creates the production frontend in `dist/`.
- Backend provider keys and model identifiers stay server-side. Vite exposes only variables prefixed with `VITE_`; no AI-provider or internal model variable should use that prefix.
