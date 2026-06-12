/**
 * AI アシスタントパネル。
 * 録音 → 文字起こし → SOAP下書き → 処置・病名候補の提示。
 * 出力はすべて「下書き」スタイル（薄紫・点線）で表示し、反映は明示的な操作で行う。
 */
import { useEffect, useRef, useState } from "react";
import { MockAiService, type AiDraftResult } from "../services/ai.js";
import { parseTooth, toJapaneseNotation } from "../../../src/domain/tooth.js";

type Stage = "idle" | "recording" | "transcribing" | "drafting" | "review";

interface Props {
  onApplySoap(result: AiDraftResult): void;
  onAcceptProcedure(code: string, name: string, teeth: string[]): void;
  onAcceptDx(name: string, teeth: string[]): void;
  acceptedProcedures: string[];
  acceptedDx: string[];
}

const ai = new MockAiService();

export function AiPanel({ onApplySoap, onAcceptProcedure, onAcceptDx, acceptedProcedures, acceptedDx }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<AiDraftResult | null>(null);
  const [soapApplied, setSoapApplied] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const startRec = () => {
    setStage("recording");
    setSeconds(0);
    timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  };

  const stopRec = async () => {
    if (timer.current) clearInterval(timer.current);
    const r = await ai.transcribeAndDraft((s) => setStage(s));
    setResult(r);
    setStage("review");
  };

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const teethLabel = (teeth: string[]) =>
    teeth.length > 0 ? teeth.map((t) => toJapaneseNotation(parseTooth(t))).join("・") : "部位なし";

  return (
    <div className="card ai-panel">
      <div className="card-head">
        <h2><span className="ai-mark">✦</span> AI アシスタント</h2>
        <span className="chip ai" style={{ marginLeft: "auto" }}>下書き — 医師の確認が必要</span>
      </div>
      <div className="card-body">
        {stage === "idle" && (
          <div className="rec-area">
            <button type="button" className="rec-btn" onClick={startRec} aria-label="録音開始">🎙</button>
            <div className="rec-hint">タップして診療会話を録音 → SOAP下書きを自動生成</div>
          </div>
        )}

        {stage === "recording" && (
          <div className="rec-area">
            <button type="button" className="rec-btn recording" onClick={stopRec} aria-label="録音停止">■</button>
            <div className="rec-timer">{mmss}</div>
            <div className="wave" aria-hidden>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <span key={i} style={{ animationDelay: `${i * 0.11}s` }} />
              ))}
            </div>
            <div className="rec-hint">録音中 — もう一度タップで停止して生成</div>
          </div>
        )}

        {(stage === "transcribing" || stage === "drafting") && (
          <div style={{ padding: "10px 4px" }}>
            <div className={`ai-step ${stage !== "transcribing" ? "done" : ""}`}>
              {stage === "transcribing" ? <span className="spinner" /> : <span>✓</span>}
              文字起こし中（音声 → テキスト）
            </div>
            <div className={`ai-step ${stage === "drafting" ? "" : ""}`} style={{ opacity: stage === "drafting" ? 1 : 0.45 }}>
              {stage === "drafting" ? <span className="spinner" /> : <span>•</span>}
              歯科SOAP・処置候補を生成中
            </div>
          </div>
        )}

        {stage === "review" && result && (
          <div>
            <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>文字起こし</div>
            <div className="transcript-box">{result.transcript}</div>

            <div style={{ display: "flex", gap: 8, margin: "12px 0 16px" }}>
              <button
                type="button"
                className="btn ai"
                style={{ flex: 1 }}
                disabled={soapApplied}
                onClick={() => { onApplySoap(result); setSoapApplied(true); }}
              >
                {soapApplied ? "✓ カルテに反映済み" : "✦ SOAP下書きをカルテに反映"}
              </button>
            </div>

            <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>
              病名候補 <span className="tiny">（会話から抽出）</span>
            </div>
            {result.diagnoses.map((d) => {
              const accepted = acceptedDx.includes(d.name);
              return (
                <div className="candidate" key={d.name}>
                  <div className="c-main">
                    <div className="c-name">{d.name}</div>
                    <div className="c-meta">{teethLabel(d.teeth)}</div>
                  </div>
                  <span className="conf">{Math.round(d.confidence * 100)}%</span>
                  <button type="button" className="btn sm" disabled={accepted} onClick={() => onAcceptDx(d.name, d.teeth)}>
                    {accepted ? "✓" : "追加"}
                  </button>
                </div>
              );
            })}

            <div className="muted" style={{ fontWeight: 700, margin: "12px 0 6px" }}>
              処置候補 <span className="tiny">（算定はエンジンが検証）</span>
            </div>
            {result.procedures.map((p) => {
              const accepted = acceptedProcedures.includes(p.code);
              return (
                <div className="candidate" key={p.code}>
                  <div className="c-main">
                    <div className="c-name">{p.name}</div>
                    <div className="c-meta">{teethLabel(p.teeth)}</div>
                  </div>
                  <span className="conf">{Math.round(p.confidence * 100)}%</span>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={accepted}
                    onClick={() => onAcceptProcedure(p.code, p.name, p.teeth)}
                  >
                    {accepted ? "✓" : "追加"}
                  </button>
                </div>
              );
            })}

            <div className="ai-note" style={{ marginTop: 10 }}>
              ✦ AI出力は下書きです。内容の確認・確定は歯科医師が行います。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
