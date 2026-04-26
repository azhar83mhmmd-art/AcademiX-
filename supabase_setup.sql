-- AcademiX — Supabase Setup SQL (UPGRADED v2)
-- Run this in your Supabase SQL Editor

-- ─────────────────────────────────────────────────────────
--  USERS
-- ─────────────────────────────────────────────────────────
create table if not exists public.users (
  id        uuid primary key references auth.users(id) on delete cascade,
  email     text unique not null,
  username  text,
  role      text default 'siswa',
  banned    boolean default false,
  created_at timestamp with time zone default now()
);
alter table public.users enable row level security;
create policy "Users: read all"    on public.users for select using (true);
create policy "Users: own write"   on public.users for insert with check (auth.uid() = id);
create policy "Users: own update"  on public.users for update using (auth.uid() = id);

-- ─────────────────────────────────────────────────────────
--  SUBJECTS  (with lock columns)
-- ─────────────────────────────────────────────────────────
create table if not exists public.subjects (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  kisi_content     text,
  duration_minutes int  default 60,
  -- Lock/access control
  lock_mode        text default 'open',   -- 'open' | 'locked' | 'scheduled'
  open_at          timestamp with time zone,
  close_at         timestamp with time zone,
  created_at       timestamp with time zone default now()
);
alter table public.subjects enable row level security;
create policy "Subjects: all read"   on public.subjects for select using (true);
create policy "Subjects: admin write" on public.subjects for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- Add lock columns to existing subjects table (safe migration)
alter table public.subjects add column if not exists lock_mode text default 'open';
alter table public.subjects add column if not exists open_at   timestamp with time zone;
alter table public.subjects add column if not exists close_at  timestamp with time zone;

-- ─────────────────────────────────────────────────────────
--  QUESTIONS
-- ─────────────────────────────────────────────────────────
create table if not exists public.questions (
  id              uuid primary key default gen_random_uuid(),
  subject_id      uuid references public.subjects(id) on delete cascade,
  type            text not null,           -- 'pg' | 'pgk' | 'isian'
  question_text   text not null,
  options         jsonb,
  correct_answer  text,
  correct_answers text[],
  points          int default 10,
  created_at      timestamp with time zone default now()
);
alter table public.questions enable row level security;
create policy "Questions: all read"    on public.questions for select using (true);
create policy "Questions: admin write" on public.questions for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- ─────────────────────────────────────────────────────────
--  RESULTS
-- ─────────────────────────────────────────────────────────
create table if not exists public.results (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(id) on delete cascade,
  subject_id      uuid references public.subjects(id) on delete cascade,
  score           int,
  correct         int,
  wrong           int,
  total_questions int,
  answers         jsonb,
  created_at      timestamp with time zone default now()
);
alter table public.results enable row level security;
create policy "Results: own read"   on public.results for select using (auth.uid() = user_id or
  exists (select 1 from public.users where id = auth.uid() and role = 'admin'));
