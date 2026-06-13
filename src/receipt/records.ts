/**
 * レセプト電算（UKE）レコード定義と型付きビルダー。
 *
 * フィールドの並び・モード・最大バイト・固定/可変は
 * 「オンライン又は光ディスク等による請求に係る記録条件仕様（歯科用）令和8年6月版」
 * （docs/specs/R08bt1_3_kiroku_dental.pdf 第1章 3（4））から転記。推測で定義しない。
 *
 * 検証の根拠:
 *   - モード: 数字=半角数字（小数点可）/ 英数=半角英数 / 漢字=全角文字。
 *     英数・漢字の混在不可項目は「いずれか一方のみ」を強制（氏名・記号・番号等）。
 *   - 固定項目は最大バイト数ちょうどで記録、可変項目は有効桁まで。
 *   - 歯式コードは6バイト単位・最大64個、修飾語コードは4バイト単位・最大20個。
 *   - SS の回数は算定日情報（1〜31日）の合計と一致する。
 */
import type { UkeRecord } from "./uke.js";
import { isFullWidthSjis, sjisByteLength } from "./shift-jis.js";

export type FieldMode = "num" | "alnum" | "kanji" | "alnum-or-kanji";

export interface FieldDef {
  /** 仕様書どおりの項目名 */
  name: string;
  mode: FieldMode;
  maxBytes: number;
  /** true=固定長（記録時は最大バイト数ちょうど） */
  fixed?: boolean;
}

const f = (name: string, mode: FieldMode, maxBytes: number, fixed = false): FieldDef =>
  fixed ? { name, mode, maxBytes, fixed } : { name, mode, maxBytes };

/** 算定日情報 1日〜31日（SS/SI/IY/TO 共通） */
const dailyFields = (): FieldDef[] =>
  Array.from({ length: 31 }, (_, i) => f(`${i + 1}日の情報`, "num", 3));

