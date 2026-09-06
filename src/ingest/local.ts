/** 単一のローカルファイルを抽出してメタデータを付ける（extract / chunk CLI の共通処理） */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileTypeFromName } from "../sources/DocumentSource.js";
import { extractText, type ExtractedText } from "./extract.js";
import { extractMetadata, type DocumentMetadata } from "./metadata.js";

export async function analyzeLocalFile(file: string): Promise<{ extracted: ExtractedText; meta: DocumentMetadata }> {
  const type = fileTypeFromName(file);
  if (!type) throw new Error("pdf か docx を指定してください");
  const extracted = await extractText(await readFile(file), type);
  // 親フォルダ名を部署のヒントにする（LocalFolderSource と同じ規則）
  const hint = path.basename(path.dirname(path.resolve(file)));
  return { extracted, meta: extractMetadata(extracted.fullText, path.basename(file), hint) };
}
