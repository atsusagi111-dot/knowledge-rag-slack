-- pgvector = PostgreSQL でベクトル（意味検索用の数値列）を扱う拡張機能
-- Supabase ダッシュボードで有効化済みでも、冪等なので実行して問題ない
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;
