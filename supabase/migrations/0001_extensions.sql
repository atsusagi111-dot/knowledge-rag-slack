-- pgvector = PostgreSQL でベクトル（意味検索用の数値列）を扱う拡張機能
-- Supabase ダッシュボードで有効化済みでも、冪等なので実行して問題ない
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
-- 以降のマイグレーションで vector 型を修飾なしで使えるようにする
set search_path = public, extensions;
