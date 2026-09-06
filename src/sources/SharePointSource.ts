/**
 * Phase 2 用スタブ。
 * 実装時は Microsoft Graph API（要 Microsoft 365 ライセンス + Entra ID アプリ登録）で
 *   GET /sites/{site-id}/drives/{drive-id}/root/children を辿って list() を、
 *   GET /drives/{drive-id}/items/{item-id}/content で read() を実装する。
 * 部署は SharePoint のライブラリ名 or フォルダ名を departmentHint に入れる。
 */
import type { DocumentSource, SourceFile } from "./DocumentSource.js";

export class SharePointSource implements DocumentSource {
  readonly type = "sharepoint" as const;

  constructor(_options: { siteId: string; driveId: string; tenantId: string; clientId: string }) {}

  // eslint-disable-next-line require-yield
  async *list(): AsyncIterable<SourceFile> {
    throw new Error("SharePointSource は Phase 2 で実装します（Microsoft 365 ライセンスが必要）");
  }

  async read(_file: SourceFile): Promise<Buffer> {
    throw new Error("SharePointSource は Phase 2 で実装します（Microsoft 365 ライセンスが必要）");
  }
}
