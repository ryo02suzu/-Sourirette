/** デモ用モックデータ。実装時は API（Supabase/PostgreSQL）から取得する。 */

export type FlowStatus = "reserved" | "checked_in" | "in_chair" | "waiting_pay";

export interface BoardPatient {
  id: string;
  time: string;
  name: string;
  kana: string;
  age: number;
  sex: "M" | "F";
  chief: string; // 主訴・予定
  status: FlowStatus;
  onshikaku: boolean; // オンライン資格確認 済
  tags: string[];
}

export const todayPatients: BoardPatient[] = [
  { id: "p1", time: "09:00", name: "佐藤 美咲", kana: "サトウ ミサキ", age: 34, sex: "F", chief: "SPT（定期メンテ）", status: "waiting_pay", onshikaku: true, tags: ["P処置"] },
  { id: "p2", time: "09:30", name: "田中 花子", kana: "タナカ ハナコ", age: 45, sex: "F", chief: "右上の冷水痛", status: "in_chair", onshikaku: true, tags: ["初診"] },
  { id: "p3", time: "10:00", name: "鈴木 一郎", kana: "スズキ イチロウ", age: 67, sex: "M", chief: "義歯調整", status: "checked_in", onshikaku: true, tags: ["再診"] },
  { id: "p4", time: "10:30", name: "高橋 蓮", kana: "タカハシ レン", age: 8, sex: "M", chief: "フッ化物塗布", status: "checked_in", onshikaku: false, tags: ["小児", "保険証未確認"] },
  { id: "p5", time: "11:00", name: "伊藤 さくら", kana: "イトウ サクラ", age: 29, sex: "F", chief: "親知らず相談", status: "reserved", onshikaku: false, tags: ["初診"] },
  { id: "p6", time: "11:30", name: "渡辺 健", kana: "ワタナベ ケン", age: 52, sex: "M", chief: "根管治療 2回目", status: "reserved", onshikaku: false, tags: ["再診"] },
];

export type ToothState = "healthy" | "caries" | "cr" | "crown" | "missing" | "implant";

/** 診療中の患者（田中 花子）の口腔内状態 */
export const activePatientTeeth: Record<string, ToothState> = {
  "16": "caries",
  "17": "crown",
  "25": "implant",
  "26": "cr",
  "36": "cr",
  "45": "crown",
  "46": "missing",
  "47": "crown",
};

/** ブリッジ（45 支台 — 46 ポンティック — 47 支台） */
export const activeBridges: string[][] = [["45", "46", "47"]];

export interface DxItem {
  teeth: string[];
  name: string;
  since: string;
  aiSuggested?: boolean;
}

export const activePatientDx: DxItem[] = [
  { teeth: ["47"], name: "根尖性歯周炎", since: "2025-11-04" },
  { teeth: [], name: "歯周炎", since: "2025-11-04" },
];

export interface ReceiptRow {
  id: string;
  patient: string;
  insurance: string;
  points: number;
  errors: number;
  warnings: number;
}

export const monthReceipts: ReceiptRow[] = [
  { id: "r1", patient: "佐藤 美咲", insurance: "社保 本人", points: 1284, errors: 0, warnings: 0 },
  { id: "r2", patient: "田中 花子", insurance: "社保 家族", points: 866, errors: 1, warnings: 1 },
  { id: "r3", patient: "鈴木 一郎", insurance: "後期高齢", points: 2310, errors: 0, warnings: 2 },
  { id: "r4", patient: "高橋 蓮", insurance: "国保", points: 412, errors: 0, warnings: 0 },
  { id: "r5", patient: "渡辺 健", insurance: "社保 本人", points: 1750, errors: 1, warnings: 0 },
];

export interface ReceiptIssue {
  severity: "error" | "warning";
  message: string;
}

export const receiptIssues: Record<string, ReceiptIssue[]> = {
  r2: [
    { severity: "error", message: "充填（16）に対応する傷病名がありません — 病名「う蝕症」の登録が必要です" },
    { severity: "warning", message: "歯科疾患管理料: 管理計画書の交付記録が確認できません" },
  ],
  r3: [
    { severity: "warning", message: "SPT: 前回の歯周検査から4ヶ月以上経過しています" },
    { severity: "warning", message: "義歯調整の算定が月2回目です — 摘要欄にコメントの記載を推奨" },
  ],
  r5: [
    { severity: "error", message: "根管貼薬の部位（47）が傷病名の部位と一致しません" },
  ],
};

