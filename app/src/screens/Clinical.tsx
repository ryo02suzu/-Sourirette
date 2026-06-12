/**
 * 診療画面（チェアサイドの中心画面）。
 * 左: 歯式・傷病名 / 中央: SOAPカルテ / 右: AIパネル＋算定プレビュー。
 * 算定プレビューはコアの CalculationEngine（src/billing）をそのまま実行している。
 */
import { useMemo, useState } from "react";
import { ToothChart } from "../components/ToothChart.js";
import { AiPanel } from "../components/AiPanel.js";
import { activeBridges, activePatientDx, activePatientTeeth, type DxItem, type ToothState } from "../data/mock.js";
import { calculateDemo, DEMO_CODES } from "../billing-demo.js";
import type { AiDraftResult } from "../services/ai.js";
import { parseTooth, toJapaneseNotation } from "../../../src/domain/tooth.js";
import type { PerformedProcedure } from "../../../src/domain/types.js";

const TODAY = "2026-06-12";

interface ProcItem extends PerformedProcedure {
  name: string;
  fromAi?: boolean;
}

type SoapKey = "S" | "O" | "A" | "P";
const SOAP_LABELS: Record<SoapKey, string> = {
  S: "主訴・問診",
  O: "口腔内所見・検査",
  A: "評価",
  P: "治療計画・処置",
};

const STATUS_BUTTONS: { state: ToothState; label: string }[] = [
  { state: "healthy", label: "健全" },
  { state: "caries", label: "う蝕 C" },
  { state: "cr", label: "CR充填" },
  { state: "crown", label: "クラウン" },
  { state: "missing", label: "欠損" },
  { state: "implant", label: "インプラント" },
];

