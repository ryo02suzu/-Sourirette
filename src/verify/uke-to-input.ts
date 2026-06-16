/**
 * 突合ハーネス用 UKE → ProcessReceiptInput 逆変換（P0-2 の中核）。
 *
 * 既存レセコンが出力した実UKEを読み戻し、当エンジンの入力（ProcessReceiptInput）を復元する。
 * 復元した入力を processReceipt で再計算し、元UKEと突き合わせることで、当エンジンの算定が
 * 実レセと一致するか／どの算定が欠落しているかを露見させる。
 *
 * 復元の方針:
 *   - レセプト共通(RE): 種別→保険枠・受給区分、男女・生年月日、氏名、診療年月。
 *   - 保険者(HO): 保険者番号。傷病名部位(HS): 傷病名コード・歯式（部位）・診療開始日。
 *   - 歯科診療行為(SS): 診療行為コード＋算定日情報(1〜31日) から受診日ごとの受診を再構成。
 *     算定日の各日に出現した回数だけコードを並べる（quantity=1×回数）。初診料(A000)が
 *     ある日は初診、無ければ再診とみなす。
 *
 * 限界: timeClass（時間外区分）は UKE に現れないため復元不可（regular扱い）。自費・労災等の
 * 非保険、医薬品(IY)・特定器材(TO) は当エンジン未実装のため SS のみ対象（突合で欠落として露見）。
 */
import type { UkeRecord } from "../receipt/uke.js";
import type { ReceiptCoreInput, ProcessVisit } from "../receipt/process.js";
import type { UkeFileInput } from "../receipt/build.js";
import type { Diagnosis } from "../domain/types.js";
import type { ReceiptScheme, Beneficiary } from "../receipt/receipt-type.js";

/** 種別 第4桁（入院外・偶数）→ 受給区分。入院（奇数）は突合対象外（外来歯科） */
const FOURTH_TO_BENEFICIARY: Record<string, Beneficiary> = {
  "2": "principal",
  "4": "preschool",
  "6": "family",
  "8": "elderly-general",
  "0": "elderly-7",
};

/** YYYYMMDD → YYYY-MM-DD（不正は空） */
function isoDate(compact: string): string {
  return /^\d{8}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : "";
}

/** 歯式コード列（6桁×n の連結）→ FDI配列（全顎100000・歯列100100/100200は部位なし扱いで除外） */
function shikiToTeeth(shiki: string): string[] {
  const teeth: string[] = [];
  for (let i = 0; i + 6 <= shiki.length; i += 6) {
    const chunk = shiki.slice(i, i + 6);
    if (!chunk.startsWith("10")) continue;
    const fdi = chunk.slice(2, 4);
    if (fdi === "00") continue; // 100000/100100/100200 等（部位なし）
    if (/^\d{2}$/.test(fdi)) teeth.push(fdi);
  }
  return teeth;
}

/** 種別コード → ReceiptScheme（医保中心。koki/公費単独は best-effort） */
function schemeFromType(receiptType: string): ReceiptScheme {
  const second = receiptType[1];
  const fourth = receiptType[3] ?? "6";
  if (second === "3") {
    return { kind: "koki", category: fourth === "9" || fourth === "0" ? "7" : "general" };
  }
  if (second === "2") {
    return { kind: "public-only" };
  }
  // 医保/国保
  return { kind: "medical", beneficiary: FOURTH_TO_BENEFICIARY[fourth] ?? "family" };
}

export interface ReconstructedReceipt {
  facility: UkeFileInput["facility"];
  input: ReceiptCoreInput;
  /** 元レセプトの公表値（突合の期待値） */
  expected: { totalPoints: number; actualDays: number; receiptType: string };
}

/** レコード全体を レセプト単位（IR..）に分割し、各々を入力へ復元する。
 *  codeToKubun を渡すと初診（区分A000）判定が正確になる（未指定時は主要初診料コードで近似）。 */
