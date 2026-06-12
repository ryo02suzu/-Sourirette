/**
 * 訪問診療: 訪問先管理＋医療保険・介護保険の同時算定シミュレータ。
 * 職制・場所・人数・時間の条件から両保険の算定を同時に組み立てる（点数・単位はサンプル値）。
 */
import { useMemo, useState } from "react";
import { useToast } from "../components/toast.js";

const FACILITIES = [
  { name: "特養 さくら苑", kind: "施設", patients: 12, next: "6/13（土）13:30", manager: "ケアマネ: 井上" },
  { name: "グループホームひだまり", kind: "施設", patients: 5, next: "6/20（土）14:00", manager: "ケアマネ: 森" },
  { name: "山本 久子 宅", kind: "居宅", patients: 1, next: "6/27（土）10:00", manager: "ケアマネ: 井上" },
];

/** サンプル算定表（実装時は公式マスタ・介護給付費単位数表から取得） */
const VISIT_FEE = { single: 1100, small: 410, large: 310 }; // 歯科訪問診療料 1/2/3 相当（点）
const KAIGO_FEE = { dentist: { single: 517, multi: 487 }, hygienist: { single: 362, multi: 326 } }; // 居宅療養管理指導（単位）

export function HomeVisitScreen() {
  const toast = useToast();
  const [role, setRole] = useState<"dentist" | "hygienist">("dentist");
  const [place, setPlace] = useState<"facility" | "home">("facility");
  const [headcount, setHeadcount] = useState<"1" | "2-9" | "10+">("2-9");
  const [over20min, setOver20min] = useState(true);
  const [reportDraft, setReportDraft] = useState(false);

  const calc = useMemo(() => {
    const medical =
      headcount === "1" ? { name: "歯科訪問診療料1（同一建物1人）", points: VISIT_FEE.single }
      : headcount === "2-9" ? { name: "歯科訪問診療料2（同一建物2〜9人）", points: VISIT_FEE.small }
      : { name: "歯科訪問診療料3（同一建物10人以上）", points: VISIT_FEE.large };
    const k = KAIGO_FEE[role][headcount === "1" ? "single" : "multi"];
    const kaigo = {
      name: `居宅療養管理指導費（${role === "dentist" ? "歯科医師" : "歯科衛生士"}・${headcount === "1" ? "単一" : "複数"}建物）`,
      units: k,
    };
    const warnings: string[] = [];
    if (!over20min && headcount === "1") warnings.push("診療時間20分未満の場合、歯科訪問診療料1は算定できません（減算規定）");
    if (place === "home" && headcount !== "1") warnings.push("居宅で複数人の条件が選択されています — 場所と人数の組み合わせを確認してください");
    return { medical, kaigo, warnings };
  }, [role, place, headcount, over20min]);

  return (
    <div>
      <div className="stat-row">
        <div className="stat"><div className="label">今月の訪問</div><div className="value">9<small>件</small></div></div>
        <div className="stat"><div className="label">訪問患者数</div><div className="value">18<small>名</small></div></div>
        <div className="stat"><div className="label">介護保険請求（当月）</div><div className="value">86,420<small>円</small></div></div>
        <div className="stat"><div className="label">算定漏れ警告</div><div className="value" style={{ color: "var(--warn)" }}>1<small>件</small></div></div>
      </div>

      <div className="clinical" style={{ gridTemplateColumns: "minmax(360px, 4fr) minmax(420px, 5fr)" }}>
        <div className="card">
          <div className="card-head"><h2>訪問先</h2><button type="button" className="btn sm" style={{ marginLeft: "auto" }}>＋ 追加</button></div>
          <div className="card-body" style={{ paddingTop: 8 }}>
            {FACILITIES.map((f) => (
              <div key={f.name} style={{ borderBottom: "1px solid var(--line)", padding: "11px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong style={{ fontSize: 13.5 }}>{f.name}</strong>
                  <span className="chip">{f.kind}</span>
                  <span className="chip brand">{f.patients}名</span>
                  <button type="button" className="btn sm" style={{ marginLeft: "auto" }}>訪問カルテ</button>
                </div>
                <div className="tiny">次回: {f.next} ・ {f.manager}</div>
              </div>
            ))}
            <div className="issue warning" style={{ marginTop: 12 }}>
              <span className="badge">警告</span>
              <span>さくら苑 5/30 訪問分: 歯科衛生士の居宅療養管理指導が未請求の可能性（推定 +3,260円/月）</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>同時算定シミュレータ（医療保険 × 介護保険）</h2>
            <span className="chip" style={{ marginLeft: "auto" }}>⚠ サンプル値</span>
          </div>
          <div className="card-body">
            <div className="form-row">
              <label>職制</label>
              <div className="seg">
                <button type="button" className={role === "dentist" ? "on" : ""} onClick={() => setRole("dentist")}>歯科医師</button>
                <button type="button" className={role === "hygienist" ? "on" : ""} onClick={() => setRole("hygienist")}>歯科衛生士</button>
              </div>
            </div>
            <div className="form-row">
              <label>場所</label>
              <div className="seg">
                <button type="button" className={place === "facility" ? "on" : ""} onClick={() => setPlace("facility")}>施設</button>
                <button type="button" className={place === "home" ? "on" : ""} onClick={() => setPlace("home")}>居宅</button>
              </div>
            </div>
            <div className="form-row">
              <label>同一建物の診療人数</label>
              <div className="seg">
                {(["1", "2-9", "10+"] as const).map((h) => (
                  <button type="button" key={h} className={headcount === h ? "on" : ""} onClick={() => setHeadcount(h)}>{h === "1" ? "1人" : h === "2-9" ? "2〜9人" : "10人以上"}</button>
                ))}
              </div>
            </div>
            <div className="form-row">
              <label>診療時間20分以上</label>
              <div className="seg">
                <button type="button" className={over20min ? "on" : ""} onClick={() => setOver20min(true)}>はい</button>
                <button type="button" className={!over20min ? "on" : ""} onClick={() => setOver20min(false)}>いいえ</button>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 12 }}>
              <div className="pay-row"><span>🏥 医療保険: {calc.medical.name}</span><span className="v">{calc.medical.points} 点</span></div>
              <div className="pay-row"><span>🤝 介護保険: {calc.kaigo.name}</span><span className="v">{calc.kaigo.units} 単位</span></div>
              {calc.warnings.map((w) => (
                <div className="issue warning" key={w}><span className="badge">警告</span><span>{w}</span></div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button type="button" className="btn primary" style={{ flex: 1 }} onClick={() => toast("訪問カルテに算定をセットしました（医療・介護同時）")}>
                この条件で算定をセット
              </button>
              <button type="button" className="btn ghost-ai" onClick={() => setReportDraft(!reportDraft)}>✦ ケアマネ報告書</button>
            </div>
            {reportDraft && (
              <div className="ai-draft-box" style={{ padding: "12px 14px", marginTop: 10, fontSize: 12.5 }}>
                <div className="ai-note" style={{ marginBottom: 6 }}>✦ 居宅療養管理指導情報提供書の下書き（訪問カルテから生成）</div>
                山本久子様（74歳）。口腔内状態: 上顎義歯の適合不良による咀嚼困難を認め、義歯調整を実施。
                口腔衛生状態は概ね良好だが、自立した義歯清掃が困難になりつつあり、介助者による就寝前の義歯洗浄の声かけをお願いしたい。
                次回訪問は2週間後を予定。誤嚥性肺炎予防の観点から、食前の口腔体操の継続を推奨します。
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn sm primary" onClick={() => { setReportDraft(false); toast("ケアマネジャーへの情報提供書を発行し、診療録に記録しました"); }}>確認して発行</button>
                  <button type="button" className="btn sm">編集</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