export const RECORD_SCHEMAS: Record<string, FieldDef[]> = {
  // 受付情報レコード（仕様 p5）
  UK: [
    f("審査支払機関", "num", 1, true),
    f("都道府県", "num", 2, true),
    f("点数表", "num", 1, true),
    f("医療機関コード", "num", 7, true),
    f("予備", "num", 2),
    f("医療機関名称", "kanji", 40),
    f("請求年月", "num", 6, true),
    f("届出", "alnum", 40),
    f("マルチボリューム識別情報", "num", 2, true),
  ],
  // 医療機関情報レコード（p6）
  IR: [
    f("審査支払機関", "num", 1, true),
    f("都道府県", "num", 2, true),
    f("点数表", "num", 1, true),
    f("医療機関コード", "num", 7, true),
    f("予備", "num", 2),
    f("請求年月", "num", 6, true),
    f("電話番号", "alnum", 15),
    f("届出", "alnum", 40),
  ],
  // レセプト共通レコード（p7〜8）
  RE: [
    f("レセプト番号", "num", 6),
    f("レセプト種別", "num", 4, true),
    f("診療年月", "num", 6, true),
    f("氏名", "alnum-or-kanji", 40),
    f("男女区分", "num", 1, true),
    f("生年月日", "num", 8, true),
    f("給付割合", "num", 3),
    f("入院年月日", "num", 8),
    f("診療開始日", "num", 8),
    f("転帰区分", "num", 1),
    f("病棟区分", "alnum", 8),
    f("一部負担金・食事療養費・生活療養費標準負担額区分", "num", 1),
    f("レセプト特記事項", "alnum", 10),
    f("予備", "num", 4),
    f("カルテ番号等", "alnum", 20),
    f("請求情報１", "num", 2),
    f("予備", "num", 2),
    f("未来院請求", "num", 2),
    f("検索番号", "num", 30),
    f("予備", "num", 5),
    f("請求情報２", "alnum-or-kanji", 40),
    f("予備", "num", 2),
    f("予備", "num", 3),
    f("予備", "num", 3),
    f("カタカナ（氏名）", "kanji", 80),
    f("患者の状態", "num", 60),
  ],
  // 保険者レコード（p9〜10）
  HO: [
    f("保険者番号", "alnum", 8, true),
    f("被保険者資格に係る記号", "alnum-or-kanji", 38),
    f("被保険者資格に係る番号", "alnum-or-kanji", 38),
    f("診療実日数", "num", 2),
    f("合計点数", "num", 8),
    f("食事療養・生活療養 回数", "num", 2),
    f("食事療養・生活療養 合計金額", "num", 8),
    f("職務上の事由", "num", 1),
    f("証明書番号", "num", 3),
    f("負担金額（医療保険）", "num", 9),
    f("減免区分", "num", 1),
    f("減額割合", "num", 3),
    f("減額金額", "num", 6),
  ],
  // 公費レコード（p11）
  KO: [
    f("負担者番号", "alnum", 8, true),
    f("受給者番号", "num", 7),
    f("任意給付区分", "num", 1),
    f("診療実日数", "num", 2),
    f("合計点数", "num", 8),
    f("負担金額（公費）", "num", 8),
    f("公費給付対象一部負担金", "num", 6),
    f("食事療養・生活療養 回数", "num", 2),
    f("食事療養・生活療養 合計金額", "num", 8),
  ],
  // 資格確認レコード（p12）
  SN: [
    f("負担者種別", "num", 1, true),
    f("確認区分", "num", 2, true),
    f("保険者番号等（資格確認）", "alnum", 8),
    f("被保険者資格に係る記号（資格確認）", "alnum-or-kanji", 38),
    f("被保険者資格に係る番号（資格確認）", "alnum-or-kanji", 38),
    f("枝番", "alnum", 2),
    f("受給者番号", "num", 7),
    f("予備", "num", 1),
  ],
  // 受診日等レコード（p13）
  JD: [
    f("負担者種別", "num", 1, true),
    ...Array.from({ length: 31 }, (_, i) => f(`${i + 1}日の情報`, "num", 1)),
  ],
  // 窓口負担額レコード（p13）
  MF: [
    f("窓口負担額区分", "num", 2, true),
    ...Array.from({ length: 31 }, (_, i) => f(`予備${i + 1}`, "num", 9)),
  ],
  // 傷病名部位レコード（p14〜15）
  HS: [
    f("診療開始日", "num", 8),
    f("転帰区分", "num", 1),
    f("歯式コード（傷病名）", "alnum", 384),
    f("傷病名コード", "num", 7, true),
    f("修飾語コード", "alnum", 80),
    f("傷病名称", "kanji", 40),
    f("併存傷病名数", "num", 1),
    f("病態移行", "num", 1),
    f("主傷病", "num", 2),
    f("コメントコード", "num", 9),
    f("補足コメント", "kanji", 100),
    f("歯式コード（補足コメント）", "alnum", 384),
  ],
  // 歯科診療行為レコード（p16〜21）
  SS: [
    f("診療識別", "num", 2),
    f("負担区分", "alnum", 1, true),
    f("診療行為コード", "num", 9, true),
    f("診療行為数量データ１", "num", 8),
    f("診療行為数量データ２", "num", 8),
    ...Array.from({ length: 35 }, (_, i) => [
      f(`加算コード${i + 1}`, "alnum", 5),
      f(`加算数量データ${i + 1}`, "num", 8),
    ]).flat(),
    f("点数", "num", 7),
    f("回数", "num", 3),
    ...dailyFields(),
  ],
  // 医科診療行為レコード（p22）
  SI: [
    f("診療識別", "num", 2),
    f("負担区分", "alnum", 1, true),
    f("診療行為コード", "num", 9, true),
    f("数量データ", "num", 8),
    f("点数", "num", 7),
    f("回数", "num", 3),
    ...dailyFields(),
  ],
  // 医薬品レコード（p23）
  IY: [
    f("診療識別", "num", 2),
    f("負担区分", "alnum", 1, true),
    f("医薬品コード", "num", 9, true),
    f("使用量", "num", 11),
    f("点数", "num", 7),
    f("回数", "num", 3),
    f("医薬品区分", "alnum", 1),
    ...dailyFields(),
  ],
  // 特定器材レコード（p24〜25）
  TO: [
    f("診療識別", "num", 2),
    f("負担区分", "alnum", 1, true),
    f("特定器材コード", "num", 9, true),
    f("使用量", "num", 9),
    f("単位コード", "num", 3),
    f("単価", "num", 11),
    f("特定器材加算等コード１", "num", 9),
    f("特定器材加算等数量データ１", "num", 9),
    f("特定器材加算等コード２", "num", 9),
    f("特定器材加算等数量データ２", "num", 9),
    f("商品名及び規格又はサイズ", "kanji", 300),
    f("点数", "num", 7),
    f("回数", "num", 3),
    ...dailyFields(),
  ],
  // コメントレコード（p26）
  CO: [
    f("診療識別", "num", 2),
    f("負担区分", "alnum", 1, true),
    f("コメントコード", "num", 9, true),
    f("文字データ", "kanji", 400),
    f("歯式コード（コメント）", "alnum", 384),
    f("予備", "alnum", 1),
    f("予備", "alnum", 2),
    f("予備", "alnum", 3),
    f("予備", "num", 7),
    f("予備", "num", 7),
  ],
  // 症状詳記レコード（p26）
  SJ: [f("症状詳記区分", "num", 2), f("症状詳記データ", "kanji", 2400)],
  // 診療報酬請求書レコード（p27）
  GO: [
    f("総件数", "num", 6),
    f("総合計点数", "num", 10),
    f("マルチボリューム識別情報", "num", 2, true),
  ],
};

