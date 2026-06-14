/**
 * UKE 自己点検バリデータ（支払基金「受付・事務点検ASP」相当の提出前チェック）。
 *
 * 目的: オンライン請求の前に、機械的に判定できる形式・構造エラーを潰し、返戻（事務的
 * 差し戻し）をゼロに近づける（master-plan の Phase 3 完了条件「返戻ゼロの月」に直結）。
 *
 * 根拠: 記録条件仕様（歯科用）令和8年6月版のレコード出現順序・桁・コード規定、および
 * 返戻・査定頻出原因（docs/specs/henrei-satei-top20）のうち「完全自動」判定可能な形式系。
 * 臨床判断・審査委員裁量に依存する査定リスク（病名↔処置の適応等）はここでは扱わない
 * （それらは算定エンジンの警告ルール側）。
 *
 * 重大度:
 *   - "reject": 受付不能相当（提出すると受け付けられない／確実に返戻）。提出前に必須修正。
 *   - "review": 要確認相当（提出は可能だが査定・返戻リスク）。
 */
import type { UkeRecord } from "./uke.js";

export interface ValidationIssue {
  severity: "reject" | "review";
  /** 自前の点検コード（L1/L2/L3 に倣う。1xxx=医療機関単位, 2xxx=レセプト単位, 3xxx=要確認） */
  code: string;
  message: string;
  /** 対象レセプト番号（RE.レセプト番号。ファイル単位エラーでは undefined） */
  receiptNo?: string;
}

/**
 * 保険者番号・公費負担者番号のチェックデジット検証（モジュラス10・ウェイト2/1）。
 * 上位7桁に左から 2,1,2,1,2,1,2 を乗じ、各積の数字和を合計、(10 - 合計 mod 10) mod 10 が
 * 末尾の検証番号と一致するか。
 * 実装根拠: 作成手引きの記録例（保険者 01130012 / 06132013、公費 19136019）で検証済み。
 */
