-- ============================================================
-- 部署マスタ
-- ============================================================
create table if not exists departments (
  id       text primary key,
  name_ja  text not null unique
);

-- ============================================================
-- Slack ユーザー ↔ 部署（多対多）
-- ============================================================
create table if not exists user_departments (
  slack_user_id  text not null,
  department_id  text not null references departments(id),
  display_name   text,
  created_at     timestamptz not null default now(),
  primary key (slack_user_id, department_id)
);
create index if not exists user_departments_user_idx on user_departments (slack_user_id);

-- ============================================================
-- 文書（1 ファイル = 1 行）
-- ============================================================
create table if not exists documents (
  id             uuid primary key default gen_random_uuid(),
  source_type    text not null,                 -- 'local' | 'sharepoint' | 'gdrive'
  source_path    text not null,                 -- 取り込み元内で一意なパス
  content_hash   text not null,                 -- 本文の SHA-256（差分取り込み用）
  title          text not null,
  department_id  text not null references departments(id),
  doc_type       text not null default 'other', -- 'proposal' | 'report' | 'other'
  client_name    text,
  created_year   int,
  file_type      text not null,                 -- 'pdf' | 'docx'
  page_count     int,
  ingested_at    timestamptz not null default now(),
  unique (source_type, source_path)
);
create index if not exists documents_department_idx on documents (department_id);

-- ============================================================
-- チャンク（検索の単位）
-- ============================================================
create table if not exists chunks (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references documents(id) on delete cascade,
  department_id  text not null references departments(id), -- RLS 判定用に非正規化
  chunk_index    int not null,
  section_title  text,
  page_start     int,
  page_end       int,
  content        text not null,
  token_count    int not null,
  embedding      vector(1536) not null,
  unique (document_id, chunk_index)
);
create index if not exists chunks_department_idx on chunks (department_id);
-- HNSW インデックスは Phase 2（数万チャンク超）で追加する:
-- create index chunks_embedding_hnsw on chunks using hnsw (embedding vector_cosine_ops);

-- ============================================================
-- 監査ログ（誰が・いつ・何を検索し・何が返ったか）
-- ============================================================
create table if not exists search_logs (
  id               bigint generated always as identity primary key,
  slack_user_id    text not null,
  channel_id       text,
  question         text not null,
  department_ids   text[] not null,
  top_chunk_ids    uuid[] not null default '{}',
  top_scores       real[] not null default '{}',
  result_status    text not null,   -- 'answered' | 'no_hit' | 'unregistered' | 'error'
  model            text,
  latency_ms       int,
  created_at       timestamptz not null default now()
);
create index if not exists search_logs_user_idx on search_logs (slack_user_id, created_at desc);
