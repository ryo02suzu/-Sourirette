/**
 * UKE 出力のゴールデンテスト。
 *
 * 正解データの出典:
 *   - 支払基金「電子レセプトの作成手引き −歯科− 令和6年9月版」（docs/specs/jiki_s01_part*.pdf）
 *     の各レコード記録例（UK p2 / IR p4 / RE p9 / HO p14 / KO p16 / SN p19 / GO p139）
 *   - 記録条件仕様（歯科用）令和8年6月版の物理仕様（Shift_JIS・CR+LF・EOF 0x1A）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeShiftJis, isFullWidthSjis, sjisByteLength } from "../src/receipt/shift-jis.js";
import { encodeUkeFile, serializeRecord } from "../src/receipt/uke.js";
import {
  buildCo,
  buildGo,
  buildHo,
  buildHs,
  buildIr,
  buildKo,
  buildRe,
  buildRecord,
  buildSn,
  buildSs,
  buildUk,
} from "../src/receipt/records.js";
import { assembleUkeFile, calculateGoTotals, type UkeReceipt } from "../src/receipt/build.js";
import { fdiToShikiCode } from "../src/domain/tooth-code.js";

// ---- Shift_JIS エンコーダ ----

test("Shift_JIS: ASCII はそのまま1バイト", () => {
  assert.deepEqual([...encodeShiftJis("RE,1,3112")], [...Buffer.from("RE,1,3112", "ascii")]);
});

test("Shift_JIS: 漢字・カタカナはラウンドトリップで一致", () => {
  for (const s of ["基金歯科病院", "キキンタロウ", "齲蝕", "全角　スペース"]) {
    const bytes = encodeShiftJis(s);
    assert.equal(new TextDecoder("shift_jis").decode(bytes), s, s);
  }
});

test("Shift_JIS: 長音「ー」は 0x815B（ダッシュ 0x815C と取り違えない）", () => {
  assert.deepEqual([...encodeShiftJis("ー")], [0x81, 0x5b]);
});

test("Shift_JIS: 半角カタカナは1バイト（0xA1〜0xDF）", () => {
  assert.deepEqual([...encodeShiftJis("ｱﾝ")], [0xb1, 0xdd]);
});

test("Shift_JIS: JIS規程外コードは全角「？」(0x8148) に置換（仕様の規定）", () => {
  assert.deepEqual([...encodeShiftJis("①")], [0x81, 0x48]); // NEC特殊文字はJIS X 0208外
  assert.deepEqual([...encodeShiftJis("🙂")], [0x81, 0x48]);
});

test("Shift_JIS: バイト数と全角判定", () => {
  assert.equal(sjisByteLength("基金　太郎"), 10);
  assert.equal(sjisByteLength("A123-456"), 8);
  assert.ok(isFullWidthSjis("基金歯科病院"));
  assert.ok(!isFullWidthSjis("ABC"));
  assert.ok(!isFullWidthSjis("ｱ")); // 半角カタカナは全角ではない
});

// ---- レコードビルダー（作成手引きの記録例と突合） ----

test("UK: 受付情報レコード記録例（手引き p2）", () => {
  const rec = buildUk({
    payer: "1",
    prefecture: "13",
    facilityCode: "1234567",
    facilityName: "基金歯科病院",
    billingMonth: "202407",
    notifications: ["01"],
  });
  assert.equal(serializeRecord(rec), "UK,1,13,3,1234567,,基金歯科病院,202407,01,00");
});

test("IR: 医療機関情報レコード記録例（手引き p4）", () => {
  const rec = buildIr({
    payer: "1",
    prefecture: "13",
    facilityCode: "1234567",
    billingMonth: "202407",
    phone: "03-1234-5678",
    notifications: ["01"],
  });
  assert.equal(serializeRecord(rec), "IR,1,13,3,1234567,,202407,03-1234-5678,01");
});

test("RE: レセプト共通レコード記録例・入院外（手引き p9）", () => {
  const rec = buildRe({
    receiptNo: 200,
    receiptType: "3112", // 医保単独・本人・入院外
    treatmentMonth: "202406",
    name: "基金　太郎",
    sex: "1",
    birthDate: "19720630",
    treatmentStartDate: "20240615",
    outcome: "1",
    specialNotes: ["40"],
    chartNo: "A123-456",
    kanaName: "キキンタロウ",
  });
  assert.equal(
    serializeRecord(rec),
    "RE,200,3112,202406,基金　太郎,1,19720630,,,20240615,1,,,40,,A123-456,,,,,,,,,,キキンタロウ,",
  );
});

test("HO: 保険者レコード記録例（手引き p14）", () => {
  const rec = buildHo({
    insurerNo: "01130012",
    symbol: "11010203",
    number: "123",
    actualDays: 2,
    totalPoints: 1150,
  });
  assert.equal(serializeRecord(rec), "HO,01130012,11010203,123,2,1150,,,,,,,,");
});

test("KO: 公費レコード記録例（手引き p16）", () => {
  const rec = buildKo({
    payerNo: "19136019",
    recipientNo: "0001234",
    actualDays: 2,
    totalPoints: 1150,
  });
  assert.equal(serializeRecord(rec), "KO,19136019,0001234,,2,1150,,,,");
});

test("SN: 資格確認レコード記録例（手引き p19）", () => {
  const rec = buildSn({ payerKind: "1", confirmation: "01", branchNo: "03" });
  assert.equal(serializeRecord(rec), "SN,1,01,,,,03,,");
});

test("GO: 診療報酬請求書レコード記録例（手引き p139）", () => {
  const rec = buildGo({ totalCount: 146, totalPoints: 133000 });
  assert.equal(serializeRecord(rec), "GO,146,133000,99");
});

test("HS: ブリッジ欠損症例の歯式連結（支台6｜欠損5｜支台4）", () => {
  const rec = buildHs({
    teeth: [
      fdiToShikiCode("16", "abutment"), // 101630
      fdiToShikiCode("15", "missing"), // 101520
      fdiToShikiCode("14", "abutment"), // 101430
    ],
    diseaseCode: "5250001",
  });
  assert.equal(serializeRecord(rec), "HS,,,101630101520101430,5250001,,,,,,,,");
});

test("HS: 未コード化傷病名は 0000999 ＋ 傷病名称（手引き 第8部の例）", () => {
  const rec = buildHs({
    teeth: ["101310", "101210", "101110", "102110", "102210", "102310"],
    diseaseCode: "0000999",
    uncodedName: "人工歯脱落",
  });
  assert.equal(serializeRecord(rec), "HS,,,101310101210101110102110102210102310,0000999,,人工歯脱落,,,,,,");
});

test("SS: 歯科初診料＋加算（フィールド数109・算定日記録）", () => {
  const rec = buildSs({
    category: "11",
    burden: "1",
    code: "301000110", // 歯科初診料
    additions: [{ code: "CA002" }],
    points: 542,
    count: 1,
    daily: { 5: 1 },
  });
  const line = serializeRecord(rec);
  assert.ok(line.startsWith("SS,11,1,301000110,,,CA002,,"), line);
  // 識別子＋108フィールド（仕様の項目数）
  assert.equal(line.split(",").length, 109);
  // 点数542・回数1 の後、5日の情報に1
  const fields = line.split(",");
  assert.equal(fields[76], "542"); // 点数
  assert.equal(fields[77], "1"); // 回数
  assert.equal(fields[78 + 4], "1"); // 5日の情報
});

test("SS: 回数と算定日情報の合計が不一致なら拒否（仕様の一致規定）", () => {
  assert.throws(
    () => buildSs({ burden: "1", code: "301001710", count: 2, daily: { 1: 1 } }),
    /回数（2）と算定日情報の合計（1）が不一致/,
  );
});

test("SS: 歯科以外の診療行為コード・36組目の加算は拒否", () => {
  assert.throws(() => buildSs({ burden: "1", code: "101000110", count: 1 }), /歯科は3で始まる9桁/);
  assert.throws(
    () =>
      buildSs({
        burden: "1",
        code: "301000110",
        count: 1,
        additions: Array.from({ length: 36 }, () => ({ code: "CA001" })),
      }),
    /最大35組/,
  );
});

test("CO: 診療行為に紐づく歯式は CO の歯式コードに記録（SS には歯式項目がない）", () => {
  const rec = buildCo({
    burden: "1",
    code: "820000000",
    teeth: [fdiToShikiCode("16"), fdiToShikiCode("17")],
  });
  assert.equal(serializeRecord(rec), "CO,,1,820000000,,101600101700,,,,,");
});

// ---- 検証（モード・桁・歯式単位） ----

test("検証: 固定長不一致・モード違反・歯式6桁違反を拒否", () => {
  // 固定長: 医療機関コードは7桁
  assert.throws(
    () => buildUk({ payer: "1", prefecture: "13", facilityCode: "123", facilityName: "あ", billingMonth: "202407" }),
    /固定長7バイトに不一致/,
  );
  // 数字モードに英字
  assert.throws(() => buildRecord("GO", ["12A", "0", "99"]), /数字モード項目に数字以外/);
  // 漢字モードに半角
  assert.throws(
    () => buildUk({ payer: "1", prefecture: "13", facilityCode: "1234567", facilityName: "Clinic", billingMonth: "202407" }),
    /漢字モード項目に全角以外/,
  );
  // 歯式コードが6桁単位でない
  assert.throws(() => buildHs({ teeth: ["10163"], diseaseCode: "5250001" }), /歯式コードは6桁英数/);
  // 最大バイト超過（カルテ番号等は20バイト）
  assert.throws(
    () =>
      buildRe({
        receiptNo: 1,
        receiptType: "3112",
        treatmentMonth: "202406",
        name: "基金　太郎",
        sex: "1",
        birthDate: "19720630",
        chartNo: "123456789012345678901",
      }),
    /最大20バイト超過/,
  );
});

test("検証: カタカナ氏名にダッシュ・ひらがなは不可、長音は可", () => {
  const base = {
    receiptNo: 1,
    receiptType: "3112",
    treatmentMonth: "202406",
    name: "基金　太郎",
    sex: "1",
    birthDate: "19720630",
  };
  assert.ok(serializeRecord(buildRe({ ...base, kanaName: "キキンター" })).includes("キキンター"));
  assert.throws(() => buildRe({ ...base, kanaName: "キキン―" }), /全角カタカナのみ/);
  assert.throws(() => buildRe({ ...base, kanaName: "ききん" }), /全角カタカナのみ/);
});

test("検証: 引用符・カンマ入りフィールドは直列化で拒否（仕様: 引用符は使用しない）", () => {
  assert.throws(() => serializeRecord({ identifier: "CO", fields: ['a"b'] }), /forbidden character/);
  assert.throws(() => serializeRecord({ identifier: "CO", fields: ["a,b"] }), /forbidden character/);
});

// ---- ファイル組み立て ----

function sampleReceipt(): UkeReceipt {
  return {
    re: buildRe({
      receiptNo: 1,
      receiptType: "3116", // 医保単独・家族・入院外
      treatmentMonth: "202406",
      name: "基金　花子",
      sex: "2",
      birthDate: "19800630",
      treatmentStartDate: "20240605",
      outcome: "1",
      kanaName: "キキンハナコ",
    }),
    ho: buildHo({ insurerNo: "01130012", symbol: "11010203", number: "123", actualDays: 1, totalPoints: 833 }),
    hs: [buildHs({ teeth: [fdiToShikiCode("16")], diseaseCode: "8830052" })],
    details: [
      buildSs({ category: "11", burden: "1", code: "301000110", points: 272, count: 1, daily: { 5: 1 } }),
      buildCo({ burden: "1", code: "820000000", teeth: [fdiToShikiCode("16")] }),
    ],
  };
}

test("ファイル組み立て: UK → [IR RE HO HS SS CO] → GO の順・GO合計の自動算出", () => {
  const records = assembleUkeFile({
    facility: {
      payer: "1",
      prefecture: "13",
      facilityCode: "1234567",
      facilityName: "基金歯科病院",
      billingMonth: "202407",
      phone: "03-1234-5678",
    },
    receipts: [sampleReceipt()],
  });
  assert.deepEqual(
    records.map((r) => r.identifier),
    ["UK", "IR", "RE", "HO", "HS", "SS", "CO", "GO"],
  );
  const go = serializeRecord(records[records.length - 1]!);
  assert.equal(go, "GO,1,833,99"); // 医保単独1件・HOの合計点数
});

test("GO合計: 医保＋1種公費併用は件数2・点数は主保険分のみ（仕様 p27 注）", () => {
  const receipt = sampleReceipt();
  receipt.ko = [buildKo({ payerNo: "19136019", recipientNo: "0001234", actualDays: 1, totalPoints: 833 })];
  const totals = calculateGoTotals([receipt]);
  assert.deepEqual(totals, { totalCount: 2, totalPoints: 833 });
});

test("ファイル組み立て: HS なし・SS等なし・HO/KO両方なしは拒否", () => {
  const facility = {
    payer: "1",
    prefecture: "13",
    facilityCode: "1234567",
    facilityName: "基金歯科病院",
    billingMonth: "202407",
  };
  const ok = sampleReceipt();
  assert.throws(
    () => assembleUkeFile({ facility, receipts: [{ ...ok, hs: [] }] }),
    /HS.*1以上必須/,
  );
  assert.throws(
    () => assembleUkeFile({ facility, receipts: [{ ...ok, details: [buildCo({ burden: "1", code: "820000000" })] }] }),
    /SS\/SI\/IY\/TO のいずれか1レコード以上/,
  );
  const noHo: UkeReceipt = { re: ok.re, hs: ok.hs, details: ok.details };
  assert.throws(() => assembleUkeFile({ facility, receipts: [noHo] }), /HO.*KO.*いずれか/);
});

test("物理仕様: Shift_JIS・CR+LF・末尾EOF(0x1A)・引用符なし", () => {
  const records = assembleUkeFile({
    facility: {
      payer: "1",
      prefecture: "13",
      facilityCode: "1234567",
      facilityName: "基金歯科病院",
      billingMonth: "202407",
    },
    receipts: [sampleReceipt()],
  });
  const bytes = encodeUkeFile(records);
  // 末尾は CR LF EOF
  assert.deepEqual([...bytes.slice(-3)], [0x0d, 0x0a, 0x1a]);
  // Shift_JIS として元のテキストに戻る（EOF を除く）
  const decoded = new TextDecoder("shift_jis").decode(bytes.slice(0, -1));
  assert.ok(decoded.startsWith("UK,1,13,3,1234567,,基金歯科病院,202407,,00\r\n"));
  assert.ok(decoded.endsWith("GO,1,833,99\r\n"));
  assert.ok(!decoded.includes('"'));
});