export type RecordType = keyof typeof RECORD_SCHEMAS;

const NUM_RE = /^\d+(\.\d+)?$/;
const ALNUM_RE = /^[\x20-\x7e]*$/; // 半角の図形文字（カンマ・引用符は直列化側で拒否）

function validateField(type: string, def: FieldDef, value: string): void {
  const where = `${type}.${def.name}`;
  if (value === "") return; // 省略（必須性はレコード/ファイル組み立て側で検証）
  switch (def.mode) {
    case "num":
      if (!NUM_RE.test(value)) throw new Error(`${where}: 数字モード項目に数字以外: ${JSON.stringify(value)}`);
      break;
    case "alnum":
      if (!ALNUM_RE.test(value)) throw new Error(`${where}: 英数モード項目に半角英数以外: ${JSON.stringify(value)}`);
      break;
    case "kanji":
      if (!isFullWidthSjis(value)) throw new Error(`${where}: 漢字モード項目に全角以外: ${JSON.stringify(value)}`);
      break;
    case "alnum-or-kanji":
      if (!ALNUM_RE.test(value) && !isFullWidthSjis(value)) {
        throw new Error(`${where}: 英数モードと漢字モードの混在不可: ${JSON.stringify(value)}`);
      }
      break;
  }
  const bytes = sjisByteLength(value);
  if (bytes > def.maxBytes) throw new Error(`${where}: 最大${def.maxBytes}バイト超過（${bytes}バイト）`);
  if (def.fixed && bytes !== def.maxBytes) {
    throw new Error(`${where}: 固定長${def.maxBytes}バイトに不一致（${bytes}バイト）`);
  }
}

/**
 * スキーマ検証付きでレコードを構築する。
 * フィールドはスキーマの全項目分を出力する（作成手引きの記録例は末尾の空項目も
 * カンマを記録しているため、これに合わせる）。
 */
export function buildRecord(type: RecordType, values: (string | number | undefined)[]): UkeRecord {
  const schema = RECORD_SCHEMAS[type];
  if (schema === undefined) throw new Error(`未知のレコード識別子: ${type}`);
  if (values.length > schema.length) {
    throw new Error(`${type}: フィールド数超過（${values.length} > ${schema.length}）`);
  }
  const fields: string[] = [];
  for (let i = 0; i < schema.length; i++) {
    const def = schema[i]!;
    const raw = values[i];
    const value = raw === undefined ? "" : String(raw);
    validateField(type, def, value);
    fields.push(value);
  }
  return { identifier: type, fields };
}

/** 歯式コード列の検証（6桁単位・最大64個） */
function joinShikiCodes(where: string, codes: readonly string[] | undefined): string {
  if (codes === undefined || codes.length === 0) return "";
  if (codes.length > 64) throw new Error(`${where}: 歯式コードは最大64個（${codes.length}個）`);
  for (const c of codes) {
    if (!/^[0-9A-Z]{6}$/.test(c)) throw new Error(`${where}: 歯式コードは6桁英数: ${JSON.stringify(c)}`);
  }
  return codes.join("");
}

