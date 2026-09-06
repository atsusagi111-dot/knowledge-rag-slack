-- 取り込みに失敗したファイルの記録。成功したら行を消す。
-- 週次ワークフロー（weekly-retry）が `npm run ingest -- --retry-failed` でここにあるファイルだけ再試行する
create table if not exists ingest_failures (
  source_type  text not null,
  source_path  text not null,
  error        text not null,
  attempts     int  not null default 1,
  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  primary key (source_type, source_path)
);
