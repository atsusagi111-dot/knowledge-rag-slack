/**
 * 取り込み元の抽象インターフェース。
 * MVP は LocalFolderSource のみ実装。SharePoint / Google Drive は Phase 2 でここに差し込む。
 */
export type SourceType = "local" | "sharepoint" | "gdrive";
export type FileType = "pdf" | "docx";

export interface SourceFile {
  /** 取り込み元内で一意なパス（documents.source_path に保存） */
  path: string;
  /** 表示用のファイル名 */
  name: string;
  fileType: FileType;
  /** 部署のヒント（フォルダ名など）。文書本文の冒頭行が優先される */
  departmentHint?: string;

}

export interface DocumentSource {
  readonly type: SourceType;
  /** 取り込み対象ファイルを列挙する */
  list(): AsyncIterable<SourceFile>;
  /** ファイルの中身をバイト列で返す */
  read(file: SourceFile): Promise<Buffer>;
}

export function fileTypeFromName(name: string): FileType | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  return null;
}
