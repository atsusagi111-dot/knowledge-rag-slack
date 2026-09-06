-- ============================================================
-- ボット専用ロール rag_bot
--   ・BYPASSRLS を持たない → RLS が必ず効く
--   ・chunks / documents / user_departments は SELECT のみ
--   ・search_logs は INSERT のみ
-- パスワードは migrate.ts が .env の RAG_BOT_PASSWORD で置換する
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'rag_bot') then
    create role rag_bot login password '__RAG_BOT_PASSWORD__' nobypassrls;
  else
    alter role rag_bot with login password '__RAG_BOT_PASSWORD__' nobypassrls;
  end if;
end $$;

grant usage on schema public to rag_bot;
grant usage on schema extensions to rag_bot;
grant select on departments, user_departments, documents, chunks to rag_bot;
grant insert on search_logs to rag_bot;
grant usage, select on sequence search_logs_id_seq to rag_bot;

-- ============================================================
-- RLS（Row Level Security = 行ごとの閲覧制御）
-- 「今のトランザクションで set_config された Slack ユーザー」が
-- 所属する部署の行だけを見せる。未設定なら空文字 → 0 件（安全側）。
-- ============================================================
create or replace function current_slack_user_id() returns text
language sql stable
as $$ select coalesce(current_setting('app.slack_user_id', true), '') $$;

alter table documents        enable row level security;
alter table chunks           enable row level security;
alter table user_departments enable row level security;
alter table search_logs      enable row level security;
alter table departments      enable row level security;

-- 部署マスタは全員が読んで良い
drop policy if exists departments_read_all on departments;
create policy departments_read_all on departments
  for select to rag_bot using (true);

-- 自分の所属行だけ読める
drop policy if exists user_departments_self on user_departments;
create policy user_departments_self on user_departments
  for select to rag_bot
  using (slack_user_id = current_slack_user_id());

-- 所属部署の文書だけ
drop policy if exists documents_by_department on documents;
create policy documents_by_department on documents
  for select to rag_bot
  using (
    department_id in (
      select department_id from user_departments
      where slack_user_id = current_slack_user_id()
    )
  );

-- 所属部署のチャンクだけ（ベクトル検索の並べ替え前に絞られる）
drop policy if exists chunks_by_department on chunks;
create policy chunks_by_department on chunks
  for select to rag_bot
  using (
    department_id in (
      select department_id from user_departments
      where slack_user_id = current_slack_user_id()
    )
  );

-- 監査ログは自分の行として書くことだけ許可
drop policy if exists search_logs_insert_self on search_logs;
create policy search_logs_insert_self on search_logs
  for insert to rag_bot
  with check (slack_user_id = current_slack_user_id());
