/**
 * CLI 共通部品。
 *  - 引数: flag("--force") / value("--user") / positionals()
 *  - 実行: runCli(main) がエラー表示・終了コード・DB 接続の後始末を一手に引き受ける
 */
import { closeAll } from "../db/client.js";

const argv = process.argv.slice(2);

/** 値を取るフラグ一覧（positionals の判定に使う） */
const VALUE_FLAGS = new Set(["--user", "--k", "--questions", "--path", "--reason", "--department", "--month"]);

export function flag(name: string): boolean {
  return argv.includes(name);
}

export function value(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/** フラグでもフラグの値でもない引数（ファイルパス、質問文など） */
export function positionals(): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (VALUE_FLAGS.has(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

export function runCli(main: () => Promise<void>): void {
  main()
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => closeAll());
}
