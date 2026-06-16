/**
 * UKE 請求ファイルの組み立て。
 *
 * レコードの出現順序（記録条件仕様 第1章 3（3）ア）:
 *   ファイル = UK ＋ レセプト（1以上） ＋ GO
 *   レセプト = IR → RE → HO/KO/SN/JD/MF → HS（1以上） → SS/SI/IY/TO/CO（SS等1以上） → SJ
 *
 * GO の総件数・総合計点数の算出（仕様 p27 注）:
 *   件数   = 医保単独:1 / 医保＋n種公費併用: 1+n / 公費単独:1 / n種公費併用: n
 *   総合計 = 保険者レコードの合計点数（医保あり）、なければ最初の公費レコードの合計点数
 */
import type { UkeRecord } from "./uke.js";
import { buildGo, buildIr, buildUk, type IrParams, type UkParams } from "./records.js";

/** 1レセプト分のレコード（IR は組み立て側で付与する） */
export interface UkeReceipt {
  re: UkeRecord;
  /** 医療保険レセプトの場合に記録（公費単独では記録不可） */
  ho?: UkeRecord;
  /** 公費負担医療レセプトの場合。法別番号順に第一公費から */
  ko?: UkeRecord[];
  sn?: UkeRecord[];
  jd?: UkeRecord[];
  mf?: UkeRecord[];
  /** 傷病名部位レコード（1以上必須） */
  hs: UkeRecord[];
  /** 診療行為情報（SS/SI/IY/TO/CO の並び順のまま。SS等いずれか1以上必須） */
  details: UkeRecord[];
  sj?: UkeRecord[];
}

export interface UkeFileInput {
  /** 医療機関情報（UK・IR 共通部分） */
  facility: UkParams & Pick<IrParams, "phone">;
  receipts: UkeReceipt[];
}

function expect(record: UkeRecord, allowed: readonly string[], where: string): void {
  if (!allowed.includes(record.identifier)) {
    throw new Error(`${where}: ${allowed.join("/")} のレコードが必要（実際: ${record.identifier}）`);
  }
}

/** HO/KO の「合計点数」フィールド（識別子を除く5番目）を読む */
function totalPointsOf(record: UkeRecord): number {
  return Number(record.fields[4] ?? 0) || 0;
}

/** レセプト1件分のレコード列（IR から）を構築・検証する */
export function assembleReceipt(facility: UkeFileInput["facility"], receipt: UkeReceipt): UkeRecord[] {
  expect(receipt.re, ["RE"], "レセプト先頭");
  const ko = receipt.ko ?? [];
  if (receipt.ho === undefined && ko.length === 0) {
    throw new Error("レセプトには保険者レコード（HO）か公費レコード（KO）のいずれかが必要");
  }
  if (receipt.ho !== undefined) expect(receipt.ho, ["HO"], "保険者");
  if (ko.length > 4) throw new Error("公費レコードは最大4（第一〜第四公費）");
  for (const r of ko) expect(r, ["KO"], "公費");
  for (const r of receipt.sn ?? []) expect(r, ["SN"], "資格確認");
  for (const r of receipt.jd ?? []) expect(r, ["JD"], "受診日等");
  for (const r of receipt.mf ?? []) expect(r, ["MF"], "窓口負担額");
  if (receipt.hs.length === 0) throw new Error("傷病名部位レコード（HS）は1以上必須");
  for (const r of receipt.hs) expect(r, ["HS"], "傷病名部位");
  for (const r of receipt.details) expect(r, ["SS", "SI", "IY", "TO", "CO"], "診療行為情報");
  if (!receipt.details.some((r) => r.identifier !== "CO")) {
    throw new Error("診療行為情報には SS/SI/IY/TO のいずれか1レコード以上が必要");
  }
  for (const r of receipt.sj ?? []) expect(r, ["SJ"], "症状詳記");

  const irParams: IrParams = {
    payer: facility.payer,
    prefecture: facility.prefecture,
    facilityCode: facility.facilityCode,
    billingMonth: facility.billingMonth,
  };
  if (facility.phone !== undefined) irParams.phone = facility.phone;
  if (facility.notifications !== undefined) irParams.notifications = facility.notifications;

  return [
    buildIr(irParams),
    receipt.re,
    ...(receipt.ho !== undefined ? [receipt.ho] : []),
    ...ko,
    ...(receipt.sn ?? []),
    ...(receipt.jd ?? []),
    ...(receipt.mf ?? []),
    ...receipt.hs,
    ...receipt.details,
    ...(receipt.sj ?? []),
  ];
}

/** GO レコードの総件数・総合計点数を算出する */
export function calculateGoTotals(receipts: readonly UkeReceipt[]): { totalCount: number; totalPoints: number } {
  let totalCount = 0;
  let totalPoints = 0;
  for (const r of receipts) {
    const koCount = r.ko?.length ?? 0;
    totalCount += r.ho !== undefined ? 1 + koCount : koCount;
    if (r.ho !== undefined) {
      totalPoints += totalPointsOf(r.ho);
    } else if (r.ko !== undefined && r.ko.length > 0) {
      totalPoints += totalPointsOf(r.ko[0]!);
    }
  }
  return { totalCount, totalPoints };
}

/** 請求ファイル全体のレコード列（UK 〜 GO）を構築する。単一ボリューム前提 */
export function assembleUkeFile(input: UkeFileInput): UkeRecord[] {
  if (input.receipts.length === 0) throw new Error("レセプトは1件以上必要");
  const records: UkeRecord[] = [buildUk({ ...input.facility, multiVolume: "00" })];
  for (const receipt of input.receipts) {
    records.push(...assembleReceipt(input.facility, receipt));
  }
  const totals = calculateGoTotals(input.receipts);
  records.push(buildGo({ ...totals, multiVolume: "99" }));
  return records;
}