/* ===== 患者一覧（患者管理画面） ===== */

export interface PatientRow {
  id: string;
  chartNo: string;
  name: string;
  kana: string;
  age: number;
  sex: "M" | "F";
  lastVisit: string;
  recallDue: string | null;
  insurance: string;
  notes: string[]; // 申し送り付箋
  tags: string[];
}

export const allPatients: PatientRow[] = [
  { id: "p2", chartNo: "000482", name: "田中 花子", kana: "タナカ ハナコ", age: 45, sex: "F", lastVisit: "2026-06-12", recallDue: null, insurance: "社保 家族（3割）", notes: ["ペニシリン系アレルギー", "高血圧（服薬中）"], tags: ["初診"] },
  { id: "p1", chartNo: "000128", name: "佐藤 美咲", kana: "サトウ ミサキ", age: 34, sex: "F", lastVisit: "2026-06-12", recallDue: "2026-09-12", insurance: "社保 本人（3割）", notes: [], tags: ["SPT"] },
  { id: "p3", chartNo: "000291", name: "鈴木 一郎", kana: "スズキ イチロウ", age: 67, sex: "M", lastVisit: "2026-05-28", recallDue: "2026-08-28", insurance: "後期高齢（1割）", notes: ["義歯調整中", "妻も当院通院（鈴木 花）"], tags: ["義歯"] },
  { id: "p4", chartNo: "000533", name: "高橋 蓮", kana: "タカハシ レン", age: 8, sex: "M", lastVisit: "2026-06-12", recallDue: "2026-09-12", insurance: "国保（2割）", notes: ["保護者同伴必須"], tags: ["小児"] },
  { id: "p5", chartNo: "000534", name: "伊藤 さくら", kana: "イトウ サクラ", age: 29, sex: "F", lastVisit: "2026-06-12", recallDue: null, insurance: "社保 本人（3割）", notes: [], tags: ["初診"] },
  { id: "p6", chartNo: "000402", name: "渡辺 健", kana: "ワタナベ ケン", age: 52, sex: "M", lastVisit: "2026-06-05", recallDue: null, insurance: "社保 本人（3割）", notes: ["47 根管治療中（2/3回）"], tags: ["根治"] },
  { id: "p7", chartNo: "000077", name: "山本 久子", kana: "ヤマモト ヒサコ", age: 74, sex: "F", lastVisit: "2026-04-30", recallDue: "2026-07-30", insurance: "後期高齢（1割）", notes: ["訪問診療（さくら苑）"], tags: ["訪問"] },
  { id: "p8", chartNo: "000350", name: "中村 大輔", kana: "ナカムラ ダイスケ", age: 41, sex: "M", lastVisit: "2025-11-20", recallDue: "2026-05-20", insurance: "社保 本人（3割）", notes: [], tags: ["リコール超過"] },
];

export interface VisitHistoryItem { date: string; summary: string; points: number }

export const visitHistory: Record<string, VisitHistoryItem[]> = {
  p2: [
    { date: "2026-06-12", summary: "初診・16 う蝕処置＋CR充填", points: 590 },
  ],
  p3: [
    { date: "2026-05-28", summary: "再診・義歯調整", points: 312 },
    { date: "2026-05-14", summary: "再診・義歯新製 印象採得", points: 866 },
    { date: "2026-04-30", summary: "再診・47 抜歯", points: 540 },
  ],
};

/* ===== 予約（アポイントブック） ===== */

export interface Appointment {
  id: string;
  unit: number;        // 0..2（チェア番号）
  start: string;       // "09:00"
  minutes: number;
  patient: string;
  kind: "初診" | "再診" | "SPT" | "自費" | "訪問" | "急患";
  note?: string;
}

