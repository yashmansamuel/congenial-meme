begin;
create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  password_hash text not null,
  plan_type text not null default 'free' check (plan_type in ('free','pro','business','suite')),
  status text not null default 'active' check (status in ('active','disabled','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.app_users(id) on delete cascade,
  title text not null default 'New Chat', model_used text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  role text not null check(role in ('user','assistant','system')), content text not null, created_at timestamptz not null default now()
);
create table if not exists public.ai_usage_events (
  id bigint generated always as identity primary key, user_id uuid not null references public.app_users(id) on delete cascade,
  conversation_id uuid references public.chat_conversations(id) on delete set null, status text not null default 'success',
  model_key text, attachment_count integer not null default 0 check(attachment_count between 0 and 5), deep_research boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.auth_rate_limits (
  id bigint generated always as identity primary key, key text not null, action text not null, created_at timestamptz not null default now()
);
create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique, expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references public.app_users(id) on delete cascade,
  provider text not null default 'lemon_squeezy', provider_customer_id text, provider_subscription_id text unique,
  status text not null default 'inactive', variant_id text, renews_at timestamptz, ends_at timestamptz, updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.app_users(id) on delete cascade,
  type text not null default 'system', title text not null, message text not null, metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user_created on public.notifications(user_id,created_at desc);
create index if not exists idx_conversations_user_updated on public.chat_conversations(user_id,updated_at desc);
create index if not exists idx_messages_conversation_created on public.chat_messages(conversation_id,created_at);
create index if not exists idx_usage_user_created on public.ai_usage_events(user_id,created_at desc);
create index if not exists idx_rate_limit_key_action_created on public.auth_rate_limits(key,action,created_at desc);
commit;