export function ukeToInputs(records: readonly UkeRecord[], codeToKubun?: Map<string, string>): ReconstructedReceipt[] {
  const isShoshin = (code: string): boolean =>
    codeToKubun !== undefined ? codeToKubun.get(code) === "A000" : code === "301000110" || code === "301000210";
  const uk = records.find((r) => r.identifier === "UK");
  const facility: UkeFileInput["facility"] = {
    payer: String(uk?.fields[0] ?? "1"),
    prefecture: String(uk?.fields[1] ?? "13"),
    facilityCode: String(uk?.fields[3] ?? "1234567"),
    facilityName: String(uk?.fields[5] ?? "突合対象医院"),
    billingMonth: String(uk?.fields[6] ?? ""),
  };

  // IR 区切りでレセプトを切る
  const groups: UkeRecord[][] = [];
  let cur: UkeRecord[] | undefined;
  for (const r of records) {
    if (r.identifier === "UK" || r.identifier === "GO") continue;
    if (r.identifier === "IR") groups.push((cur = [r]));
    else if (cur) cur.push(r);
  }

  const out: ReconstructedReceipt[] = [];
  for (const g of groups) {
    const re = g.find((r) => r.identifier === "RE");
    const ho = g.find((r) => r.identifier === "HO");
    if (re === undefined) continue;
    const receiptType = String(re.fields[1] ?? "");
    const treatmentMonth = String(re.fields[2] ?? facility.billingMonth); // YYYYMM
    const sex: "M" | "F" = String(re.fields[4] ?? "1") === "2" ? "F" : "M";
    const birthDate = isoDate(String(re.fields[5] ?? ""));
    const name = String(re.fields[3] ?? "") || "（匿名）";

    // 傷病名
    const diagnoses: Diagnosis[] = g
      .filter((r) => r.identifier === "HS")
      .map((hs) => {
        const teeth = shikiToTeeth(String(hs.fields[2] ?? ""));
        const onset = isoDate(String(hs.fields[0] ?? "")) || `${treatmentMonth.slice(0, 4)}-${treatmentMonth.slice(4, 6)}-01`;
        const dx: Diagnosis = { diseaseCode: String(hs.fields[3] ?? ""), onsetDate: onset };
        if (teeth.length > 0) dx.teeth = teeth;
        return dx;
      })
      .filter((d) => /^\d{7}$/.test(d.diseaseCode));

    // SS → 受診日ごとのコード（算定日情報 fields[77..107] が1〜31日）
    const byDay = new Map<number, string[]>();
    let expectedTotal = 0;
    for (const ss of g.filter((r) => r.identifier === "SS")) {
      const code = String(ss.fields[2] ?? "");
      if (!/^\d{9}$/.test(code)) continue;
      const points = Number(ss.fields[75] ?? 0) || 0;
      const count = Number(ss.fields[76] ?? 0) || 0;
      expectedTotal += points * count;
      for (let d = 1; d <= 31; d++) {
        const n = Number(ss.fields[76 + d] ?? 0) || 0; // fields[77]=1日 … fields[107]=31日
        for (let k = 0; k < n; k++) {
          let arr = byDay.get(d);
          if (arr === undefined) byDay.set(d, (arr = []));
          arr.push(code);
        }
      }
    }

    const yyyy = treatmentMonth.slice(0, 4);
    const mm = treatmentMonth.slice(4, 6);
    const visits: ProcessVisit[] = [...byDay.keys()]
      .sort((a, b) => a - b)
      .map((d) => {
        const codes = byDay.get(d)!;
        const visitType: "first" | "followup" = codes.some((c) => isShoshin(c)) ? "first" : "followup";
        return { date: `${yyyy}-${mm}-${String(d).padStart(2, "0")}`, visitType, procedureCodes: codes };
      });

    const input: ReceiptCoreInput = {
      patient: { birthDate: birthDate || "1980-01-01", sex },
      name,
      scheme: schemeFromType(receiptType),
      insurer: { insurerNo: String(ho?.fields[0] ?? "01130012"), number: String(ho?.fields[2] ?? "1") || "1" },
      visits,
      diagnoses,
    };

    out.push({
      facility,
      input,
      expected: { totalPoints: expectedTotal, actualDays: Number(ho?.fields[3] ?? 0) || 0, receiptType },
    });
  }
  return out;
}
