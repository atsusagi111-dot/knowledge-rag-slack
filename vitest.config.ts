import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 既定は単体テスト + PGlite でのローカル RLS テスト。実 DB に触る tests/db/ は npm run test:rls（vitest.db.config.ts）で実行する
    include: ["tests/*.test.ts"],
    testTimeout: 60_000,
    // PGlite（WASM）が重いので、ファイルを並列実行しない（メモリ不足での失敗を防ぐ）
    fileParallelism: false,
    setupFiles: ["tests/setup.ts"],
  },
});
