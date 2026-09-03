-- ことば帳: Supabase 初期設定
-- Supabase Dashboard の SQL Editor で、このファイル全体を一度実行してください。

begin;

create extension if not exists pgcrypto;

create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  category text not null check (category in ('english', 'classical')),
  sort_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notebook_id uuid not null,
  front text not null check (char_length(trim(front)) > 0),
  back text not null check (char_length(trim(back)) > 0),
  note text not null default '',
  ocr_raw_meaning text not null default '',
  answer_candidates text[] not null default '{}',
  sort_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, notebook_id, user_id),
  constraint words_notebook_owner_fk
    foreign key (notebook_id, user_id)
    references public.notebooks(id, user_id)
    on delete cascade
);

create table if not exists public.review_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  notebook_id uuid not null,
  word_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, notebook_id, word_id),
  constraint review_word_owner_fk
    foreign key (word_id, notebook_id, user_id)
    references public.words(id, notebook_id, user_id)
    on delete cascade
);

create index if not exists notebooks_user_id_idx
  on public.notebooks(user_id);
create index if not exists words_user_notebook_idx
  on public.words(user_id, notebook_id);
create index if not exists review_items_user_notebook_idx
  on public.review_items(user_id, notebook_id);

alter table public.notebooks
  add column if not exists sort_index integer not null default 0;
alter table public.words
  add column if not exists sort_index integer not null default 0;
alter table public.words
  add column if not exists ocr_raw_meaning text not null default '';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notebooks_set_updated_at on public.notebooks;
create trigger notebooks_set_updated_at
before update on public.notebooks
for each row execute function public.set_updated_at();

drop trigger if exists words_set_updated_at on public.words;
create trigger words_set_updated_at
before update on public.words
for each row execute function public.set_updated_at();

alter table public.notebooks enable row level security;
alter table public.words enable row level security;
alter table public.review_items enable row level security;

drop policy if exists "notebooks_select_own" on public.notebooks;
create policy "notebooks_select_own"
on public.notebooks for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "notebooks_insert_own" on public.notebooks;
create policy "notebooks_insert_own"
on public.notebooks for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "notebooks_update_own" on public.notebooks;
create policy "notebooks_update_own"
on public.notebooks for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "notebooks_delete_own" on public.notebooks;
create policy "notebooks_delete_own"
on public.notebooks for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "words_select_own" on public.words;
create policy "words_select_own"
on public.words for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "words_insert_own" on public.words;
create policy "words_insert_own"
on public.words for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "words_update_own" on public.words;
create policy "words_update_own"
on public.words for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "words_delete_own" on public.words;
create policy "words_delete_own"
on public.words for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "review_select_own" on public.review_items;
create policy "review_select_own"
on public.review_items for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "review_insert_own" on public.review_items;
create policy "review_insert_own"
on public.review_items for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "review_update_own" on public.review_items;
create policy "review_update_own"
on public.review_items for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "review_delete_own" on public.review_items;
create policy "review_delete_own"
on public.review_items for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.notebooks, public.words, public.review_items from anon;
grant select, insert, update, delete
  on public.notebooks, public.words, public.review_items
  to authenticated;

-- アプリ内の1回の保存を1トランザクションで反映します。
-- security invoker のため、上記RLSを回避しません。
create or replace function public.sync_user_data(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  notebook_list jsonb;
begin
  if current_user_id is null then
    raise exception 'ログインが必要です';
  end if;

  if payload is null
     or jsonb_typeof(payload) <> 'object'
     or jsonb_typeof(payload -> 'notebooks') <> 'array' then
    raise exception '保存データの形式が正しくありません';
  end if;

  notebook_list := payload -> 'notebooks';

  insert into public.notebooks (id, user_id, name, category, sort_index)
  select
    (notebook.item ->> 'id')::uuid,
    current_user_id,
    trim(notebook.item ->> 'name'),
    case
      when notebook.item ->> 'category' = 'classical' then 'classical'
      else 'english'
    end,
    (notebook.position - 1)::integer
  from jsonb_array_elements(notebook_list) with ordinality as notebook(item, position)
  on conflict (id) do update
  set name = excluded.name,
      category = excluded.category,
      sort_index = excluded.sort_index
  where public.notebooks.user_id = current_user_id;

  insert into public.words (
    id, user_id, notebook_id, front, back, note, ocr_raw_meaning, answer_candidates, sort_index
  )
  select
    (word.item ->> 'id')::uuid,
    current_user_id,
    (notebook.item ->> 'id')::uuid,
    trim(word.item ->> 'front'),
    trim(word.item ->> 'back'),
    coalesce(word.item ->> 'note', ''),
    coalesce(word.item ->> 'ocr_raw_meaning', ''),
    array(
      select jsonb_array_elements_text(
        coalesce(word.item -> 'answer_candidates', '[]'::jsonb)
      )
    ),
    (word.position - 1)::integer
  from jsonb_array_elements(notebook_list) with ordinality as notebook(item, position)
  cross join lateral jsonb_array_elements(
    coalesce(notebook.item -> 'words', '[]'::jsonb)
  ) with ordinality as word(item, position)
  on conflict (id) do update
  set notebook_id = excluded.notebook_id,
      front = excluded.front,
      back = excluded.back,
      note = excluded.note,
      ocr_raw_meaning = excluded.ocr_raw_meaning,
      answer_candidates = excluded.answer_candidates,
      sort_index = excluded.sort_index
  where public.words.user_id = current_user_id;

  -- 復習対象は現在の状態で全置換します。
  delete from public.review_items
  where user_id = current_user_id;

  delete from public.words as stored_word
  where stored_word.user_id = current_user_id
    and not exists (
      select 1
      from jsonb_array_elements(notebook_list) as notebook(item)
      cross join lateral jsonb_array_elements(
        coalesce(notebook.item -> 'words', '[]'::jsonb)
      ) as word(item)
      where (word.item ->> 'id')::uuid = stored_word.id
    );

  delete from public.notebooks as stored_notebook
  where stored_notebook.user_id = current_user_id
    and not exists (
      select 1
      from jsonb_array_elements(notebook_list) as notebook(item)
      where (notebook.item ->> 'id')::uuid = stored_notebook.id
    );

  insert into public.review_items (user_id, notebook_id, word_id)
  select distinct
    current_user_id,
    (notebook.item ->> 'id')::uuid,
    stored_word.id
  from jsonb_array_elements(notebook_list) as notebook(item)
  cross join lateral jsonb_array_elements_text(
    coalesce(notebook.item -> 'review_ids', '[]'::jsonb)
  ) as review_id(value)
  join public.words as stored_word
    on stored_word.id = review_id.value::uuid
   and stored_word.notebook_id = (notebook.item ->> 'id')::uuid
   and stored_word.user_id = current_user_id;
end;
$$;

revoke all on function public.sync_user_data(jsonb) from public, anon;
grant execute on function public.sync_user_data(jsonb) to authenticated;

commit;