create policy "Results: own insert" on public.results for insert with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────
--  LEADERBOARD
-- ─────────────────────────────────────────────────────────
create table if not exists public.leaderboard (
  user_id   uuid primary key references public.users(id) on delete cascade,
  username  text,
  avg_score int,
  updated_at timestamp with time zone default now()
);
alter table public.leaderboard enable row level security;
create policy "Leaderboard: all read"   on public.leaderboard for select using (true);
create policy "Leaderboard: own upsert" on public.leaderboard for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────
--  RATINGS
-- ─────────────────────────────────────────────────────────
create table if not exists public.ratings (
  id         uuid primary key default gen_random_uuid(),
  subject_id uuid references public.subjects(id) on delete cascade,
  user_id    uuid references public.users(id) on delete cascade,
  rating     int,
  unique (subject_id, user_id)
);
alter table public.ratings enable row level security;
create policy "Ratings: all read"    on public.ratings for select using (true);
create policy "Ratings: own upsert"  on public.ratings for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────
--  ANONYMOUS MESSAGES (Confession)
-- ─────────────────────────────────────────────────────────
create table if not exists public.anonymous_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.users(id) on delete cascade,
  message    text not null,
  likes      int default 0,
  liked_by   uuid[],
  created_at timestamp with time zone default now()
);
alter table public.anonymous_messages enable row level security;
create policy "Anon msgs: all read"   on public.anonymous_messages for select using (true);
create policy "Anon msgs: auth insert" on public.anonymous_messages for insert with check (auth.uid() = user_id);
create policy "Anon msgs: auth update" on public.anonymous_messages for update using (true);
create policy "Anon msgs: admin delete" on public.anonymous_messages for delete using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- ─────────────────────────────────────────────────────────
--  CONFESSION REPLIES  (public replies to anonymous messages)
-- ─────────────────────────────────────────────────────────
create table if not exists public.confession_replies (
  id            uuid primary key default gen_random_uuid(),
  confession_id uuid references public.anonymous_messages(id) on delete cascade,
  user_id       uuid references public.users(id) on delete cascade,
  content       text not null,
  created_at    timestamp with time zone default now()
);
alter table public.confession_replies enable row level security;
create policy "Replies: all read"    on public.confession_replies for select using (true);
create policy "Replies: auth insert" on public.confession_replies for insert with check (auth.uid() = user_id);
create policy "Replies: admin delete" on public.confession_replies for delete using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- ─────────────────────────────────────────────────────────
--  COMMENTS (public feed)
-- ─────────────────────────────────────────────────────────
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.users(id) on delete cascade,
  content    text not null,
  parent_id  uuid references public.comments(id) on delete cascade,
  likes      int default 0,
  liked_by   uuid[],
  created_at timestamp with time zone default now()
);
alter table public.comments enable row level security;
create policy "Comments: all read"   on public.comments for select using (true);
create policy "Comments: auth insert" on public.comments for insert with check (auth.uid() = user_id);
create policy "Comments: auth update" on public.comments for update using (true);
create policy "Comments: admin delete" on public.comments for delete using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- ─────────────────────────────────────────────────────────
--  BROADCASTS
-- ─────────────────────────────────────────────────────────
create table if not exists public.broadcasts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.users(id) on delete cascade,
  title      text not null,
  message    text not null,
  created_at timestamp with time zone default now()
);
alter table public.broadcasts enable row level security;
create policy "Broadcasts: all read"    on public.broadcasts for select using (true);
create policy "Broadcasts: admin write" on public.broadcasts for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- ─────────────────────────────────────────────────────────
--  REALTIME — enable for live updates
-- ─────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.broadcasts;
alter publication supabase_realtime add table public.leaderboard;
alter publication supabase_realtime add table public.anonymous_messages;
alter publication supabase_realtime add table public.confession_replies;
alter publication supabase_realtime add table public.comments;

-- ─────────────────────────────────────────────────────────
--  EXAM VIOLATIONS LOG (Anti-Cheat v2)
-- ─────────────────────────────────────────────────────────
create table if not exists public.exam_violations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(id) on delete cascade,
  subject_id      uuid references public.subjects(id) on delete set null,
  violation_count int  default 0,
  violation_log   jsonb default '[]',   -- [{type, timestamp, device}]
  tab_switch_count int default 0,
  status          text default 'aman',  -- 'aman' | 'peringatan' | 'curang'
  device_info     jsonb,
  created_at      timestamp with time zone default now(),
  updated_at      timestamp with time zone default now()
);
alter table public.exam_violations enable row level security;
create policy "Violations: own read"   on public.exam_violations for select using (auth.uid() = user_id or
  exists (select 1 from public.users where id = auth.uid() and role = 'admin'));
create policy "Violations: own insert" on public.exam_violations for insert with check (auth.uid() = user_id);
create policy "Violations: own update" on public.exam_violations for update using (auth.uid() = user_id);

-- Enable realtime for violations
alter publication supabase_realtime add table public.exam_violations;

-- Results: add cheat_status column
alter table public.results add column if not exists cheat_status text default 'normal'; -- 'normal' | 'curang'
alter table public.results add column if not exists violation_count int default 0;
