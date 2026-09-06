/**
 * ローカル開発用 PostgreSQL（PGlite + pgvector）を TCP で公開する。
 * Supabase を作る前でも、マイグレーション・取り込み・検索・評価を一通り試せる。
 *
 *   npx tsx scripts/local-db.ts            → 127.0.0.1:54329 で待ち受け（データは data/local-db/ に保存）
 *   npx tsx scripts/local-db.ts --memory   → メモリのみ（終了で消える）
 *
 * .env.local.example を .env にコピーすると、この DB に接続する設定になる。
 * PGlite は 1 ユーザー DB なので rag_bot でのログインはできないが、withSlackUser が毎回 set local role rag_bot を実行するので RLS は同じように効く。
 */
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = Number(process.env.LOCAL_DB_PORT ?? 54329);
const memory = process.argv.includes("--memory");

async function main() {
  const db = memory ? new PGlite({ extensions: { vector } }) : new PGlite("./data/local-db", { extensions: { vector } });
  await db.waitReady;
  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1", maxConnections: 8 });
  await server.start();
  console.log(`ローカル DB 起動: postgresql://postgres@127.0.0.1:${PORT}/postgres  ${memory ? "(メモリ)" : "(data/local-db に保存)"}`);
  console.log("Ctrl+C で停止");
  const stop = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
