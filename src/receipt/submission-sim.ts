/**
 * オンライン請求・確認試験の仮想シミュレータ。
 *
 * 実際のオンライン請求は、電子証明書＋閉域網（IP-VPN/IPsec）で支払基金/国保連へ UKE を送り、
 * 受付（L1）→ 事務点検ASP（L2）→ 確認試験（エラーゼロ判定）を通す。ここではその経路を
 * ローカルで再現し、生成済み UKE が「確認試験を通る形か」を提出前に確かめられるようにする。
 *
 * 流れ:
 *   1. 提出: UKE バイト列（Shift_JIS）を受け取り、復号して構造を読み直す（実際の受付と同様）。
 *   2. 受付（L1, 1xxx）: ファイル単位の致命的エラーがあれば「受付不能」で差し戻し。
 *   3. 事務点検（L2, 2xxx）: レセプト単位の形式エラー。あれば「返戻」。
 *   4. 確認試験判定: reject ゼロなら合格。review（査定リスク）は警告として併記。
 *
 * ⚠️ これは形式・構造の確認試験の再現であって、審査委員会の医学的判断（査定）は再現しない。
 *    本番のオンライン請求の代替ではなく、提出前の自己確認用。
 */
import { decodeUkeFile } from "./uke.js";
import { isSubmittable, validateUkeRecords, type ValidateOptions, type ValidationIssue } from "./validate.js";

export type SubmissionStage = "受付不能" | "返戻" | "合格";

export interface KakuninShikenResult {
  /** 確認試験の最終判定 */
  stage: SubmissionStage;
  passed: boolean;
  /** L1: 受付（ファイル単位 1xxx）の reject */
  l1: ValidationIssue[];
  /** L2: 事務点検（レセプト単位 2xxx）の reject */
  l2: ValidationIssue[];
  /** 査定・返戻リスク（review）。提出は可能だが要確認 */
  review: ValidationIssue[];
  /** 提出した UKE のバイト数・レコード数 */
  byteLength: number;
  recordCount: number;
  /** 人が読める結果通知テキスト */
  report: string;
}

/**
 * 生成済み UKE バイト列を確認試験に通す（仮想）。
 * 実際の受付と同様に「バイト列を復号して読み直す」ところから始めるため、
 * Shift_JIS 化やレコード直列化で壊れていればここで露見する。
 */
export function runKakuninShiken(ukeBytes: Uint8Array, opts: ValidateOptions = {}): KakuninShikenResult {
  // 1. 提出されたバイト列を受付側が復号して読み直す
  const records = decodeUkeFile(ukeBytes);
  // 2-3. L1/L2 点検
  const issues = validateUkeRecords(records, opts);

  const l1 = issues.filter((i) => i.severity === "reject" && i.code.startsWith("1"));
  const l2 = issues.filter((i) => i.severity === "reject" && i.code.startsWith("2"));
  const review = issues.filter((i) => i.severity === "review");

  const passed = isSubmittable(issues);
  const stage: SubmissionStage = l1.length > 0 ? "受付不能" : l2.length > 0 ? "返戻" : "合格";

  const lines: string[] = [];
  lines.push("════════ 確認試験 結果通知（仮想） ════════");
  lines.push(`提出ファイル: ${records.length} レコード / ${ukeBytes.length} バイト（Shift_JIS）`);
  lines.push(`判定: ${stage}${passed ? "（エラーゼロ）" : ""}`);
  if (l1.length > 0) {
    lines.push(`\n【受付エラー L1（${l1.length}件）】受付不能。ファイル単位の修正が必要:`);
    for (const i of l1) lines.push(`  [${i.code}] ${i.message}`);
  }
  if (l2.length > 0) {
    lines.push(`\n【事務点検エラー L2（${l2.length}件）】返戻。レセプト単位の修正が必要:`);
    for (const i of l2) lines.push(`  [${i.code}] ${i.message}${i.receiptNo ? `（レセプト${i.receiptNo}）` : ""}`);
  }
  if (review.length > 0) {
    lines.push(`\n【査定・返戻リスク（${review.length}件）】提出は可能だが要確認:`);
    for (const i of review) lines.push(`  [${i.code}] ${i.message}${i.receiptNo ? `（レセプト${i.receiptNo}）` : ""}`);
  }
  if (passed) lines.push("\n✓ 確認試験合格相当（L1/L2 エラーゼロ）。オンライン請求に進めます。");
  else lines.push("\n✗ このままでは請求できません。上記を修正して再提出してください。");
  lines.push("════════════════════════════════════════");

  return { stage, passed, l1, l2, review, byteLength: ukeBytes.length, recordCount: records.length, report: lines.join("\n") };
}
