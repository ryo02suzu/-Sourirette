/**
 * 歯式チャート（オドントグラム）。
 *
 * 実際の歯科チャートの慣例に従う:
 *   - 患者と向かい合う視点（患者の右 = 画面の左）
 *   - 上顎は ∩ 型・下顎は ∪ 型の歯列弓。切歯が外側、臼歯が咬合面側（中央寄り）
 *   - 歯種ごとの咬合面観の形状（切歯/犬歯/小臼歯/大臼歯）
 *   - 状態描画: う蝕(赤) / CR充填(青) / クラウン(金属) / 欠損(×) / インプラント / ブリッジ連結
 * 部位の内部表現は FDI（src/domain/tooth.ts）。
 */
import { useMemo, useState } from "react";
import { parseTooth, toJapaneseNotation } from "../../../src/domain/tooth.js";
import type { ToothState } from "../data/mock.js";

const POSITION_NAMES: Record<number, string> = {
  1: "中切歯", 2: "側切歯", 3: "犬歯", 4: "第一小臼歯",
  5: "第二小臼歯", 6: "第一大臼歯", 7: "第二大臼歯", 8: "智歯",
};

export const STATUS_LABELS: Record<ToothState, string> = {
  healthy: "健全",
  caries: "う蝕（要処置）",
  cr: "CR充填",
  crown: "クラウン（補綴）",
  missing: "欠損",
  implant: "インプラント",
};

type ToothType = "incisor" | "canine" | "premolar" | "molar";

const typeOf = (position: number): ToothType =>
  position <= 2 ? "incisor" : position === 3 ? "canine" : position <= 5 ? "premolar" : "molar";

function sizeOf(type: ToothType, position: number, jaw: "upper" | "lower"): { w: number; h: number } {
  if (type === "molar") return { w: 40, h: 42 };
  if (type === "premolar") return { w: 31, h: 35 };
  if (type === "canine") return { w: 27, h: 33 };
  if (jaw === "upper") return position === 1 ? { w: 30, h: 36 } : { w: 25, h: 31 };
  return position === 1 ? { w: 21, h: 29 } : { w: 23, h: 30 };
}

/** 咬合面観の歯冠アウトライン（滑らかなブロブ。原点中心） */
function crownPath(w: number, h: number): string {
  const x = w / 2, y = h / 2;
  return [
    `M 0,${-y}`,
    `C ${x * 0.84},${-y} ${x},${-y * 0.56} ${x},0`,
    `C ${x},${y * 0.6} ${x * 0.8},${y} 0,${y}`,
    `C ${-x * 0.8},${y} ${-x},${y * 0.6} ${-x},0`,
    `C ${-x},${-y * 0.56} ${-x * 0.84},${-y} 0,${-y} Z`,
  ].join(" ");
}

/** 歯種ごとの咬合面の溝・隆線（装飾ストローク） */
function grooves(type: ToothType, w: number, h: number): string[] {
  if (type === "molar")
    return [
      `M ${-w * 0.3},${-h * 0.06} Q 0,${h * 0.16} ${w * 0.3},${-h * 0.06}`,
      `M ${-w * 0.06},${-h * 0.32} Q ${w * 0.08},0 ${-w * 0.06},${h * 0.32}`,
      `M ${-w * 0.32},${-h * 0.26} Q ${-w * 0.12},${-h * 0.12} ${-w * 0.04},${-h * 0.3}`,
    ];
  if (type === "premolar") return [`M ${-w * 0.26},0 Q 0,${h * 0.12} ${w * 0.26},0`];
  if (type === "canine") return [`M 0,${-h * 0.3} Q ${w * 0.06},0 0,${h * 0.3}`];
  return [`M ${-w * 0.3},${-h * 0.2} L ${w * 0.3},${-h * 0.2}`]; // 切縁
}

/** 歯列弓上のレイアウト計算 */
interface ToothLayout {
  fdi: string;
  position: number;
  type: ToothType;
  w: number; h: number;
  x: number; y: number;   // 歯冠中心
  rot: number;            // 回転（deg）
  nx: number; ny: number; // 番号ラベル位置
}