// ---- 型付きビルダー（歯科の一次請求で使うレコード） ----

export interface UkParams {
  /** 別表1: 1=支払基金 2=国保連 */
  payer: string;
  /** 別表2: 都道府県コード2桁 */
  prefecture: string;
  /** 医療機関コード7桁 */
  facilityCode: string;
  /** 地方厚生（支）局長に届け出た医療機関名称（全角） */
  facilityName: string;
  /** 請求年月 YYYYMM（西暦） */
  billingMonth: string;
  /** 別表5: 施設基準届出コード（2桁×最大14個） */
  notifications?: string[];
  /** マルチボリューム識別情報。単一ボリュームは "00" */
  multiVolume?: string;
}

export function buildUk(p: UkParams): UkeRecord {
  return buildRecord("UK", [
    p.payer,
    p.prefecture,
    "3", // 点数表（歯科）
    p.facilityCode,
    undefined,
    p.facilityName,
    p.billingMonth,
    joinNotifications("UK.届出", p.notifications),
    p.multiVolume ?? "00",
  ]);
}

function joinNotifications(where: string, codes: readonly string[] | undefined): string {
  if (codes === undefined || codes.length === 0) return "";
  if (codes.length > 14) throw new Error(`${where}: 施設基準届出コードは最大14個`);
  if (new Set(codes).size !== codes.length) throw new Error(`${where}: 同一コードの重複記録は不可`);
  for (const c of codes) {
    if (!/^[0-9A-Z]{2}$/.test(c)) throw new Error(`${where}: 届出コードは2桁: ${JSON.stringify(c)}`);
  }
  return codes.join("");
}

export interface IrParams {
  payer: string;
  prefecture: string;
  facilityCode: string;
  billingMonth: string;
  phone?: string;
  notifications?: string[];
}

export function buildIr(p: IrParams): UkeRecord {
  return buildRecord("IR", [
    p.payer,
    p.prefecture,
    "3",
    p.facilityCode,
    undefined,
    p.billingMonth,
    p.phone,
    joinNotifications("IR.届出", p.notifications),
  ]);
}

export interface ReParams {
  /** レセプト記録順に1から昇順 */
  receiptNo: number;
  /** 別表6: レセプト種別4桁（歯科は3で始まる） */
  receiptType: string;
  /** 診療年月 YYYYMM */
  treatmentMonth: string;
  /** 姓名（姓と名の間に1文字スペース。英数と漢字の混在不可） */
  name: string;
  /** 別表7: 1=男 2=女 */
  sex: string;
  /** 生年月日 YYYYMMDD */
  birthDate: string;
  /** 国保の給付割合（％） */
  benefitRatio?: string;
  /** 入院レセプトの入院年月日 YYYYMMDD */
  admissionDate?: string;
  /** 入院外レセプトの保険診療開始日 YYYYMMDD */
  treatmentStartDate?: string;
  /** 別表8: 転帰区分（入院外） */
  outcome?: string;
  /** 別表10: 一部負担金等標準負担額区分 */
  burdenCategory?: string;
  /** 別表11: レセプト特記事項（2桁×最大5個） */
  specialNotes?: string[];
  /** カルテ番号・患者ID等（任意） */
  chartNo?: string;
  /** 別表12: 未来院請求（"01"） */
  noShowClaim?: string;
  /** 氏名フリガナ（全角カタカナ・姓名間スペースなし） */
  kanaName?: string;
  /** 別表26: 患者の状態コード（3桁×最大20個） */
  patientStates?: string[];
}

