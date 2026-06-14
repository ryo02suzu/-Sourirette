/**
 * 算定サーバ（npm run serve）への API クライアント。
 * 画面から「実点数で算定 → UKE生成 → 自己点検」をサーバ経由で実行する。
 * サーバ未起動時は呼び出し側でブラウザのデモ算定にフォールバックする。
 */
const SERVER_URL = "http://localhost:8787";

export interface ServerValidationIssue {
  severity: "reject" | "review";
  code: string;
  message: string;
  receiptNo?: string;
}

export interface ServerCommentCandidate {
  procedureCode: string;
  commentCode: string;
  displayText: string;
  recordingNote: string;
}

export interface ServerReceiptResult {
  recordsText: string;
  ukeBase64: string;
  recordCount: number;
  byteLength: number;
  totalPoints: number;
  visitDays: number;
  validation: ServerValidationIssue[];
  submittable: boolean;
  commentCandidates: ServerCommentCandidate[];
}

/** サーバ稼働確認（取込件数を返す） */
export async function checkHealth(): Promise<{ ok: boolean; counts?: Record<string, number> }> {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false };
    return await res.json();
  } catch {
    return { ok: false };
  }
}

/** カルテ入力 → 実点数算定・UKE生成・自己点検 */
export async function generateReceipt(input: unknown): Promise<ServerReceiptResult> {
  const res = await fetch(`${SERVER_URL}/api/receipt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as ServerReceiptResult;
}

/** base64 の UKE バイト列を RECEIPTS.UKE としてダウンロード（Shift_JIS を変質させない） */
export function downloadUkeBase64(base64: string, filename = "RECEIPTS.UKE"): void {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** デモ用のカルテ入力（初診＋写真診断、慢性歯周炎）。サーバの processReceipt 入力形式 */
export const DEMO_ENCOUNTER = {
  facility: { payer: "1", prefecture: "13", facilityCode: "1234567", facilityName: "ソーリレット歯科デモ医院", billingMonth: "202607", phone: "03-1234-5678" },
  patient: { birthDate: "1980-06-30", sex: "F" },
  name: "基金　花子",
  kanaName: "キキンハナコ",
  chartNo: "DEMO-0001",
  scheme: { kind: "medical", beneficiary: "family" },
  insurer: { insurerNo: "01130012", symbol: "11010203", number: "123" },
  visits: [
    { date: "2026-06-05", visitType: "first", procedureCodes: ["301000110", "305000110", "305004010"] },
    { date: "2026-06-19", visitType: "followup", procedureCodes: [] },
  ],
  diagnoses: [{ diseaseCode: "8840351", teeth: ["16"], onsetDate: "2026-06-05" }],
} as const;
