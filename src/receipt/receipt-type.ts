/**
 * レセプト種別コード（別表6）と負担区分コード（別表21）の決定。
 *
 * 根拠: 記録条件仕様（歯科用）令和8年6月版 別表6・別表21
 * （docs/specs/R08bt1_3_kiroku_dental.pdf。pdftotext で全コードを確認）。
 *
 * 注: ここで扱うのは「コード体系」であって点数ではない。コード値は仕様で固定された
 * 分類記号であり、ハードコード禁止原則（点数・名称をコードに埋め込まない）の対象外。
 */

/** 受給者区分（医保/国保。別表6 第4桁の本人・家族・高齢の別） */
export type Beneficiary =
  | "principal" // 本人/世帯主
  | "preschool" // 未就学者
  | "family" // 家族/その他
  | "elderly-general" // 高齢受給者 一般・低所得者
  | "elderly-7"; // 高齢受給者 7割

/** 後期高齢者の負担区分（別表6 第4桁） */
export type KokiCategory = "general" /* 一般・低所得者 */ | "7" /* 7割 */;

/** 保険の枠組み */
export type ReceiptScheme =
  | { kind: "medical"; beneficiary: Beneficiary } // 医保/国保（単独 or 公費併用）
  | { kind: "koki"; category: KokiCategory } // 後期高齢者医療（単独 or 公費併用）
  | { kind: "public-only" }; // 公費負担医療単独 or 公費併用

export interface ReceiptTypeInput {
  scheme: ReceiptScheme;
  /** 併用する公費の種数（0〜4）。public-only では1以上 */
  publicExpenseCount: number;
  /** 入院=true / 入院外=false */
  admission: boolean;
}

// 別表6 第4桁: [入院, 入院外] の対応値（医保/国保）
const MEDICAL_4TH: Record<Beneficiary, [string, string]> = {
  principal: ["1", "2"],
  preschool: ["3", "4"],
  family: ["5", "6"],
  "elderly-general": ["7", "8"],
  "elderly-7": ["9", "0"],
};

// 別表6 第4桁: [入院, 入院外] の対応値（後期高齢者）
const KOKI_4TH: Record<KokiCategory, [string, string]> = {
  general: ["7", "8"],
  "7": ["9", "0"],
};

/**
 * レセプト種別コード（歯科・4桁）を決定する。
 * 第1桁=3（歯科固定）、第2桁=保険枠、第3桁=公費種数区分、第4桁=受給区分×入院/入院外。
 */
export function determineReceiptType(input: ReceiptTypeInput): string {
  const { scheme, publicExpenseCount: pub, admission } = input;
  if (!Number.isInteger(pub) || pub < 0 || pub > 4) {
    throw new Error(`公費種数は0〜4: ${pub}`);
  }
  const idx = admission ? 0 : 1; // [入院, 入院外]

  switch (scheme.kind) {
    case "medical": {
      // 3111(単独) / 3121(+1種) … 第3桁 = 1+公費種数
      const third = String(1 + pub);
      const fourth = MEDICAL_4TH[scheme.beneficiary][idx];
      return `31${third}${fourth}`;
    }
    case "koki": {
      // 3317(単独) / 3327(+1種) … 第3桁 = 1+公費種数
      const third = String(1 + pub);
      const fourth = KOKI_4TH[scheme.category][idx];
      return `33${third}${fourth}`;
    }
    case "public-only": {
      // 3211(単独=1種) / 3221(2種) … 第3桁 = 公費種数、第4桁 = 1入院/2入院外
      if (pub < 1) throw new Error("公費単独・公費併用では公費種数は1以上");
      const fourth = admission ? "1" : "2";
      return `32${pub}${fourth}`;
    }
  }
}

/**
 * 負担区分コード（別表21）。請求点数を持つ管掌（法別）の組合せから1桁の区分記号を返す。
 * payers: [医保, 公費①, 公費②, 公費③, 公費④] の各 true/false。
 */
const BURDEN_TABLE: Record<string, string> = {
  // 1者
  "10000": "1",
  "01000": "5",
  "00100": "6",
  "00010": "B",
  "00001": "C",
  // 2者
  "11000": "2",
  "10100": "3",
  "10010": "E",
  "10001": "G",
  "01100": "7",
  "01010": "H",
  "01001": "I",
  "00110": "J",
  "00101": "K",
  "00011": "L",
  // 3者
  "11100": "4",
  "11010": "M",
  "11001": "N",
  "10110": "O",
  "10101": "P",
  "10011": "Q",
  "01110": "R",
  "01101": "S",
  "01011": "T",
  "00111": "U",
  // 4者
  "11110": "V",
  "11101": "W",
  "11011": "X",
  "10111": "Y",
  "01111": "Z",
  // 5者
  "11111": "9",
};

export interface PayerSet {
  medical: boolean;
  /** 公費①〜④の適用（長さ0〜4）。true の位置が請求点数を持つ公費 */
  publicExpenses?: boolean[];
}

export function determineBurden(payers: PayerSet): string {
  const pub = payers.publicExpenses ?? [];
  if (pub.length > 4) throw new Error("公費は最大4");
  const bits = [payers.medical, pub[0] ?? false, pub[1] ?? false, pub[2] ?? false, pub[3] ?? false];
  const key = bits.map((b) => (b ? "1" : "0")).join("");
  const code = BURDEN_TABLE[key];
  if (code === undefined) throw new Error(`負担区分に該当なし（管掌の組合せが不正）: ${key}`);
  return code;
}

/** 別表7 男女区分: ドメインの "M"/"F" → "1"/"2" */
export function sexCode(sex: "M" | "F"): string {
  return sex === "M" ? "1" : "2";
}

/** 別表8 転帰区分: ドメインの outcome → コード（入院外は省略可だが算出は提供） */
export function outcomeCode(outcome: "cured" | "died" | "stopped" | "transferred" | undefined): string | undefined {
  switch (outcome) {
    case undefined:
      return "1"; // 治癒・死亡・中止以外（継続中）
    case "cured":
      return "2";
    case "died":
      return "3";
    case "stopped":
    case "transferred":
      return "4"; // 中止（転医）
  }
}