export function buildRe(p: ReParams): UkeRecord {
  if (!/^3\d{3}$/.test(p.receiptType)) {
    throw new Error(`RE.レセプト種別: 歯科は3で始まる4桁: ${JSON.stringify(p.receiptType)}`);
  }
  if (p.kanaName !== undefined && p.kanaName !== "" && !/^[ァ-ヶー]+$/u.test(p.kanaName)) {
    throw new Error(`RE.カタカナ（氏名）: 全角カタカナのみ（長音「ー」可・ダッシュ/マイナス不可）: ${JSON.stringify(p.kanaName)}`);
  }
  const specialNotes = p.specialNotes ?? [];
  if (specialNotes.length > 5) throw new Error("RE.レセプト特記事項: 最大5個");
  const states = p.patientStates ?? [];
  if (states.length > 20) throw new Error("RE.患者の状態: 最大20個");
  return buildRecord("RE", [
    p.receiptNo,
    p.receiptType,
    p.treatmentMonth,
    p.name,
    p.sex,
    p.birthDate,
    p.benefitRatio,
    p.admissionDate,
    p.treatmentStartDate,
    p.outcome,
    undefined, // 病棟区分（入院のみ）
    p.burdenCategory,
    specialNotes.join(""),
    undefined,
    p.chartNo,
    undefined, // 請求情報１
    undefined,
    p.noShowClaim,
    undefined, // 検索番号（一次請求では省略）
    undefined,
    undefined, // 請求情報２
    undefined,
    undefined,
    undefined,
    p.kanaName,
    states.join(""),
  ]);
}

export interface HoParams {
  /** 保険者番号（8桁未満は先頭スペース埋めで8桁にして渡す） */
  insurerNo: string;
  /** 被保険者証の記号（番号のみの場合は省略） */
  symbol?: string;
  /** 被保険者証の番号 */
  number: string;
  /** 医療保険の診療実日数 */
  actualDays: number;
  /** 医療保険の合計点数 */
  totalPoints: number;
  /** 入院外の一部負担金額（必要な場合） */
  burdenAmount?: number;
}

export function buildHo(p: HoParams): UkeRecord {
  return buildRecord("HO", [
    p.insurerNo,
    p.symbol,
    p.number,
    p.actualDays,
    p.totalPoints,
    undefined, // 食事回数（入院のみ）
    undefined,
    undefined, // 職務上の事由
    undefined,
    p.burdenAmount,
    undefined,
    undefined,
    undefined,
  ]);
}

export interface KoParams {
  /** 公費負担者番号8桁 */
  payerNo: string;
  /** 受給者番号（7桁未満は先頭0埋め。医療観察法は省略） */
  recipientNo?: string;
  /** 公費の診療実日数 */
  actualDays: number;
  /** 公費の合計点数 */
  totalPoints: number;
  /** 公費に係る患者負担額 */
  burdenAmount?: number;
  /** 公費給付対象一部負担金 */
  benefitTargetBurden?: number;
}

export function buildKo(p: KoParams): UkeRecord {
  return buildRecord("KO", [
    p.payerNo,
    p.recipientNo,
    undefined, // 任意給付区分
    p.actualDays,
    p.totalPoints,
    p.burdenAmount,
    p.benefitTargetBurden,
    undefined,
    undefined,
  ]);
}

export interface SnParams {
  /** 別表27: 1=医保 2〜5=第1〜第4公費 */
  payerKind: string;
  /** 別表28: 確認区分（一次請求は "01"〜"03" 等） */
  confirmation: string;
  /** 枝番2桁（後期高齢者・公費は省略） */
  branchNo?: string;
}

export function buildSn(p: SnParams): UkeRecord {
  return buildRecord("SN", [
    p.payerKind,
    p.confirmation,
    undefined, // 保険者番号等〜受給者番号は一次請求では省略
    undefined,
    undefined,
    p.branchNo,
    undefined,
    undefined,
  ]);
}

export interface HsParams {
  /** 歯式コード6桁の配列（仕様の配列順で渡す）。部位不要なら省略 */
  teeth?: string[];
  /** 傷病名コード7桁（未コード化は "0000999"） */
  diseaseCode: string;
  /** 修飾語コード（4桁×最大20個） */
  modifiers?: string[];
  /** 未コード化傷病名の名称（全角） */
  uncodedName?: string;
  /** 歯式に併存する傷病名数 */
  concurrentCount?: number;
  /** 別表18: 1=病態移行前 2=病態移行後 */
  transition?: string;
  /** 補足コメントコード9桁 */
  commentCode?: string;
  /** 補足コメント文字データ（コメントコード 810000001 の場合） */
  commentText?: string;
  /** 歯式コード（補足コメント） */
  commentTeeth?: string[];
}

