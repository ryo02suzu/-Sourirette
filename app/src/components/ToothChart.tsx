/**
 * 歯式チャート（永久歯 32 本）。
 * 並びは診療室の慣例どおり「患者と向かい合う視点」:
 *   上顎: 右8…右1 | 左1…左8（FDI 18…11 | 21…28）
 *   下顎: 右8…右1 | 左1…左8（FDI 48…41 | 31…38）
 */
import { parseTooth, toJapaneseNotation } from "../../../src/domain/tooth.js";
import type { ToothState } from "../data/mock.js";

const UPPER = ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"];
const LOWER = ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"];

interface Props {
  states: Record<string, ToothState>;
  selected: string[];
  onToggle(fdi: string): void;
}

function ToothButton({ fdi, state, isSelected, onToggle }: { fdi: string; state: ToothState; isSelected: boolean; onToggle(f: string): void }) {
  const tooth = parseTooth(fdi);
  const cls = ["tooth", state !== "healthy" ? state : "", isSelected ? "selected" : ""].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      onClick={() => onToggle(fdi)}
      title={`${toJapaneseNotation(tooth)}（FDI ${fdi}）`}
      aria-pressed={isSelected}
    >
      {state === "caries" && <span className="dot caries" />}
      {state === "treated" && <span className="dot treated" />}
      {tooth.position}
    </button>
  );
}

export function ToothChart({ states, selected, onToggle }: Props) {
  const render = (row: string[]) =>
    row.map((fdi) => (
      <ToothButton
        key={fdi}
        fdi={fdi}
        state={states[fdi] ?? "healthy"}
        isSelected={selected.includes(fdi)}
        onToggle={onToggle}
      />
    ));

  return (
    <div className="tooth-chart">
      <div className="arch">{render(UPPER)}</div>
      <div className="arch">{render(LOWER)}</div>
      <div className="chart-legend">
        <span className="key"><span className="swatch" style={{ background: "var(--tooth-caries)" }} />う蝕</span>
        <span className="key"><span className="swatch" style={{ background: "var(--tooth-treated)" }} />処置済</span>
        <span className="key"><span className="swatch" style={{ background: "var(--tooth-missing)" }} />欠損</span>
        <span className="key"><span className="swatch" style={{ borderColor: "var(--brand)", borderWidth: 2 }} />選択中</span>
      </div>
      <div className="selected-teeth">
        {selected.length === 0 ? (
          <span className="tiny">部位をタップして選択（複数可）</span>
        ) : (
          selected.map((fdi) => (
            <span key={fdi} className="chip brand">
              {toJapaneseNotation(parseTooth(fdi))}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
