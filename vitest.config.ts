import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    // PGlite（WASM）が重いので、ファイルを並列実行しない（メモリ不足での失敗を防ぐ）
    fileParallelism: false,
    // RLS テストは実 DB に接続するため .env を読む
    setupFiles: ["tests/setup.ts"],
  },
});
