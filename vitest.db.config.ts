import { defineConfig } from "vitest/config";

/** 実 DB（.env の Supabase または ローカル PGlite サーバー）に接続するテスト: npm run test:rls */
export default defineConfig({
  test: {
    include: ["tests/db/*.test.ts"],
    testTimeout: 60_000,
    setupFiles: ["tests/setup.ts"],
  },
});
