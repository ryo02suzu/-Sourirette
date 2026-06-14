/**
 * 医院プロファイル（都道府県・届出施設基準）のテスト。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FACILITY_STANDARDS,
  PREFECTURES,
  prefectureName,
  profileToFacilityStandards,
  validateClinicProfile,
  type ClinicProfile,
} from "../src/billing/clinic.js";
import { CalculationEngine, type Rule } from "../src/billing/engine.js";
import { InMemoryMaster } from "../src/billing/master.js";

test("都道府県: 別表2 全47件・コードと名称が引ける", () => {
  assert.equal(PREFECTURES.length, 47);
  assert.equal(prefectureName("13"), "東京");
  assert.equal(prefectureName("01"), "北海道");
  assert.equal(prefectureName("47"), "沖縄");
  assert.equal(prefectureName("99"), undefined);
});

test("プロファイル検証: 未知の都道府県・施設基準コードを弾く", () => {
  const ok: ClinicProfile = {
    prefectureCode: "13",
    facilityCode: "1234567",
    facilityName: "テスト歯科",
    notifiedStandards: ["17"],
  };
  assert.deepEqual(validateClinicProfile(ok), []);

  const ng: ClinicProfile = {
    prefectureCode: "99",
    facilityCode: "123",
    facilityName: "テスト歯科",
    notifiedStandards: ["ZZ"],
  };
  const errors = validateClinicProfile(ng);
  assert.ok(errors.some((e) => e.includes("都道府県")));
  assert.ok(errors.some((e) => e.includes("医療機関コード")));
  assert.ok(errors.some((e) => e.includes("施設基準")));
});

test("施設基準カタログ: 別表5で確定済みの2件を収録（残りは要追加）", () => {
  const codes = FACILITY_STANDARDS.map((s) => s.code);
  assert.ok(codes.includes("01")); // 補管
  assert.ok(codes.includes("17")); // 歯初診
  assert.ok(FACILITY_STANDARDS.every((s) => s.verified));
});

test("設定→エンジン反映: 届出を選ぶと該当加算が算定可能になる", () => {
  // 届出（17 歯初診）があるときだけ加算する最小ルール
  const ADDON = "DEMO-ADDON";
  const rule: Rule = {
    id: "facility-addon/test",
    validFrom: "2024-01-01",
    evaluate(ctx) {
      if (!ctx.facility.has("17", ctx.visit.visitDate)) return {};
      const row = ctx.master.findProcedure(ADDON, ctx.visit.visitDate);
      if (!row) return {};
      return { lines: [{ procedureCode: ADDON, name: row.name, points: row.points, quantity: 1 }] };
    },
  };
  const master = new InMemoryMaster();
  master.add({ code: ADDON, name: "歯科外来診療医療安全対策加算（デモ）", points: 12, validFrom: "2024-01-01" });
  const engine = new CalculationEngine([rule]);

  const base = {
    patient: { id: "p", birthDate: "1980-01-01", sex: "F" as const },
    visit: { id: "v", patientId: "p", visitDate: "2026-06-12", visitType: "first" as const },
    procedures: [],
    diagnoses: [],
    history: { countInMonth: () => 0 },
    master,
  };

  // 届出なし → 加算されない
  const without = engine.calculate({
    ...base,
    facility: profileToFacilityStandards({ prefectureCode: "13", facilityCode: "1234567", facilityName: "テスト歯科", notifiedStandards: [] }),
  });
  assert.equal(without.lines.length, 0);

  // 届出あり（17）→ 加算される
  const withStd = engine.calculate({
    ...base,
    facility: profileToFacilityStandards({ prefectureCode: "13", facilityCode: "1234567", facilityName: "テスト歯科", notifiedStandards: ["17"] }),
  });
  assert.equal(withStd.lines.length, 1);
  assert.equal(withStd.totalPoints, 12);
});
