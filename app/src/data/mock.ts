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

export type ToothState = "healthy" | "caries" | "treated" | "missing";

/** 診療中の患者（田中 花子）の口腔内状態 */
export const activePatientTeeth: Record<string, ToothState> = {
  "16": "caries",
  "17": "treated",
  "26": "treated",
  "36": "treated",
  "46": "missing",
  "47": "treated",
  "45": "treated",
};

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
