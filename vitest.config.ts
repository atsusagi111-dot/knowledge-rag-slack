import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    // RLS テストは実 DB に接続するため .env を読む
    setupFiles: ["tests/setup.ts"],
  },
});
