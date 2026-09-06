/**
 * ローカルフォルダを取り込み元にする実装。
 * 想定構成: <root>/<部署フォルダ>/xxx.pdf  例) data/docs/strategy/bank-dx.pdf
 * 部署フォルダ名（英語 ID または日本語名）を departmentHint として渡す。
 * 直下に置かれたファイルも取り込む（その場合は本文の冒頭行だけで部署を決める）。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileTypeFromName, type DocumentSource, type SourceFile } from "./DocumentSource.js";

export class LocalFolderSource implements DocumentSource {
  readonly type = "local" as const;

  constructor(private readonly root: string) {}

  async *list(): AsyncIterable<SourceFile> {
    yield* this.walk(this.root, undefined);
  }

  private async *walk(dir: string, hint: string | undefined): AsyncGenerator<SourceFile> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      throw new Error(`取り込み元フォルダが読めません: ${dir}（${(e as Error).message}）`);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // 1 階層目のフォルダ名を部署ヒントにする。深い階層は最初のヒントを引き継ぐ
        yield* this.walk(full, hint ?? entry.name);
        continue;
      }
      const fileType = fileTypeFromName(entry.name);
      if (!fileType || entry.name.startsWith("~$")) continue; // 対象外 / Word の一時ファイル
      yield { path: path.relative(this.root, full).split(path.sep).join("/"), name: entry.name, fileType, departmentHint: hint };
    }
  }

  async read(file: SourceFile): Promise<Buffer> {
    return readFile(path.join(this.root, ...file.path.split("/")));
  }
}
