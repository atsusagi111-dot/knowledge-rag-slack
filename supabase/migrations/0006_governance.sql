-- ============================================================
-- 機密文書ガバナンス
--  ① 「機密」部署: この部署を付与された人だけが見られる文書区分
--  ② documents.department_id を手で変えたら chunks にも反映し、取り込みで戻らないようロック
--  ③ 部署管理者（月次レポートの送付先）
-- ============================================================

insert into departments (id, name_ja) values ('confidential', '機密')
on conflict (id) do update set name_ja = excluded.name_ja;

alter table documents
  add column if not exists department_locked boolean not null default false;

-- Table Editor などで department_id を変更したときに
--   ・chunks.department_id を同じ値に更新（RLS の判定列）
--   ・department_locked = true にして、次回の取り込みで元の部署に戻らないようにする
create or replace function sync_document_department() returns trigger
language plpgsql
as $$
begin
  if new.department_id is distinct from old.department_id then
    update chunks set department_id = new.department_id where document_id = new.id;
    if not new.department_locked then
      new.department_locked := true;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists documents_department_sync on documents;
create trigger documents_department_sync
  before update of department_id on documents
  for each row execute function sync_document_department();

-- 部署管理者（レポート送付先）。1 部署に複数人可
create table if not exists department_managers (
  department_id  text not null references departments(id),
  slack_user_id  text not null,
  display_name   text,
  primary key (department_id, slack_user_id)
);
