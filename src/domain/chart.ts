/**
 * カルテ記録（追記専用・版管理・ハッシュ連鎖）。
 *
 * 電子保存の3原則のうち「真正性」をアプリケーション層でも担保する:
 *   - 確定（final）済みの記録は変更不可。訂正は supersedesId で旧版を指す新版の追加。
 *   - 各記録は「前の記録のハッシュ + 本文」の SHA-256 を持ち、チェーン検証で改ざんを検知。
 * DB 層の強制（UPDATE/DELETE 拒否トリガ）は db/schema.sql 側にあり、二重に守る。
 */
import { createHash } from "node:crypto";

export interface Soap {
  S: string;
  O: string;
  A: string;
  P: string;
}

export interface ChartEntry {
  id: string;
  visitId: string;
  supersedesId?: string;
  status: "draft" | "final";
  soap: Soap;
  authoredBy: string;
  finalizedBy?: string;
  finalizedAt?: string;
  contentHash?: string;
}

function hashEntry(prevHash: string | undefined, entry: ChartEntry): string {
  const payload = JSON.stringify({
    prev: prevHash ?? null,
    visitId: entry.visitId,
    supersedesId: entry.supersedesId ?? null,
    soap: entry.soap,
    authoredBy: entry.authoredBy,
    finalizedBy: entry.finalizedBy ?? null,
    finalizedAt: entry.finalizedAt ?? null,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * 記録を確定する。確定済み記録の再確定は不可。
 * prevHash には同一患者のチェーン上で直前に確定した記録の contentHash を渡す（先頭は undefined）。
 */
export function finalizeEntry(
  entry: ChartEntry,
  finalizedBy: string,
  finalizedAt: string,
  prevHash: string | undefined,
): ChartEntry {
  if (entry.status === "final") {
    throw new Error(`chart entry is already final: ${entry.id}`);
  }
  const finalized: ChartEntry = { ...entry, status: "final", finalizedBy, finalizedAt };
  finalized.contentHash = hashEntry(prevHash, finalized);
  return finalized;
}

/**
 * 確定済み記録の訂正版（draft）を作る。元の記録自体は変更しない。
 */
export function reviseEntry(original: ChartEntry, soap: Soap, authoredBy: string): ChartEntry {
  if (original.status !== "final") {
    throw new Error("only final entries can be revised; edit the draft directly");
  }
  return {
    id: crypto.randomUUID(),
    visitId: original.visitId,
    supersedesId: original.id,
    status: "draft",
    soap,
    authoredBy,
  };
}

/** 確定済み記録のチェーンを検証する。改ざん・欠落があれば false。 */
export function verifyChain(entries: ChartEntry[]): boolean {
  let prevHash: string | undefined;
  for (const entry of entries) {
    if (entry.status !== "final" || !entry.contentHash) return false;
    if (hashEntry(prevHash, entry) !== entry.contentHash) return false;
    prevHash = entry.contentHash;
  }
  return true;
}
