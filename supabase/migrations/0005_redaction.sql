-- 誤アップロード取り消し（redact）のための列を監査ログに追加
--   answer_channel_id / answer_ts : 回答を Slack に投稿した場所と ID（あとで削除できるように）
--   redacted_at / redaction_note  : 取り消し処理の記録（ログ行自体は消さない）
alter table search_logs
  add column if not exists answer_channel_id text,
  add column if not exists answer_ts         text,
  add column if not exists redacted_at       timestamptz,
  add column if not exists redaction_note    text;

-- rag_bot は自分名義の行の「回答の投稿先」列だけ更新できる
grant update (answer_channel_id, answer_ts) on search_logs to rag_bot;
grant select on search_logs to rag_bot;

drop policy if exists search_logs_select_self on search_logs;
create policy search_logs_select_self on search_logs
  for select to rag_bot
  using (slack_user_id = current_slack_user_id());

drop policy if exists search_logs_update_self on search_logs;
create policy search_logs_update_self on search_logs
  for update to rag_bot
  using (slack_user_id = current_slack_user_id())
  with check (slack_user_id = current_slack_user_id());

-- 取り消し処理の記録（誰が・いつ・何を・何件に影響したか）
create table if not exists redactions (
  id             bigint generated always as identity primary key,
  source_path    text not null,
  title          text,
  department_id  text,
  reason         text not null,
  affected_logs  int not null default 0,
  slack_deleted  int not null default 0,
  quarantined_to text,
  created_at     timestamptz not null default now()
);