export function isValidPayerNumberCheckDigit(num: string): boolean {
  if (!/^\d{8}$/.test(num)) return false;
  const weights = [2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const product = Number(num[i]) * weights[i]!;
    sum += Math.floor(product / 10) + (product % 10);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(num[7]);
}

/** 識別子→出現順位（同一レセプト内のレコード順チェック用） */
const RECEIPT_ORDER: Record<string, number> = {
  IR: 0,
  RE: 1,
  HO: 2,
  KO: 2,
  SN: 2,
  JD: 2,
  MF: 2,
  HS: 3,
  SS: 4,
  SI: 4,
  IY: 4,
  TO: 4,
  CO: 4,
  SJ: 5,
};

const DETAIL_IDS = new Set(["SS", "SI", "IY", "TO", "CO"]);
const BILLABLE_DETAIL_IDS = new Set(["SS", "SI", "IY", "TO"]);

interface ReceiptGroup {
  receiptNo?: string;
  records: UkeRecord[];
}

/** ファイル先頭 UK の次から GO の手前までを、IR 区切りでレセプト単位に分割する */
function splitReceipts(records: UkeRecord[]): ReceiptGroup[] {
  const groups: ReceiptGroup[] = [];
  let current: ReceiptGroup | undefined;
  for (const r of records) {
    if (r.identifier === "UK" || r.identifier === "GO") continue;
    if (r.identifier === "IR") {
      current = { records: [r] };
      groups.push(current);
    } else if (current !== undefined) {
      if (r.identifier === "RE") current.receiptNo = String(r.fields[0] ?? "");
      current.records.push(r);
    }
  }
  return groups;
}

/** 算定日情報（1〜31日）の合計が回数と一致するか（SS/SI/IY/TO） */
function dailyTotalMatchesCount(record: UkeRecord): boolean | undefined {
  // 各レコードの末尾31項目が算定日情報、その直前が回数（IY は医薬品区分が間に入る点に注意）
  const f = record.fields;
  if (f.length < 32) return undefined;
  const daily = f.slice(f.length - 31).map((x) => Number(x || 0));
  const sum = daily.reduce((a, b) => a + b, 0);
  if (sum === 0) return undefined; // 未来院請求等で算定日省略のケースは判定対象外
  // 回数は算定日情報の直前項目
  const count = Number(f[f.length - 32] || 0);
  return sum === count;
}

/**
 * 組み上がった UKE レコード列を提出前点検する。
 * 構造（出現順序・必須レコード）と形式（種別1桁目=3・桁・チェックデジット・GO整合・算定日合計）
 * を検証する。
 */
export function validateUkeRecords(records: UkeRecord[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (severity: ValidationIssue["severity"], code: string, message: string, receiptNo?: string) =>
    issues.push(receiptNo !== undefined ? { severity, code, message, receiptNo } : { severity, code, message });

  // ファイル構造: 先頭 UK・末尾 GO・各1個
  if (records.length === 0) {
    push("reject", "1001", "レコードが空です");
    return issues;
  }
  if (records[0]!.identifier !== "UK") push("reject", "1002", "ファイル先頭は受付情報レコード（UK）である必要があります");
  if (records[records.length - 1]!.identifier !== "GO") {
    push("reject", "1003", "ファイル末尾は診療報酬請求書レコード（GO）である必要があります");
  }
  if (records.filter((r) => r.identifier === "UK").length !== 1) push("reject", "1004", "UK は1ファイルに1個のみ");
  const goRecords = records.filter((r) => r.identifier === "GO");
  if (goRecords.length !== 1) push("reject", "1005", "GO は1ファイルに1個のみ");

  const groups = splitReceipts(records);
  if (groups.length === 0) push("reject", "1006", "レセプトが1件もありません");

  let expectedTotalPoints = 0;
  let expectedCount = 0;

  for (const g of groups) {
    const ids = g.records.map((r) => r.identifier);
    const re = g.records.find((r) => r.identifier === "RE");

    // IR の次は RE
    if (ids[0] !== "IR") push("reject", "2001", "レセプト先頭は医療機関情報レコード（IR）である必要があります", g.receiptNo);
    if (re === undefined) {
      push("reject", "2002", "レセプト共通レコード（RE）がありません", g.receiptNo);
      continue;
    }
    if (ids[1] !== "RE") push("reject", "2003", "医療機関情報レコード（IR）の次はレセプト共通レコード（RE）である必要があります", g.receiptNo);

    // レセプト種別1桁目=3（歯科）
    const receiptType = String(re.fields[1] ?? "");
    if (!/^3\d{3}$/.test(receiptType)) {
      push("reject", "2004", `レセプト種別が歯科（3始まりの4桁）ではありません: ${JSON.stringify(receiptType)}`, g.receiptNo);
    }

    // レコード出現順序
    let lastOrder = -1;
    for (const r of g.records) {
      const ord = RECEIPT_ORDER[r.identifier];
      if (ord === undefined) {
        push("reject", "2005", `レセプト内に未知のレコード識別子: ${r.identifier}`, g.receiptNo);
        continue;
      }
      if (ord < lastOrder) {
        push("reject", "2006", `レコードの出現順序が不正です（${r.identifier}）`, g.receiptNo);
      }
      lastOrder = Math.max(lastOrder, ord);
    }

    // 保険者 or 公費が必要
    const hos = g.records.filter((r) => r.identifier === "HO");
    const kos = g.records.filter((r) => r.identifier === "KO");
    if (hos.length === 0 && kos.length === 0) {
      push("reject", "2007", "保険者レコード（HO）か公費レコード（KO）のいずれかが必要です", g.receiptNo);
    }
    if (hos.length > 1) push("reject", "2008", "保険者レコード（HO）は複数記録できません", g.receiptNo);
    if (kos.length > 4) push("reject", "2009", "公費レコード（KO）は最大4です", g.receiptNo);

    // 保険者番号・公費負担者番号のチェックデジット
    for (const ho of hos) {
      const num = String(ho.fields[0] ?? "").trim();
      if (num !== "" && /^\d{8}$/.test(num) && !isValidPayerNumberCheckDigit(num)) {
        push("reject", "2010", `保険者番号のチェックデジットが不正です: ${num}`, g.receiptNo);
      }
    }
    for (const ko of kos) {
      const num = String(ko.fields[0] ?? "").trim();
      if (num !== "" && /^\d{8}$/.test(num) && !isValidPayerNumberCheckDigit(num)) {
        push("reject", "2011", `公費負担者番号のチェックデジットが不正です: ${num}`, g.receiptNo);
      }
    }

    // 傷病名部位（HS）1以上・100件未満
    const hsCount = g.records.filter((r) => r.identifier === "HS").length;
    if (hsCount === 0) push("reject", "2012", "傷病名部位レコード（HS）が1件もありません", g.receiptNo);
    if (hsCount >= 100) push("reject", "2013", `傷病名部位レコード（HS）が100件以上です（${hsCount}件）`, g.receiptNo);

    // 診療行為情報（SS/SI/IY/TO）が1以上（CO のみは不可）
    const details = g.records.filter((r) => DETAIL_IDS.has(r.identifier));
    if (!details.some((r) => BILLABLE_DETAIL_IDS.has(r.identifier))) {
      push("reject", "2014", "診療行為レコード（SS/SI/IY/TO）が1件もありません", g.receiptNo);
    }

    // 算定日情報の合計＝回数
    for (const r of g.records.filter((x) => BILLABLE_DETAIL_IDS.has(x.identifier))) {
      const ok = dailyTotalMatchesCount(r);
      if (ok === false) {
        push("reject", "2015", `${r.identifier}: 回数と算定日情報の合計が一致しません`, g.receiptNo);
      }
    }

    // GO 集計用（医保あり=主保険の合計点数、なければ最初の公費）
    const koCount = kos.length;
    expectedCount += hos.length > 0 ? 1 + koCount : koCount;
    if (hos.length > 0) {
      expectedTotalPoints += Number(hos[0]!.fields[4] ?? 0) || 0;
    } else if (kos.length > 0) {
      expectedTotalPoints += Number(kos[0]!.fields[4] ?? 0) || 0;
    }
  }

  // GO の総件数・総合計点数の整合
  if (goRecords.length === 1) {
    const go = goRecords[0]!;
    const goCount = Number(go.fields[0] ?? 0) || 0;
    const goPoints = Number(go.fields[1] ?? 0) || 0;
    if (goCount !== expectedCount) {
      push("reject", "1007", `GO 総件数（${goCount}）がレセプトから算出した件数（${expectedCount}）と一致しません`);
    }
    if (goPoints !== expectedTotalPoints) {
      push("reject", "1008", `GO 総合計点数（${goPoints}）がレセプト合計（${expectedTotalPoints}）と一致しません`);
    }
  }

  return issues;
}

/** reject が1件もなければ提出可能 */
export function isSubmittable(issues: readonly ValidationIssue[]): boolean {
  return !issues.some((i) => i.severity === "reject");
}
