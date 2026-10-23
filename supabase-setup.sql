-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- Creates the table that holds each user's decks. Row-level security means a signed-in
-- user can only read and write rows where user_id matches their own account.

create table if not exists public.decks (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.decks enable row level security;

drop policy if exists "Users manage their own decks" on public.decks;

create policy "Users manage their own decks"
  on public.decks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
