# NEO Phase 1 — File-by-File Implementation Record

## Updated core files

1. `api/chat.js` — rebuilt safely; fixes syntax defect, enforces 15 successful requests per rolling 3 hours, five free files/day, attachment validation, URL Context + web search tools, ownership checks, and provider-safe errors.
2. `api/auth.js` — production origin now fails closed; existing secure cookie/JWT/bcrypt flow retained; legacy successful login still migrates passwords to bcrypt as approved.
3. `api/history.js` — state-changing requests now require approved origin; existing ownership checks and UI contract preserved.
4. `api/checkout.js` — new authenticated server-side Lemon Squeezy checkout creation.
5. `api/notifications.js` — new organized notification read/mark-read API for system, order, payment and account events.
6. `lib/http.js` — shared JSON, parsing, origin and numeric configuration helpers.
7. `neo.js` — removed direct browser Supabase profile query, fixed unsafe markdown fallback, connected real checkout, handled quota upgrade states, hid internal model labels and registered installable app support.
8. `neo.html` — preserved layout; public labels now NEO Free/NEO Pro, approved $10 price, web-enabled research label and web-app manifest.

## New launch foundation

9. `.env.example` — all required server configuration documented with empty secrets.
10. `.gitignore` — prevents secrets, Vercel state and logs from entering Git.
11. `vercel.json` — production headers and clean `/neo` and `/bean` routes.
12. `supabase/migrations/001_phase1_core.sql` — users, conversations, messages, usage, rate limits, reset tokens, subscriptions and notifications.
13. `supabase/migrations/002_phase1_rls.sql` — RLS enabled and direct browser access revoked for server-only architecture.
14. `bean.html` / `bean.css` — truthful minimal Coming Soon destination; existing Bean links now work.
15. `manifest.webmanifest` / `sw.js` — installable shortcut/app-shell behavior without changing UI.
16. `README.md` — clean setup, migration, security and release instructions.
17. `package.json` — production identity, Node requirement and syntax-check command.
18. `package-lock.json` — root dependency manifest included; regenerate on a connected development machine with `npm install` before final commit because this sandbox could not access the package registry.

## Existing visual/content files intentionally preserved

The existing CSS identity and marketing/legal pages were not rewritten because no structural defect required it. Their local links were validated after adding the Bean page. This follows the approved rule: patch only what is required and do not redesign or damage working UI.

## Validation completed

- `node --check` passed for auth, chat, history, checkout, notifications and frontend JS.
- All 16 HTML files were scanned for local linked assets/pages; zero broken local routes were found.
- No service-role, Gemini, JWT or Lemon Squeezy secret value was inserted into frontend code.
- Existing composer, sidebar, chat layout, mascot, dark mode and visual direction remain preserved.

## Premium refinement files
- `premium-ui.css`: shared selection, footer language control, modal, responsive and accessibility styles.
- `premium-ui.js`: searchable language selector with local preference persistence, keyboard Escape handling and focus return.
- `research.html`: architecture diagram replaced with a mascot-only visual inside the same approved card.
- `research.css`: mascot-only presentation styles appended without rewriting the original design system.
- All HTML pages: only two shared asset references added (`premium-ui.css`, `premium-ui.js`).