export function buildHs(p: HsParams): UkeRecord {
  const modifiers = p.modifiers ?? [];
  if (modifiers.length > 20) throw new Error("HS.修飾語コード: 最大20個");
  for (const m of modifiers) {
    if (!/^[0-9A-Z]{4}$/.test(m)) throw new Error(`HS.修飾語コード: 4桁英数: ${JSON.stringify(m)}`);
  }
  return buildRecord("HS", [
    undefined, // 診療開始日（入院のみ）
    undefined, // 転帰区分（入院のみ）
    joinShikiCodes("HS.歯式コード（傷病名）", p.teeth),
    p.diseaseCode,
    modifiers.join(""),
    p.uncodedName,
    p.concurrentCount,
    p.transition,
    undefined, // 主傷病（入院のみ）
    p.commentCode,
    p.commentText,
    joinShikiCodes("HS.歯式コード（補足コメント）", p.commentTeeth),
  ]);
}

export interface SsAddition {
  /** 加算コード（英数5桁） */
  code: string;
  /** 加算数量データ（整数値） */
  quantity?: number;
}

export interface SsParams {
  /** 別表20: 診療識別コード（点数・回数算定単位の先頭以外は省略） */
  category?: string;
  /** 別表21: 負担区分コード（医保単独は "1"） */
  burden: string;
  /** 診療行為コード9桁（歯科は先頭3） */
  code: string;
  quantity1?: number;
  quantity2?: number;
  /** 加算コード＋加算数量データ（最大35組、診療行為と同一レコードに記録） */
  additions?: SsAddition[];
  /** 点数・回数算定単位内の最終レコードにのみ記録 */
  points?: number;
  /** 回数（算定日情報の合計と一致） */
  count: number;
  /** 算定日ごとの回数。キー=日（1〜31）。未来院請求では省略 */
  daily?: Record<number, number>;
}

export function buildSs(p: SsParams): UkeRecord {
  if (!/^3\d{8}$/.test(p.code)) {
    throw new Error(`SS.診療行為コード: 歯科は3で始まる9桁: ${JSON.stringify(p.code)}`);
  }
  const additions = p.additions ?? [];
  if (additions.length > 35) throw new Error("SS.加算コード: 最大35組");
  const additionFields: (string | number | undefined)[] = [];
  for (let i = 0; i < 35; i++) {
    const a = additions[i];
    additionFields.push(a?.code, a?.quantity);
  }
  const daily = buildDailyFields("SS", p.daily, p.count);
  return buildRecord("SS", [
    p.category,
    p.burden,
    p.code,
    p.quantity1,
    p.quantity2,
    ...additionFields,
    p.points,
    p.count,
    ...daily,
  ]);
}

function buildDailyFields(
  type: string,
  daily: Record<number, number> | undefined,
  count: number,
): (number | undefined)[] {
  const fields: (number | undefined)[] = Array.from({ length: 31 }, () => undefined);
  if (daily === undefined || Object.keys(daily).length === 0) return fields; // 未来院請求等
  let sum = 0;
  for (const [dayStr, n] of Object.entries(daily)) {
    const day = Number(dayStr);
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error(`${type}.算定日情報: 日は1〜31: ${dayStr}`);
    fields[day - 1] = n;
    sum += n;
  }
  if (sum !== count) {
    throw new Error(`${type}: 回数（${count}）と算定日情報の合計（${sum}）が不一致`);
  }
  return fields;
}

export interface CoParams {
  /** 別表20: 診療識別コード */
  category?: string;
  /** 別表21: 負担区分コード */
  burden: string;
  /** コメントコード9桁（先頭8） */
  code: string;
  /** コメントコードに応じた文字データ（全角） */
  text?: string;
  /** 歯式コード（コメント）。診療行為に紐づく歯式は SS ではなく CO に記録する */
  teeth?: string[];
}

export function buildCo(p: CoParams): UkeRecord {
  return buildRecord("CO", [
    p.category,
    p.burden,
    p.code,
    p.text,
    joinShikiCodes("CO.歯式コード（コメント）", p.teeth),
  ]);
}

export interface GoParams {
  /** 保険医療機関単位のレセプト総件数 */
  totalCount: number;
  /** 各レセプトの主保険に係る点数の総合計 */
  totalPoints: number;
  /** 単一ボリュームは "99" */
  multiVolume?: string;
}

export function buildGo(p: GoParams): UkeRecord {
  return buildRecord("GO", [p.totalCount, p.totalPoints, p.multiVolume ?? "99"]);
}
