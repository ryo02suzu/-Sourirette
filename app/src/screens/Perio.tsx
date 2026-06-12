/**
 * 歯周検査（P検）画面。4点法のフルマウス入力。
 * 集計・病態評価はコアの src/domain/perio.ts を実行する。
 * 「音声入力」はハンズフリーP検（読み上げ→自動入力）の UX デモ（モック）。
 */
import { useMemo, useRef, useState } from "react";
import { assess, severityOf, summarize, type ToothPerioRecord } from "../../../src/domain/perio.js";
import { parseTooth, toJapaneseNotation } from "../../../src/domain/tooth.js";
import { activePatientTeeth, perioVoiceScript, type PerioToothInput } from "../data/mock.js";

const UPPER = ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"];
const LOWER = ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"];
const SITE_LABELS = ["頬近", "頬遠", "舌近", "舌遠"];

const emptyTooth = (): PerioToothInput => ({ pd: [null, null, null, null], bop: [false, false, false, false], mobility: 0 });

function initialData(): Record<string, PerioToothInput> {
  const data: Record<string, PerioToothInput> = {};
  for (const fdi of [...UPPER, ...LOWER]) data[fdi] = emptyTooth();
  return data;
}

export function PerioScreen({ onTransfer }: { onTransfer(text: string): void }) {
  const [data, setData] = useState<Record<string, PerioToothInput>>(initialData);
  const [voiceState, setVoiceState] = useState<"idle" | "running" | "done">("idle");
  const [voiceCaption, setVoiceCaption] = useState("");
  const [transferred, setTransferred] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isMissing = (fdi: string) => activePatientTeeth[fdi] === "missing";

  const records: ToothPerioRecord[] = useMemo(
    () =>
      Object.entries(data)
        .filter(([fdi, t]) => !isMissing(fdi) && t.pd.some((v) => v != null && v > 0))
        .map(([fdi, t]) => ({
          fdi,
          pd: t.pd.map((v) => v ?? 0),
          bop: t.bop,
          mobility: t.mobility,
        })),
    [data],
  );

  const summary = useMemo(() => summarize(records), [records]);
  const assessment = useMemo(() => assess(summary), [summary]);
  const severityMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of records) m.set(r.fdi, severityOf(r));
    return m;
  }, [records]);

  const setPd = (fdi: string, site: number, value: string, target?: HTMLInputElement) => {
    const n = value === "" ? null : Math.max(0, Math.min(12, Number(value)));
    setData((prev) => {
      const tooth = prev[fdi] ?? emptyTooth();
      const pd = [...tooth.pd];
      pd[site] = Number.isNaN(n as number) ? null : n;
      return { ...prev, [fdi]: { ...tooth, pd } };
    });
    // 入力したら次のセルへ自動フォーカス（プロービングのリズムを止めない）
    if (target && value !== "" && !Number.isNaN(n as number)) {
      const grid = target.closest(".card-body");
      if (grid) {
        const inputs = [...grid.querySelectorAll<HTMLInputElement>(".perio-cell input")];
        const next = inputs[inputs.indexOf(target) + 1];
        next?.focus();
        next?.select();
      }
    }
  };

  const toggleBop = (fdi: string, site: number) => {
    setData((prev) => {
      const tooth = prev[fdi] ?? emptyTooth();
      const bop = [...tooth.bop];
      bop[site] = !bop[site];
      return { ...prev, [fdi]: { ...tooth, bop } };
    });
  };

  /** 音声入力デモ: スクリプトを1歯ずつ読み上げ風に自動入力 */
  const runVoiceDemo = () => {
    if (voiceState === "running") return;
    setVoiceState("running");
    const entries = Object.entries(perioVoiceScript);
    let i = 0;
    timerRef.current = setInterval(() => {
      const entry = entries[i];
      if (!entry) {
        if (timerRef.current) clearInterval(timerRef.current);
        setVoiceCaption("検査完了。お疲れさまでした");
        setVoiceState("done");
        return;
      }
      const [fdi, v] = entry;
      const label = toJapaneseNotation(parseTooth(fdi));
      setVoiceCaption(
        `「${label}、${v.pd.join("・")}${v.bop.some(Boolean) ? "、BOPプラス" : ""}」`,
      );
      setData((prev) => ({ ...prev, [fdi]: { pd: [...v.pd], bop: [...v.bop], mobility: prev[fdi]?.mobility ?? 0 } }));
      i += 1;
    }, 900);
  };

  const renderArch = (fdis: string[], title: string) => (
    <div className="perio-arch">
      <div className="perio-arch-title">{title}</div>
      <div className="perio-grid" style={{ gridTemplateColumns: `52px repeat(16, 1fr)` }}>
        <div className="perio-corner" />
        {fdis.map((fdi) => {
          const sev = severityMap.get(fdi);
          return (
            <div key={fdi} className={`perio-th sev-${sev ?? "none"} ${isMissing(fdi) ? "missing" : ""}`}>
              {parseTooth(fdi).position}
            </div>
          );
        })}
        {SITE_LABELS.map((label, site) => (
          <PerioRow
            key={label}
            label={label}
            site={site}
            fdis={fdis}
            data={data}
            isMissing={isMissing}
            setPd={setPd}
            toggleBop={toggleBop}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <div className="patient-banner">
        <div className="avatar">田中</div>
        <div>
          <div className="pname">田中 花子 <span className="muted" style={{ fontWeight: 500 }}>タナカ ハナコ</span></div>
          <div className="meta">45歳 女性 ・ カルテ番号 000482 ・ 傷病名: 歯周炎 ・ 4点法デモ</div>
        </div>
        <div className="alerts">
          <button
            type="button"
            className={`btn ${voiceState === "running" ? "" : "ai"}`}
            onClick={runVoiceDemo}
            disabled={voiceState === "running"}
          >
            {voiceState === "running" ? "🎙 認識中…" : "🎙 音声入力（ハンズフリーP検）"}
          </button>
        </div>
      </div>

      {voiceCaption && (
        <div className={`voice-caption ${voiceState === "running" ? "live" : ""}`}>
          <span className="ai-mark">✦</span> {voiceState === "running" ? "音声認識:" : ""} {voiceCaption}
        </div>
      )}

      <div className="clinical" style={{ gridTemplateColumns: "minmax(620px, 8fr) minmax(300px, 3fr)" }}>
        <div className="card">
          <div className="card-head">
            <h2>プロービングチャート（PD mm ・ クリックでBOP切替）</h2>
            <span className="tiny" style={{ marginLeft: "auto" }}>数値セルを赤丸クリック=BOP(+)</span>
          </div>
          <div className="card-body" style={{ overflowX: "auto" }}>
            {renderArch(UPPER, "上顎")}
            {renderArch(LOWER, "下顎")}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card-head"><h2>集計（コアエンジン実行）</h2></div>
            <div className="card-body">
              <div className="pay-row"><span>検査部位数</span><span className="v">{summary.sites}</span></div>
              <div className="pay-row"><span>平均PD</span><span className="v">{summary.meanPd} mm</span></div>
              <div className="pay-row"><span>最大PD</span><span className="v">{summary.maxPd} mm</span></div>
              <div className="pay-row"><span>BOP率</span><span className="v">{Math.round(summary.bopRate * 100)}%</span></div>
              <div className="pay-row"><span>4mm以上</span><span className="v" style={{ color: "var(--warn)" }}>{summary.sites4mm} 部位</span></div>
              <div className="pay-row"><span>6mm以上</span><span className="v" style={{ color: "var(--error)" }}>{summary.sites6mm} 部位</span></div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>評価・処置提案</h2><span className="chip" style={{ marginLeft: "auto" }}>⚠ デモ判定</span></div>
            <div className="card-body">
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{assessment.label}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {assessment.suggestions.map((s) => <span className="chip brand" key={s}>{s}</span>)}
              </div>
              <button
                type="button"
                className="btn primary"
                style={{ width: "100%", marginTop: 14 }}
                disabled={summary.sites === 0 || transferred}
                onClick={() => {
                  setTransferred(true);
                  onTransfer(
                    `平均PD ${summary.meanPd}mm / 最大 ${summary.maxPd}mm / BOP ${Math.round(summary.bopRate * 100)}% / ` +
                    `4mm以上 ${summary.sites4mm}部位・6mm以上 ${summary.sites6mm}部位（${summary.sites}部位計測）。${assessment.label}。`,
                  );
                }}
              >
                {transferred ? "✓ カルテへ転記済み" : "検査結果をカルテへ転記"}
              </button>
              <div className="tiny" style={{ marginTop: 8 }}>
                正式な病態区分・算定条件（歯周基本/精密検査、SPT移行）は公式マスタ取込後に実装。
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PerioRow({
  label, site, fdis, data, isMissing, setPd, toggleBop,
}: {
  label: string;
  site: number;
  fdis: string[];
  data: Record<string, PerioToothInput>;
  isMissing(fdi: string): boolean;
  setPd(fdi: string, site: number, value: string, target?: HTMLInputElement): void;
  toggleBop(fdi: string, site: number): void;
}) {
  return (
    <>
      <div className="perio-rowlabel">{label}</div>
      {fdis.map((fdi) => {
        const tooth = data[fdi];
        const pd = tooth?.pd[site];
        const bop = tooth?.bop[site] ?? false;
        if (isMissing(fdi)) return <div key={fdi} className="perio-cell missing">—</div>;
        return (
          <div key={fdi} className={`perio-cell ${bop ? "bop" : ""} ${pd != null && pd >= 6 ? "deep" : pd != null && pd >= 4 ? "mid" : ""}`}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={pd ?? ""}
              onChange={(e) => setPd(fdi, site, e.target.value, e.target)}
              aria-label={`${fdi} ${label} PD`}
            />
            <button type="button" className="bop-dot" title="BOP切替" onClick={() => toggleBop(fdi, site)} />
          </div>
        );
      })}
    </>
  );
}
