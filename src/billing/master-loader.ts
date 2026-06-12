/**
 * 公式マスタCSVローダー。
 *
 * 対象: 支払基金 基本マスター（歯科診療行為 h_*.csv / 歯式 f_*.csv）。
 * カラム位置の根拠: マスターファイル仕様説明書 令和8年度版
 * （docs/specs/master-layout-research-R08.* で裏取り済み）
 *   歯科診療行為: 項番3=コード / 9=基本名称 / 10=省略名称 / 11=点数等識別 / 12=点数等
 *                 / 57=変更年月日(YYYYMMDD) / 58=廃止年月日
 *   点数等識別: 1:金額 3:点数 4:購入価格 5:%加算 6:%減算 7:減点 8:点数(マイナス)
 *   廃止年月日の「無期限」はマスタにより 99999999 / 0 / 00000000 と揺れる → 正規化する。
 */
import type { ProcedureMasterRow } from "./master.js";
import { InMemoryMaster } from "./master.js";

/** Shift_JIS バイト列を UTF-8 文字列へ（Node/ブラウザ共通の TextDecoder を使用） */
export function decodeSjis(buf: Uint8Array): string {
  return new TextDecoder("shift_jis").decode(buf);
}

/** ダブルクォート付きCSVの1行をフィールド配列に分解する */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** YYYYMMDD → ISO。無期限・未設定（99999999/0/00000000/空）は undefined */
export function normalizeDate(raw: string | undefined): string | undefined {
  const v = (raw ?? "").trim();
  if (v === "" || v === "0" || v === "00000000" || v === "99999999") return undefined;
  if (!/^\d{8}$/.test(v)) return undefined;
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

export interface DentalProcedureRow {
  code: string;
  name: string;
  shortName: string;
  /** 点数等識別（1:金額 3:点数 5:%加算 6:%減算 7:減点 8:点数マイナス 等） */
  pointType: string;
  /** 点数等（識別により点数/金額/%の意味になる） */
  points: number;
  validFrom: string; // ISO
  validTo?: string;  // ISO（無期限は undefined）
}

/** 歯科診療行為マスタ（UTF-8テキスト）をパースする */
export function parseDentalProcedureMaster(utf8: string): DentalProcedureRow[] {
  const rows: DentalProcedureRow[] = [];
  for (const line of utf8.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = parseCsvLine(line);
    if ((f[1] ?? "") !== "H") continue;
    const code = f[2] ?? "";
    if (!/^\d{9}$/.test(code)) continue;
    const row: DentalProcedureRow = {
      code,
      name: f[8] ?? "",
      shortName: f[9] ?? "",
      pointType: f[10] ?? "",
      points: Number(f[11] ?? "0"),
      validFrom: normalizeDate(f[56]) ?? "1900-01-01",
    };
    const validTo = normalizeDate(f[57]);
    if (validTo !== undefined) row.validTo = validTo;
    rows.push(row);
  }
  return rows;
}

/** 算定エンジン用の MasterRepository を実マスタから構築する */
export function buildMasterFromRows(rows: DentalProcedureRow[]): InMemoryMaster {
  const m = new InMemoryMaster();
  for (const r of rows) {
    const entry: Parameters<InMemoryMaster["add"]>[0] = {
      code: r.code,
      name: r.name,
      points: r.points,
      validFrom: r.validFrom,
    };
    if (r.validTo !== undefined) entry.validTo = r.validTo;
    m.add(entry);
  }
  return m;
}

export interface ToothCodeRow {
  /** 6桁歯式コード（歯種4桁＋状態1桁＋部分1桁） */
  code: string;
  name: string;
}

/** 歯式マスタ（f_*.csv、UTF-8テキスト）をパースする */
export function parseToothCodeMaster(utf8: string): ToothCodeRow[] {
  const rows: ToothCodeRow[] = [];
  for (const line of utf8.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = parseCsvLine(line);
    if ((f[1] ?? "") !== "F") continue;
    const code = f[2] ?? "";
    if (!/^\d{6}$/.test(code)) continue;
    rows.push({ code, name: f[4] ?? "" });
  }
  return rows;
}

export type { ProcedureMasterRow };
