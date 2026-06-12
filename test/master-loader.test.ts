import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  buildMasterFromRows,
  decodeSjis,
  normalizeDate,
  parseCsvLine,
  parseDentalProcedureMaster,
  parseToothCodeMaster,
} from "../src/billing/master-loader.js";
import { fdiToShikiCode, SHIKI_WHOLE_MOUTH } from "../src/domain/tooth-code.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const loadSjis = (rel: string) => decodeSjis(new Uint8Array(readFileSync(join(ROOT, rel))));

const hText = loadSjis("data/masters/h_ALL20260611.csv");
const fText = loadSjis("data/masters/f_20260306.csv");

test("CSV行パース（クォート・カンマ）", () => {
  assert.deepEqual(parseCsvLine('"a","b,c","d""e"'), ["a", "b,c", 'd"e']);
});

test("日付正規化（無期限値の揺れを吸収）", () => {
  assert.equal(normalizeDate("20260601"), "2026-06-01");
  assert.equal(normalizeDate("99999999"), undefined);
  assert.equal(normalizeDate("0"), undefined);
  assert.equal(normalizeDate("00000000"), undefined);
});

test("実マスタ: 歯科診療行為 3,000行超を取込める", () => {
  const rows = parseDentalProcedureMaster(hText);
  assert.ok(rows.length > 3000, `rows=${rows.length}`);
});

test("実マスタ: 歯科初診料272点・再診料59点（令和8年度改定値）が引ける", () => {
  const master = buildMasterFromRows(parseDentalProcedureMaster(hText));
  const shoshin = master.findProcedure("301000110", "2026-06-12");
  assert.equal(shoshin?.points, 272);
  assert.match(shoshin?.name ?? "", /初診料/);
  const saishin = master.findProcedure("301001610", "2026-06-12");
  assert.equal(saishin?.points, 59);
});

test("FDI→歯式コード変換が実マスタ（歯式マスター）と一致する", () => {
  const byCode = new Map(parseToothCodeMaster(fText).map((r) => [r.code, r.name]));
  const expects: [string, RegExp][] = [
    [fdiToShikiCode("11"), /右側上顎中切歯現存歯/],
    [fdiToShikiCode("26"), /左側上顎第１大臼歯現存歯/],
    [fdiToShikiCode("48"), /右側下顎第３大臼歯現存歯/],
    [fdiToShikiCode("55"), /右側上顎第２乳臼歯現存歯/],
    [fdiToShikiCode("81"), /右側下顎乳中切歯現存歯/],
    [fdiToShikiCode("46", "missing"), /右側下顎第１大臼歯欠損歯/],
    [fdiToShikiCode("45", "abutment"), /右側下顎第２小臼歯支台歯/],
    [SHIKI_WHOLE_MOUTH, /口腔全体現存歯/],
  ];
  for (const [code, pattern] of expects) {
    const name = byCode.get(code);
    assert.ok(name, `code ${code} not found in f master`);
    assert.match(name, pattern, `code ${code} = ${name}`);
  }
});