const CX = 360, A = 290, B = 192, CY_U = 252, CY_L = 308, T_MAX = 75;
const UPPER = ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"];
const LOWER = ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"];

function layoutArch(fdis: string[], jaw: "upper" | "lower"): ToothLayout[] {
  return fdis.map((fdi, i) => {
    const t = ((-T_MAX + ((2 * T_MAX) / 15) * i) * Math.PI) / 180;
    const tooth = parseTooth(fdi);
    const type = typeOf(tooth.position);
    const { w, h } = sizeOf(type, tooth.position, jaw);
    const sin = Math.sin(t), cos = Math.cos(t);
    const y = jaw === "upper" ? CY_U - B * cos : CY_L + B * cos;
    const ny = jaw === "upper" ? CY_U - (B + 36) * cos : CY_L + (B + 36) * cos;
    const rotDeg = (t * 180) / Math.PI;
    return {
      fdi, position: tooth.position, type, w, h,
      x: CX + A * sin, y,
      rot: jaw === "upper" ? rotDeg : -rotDeg,
      nx: CX + (A + 34) * sin, ny,
    };
  });
}

/** 歯列弓に沿った歯肉の帯（背景装飾） */
function gumBandPath(jaw: "upper" | "lower"): string {
  const pts: string[] = [];
  for (let deg = -T_MAX - 4; deg <= T_MAX + 4; deg += 4) {
    const t = (deg * Math.PI) / 180;
    const x = CX + A * Math.sin(t);
    const y = jaw === "upper" ? CY_U - B * Math.cos(t) : CY_L + B * Math.cos(t);
    pts.push(`${pts.length === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}
const GUM_UPPER = gumBandPath("upper");
const GUM_LOWER = gumBandPath("lower");

const LAYOUT: ToothLayout[] = [...layoutArch(UPPER, "upper"), ...layoutArch(LOWER, "lower")];
const BY_FDI = new Map(LAYOUT.map((l) => [l.fdi, l]));

interface Props {
  states: Record<string, ToothState>;
  /** ブリッジ（支台歯〜ポンティック〜支台歯の FDI 列） */
  bridges: string[][];
  /** 歯面単位の所見（fdi → ["M","D","B","L","O"]）。う蝕等の部位を歯面レベルで表示 */
  surfaces?: Record<string, string[]>;
  selected: string[];
  onToggle(fdi: string): void;
}

/** 歯面マーカーの歯ローカル座標（回転前。M/D は近遠心＝歯列弓に沿う向き） */
function surfaceOffset(surface: string, l: ToothLayout, jaw: "upper" | "lower", side: "right" | "left"): [number, number] {
  const mesialSign = side === "right" ? 1 : -1;
  const buccalSign = jaw === "upper" ? -1 : 1;
  switch (surface) {
    case "M": return [mesialSign * l.w * 0.33, 0];
    case "D": return [-mesialSign * l.w * 0.33, 0];
    case "B": return [0, buccalSign * l.h * 0.33];
    case "L": return [0, -buccalSign * l.h * 0.33];
    default: return [0, 0]; // O（咬合面）/ 切縁
  }
}

function ToothShape({ l, state, isPontic }: { l: ToothLayout; state: ToothState; isPontic: boolean }) {
  const outline = crownPath(l.w, l.h);
  const fill =
    state === "caries" ? "var(--tc-caries)" :
    state === "cr" ? "var(--tc-cr)" :
    state === "crown" || isPontic ? "url(#metal)" :
    state === "missing" ? "var(--tc-missing)" :
    state === "implant" ? "var(--tc-missing)" : "var(--tc-healthy)";
  const stroke =
    state === "caries" ? "#d92d20" :
    state === "cr" ? "#5b8fb8" :
    state === "crown" || isPontic ? "#8a96a3" :
    state === "missing" || state === "implant" ? "#aab4bd" : "#bfb39e";

  return (
    <g transform={`rotate(${l.rot})`}>
      <path
        d={outline}
        fill={fill}
        stroke={stroke}
        strokeWidth={state === "caries" ? 2 : 1.4}
        strokeDasharray={state === "missing" && !isPontic ? "3 3" : isPontic ? "5 3" : undefined}
        opacity={state === "missing" && !isPontic ? 0.75 : 1}
      />
      {/* 健全・う蝕・CR は溝を描く（補綴・欠損は描かない） */}
      {(state === "healthy" || state === "caries" || state === "cr") &&
        grooves(l.type, l.w, l.h).map((d, i) => (
          <path key={i} d={d} fill="none" stroke={state === "caries" ? "#c9776e" : "#c5b9a2"} strokeWidth={1.1} strokeLinecap="round" />
        ))}
      {/* CR 充填窩洞 */}
      {state === "cr" && <circle cx={l.w * 0.14} cy={-l.h * 0.1} r={Math.min(l.w, l.h) * 0.18} fill="#5b8fb8" opacity={0.85} />}
      {/* 欠損 × */}
      {state === "missing" && !isPontic && (
        <g stroke="#98a4ad" strokeWidth={2.2} strokeLinecap="round">
          <line x1={-l.w * 0.3} y1={-l.h * 0.3} x2={l.w * 0.3} y2={l.h * 0.3} />
          <line x1={l.w * 0.3} y1={-l.h * 0.3} x2={-l.w * 0.3} y2={l.h * 0.3} />
        </g>
      )}
      {/* インプラント（スクリュー） */}
      {state === "implant" && (
        <g>
          <circle r={Math.min(l.w, l.h) * 0.3} fill="#aeb9c6" stroke="#7f8b99" strokeWidth={1.5} />
          <line x1={-l.w * 0.16} y1={0} x2={l.w * 0.16} y2={0} stroke="#5d6b7a" strokeWidth={2} strokeLinecap="round" />
          <circle r={Math.min(l.w, l.h) * 0.3} fill="none" stroke="#7f8b99" strokeWidth={1} strokeDasharray="2 2" transform="scale(1.45)" />
        </g>
      )}
    </g>
  );
}

export function ToothChart({ states, bridges, surfaces, selected, onToggle }: Props) {
  const [hover, setHover] = useState<string | null>(null);

  const pontics = useMemo(() => {
    const set = new Set<string>();
    for (const bridge of bridges)
      for (const fdi of bridge) if ((states[fdi] ?? "healthy") === "missing") set.add(fdi);
    return set;
  }, [bridges, states]);

  const hoverLayout = hover ? BY_FDI.get(hover) : undefined;
  const hoverState: ToothState = hover ? states[hover] ?? "healthy" : "healthy";

  return (
    <div className="odon-wrap">
      <svg viewBox="0 0 720 560" className="odon-svg" role="img" aria-label="歯式チャート">
        <defs>
          <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e8edf2" />
            <stop offset="55%" stopColor="#c4cdd6" />
            <stop offset="100%" stopColor="#dde3ea" />
          </linearGradient>
        </defs>

        {/* 歯列弓の歯肉帯（背景） */}
        <path d={GUM_UPPER} fill="none" stroke="#f7ede8" strokeWidth={62} strokeLinecap="round" />
        <path d={GUM_LOWER} fill="none" stroke="#f7ede8" strokeWidth={62} strokeLinecap="round" />

        {/* 正中線・咬合平面（伝統的な十字表記へのリファレンス） */}
        <line x1={360} y1={42} x2={360} y2={518} className="odon-axis" />
        <line x1={36} y1={280} x2={684} y2={280} className="odon-axis" />
        <text x={26} y={285} className="odon-side">右</text>
        <text x={682} y={285} className="odon-side">左</text>
        <text x={360} y={172} className="odon-jaw" textAnchor="middle">上顎</text>
        <text x={360} y={400} className="odon-jaw" textAnchor="middle">下顎</text>

        {/* ブリッジ連結（歯の下層に描画） */}
        {bridges.map((bridge, i) => {
          const pts = bridge.map((f) => BY_FDI.get(f)).filter((l): l is ToothLayout => !!l);
          if (pts.length < 2) return null;
          const d = pts.map((p, j) => `${j === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" ");
          return <path key={i} d={d} stroke="#b6c2cd" strokeWidth={8} strokeLinecap="round" fill="none" opacity={0.85} />;
        })}

        {LAYOUT.map((l) => {
          const state = states[l.fdi] ?? "healthy";
          const isSelected = selected.includes(l.fdi);
          const isPontic = pontics.has(l.fdi);
          return (
            <g
              key={l.fdi}
              className="tooth-g"
              transform={`translate(${l.x},${l.y})`}
              onClick={() => onToggle(l.fdi)}
              onMouseEnter={() => setHover(l.fdi)}
              onMouseLeave={() => setHover(null)}
            >
              {/* タップ領域（44px 相当） */}
              <circle r={26} fill="transparent" />
              {isSelected && (
                <>
                  <circle r={27} fill="var(--brand-soft)" opacity={0.85} />
                  <circle r={27} fill="none" stroke="var(--brand)" strokeWidth={2.4} />
                </>
              )}
              <ToothShape l={l} state={state} isPontic={isPontic} />
              {/* 歯面マーカー（回転に追従して近遠心/頬舌側を示す） */}
              {(surfaces?.[l.fdi] ?? []).map((s) => {
                const tooth = parseTooth(l.fdi);
                const [ox, oy] = surfaceOffset(s, l, tooth.jaw, tooth.side);
                return (
                  <g key={s} transform={`rotate(${l.rot})`}>
                    <circle cx={ox} cy={oy} r={4} fill="#d92d20" stroke="#fff" strokeWidth={1.2} />
                  </g>
                );
              })}
              {/* う蝕バッジ */}
              {state === "caries" && (
                <g transform={`translate(${l.w * 0.52},${-l.h * 0.52})`}>
                  <circle r={8} fill="#d92d20" />
                  <text y={3.4} textAnchor="middle" fontSize={10} fontWeight={800} fill="#fff" fontFamily="Inter, sans-serif">C</text>
                </g>
              )}
            </g>
          );
        })}

        {/* 歯番（Palmer 位置番号） */}
        {LAYOUT.map((l) => (
          <text
            key={`n-${l.fdi}`}
            x={l.nx}
            y={l.ny + 4}
            textAnchor="middle"
            className={`odon-num ${selected.includes(l.fdi) ? "sel" : ""}`}
          >
            {l.position}
          </text>
        ))}
      </svg>

      {hoverLayout && (
        <div
          className="odon-tooltip"
          style={{
            left: `${Math.min(72, Math.max(28, (hoverLayout.x / 720) * 100))}%`,
            top: `${((hoverLayout.y - 50) / 560) * 100}%`,
          }}
        >
          <strong>{toJapaneseNotation(parseTooth(hoverLayout.fdi))}</strong> {POSITION_NAMES[hoverLayout.position]}
          <span className={`odon-tip-state s-${hoverState}`}>{pontics.has(hoverLayout.fdi) ? "ポンティック（ブリッジ）" : STATUS_LABELS[hoverState]}</span>
        </div>
      )}

      <div className="chart-legend">
        <span className="key"><span className="swatch" style={{ background: "var(--tc-healthy)" }} />健全</span>
        <span className="key"><span className="swatch" style={{ background: "var(--tc-caries)", borderColor: "#d92d20" }} />う蝕</span>
        <span className="key"><span className="swatch" style={{ background: "var(--tc-cr)", borderColor: "#5b8fb8" }} />CR充填</span>
        <span className="key"><span className="swatch" style={{ background: "linear-gradient(135deg,#e8edf2,#c4cdd6)" }} />クラウン</span>
        <span className="key"><span className="swatch" style={{ background: "var(--tc-missing)", borderStyle: "dashed" }} />欠損</span>
        <span className="key"><span className="swatch" style={{ background: "#aeb9c6" }} />インプラント</span>
        <span className="key"><span className="swatch" style={{ background: "#b6c2cd", borderColor: "transparent" }} />ブリッジ</span>
      </div>
    </div>
  );
}
