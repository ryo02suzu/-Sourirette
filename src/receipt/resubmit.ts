/**
 * 返戻ファイルからの再請求ファイル組み立て（別添C「返戻・再請求に係る記録条件仕様（歯科用）」）。
 *
 * 仕様の核（別添C 第1章 1（4））:
 *   保険医療機関から審査支払機関へ返戻分を再請求する場合、返戻レセプトの
 *   「請求データ（履歴管理ブロックの履歴請求データを除く）」を修正し、
 *   「返戻理由データ（履歴管理ブロックの履歴返戻理由データを除く）」を削除したレセプトに、
 *   受付情報（先頭 UK）と診療報酬請求書情報（末尾 GO）を付加して再請求する。
 *
 * 実装方針: レコード識別子で「請求データ（IR〜SJ）」「返戻理由（HR・トップレベル）」
 * 「履歴管理ブロック（識別子 "8" のレコード）」を判別する。識別子ベースでの分離は
 * 記録条件仕様が推奨する方法であり、HI/HR/HG/履歴ブロック内項目の意味解釈には踏み込まない
 * （履歴管理ブロックは不可変＝そのまま温存する）。
 *
 * 対象外（仕様どおり別扱い・呼び出し側で一次請求ファイルを作成すること）:
 *   - 異なる審査支払機関への再請求
 *   - 再審査等返戻・再請求返戻を複数枚に分けて再請求する場合の2枚目以降
 */
import type { UkeRecord } from "./uke.js";
import { buildGo, buildUk, type UkParams } from "./records.js";

/** 履歴管理ブロックのレコードか（識別子が "8"） */
function isHistoryBlock(r: UkeRecord): boolean {
  return r.identifier === "8";
}

/** ファイル先頭/末尾の返戻情報・返戻合計か */
function isReturnHeaderOrFooter(r: UkeRecord): boolean {
  return r.identifier === "HI" || r.identifier === "HG";
}

/** トップレベルの返戻理由レコードか（履歴ブロック内の "8,..,HR,.." は別物として温存） */
function isTopLevelReturnReason(r: UkeRecord): boolean {
  return r.identifier === "HR";
}

export interface ResubmitInput {
  /** 審査支払機関からダウンロードした返戻ファイルのレコード列（decodeUkeFile 等で復元） */
  returnedRecords: UkeRecord[];
  /** 再請求ファイルの先頭に付ける受付情報（UK）の内容 */
  facility: UkParams;
  /**
   * 請求データ（IR〜SJ）の修正フック。返戻箇所を訂正する。
   * 履歴管理ブロック・返戻理由は渡さない（修正不可・削除対象のため）。
   * 返り値で置き換えるか、引数を破壊的に変更してもよい。
   */
  modifyRequestData?: (requestRecords: UkeRecord[]) => UkeRecord[] | void;
}

/** HO/KO の「合計点数」（識別子を除く5番目）を読む */
function totalPointsOf(record: UkeRecord): number {
  return Number(record.fields[4] ?? 0) || 0;
}

/**
 * 再請求の請求データ（履歴ブロック・HI/HG・HR を除く IR〜SJ）から GO の総件数・総合計点数を算出。
 * 医保ありレセプトは 1＋公費数、公費単独は公費数。点数は主保険（なければ最初の公費）の合計点数。
 */
function calcGoTotals(requestRecords: UkeRecord[]): { totalCount: number; totalPoints: number } {
  let totalCount = 0;
  let totalPoints = 0;
  let hoInReceipt: UkeRecord | undefined;
  let koInReceipt: UkeRecord[] = [];
  const flush = () => {
    if (hoInReceipt === undefined && koInReceipt.length === 0) return;
    totalCount += hoInReceipt !== undefined ? 1 + koInReceipt.length : koInReceipt.length;
    if (hoInReceipt !== undefined) totalPoints += totalPointsOf(hoInReceipt);
    else if (koInReceipt.length > 0) totalPoints += totalPointsOf(koInReceipt[0]!);
  };
  for (const r of requestRecords) {
    if (r.identifier === "IR") {
      flush();
      hoInReceipt = undefined;
      koInReceipt = [];
    } else if (r.identifier === "HO") {
      hoInReceipt = r;
    } else if (r.identifier === "KO") {
      koInReceipt.push(r);
    }
  }
  flush();
  return { totalCount, totalPoints };
}

export interface ResubmitResult {
  records: UkeRecord[];
  /** 削除した返戻理由（HR）レコード数 */
  droppedReturnReasons: number;
  /** 温存した履歴管理ブロックのレコード数 */
  preservedHistoryRecords: number;
}

/**
 * 返戻ファイル → 再請求ファイルを組み立てる。
 * 返戻情報（HI）・返戻合計（HG）・返戻理由（HR）を取り除き、請求データを修正し、
 * 履歴管理ブロックを温存したうえで、受付情報（UK）と診療報酬請求書（GO）を付加する。
 */
export function buildResubmissionFile(input: ResubmitInput): ResubmitResult {
  const { returnedRecords } = input;

  // 請求データ（修正対象）と履歴管理ブロック（温存）を、元の出現順を保ったまま仕分ける。
  // レコードごとに種別を覚えておき、最後に「請求データ（修正後）＋履歴ブロック」を順序復元する。
  type Tagged = { kind: "request" | "history"; index: number; record: UkeRecord };
  const tagged: Tagged[] = [];
  let droppedReturnReasons = 0;
  for (const r of returnedRecords) {
    if (isReturnHeaderOrFooter(r)) continue; // HI / HG を除去
    if (isTopLevelReturnReason(r)) {
      droppedReturnReasons++;
      continue; // HR（返戻理由）を削除
    }
    if (isHistoryBlock(r)) {
      tagged.push({ kind: "history", index: tagged.length, record: r });
    } else {
      tagged.push({ kind: "request", index: tagged.length, record: r });
    }
  }

  // 請求データだけ取り出して修正フックへ
  const requestRecords = tagged.filter((t) => t.kind === "request").map((t) => t.record);
  let modifiedRequest = requestRecords;
  if (input.modifyRequestData !== undefined) {
    const out = input.modifyRequestData(requestRecords);
    if (out !== undefined) modifiedRequest = out;
  }
  if (modifiedRequest.length !== requestRecords.length) {
    throw new Error(
      `modifyRequestData は請求データの件数を変更できません（${requestRecords.length} → ${modifiedRequest.length}）。値の訂正のみ可能です`,
    );
  }

  // 元の順序を保ちながら、請求データは修正後で差し替える
  let reqCursor = 0;
  const body: UkeRecord[] = tagged.map((t) =>
    t.kind === "request" ? modifiedRequest[reqCursor++]! : t.record,
  );

  const preservedHistoryRecords = tagged.filter((t) => t.kind === "history").length;
  const totals = calcGoTotals(modifiedRequest);

  const records: UkeRecord[] = [
    buildUk({ ...input.facility, multiVolume: input.facility.multiVolume ?? "00" }),
    ...body,
    buildGo({ ...totals, multiVolume: "99" }),
  ];

  return { records, droppedReturnReasons, preservedHistoryRecords };
}