export function ClinicalScreen() {
  const [selectedTeeth, setSelectedTeeth] = useState<string[]>([]);
  const [teethState, setTeethState] = useState<Record<string, ToothState>>(activePatientTeeth);
  const [dxList, setDxList] = useState<DxItem[]>(activePatientDx);
  const [soap, setSoap] = useState<Record<SoapKey, string>>({ S: "", O: "", A: "", P: "" });
  const [aiDraftFields, setAiDraftFields] = useState<Set<SoapKey>>(new Set());
  const [procedures, setProcedures] = useState<ProcItem[]>([
    { procedureCode: DEMO_CODES.firstVisit, name: "初診料", quantity: 1 },
  ]);
  const [finalized, setFinalized] = useState(false);
  const [hash, setHash] = useState<string | null>(null);

  const toggleTooth = (fdi: string) =>
    setSelectedTeeth((prev) => (prev.includes(fdi) ? prev.filter((t) => t !== fdi) : [...prev, fdi]));

  const applyToothStatus = (state: ToothState) => {
    setTeethState((prev) => {
      const next = { ...prev };
      for (const fdi of selectedTeeth) {
        if (state === "healthy") delete next[fdi];
        else next[fdi] = state;
      }
      return next;
    });
    setSelectedTeeth([]);
  };

  const applySoap = (result: AiDraftResult) => {
    if (finalized) return;
    setSoap(result.soap);
    setAiDraftFields(new Set<SoapKey>(["S", "O", "A", "P"]));
  };

  const editSoap = (key: SoapKey, value: string) => {
    setSoap((prev) => ({ ...prev, [key]: value }));
    setAiDraftFields((prev) => {
      const next = new Set(prev);
      next.delete(key); // 人が触ったフィールドは「下書き」表示を解除
      return next;
    });
  };

  const acceptProcedure = (code: string, name: string, teeth: string[]) => {
    if (finalized) return;
    setProcedures((prev) =>
      prev.some((p) => p.procedureCode === code)
        ? prev
        : [...prev, { procedureCode: code, name, teeth, quantity: 1, fromAi: true }],
    );
  };

  const acceptDx = (name: string, teeth: string[]) => {
    if (finalized) return;
    setDxList((prev) =>
      prev.some((d) => d.name === name) ? prev : [...prev, { name, teeth, since: TODAY, aiSuggested: true }],
    );
  };

  const removeProcedure = (code: string) =>
    setProcedures((prev) => prev.filter((p) => p.procedureCode !== code));

  const calc = useMemo(
    () =>
      calculateDemo({
        visitType: "first",
        visitDate: TODAY,
        procedures,
        diagnoses: dxList.map((d) => ({ diseaseCode: d.name, teeth: d.teeth, onsetDate: d.since })),
      }),
    [procedures, dxList],
  );

  const hasError = calc.issues.some((i) => i.severity === "error");
  const burden = Math.round((calc.totalPoints * 10 * 0.3) / 10) * 10; // 3割負担・10円単位（デモ）

  const finalize = async () => {
    const payload = JSON.stringify(soap);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    setHash(hex.slice(0, 16));
    setFinalized(true);
    setAiDraftFields(new Set());
  };

  return (
    <div>
      <div className="patient-banner">
        <div className="avatar">田中</div>
        <div>
          <div className="pname">田中 花子 <span className="muted" style={{ fontWeight: 500 }}>タナカ ハナコ</span></div>
          <div className="meta">45歳 女性 ・ カルテ番号 000482 ・ 社保 家族（3割） ・ 初診</div>
        </div>
        <div className="alerts">
          <span className="chip ok">オン資 確認済</span>
          <span className="chip warn">ペニシリン系アレルギー</span>
          <span className="chip">高血圧（服薬中）</span>
        </div>
      </div>

      <div className="clinical">
        {/* 左カラム: 歯式・傷病名 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h2>歯式</h2>
              <span className="tiny" style={{ marginLeft: "auto" }}>
                {selectedTeeth.length > 0
                  ? `${selectedTeeth.length}歯 選択中 — 下のボタンで状態を設定`
                  : "歯をタップして選択（複数可）"}
              </span>
            </div>
            <div className="card-body">
              <ToothChart states={teethState} bridges={activeBridges} selected={selectedTeeth} onToggle={toggleTooth} />
              <div className="status-toolbar">
                {STATUS_BUTTONS.map((b) => (
                  <button
                    type="button"
                    key={b.state}
                    className={`btn sm tstat-${b.state}`}
                    disabled={selectedTeeth.length === 0 || finalized}
                    onClick={() => applyToothStatus(b.state)}
                  >
                    {b.label}
                  </button>
                ))}
                {selectedTeeth.length > 0 && (
                  <button type="button" className="btn sm" onClick={() => setSelectedTeeth([])}>選択解除</button>
                )}
              </div>
              <div className="selected-teeth">
                {selectedTeeth.map((fdi) => (
                  <span key={fdi} className="chip brand">{toJapaneseNotation(parseTooth(fdi))}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>傷病名</h2>
              <button type="button" className="btn sm" style={{ marginLeft: "auto" }}>＋ 追加</button>
            </div>
            <div className="card-body">
              <div className="dx-list">
                {dxList.map((d) => (
                  <div className={`dx-item ${d.aiSuggested ? "ai-suggested" : ""}`} key={d.name}>
                    <span className="dx-teeth">
                      {d.teeth.length > 0 ? d.teeth.map((t) => toJapaneseNotation(parseTooth(t))).join("・") : "全体"}
                    </span>
                    <span className="dx-name">{d.aiSuggested && <span className="ai-mark">✦ </span>}{d.name}</span>
                    <span className="dx-date">{d.since}〜</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 中央カラム: SOAPカルテ */}
        <div className="card">
          <div className="card-head">
            <h2>カルテ記録（SOAP）</h2>
            {finalized ? (
              <span className="chip ok" style={{ marginLeft: "auto" }}>✓ 確定済み</span>
            ) : aiDraftFields.size > 0 ? (
              <span className="chip ai" style={{ marginLeft: "auto" }}>✦ AI下書きあり — 要確認</span>
            ) : (
              <span className="chip" style={{ marginLeft: "auto" }}>下書き</span>
            )}
          </div>
          <div className="card-body">
            {(Object.keys(SOAP_LABELS) as SoapKey[]).map((key) => (
              <div className="soap-field" key={key}>
                <div className="soap-label">
                  <span className={`soap-key ${key.toLowerCase()}`}>{key}</span>
                  {SOAP_LABELS[key]}
                  {aiDraftFields.has(key) && <span className="ai-note">✦ AI下書き — 編集すると確定表示に</span>}
                </div>
                <textarea
                  value={soap[key]}
                  disabled={finalized}
                  className={aiDraftFields.has(key) ? "ai-draft" : ""}
                  placeholder={`${SOAP_LABELS[key]}を入力、または右の ✦ AIアシスタントから下書きを反映`}
                  onChange={(e) => editSoap(key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="finalize-bar">
            {finalized ? (
              <>
                <span className="muted">確定者: 鈴木 智也（歯科医師）・ {TODAY} 14:32</span>
                <span className="hash-chip" title="真正性: 記録のSHA-256ハッシュ（チェーン連結）">⛓ {hash}…</span>
              </>
            ) : (
              <>
                <span className="tiny" style={{ flex: 1 }}>
                  確定後は変更不可（訂正は新版の追記）。エラーがある場合は確定できません。
                </span>
                <button
                  type="button"
                  className="btn primary"
                  disabled={hasError || soap.S === ""}
                  title={hasError ? "算定エラーを解消してください" : ""}
                  onClick={finalize}
                >
                  カルテを確定する
                </button>
              </>
            )}
          </div>
        </div>

        {/* 右カラム: AI ＋ 算定 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <AiPanel
            onApplySoap={applySoap}
            onAcceptProcedure={acceptProcedure}
            onAcceptDx={acceptDx}
            acceptedProcedures={procedures.map((p) => p.procedureCode)}
            acceptedDx={dxList.map((d) => d.name)}
          />

          <div className="card">
            <div className="card-head">
              <h2>算定プレビュー</h2>
              <span className="chip" style={{ marginLeft: "auto" }} title="点数はサンプル値。公式マスタ取込後に実点数になります">
                ⚠ サンプル点数
              </span>
            </div>
            <div className="card-body" style={{ paddingTop: 8 }}>
              <table className="claim-table">
                <thead>
                  <tr><th>診療行為</th><th>部位</th><th style={{ textAlign: "right" }}>点数</th><th /></tr>
                </thead>
                <tbody>
                  {calc.lines.map((l) => (
                    <tr key={l.procedureCode}>
                      <td>{procedures.find((p) => p.procedureCode === l.procedureCode)?.fromAi && <span className="ai-mark">✦ </span>}{l.name}</td>
                      <td className="tiny">{l.teeth?.map((t) => toJapaneseNotation(parseTooth(t))).join("・") ?? "—"}</td>
                      <td className="num">{l.points * l.quantity}</td>
                      <td style={{ width: 28 }}>
                        {l.procedureCode !== DEMO_CODES.firstVisit && !finalized && (
                          <button type="button" className="btn sm danger-ghost" onClick={() => removeProcedure(l.procedureCode)} aria-label="削除">×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="claim-total">
                <span>合計 <span className="tiny">／ 窓口負担（3割）約 {burden.toLocaleString()}円</span></span>
                <span className="points">{calc.totalPoints}<small style={{ fontSize: 13 }}> 点</small></span>
              </div>
              {calc.issues.map((issue, i) => (
                <div className={`issue ${issue.severity}`} key={i}>
                  <span className="badge">{issue.severity === "error" ? "エラー" : "警告"}</span>
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
