/**
 * Phase 2 用スタブ。
 * 実装時は Google Drive API v3（サービスアカウント）で files.list / files.get(alt=media) を使う。
 */
import type { DocumentSource, SourceFile } from "./DocumentSource.js";

export class GoogleDriveSource implements DocumentSource {
  readonly type = "gdrive" as const;

  constructor(_options: { folderId: string; serviceAccountJsonPath: string }) {}

  // eslint-disable-next-line require-yield
  async *list(): AsyncIterable<SourceFile> {
    throw new Error("GoogleDriveSource は Phase 2 で実装します");
  }

  async read(_file: SourceFile): Promise<Buffer> {
    throw new Error("GoogleDriveSource は Phase 2 で実装します");
  }
}
