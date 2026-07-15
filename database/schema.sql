-- Study Desk's browser never connects to Supabase directly. Google authenticates
-- users in the Node server, and this database stores only durable application data.
create extension if not exists pgcrypto;

create table if not exists public.study_desk_users (
  id uuid primary key default gen_random_uuid(),
  google_subject text not null unique,
  email text not null,
  name varchar(64) not null default 'Student',
  avatar varchar(16) not null default 'male' check (avatar in ('male', 'girl')),
  color varchar(7) not null default '#86efac' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  photo text,
  profile_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_libraries (
  id uuid primary key default gen_random_uuid(),
  name varchar(80) not null,
  owner_user_id uuid not null references public.study_desk_users(id) on delete restrict,
  invite_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_library_memberships (
  library_id uuid not null references public.study_libraries(id) on delete cascade,
  user_id uuid not null references public.study_desk_users(id) on delete cascade,
  role varchar(16) not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (library_id, user_id)
);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.study_desk_users(id) on delete cascade,
  library_id uuid not null references public.study_libraries(id) on delete cascade,
  mode varchar(16) not null check (mode in ('focus', 'pomodoro')),
  topic varchar(120) not null default '',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  focus_seconds integer check (focus_seconds is null or focus_seconds between 0 and 86400),
  completed boolean not null default false
);

create index if not exists study_library_memberships_user_idx
  on public.study_library_memberships(user_id);
create index if not exists study_sessions_user_started_idx
  on public.study_sessions(user_id, started_at desc);
create index if not exists study_sessions_library_started_idx
  on public.study_sessions(library_id, started_at desc);

-- The public schema is convenient for the Supabase SQL editor, but no browser key
-- is used by this app. RLS and revoked API roles keep these tables closed if someone
-- later enables Supabase's generated REST API without adding deliberate policies.
alter table public.study_desk_users enable row level security;
alter table public.study_libraries enable row level security;
alter table public.study_library_memberships enable row level security;
alter table public.study_sessions enable row level security;

revoke all on public.study_desk_users from anon, authenticated;
revoke all on public.study_libraries from anon, authenticated;
revoke all on public.study_library_memberships from anon, authenticated;
revoke all on public.study_sessions from anon, authenticated;