export const todayAppointments: Appointment[] = [
  { id: "a1", unit: 0, start: "09:00", minutes: 60, patient: "佐藤 美咲", kind: "SPT", note: "P検＋PMTC" },
  { id: "a2", unit: 0, start: "10:30", minutes: 60, patient: "鈴木 一郎", kind: "再診", note: "義歯調整" },
  { id: "a3", unit: 0, start: "14:00", minutes: 90, patient: "渡辺 健", kind: "再診", note: "根管治療 2回目" },
  { id: "a4", unit: 1, start: "09:30", minutes: 90, patient: "田中 花子", kind: "初診", note: "右上冷水痛" },
  { id: "a5", unit: 1, start: "11:00", minutes: 30, patient: "高橋 蓮", kind: "再診", note: "フッ化物塗布" },
  { id: "a6", unit: 1, start: "15:00", minutes: 120, patient: "小林 真由", kind: "自費", note: "セラミック形成" },
  { id: "a7", unit: 2, start: "10:00", minutes: 60, patient: "伊藤 さくら", kind: "初診", note: "親知らず相談" },
  { id: "a8", unit: 2, start: "13:30", minutes: 60, patient: "山本 久子", kind: "訪問", note: "さくら苑（同行: 衛生士）" },
  { id: "a9", unit: 2, start: "16:30", minutes: 30, patient: "（空き枠）", kind: "急患", note: "急患受入枠" },
];

/* ===== P検（佐藤 美咲の検査途中データ） ===== */

export interface PerioToothInput {
  pd: (number | null)[];   // 4点法
  bop: boolean[];
  mobility: 0 | 1 | 2 | 3;
}

/** 音声入力デモで読み上げられる「正解」データ（臼歯部が悪い想定） */
export const perioVoiceScript: Record<string, { pd: number[]; bop: boolean[] }> = {
  "17": { pd: [4, 5, 4, 3], bop: [true, true, false, false] },
  "16": { pd: [5, 6, 4, 4], bop: [true, true, true, false] },
  "15": { pd: [3, 4, 3, 3], bop: [false, true, false, false] },
  "26": { pd: [4, 4, 5, 3], bop: [true, false, true, false] },
  "27": { pd: [3, 4, 3, 3], bop: [false, false, false, false] },
  "36": { pd: [4, 5, 4, 3], bop: [true, true, false, false] },
  "37": { pd: [4, 4, 3, 3], bop: [true, false, false, false] },
  "47": { pd: [5, 5, 4, 4], bop: [true, true, false, true] },
};

/* ===== 経営分析 ===== */

export interface MonthlyRevenue { month: string; hoken: number; jihi: number }

export const monthlyRevenue: MonthlyRevenue[] = [
  { month: "7", hoken: 412, jihi: 95 }, { month: "8", hoken: 398, jihi: 120 },
  { month: "9", hoken: 445, jihi: 88 }, { month: "10", hoken: 460, jihi: 132 },
  { month: "11", hoken: 471, jihi: 110 }, { month: "12", hoken: 489, jihi: 145 },
  { month: "1", hoken: 430, jihi: 98 }, { month: "2", hoken: 455, jihi: 125 },
  { month: "3", hoken: 478, jihi: 160 }, { month: "4", hoken: 492, jihi: 138 },
  { month: "5", hoken: 505, jihi: 152 }, { month: "6", hoken: 318, jihi: 92 },
];

export interface CancelRisk { slot: string; risk: number; reason: string }

export const cancelRisks: CancelRisk[] = [
  { slot: "6/16（火）10:00", risk: 0.72, reason: "雨予報 × 過去の当日キャンセル2回の患者" },
  { slot: "6/19（金）18:00", risk: 0.58, reason: "金曜夜枠は直近3ヶ月で35%キャンセル" },
  { slot: "6/17（水）14:30", risk: 0.41, reason: "初診予約から2週間経過（熱量低下パターン）" },
];

export interface RecallTarget { name: string; due: string; lastVisit: string; note: string }

export const recallTargets: RecallTarget[] = [
  { name: "中村 大輔", due: "2026-05-20（超過）", lastVisit: "2025-11-20", note: "SPT中断。46 経過観察あり" },
  { name: "山本 久子", due: "2026-07-30", lastVisit: "2026-04-30", note: "訪問診療・義歯リコール" },
  { name: "佐藤 美咲", due: "2026-09-12", lastVisit: "2026-06-12", note: "SPT 3ヶ月周期" },
];
