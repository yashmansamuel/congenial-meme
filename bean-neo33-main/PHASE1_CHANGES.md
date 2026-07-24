# Phase 1 implementation changes

1. Added reproducible environment and Vercel configuration.
2. Added versioned Supabase migrations and RLS lockdown.
3. Rebuilt chat API around approved 15 requests / 3 hours quota.
4. Added successful-response-only usage accounting.
5. Added five-files-per-day free limit and verified MIME/size validation.
6. Added Gemini URL Context + Google Search tools for Deep Research mode.
7. Added secure server-side Lemon Squeezy checkout creation.
8. Removed direct browser Supabase profile query.
9. Fixed unsafe markdown fallback when DOMPurify is unavailable.
10. Added truthful Bean Coming Soon page and resolved existing links.
11. Added web app manifest and service worker for installable app behavior.
12. Preserved the approved NEO layout, composer, sidebar, dark mode and visual identity.

## Premium UI refinement pass
- Added one shared premium consistency layer across all 16 HTML pages.
- Added consistent text-selection highlighting.
- Upgraded the footer language control into an accessible searchable language selector.
- Preserved the existing footer structure, links, colors and product identity.
- Simplified the Research featured black visual by removing the architecture diagram and retaining the NEO mascot only.
- Added reduced-motion and mobile behavior for the new UI layer.

## Vite and favicon refinement
- Added `assets/favicon.png` and linked it across every HTML page.
- Added a multi-page Vite configuration without restructuring the existing frontend.
- Added Vite development, build and preview scripts.
- Kept provider API keys and internal provider model identifiers on the server only.
- Removed the client-supplied model field from chat requests; the backend selects the approved model by plan.
