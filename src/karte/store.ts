/**
 * 電子カルテ保存層（電子保存の3原則＋3省2ガイドラインの技術的担保を1モジュールに）。
 *
 * 既存の chart.ts（追記専用・SHA-256 ハッシュ連鎖＝真正性の核）の上に、運用に必要な
 * 「監査証跡・アクセス制御・見読性（可読出力）・保存性（暗号化バックアップと全体検証）」を載せる。
 * DB を持たない仮想稼働でも動く純TS実装（永続化は serialize/exportBackup の文字列を保存するだけ）。
 *
 * 3原則:
 *   - 真正性: 確定記録は変更不可・ハッシュ連鎖で改ざん検知（chart.ts）。誰が確定したかを記録。
 *   - 見読性: readableText() で人が読める形に整形（個別指導・監査で提示できる）。
 *   - 保存性: exportBackup()/importBackup() で暗号化保存・復元、verifyIntegrity() で全患者の連鎖検証。
 * 3省2ガイドライン（技術的安全管理）:
 *   - アクセス制御: 操作の都度 authorize(user, action) を必須化（権限の無い操作は拒否）。
 *   - 監査証跡: 全操作（追記・確定・閲覧・出力）を改ざん検知付きで記録する。
 */
import { createHash, createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { finalizeEntry, reviseEntry, verifyChain, type ChartEntry, type Soap } from "../domain/chart.js";

export type KarteAction = "append" | "finalize" | "revise" | "read" | "export";

export interface User {
  id: string;
  /** 役割。歯科医師のみ確定可、受付は閲覧のみ 等のアクセス制御に使う */
  role: "dentist" | "hygienist" | "reception" | "admin";
}

export interface AuditRecord {
  seq: number;
  at: string;
  userId: string;
  role: User["role"];
  action: KarteAction;
  patientId: string;
  entryId?: string;
  /** 直前監査レコードのハッシュ＋本レコードの SHA-256（監査証跡自体の改ざん検知） */
  hash: string;
}

/** 役割ごとに許可される操作（最小権限） */
const PERMISSIONS: Record<User["role"], Set<KarteAction>> = {
  dentist: new Set<KarteAction>(["append", "finalize", "revise", "read", "export"]),
  hygienist: new Set<KarteAction>(["append", "revise", "read"]),
  reception: new Set<KarteAction>(["read"]),
  admin: new Set<KarteAction>(["read", "export"]),
};

export class AccessDeniedError extends Error {
  constructor(user: User, action: KarteAction) {
    super(`アクセス拒否: 役割 ${user.role} は操作 ${action} を許可されていません`);
    this.name = "AccessDeniedError";
  }
}

export class KarteStore {
  /** 患者ID → 確定済み記録の追記専用チェーン */
  private readonly chains = new Map<string, ChartEntry[]>();
  private readonly audit: AuditRecord[] = [];

  /** アクセス制御＋監査の共通ゲート。許可されない操作は例外で止める */
  private gate(user: User, action: KarteAction, patientId: string, entryId?: string): void {
    if (!PERMISSIONS[user.role].has(action)) throw new AccessDeniedError(user, action);
    const prev = this.audit[this.audit.length - 1]?.hash;
    const seq = this.audit.length;
    const at = new Date().toISOString();
    const base = { seq, at, userId: user.id, role: user.role, action, patientId, entryId: entryId ?? null, prev: prev ?? null };
    const hash = createHash("sha256").update(JSON.stringify(base)).digest("hex");
    this.audit.push({ seq, at, userId: user.id, role: user.role, action, patientId, ...(entryId !== undefined ? { entryId } : {}), hash });
  }

  /** 直前に確定した記録のハッシュ（チェーン継続用） */
  private headHash(patientId: string): string | undefined {
    const chain = this.chains.get(patientId);
    return chain && chain.length > 0 ? chain[chain.length - 1]!.contentHash : undefined;
  }

  /** SOAP を確定記録として追記する（真正性: 確定と同時にハッシュ連鎖に組み込む） */
  appendFinal(user: User, patientId: string, visitId: string, soap: Soap): ChartEntry {
    this.gate(user, "finalize", patientId);
    const draft: ChartEntry = { id: cryptoRandomId(), visitId, status: "draft", soap, authoredBy: user.id };
    const finalized = finalizeEntry(draft, user.id, new Date().toISOString(), this.headHash(patientId));
    const chain = this.chains.get(patientId) ?? [];
    chain.push(finalized);
    this.chains.set(patientId, chain);
    return finalized;
  }

  /** 確定済み記録の訂正版を確定する（元記録は保持し、supersedes で旧版を指す） */
  reviseFinal(user: User, patientId: string, originalId: string, soap: Soap): ChartEntry {
    this.gate(user, "revise", patientId, originalId);
    const chain = this.chains.get(patientId) ?? [];
    const original = chain.find((e) => e.id === originalId);
    if (original === undefined) throw new Error(`訂正対象が見つかりません: ${originalId}`);
    const draft = reviseEntry(original, soap, user.id);
    const finalized = finalizeEntry(draft, user.id, new Date().toISOString(), this.headHash(patientId));
    chain.push(finalized);
    this.chains.set(patientId, chain);
    return finalized;
  }

  /** 患者の確定記録チェーンを返す（閲覧も監査に残す） */
  read(user: User, patientId: string): ChartEntry[] {
    this.gate(user, "read", patientId);
    return [...(this.chains.get(patientId) ?? [])];
  }

  /** 見読性: 人が読める形（個別指導・監査で提示できるテキスト）に整形 */
  readableText(user: User, patientId: string): string {
    this.gate(user, "read", patientId);
    const chain = this.chains.get(patientId) ?? [];
    const lines: string[] = [`■ カルテ（患者 ${patientId}）  確定記録 ${chain.length} 件`];
    for (const e of chain) {
      const mark = e.supersedesId ? `（訂正: 旧版 ${e.supersedesId} を置換）` : "";
      lines.push(
        `── ${e.finalizedAt ?? ""}  記録ID ${e.id} ${mark}`,
        `   確定者: ${e.finalizedBy}`,
        `   S: ${e.soap.S}`,
        `   O: ${e.soap.O}`,
        `   A: ${e.soap.A}`,
        `   P: ${e.soap.P}`,
        `   完全性ハッシュ: ${e.contentHash?.slice(0, 16)}…`,
      );
    }
    return lines.join("\n");
  }

  /** 保存性: 全患者の連鎖と監査証跡を検証（改ざん・欠落があれば false と理由） */
  verifyIntegrity(): { ok: boolean; problems: string[] } {
    const problems: string[] = [];
    for (const [patientId, chain] of this.chains) {
      if (!verifyChain(chain)) problems.push(`患者 ${patientId} のカルテ連鎖が改ざん/欠落`);
    }
    // 監査証跡自体の連鎖も検証
    let prev: string | undefined;
    for (const r of this.audit) {
      const base = { seq: r.seq, at: r.at, userId: r.userId, role: r.role, action: r.action, patientId: r.patientId, entryId: r.entryId ?? null, prev: prev ?? null };
      if (createHash("sha256").update(JSON.stringify(base)).digest("hex") !== r.hash) {
        problems.push(`監査証跡 seq=${r.seq} が改ざん`);
        break;
      }
      prev = r.hash;
    }
    return { ok: problems.length === 0, problems };
  }

  /** 監査証跡を返す（admin/dentist のみ） */
  auditTrail(user: User): AuditRecord[] {
    if (user.role !== "admin" && user.role !== "dentist") throw new AccessDeniedError(user, "read");
    return [...this.audit];
  }

  /**
   * 保存性＋暗号化: カルテ・監査をまとめてパスワードで暗号化したバックアップ文字列にする。
   * AES-256-GCM（scrypt で鍵導出）。importBackup で復元し、復元後は verifyIntegrity を推奨。
   */
  exportBackup(user: User, password: string): string {
    this.gate(user, "export", "*");
    const plain = JSON.stringify({ chains: [...this.chains.entries()], audit: this.audit });
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(password, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({ v: 1, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64"), data: enc.toString("base64") });
  }

  /** 暗号化バックアップから復元する（パスワード不一致・改ざんは例外） */
  static importBackup(backup: string, password: string): KarteStore {
    const b = JSON.parse(backup) as { salt: string; iv: string; tag: string; data: string };
    const key = scryptSync(password, Buffer.from(b.salt, "base64"), 32);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(b.iv, "base64"));
    decipher.setAuthTag(Buffer.from(b.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(b.data, "base64")), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plain) as { chains: [string, ChartEntry[]][]; audit: AuditRecord[] };
    const store = new KarteStore();
    for (const [pid, chain] of parsed.chains) store.chains.set(pid, chain);
    store.audit.push(...parsed.audit);
    return store;
  }
}

function cryptoRandomId(): string {
  return randomBytes(16).toString("hex");
}
