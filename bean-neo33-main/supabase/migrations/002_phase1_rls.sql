begin;
alter table public.app_users enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.auth_rate_limits enable row level security;
alter table public.password_reset_tokens enable row level security;
alter table public.subscriptions enable row level security;
alter table public.notifications enable row level security;
-- Phase 1 uses server-only service-role APIs. No anon/authenticated browser policies are granted.
revoke all on public.app_users, public.chat_conversations, public.chat_messages, public.ai_usage_events, public.auth_rate_limits, public.password_reset_tokens, public.subscriptions, public.notifications from anon, authenticated;
commit;
