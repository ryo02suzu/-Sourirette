/**
 * 歯式チャート（オドントグラム）— 実寸比レイアウト版。
 *
 * リアリティの根拠:
 *   - 歯列弓は放物線（y = Kx²）でモデル化し、各歯は「実際の歯冠近遠心幅（mm平均値）」の
 *     比率で弧長に沿って配置する。前歯部は急カーブ、臼歯部はほぼ平行な側方枝になる。
 *   - 歯の大きさも実測平均（中切歯8.5mm 〜 第一大臼歯10–11mm）の比率。
 *   - 咬合面観の解剖を歯種別に描画: 切歯=切縁、犬歯=尖頭と隆線、小臼歯=中心溝と2咬頭、
 *     上顎大臼歯=斜走隆線、下顎大臼歯=十字溝。
 *   - 患者と向かい合う視点（患者の右 = 画面の左）。上顎∩・下顎∪。
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
const typeOf = (p: number): ToothType => (p <= 2 ? "incisor" : p === 3 ? "canine" : p <= 5 ? "premolar" : "molar");

/* ===== 実寸（mm 平均値）===== */
// 近遠心幅（position 1..8）
const MD_UPPER = [8.5, 6.5, 7.6, 7.0, 6.8, 10.0, 9.4, 8.4];
const MD_LOWER = [5.2, 5.7, 6.9, 7.0, 7.2, 11.0, 10.4, 9.7];
// 頬舌径
function blOf(type: ToothType, jaw: "upper" | "lower", position: number): number {
  if (type === "molar") return jaw === "upper" ? 11.2 : position === 8 ? 9.6 : 10.3;
  if (type === "premolar") return 9.0;
  if (type === "canine") return 8.0;
  return jaw === "upper" ? 7.0 : 6.2;
}

/* ===== 歯列弓ジオメトリ ===== */
const SCALE = 4.0;          // mm → px
// 弓のカーブ: 前歯部は平坦・犬歯部から湾曲・臼歯部はほぼ平行（2次＋4次の混合）
const C2 = 0.012, C4 = 4.6e-5;
const archY = (x: number) => C2 * x * x + C4 * x ** 4;
const archSlope = (x: number) => 2 * C2 * x + 4 * C4 * x ** 3;
const CX = 360;
const U_TOP = 76;           // 上顎切歯部の y
const L_BOTTOM = 550;       // 下顎切歯部の y

interface ToothLayout {
  fdi: string;
  position: number;
  type: ToothType;
  w: number; h: number;     // px（近遠心幅 / 頬舌径）
  x: number; y: number;     // 歯冠中心（screen）
  rot: number;              // 近遠心軸の回転（deg）
  buccal: 1 | -1;           // 歯ローカル +y が頬側なら 1
  nx: number; ny: number;   // 歯番ラベル位置
}

/** 片側弓: 正中から弧長を歩いて各歯の中心点・接線を求める */
function halfArchCenters(widths: number[]): { x: number; y: number; tx: number; ty: number }[] {
  const targets: number[] = [];
  let cum = 0;
  for (const w of widths) {
    targets.push(cum + w / 2);
    cum += w;
  }
  const out: { x: number; y: number; tx: number; ty: number }[] = [];
  let x = 0, s = 0, ti = 0;
  const dx = 0.01;
  while (ti < targets.length && x < 60) {
    const slope = archSlope(x);
    s += Math.sqrt(1 + slope * slope) * dx;
    x += dx;
    while (ti < targets.length && s >= (targets[ti] ?? Infinity)) {
      const len = Math.sqrt(1 + slope * slope);
      out.push({ x, y: archY(x), tx: 1 / len, ty: slope / len });
      ti += 1;
    }
  }
  return out;
}

function buildArch(jaw: "upper" | "lower"): ToothLayout[] {
  const widths = jaw === "upper" ? MD_UPPER : MD_LOWER;
  const centers = halfArchCenters(widths);
  const quadrants = jaw === "upper" ? (["1", "2"] as const) : (["4", "3"] as const); // 右, 左
  const ySign = jaw === "upper" ? 1 : -1; // 後方に向かう画面方向（上顎=下へ, 下顎=上へ）
  const yBase = jaw === "upper" ? U_TOP : L_BOTTOM;
  const depth = (centers[centers.length - 1]?.y ?? 50) * SCALE;
  const interior = { x: CX, y: yBase + ySign * depth * 0.55 };

  const layouts: ToothLayout[] = [];
  for (const [qi, quadrant] of quadrants.entries()) {
    const xSign = qi === 0 ? -1 : 1; // 右側=画面左
    centers.forEach((c, i) => {
      const position = i + 1;
      const fdi = `${quadrant}${position}`;
      const type = typeOf(position);
      const X = CX + xSign * c.x * SCALE;
      const Y = yBase + ySign * c.y * SCALE;
      // 接線（近心→遠心の歩行方向）
      const tx = xSign * c.tx, ty = ySign * c.ty;
      const rot = (Math.atan2(ty, tx) * 180) / Math.PI;
      // 外向き法線（弓の内側中心から放射方向）
      let nx = X - interior.x, ny = Y - interior.y;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      // ローカル +y（=接線を時計回りに90°）が外向き（頬側）か
      const localY = { x: -ty, y: tx };
      const buccal: 1 | -1 = localY.x * nx + localY.y * ny > 0 ? 1 : -1;
      const w = (widths[i] ?? 7) * SCALE;
      const h = blOf(type, jaw, position) * SCALE;
      layouts.push({
        fdi, position, type, w, h, x: X, y: Y, rot, buccal,
        nx: X + nx * (h / 2 + 15), ny: Y + ny * (h / 2 + 15) + 4,
      });
    });
  }
  return layouts;
}

const LAYOUT: ToothLayout[] = [...buildArch("upper"), ...buildArch("lower")];
const BY_FDI = new Map(LAYOUT.map((l) => [l.fdi, l]));

/** 歯列弓に沿う歯肉帯のパス */
function gumPath(jaw: "upper" | "lower"): string {
  const ySign = jaw === "upper" ? 1 : -1;
  const yBase = jaw === "upper" ? U_TOP : L_BOTTOM;
  const pts: string[] = [];
  for (let x = -30.5; x <= 30.5; x += 0.5) {
    const X = CX + x * SCALE;
    const Y = yBase + ySign * archY(x) * SCALE;
    pts.push(`${pts.length === 0 ? "M" : "L"} ${X.toFixed(1)},${Y.toFixed(1)}`);
  }
  return pts.join(" ");
}
const GUM_U = gumPath("upper");
const GUM_L = gumPath("lower");

/* ===== 歯冠の描画 ===== */

/** 歯冠アウトライン（滑らかな咬合面観。w=近遠心, h=頬舌） */
function crownOutline(w: number, h: number, type: ToothType): string {
  const x = w / 2, y = h / 2;
  // 犬歯はやや菱形、それ以外は丸みのある矩形ブロブ
  const k = type === "canine" ? 0.66 : 0.82;
  return [
    `M 0,${-y}`,
    `C ${x * k},${-y} ${x},${-y * k} ${x},0`,
    `C ${x},${y * k} ${x * k},${y} 0,${y}`,
    `C ${-x * k},${y} ${-x},${y * k} ${-x},0`,
    `C ${-x},${-y * k} ${-x * k},${-y} 0,${-y} Z`,
  ].join(" ");
}

/** 歯種別の咬合面解剖（溝・隆線・切縁）。b = 頬側方向の符号 */
function Anatomy({ l, color }: { l: ToothLayout; color: string }) {
  const { w, h, type } = l;
  const b = l.buccal;
  const stroke = { stroke: color, strokeWidth: 1.1, fill: "none", strokeLinecap: "round" as const };
  if (type === "incisor") {
    // 切縁（近遠心に走る、やや唇側寄り）
    return <path d={`M ${-w * 0.36},${-b * h * 0.06} Q 0,${-b * h * 0.2} ${w * 0.36},${-b * h * 0.06}`} {...stroke} strokeWidth={1.4} />;
  }
  if (type === "canine") {
    // 尖頭＋近遠心切縁＋唇側隆線
    return (
      <g>
        <path d={`M ${-w * 0.34},${-b * h * 0.02} Q ${-w * 0.1},${-b * h * 0.14} 0,${-b * h * 0.05} Q ${w * 0.1},${-b * h * 0.14} ${w * 0.34},${-b * h * 0.02}`} {...stroke} strokeWidth={1.3} />
        <path d={`M 0,${-b * h * 0.05} L 0,${-b * h * 0.34}`} {...stroke} />
      </g>
    );
  }
  if (type === "premolar") {
    // 中心溝（近遠心）＋頬側・舌側咬頭の三角隆線
    return (
      <g>
        <path d={`M ${-w * 0.3},0 Q 0,${b * h * 0.05} ${w * 0.3},0`} {...stroke} strokeWidth={1.3} />
        <path d={`M 0,${-b * h * 0.36} L 0,${-b * h * 0.12}`} {...stroke} />
        <path d={`M 0,${b * h * 0.36} L 0,${b * h * 0.14}`} {...stroke} />
        <circle cx={-w * 0.24} cy={0} r={1.4} fill={color} />
        <circle cx={w * 0.24} cy={0} r={1.4} fill={color} />
      </g>
    );
  }
  // 大臼歯: 上顎=斜走隆線を挟む溝、下顎=十字溝＋頬面溝
  const isUpper = l.fdi[0] === "1" || l.fdi[0] === "2";
  if (isUpper) {
    return (
      <g>
        <path d={`M ${-w * 0.32},${-b * h * 0.1} Q ${-w * 0.05},${b * h * 0.08} ${w * 0.1},${b * h * 0.3}`} {...stroke} strokeWidth={1.3} />
        <path d={`M ${w * 0.32},${-b * h * 0.16} Q ${w * 0.1},${-b * h * 0.02} ${w * 0.16},${b * h * 0.22}`} {...stroke} />
        {/* 斜走隆線 */}
        <path d={`M ${w * 0.26},${-b * h * 0.24} L ${-w * 0.14},${b * h * 0.18}`} {...stroke} strokeWidth={0.9} opacity={0.7} />
        <circle cx={-w * 0.16} cy={-b * h * 0.04} r={1.5} fill={color} />
        <circle cx={w * 0.14} cy={b * h * 0.16} r={1.5} fill={color} />
      </g>
    );
  }
  return (
    <g>
      <path d={`M ${-w * 0.34},0 Q 0,${b * h * 0.06} ${w * 0.34},0`} {...stroke} strokeWidth={1.3} />
      <path d={`M 0,${-b * h * 0.34} L 0,${b * h * 0.32}`} {...stroke} />
      <path d={`M ${-w * 0.16},${-b * h * 0.34} L ${-w * 0.12},${-b * h * 0.1}`} {...stroke} strokeWidth={0.9} opacity={0.7} />
      <circle cx={-w * 0.2} cy={b * h * 0.02} r={1.4} fill={color} />
      <circle cx={w * 0.18} cy={b * h * 0.02} r={1.4} fill={color} />
    </g>
  );
}

function ToothShape({ l, state, isPontic }: { l: ToothLayout; state: ToothState; isPontic: boolean }) {
  const outline = crownOutline(l.w, l.h, l.type);
  const fill =
    state === "caries" ? "var(--tc-caries)" :
    state === "cr" ? "var(--tc-cr)" :
    state === "crown" || isPontic ? "url(#metal)" :
    state === "missing" || state === "implant" ? "var(--tc-missing)" : "url(#ivory)";
  const stroke =
    state === "caries" ? "#d92d20" :
    state === "cr" ? "#5b8fb8" :
    state === "crown" || isPontic ? "#8a96a3" :
    state === "missing" || state === "implant" ? "#aab4bd" : "#b9ac93";
  const anatomyColor = state === "caries" ? "#cb7a70" : state === "cr" ? "#7da6c4" : "#c2b394";

  return (
    <g transform={`rotate(${l.rot})`}>
      <path
        d={outline}
        fill={fill}
        stroke={stroke}
        strokeWidth={state === "caries" ? 2 : 1.3}
        strokeDasharray={state === "missing" && !isPontic ? "3 3" : isPontic ? "5 3" : undefined}
        opacity={state === "missing" && !isPontic ? 0.7 : 1}
      />
      {(state === "healthy" || state === "caries" || state === "cr") && <Anatomy l={l} color={anatomyColor} />}
      {state === "cr" && <circle cx={l.w * 0.12} cy={-l.h * 0.08} r={Math.min(l.w, l.h) * 0.17} fill="#5b8fb8" opacity={0.85} />}
      {state === "missing" && !isPontic && (
        <g stroke="#98a4ad" strokeWidth={2} strokeLinecap="round">
          <line x1={-l.w * 0.28} y1={-l.h * 0.28} x2={l.w * 0.28} y2={l.h * 0.28} />
          <line x1={l.w * 0.28} y1={-l.h * 0.28} x2={-l.w * 0.28} y2={l.h * 0.28} />
        </g>
      )}
      {state === "implant" && (
        <g>
          <circle r={Math.min(l.w, l.h) * 0.28} fill="#aeb9c6" stroke="#7f8b99" strokeWidth={1.5} />
          <line x1={-l.w * 0.14} y1={0} x2={l.w * 0.14} y2={0} stroke="#5d6b7a" strokeWidth={2} strokeLinecap="round" />
          <circle r={Math.min(l.w, l.h) * 0.42} fill="none" stroke="#7f8b99" strokeWidth={1} strokeDasharray="2 2" />
        </g>
      )}
    </g>
  );
}

/* ===== 公開コンポーネント ===== */

interface Props {
  states: Record<string, ToothState>;
  bridges: string[][];
  /** 歯面単位の所見（fdi → ["M","D","B","L","O"]） */
  surfaces?: Record<string, string[]>;
  selected: string[];
  onToggle(fdi: string): void;
}

/** 歯面マーカー位置（歯ローカル座標。+x=遠心 / buccal符号で頬舌） */
function surfaceOffset(surface: string, l: ToothLayout): [number, number] {
  switch (surface) {
    case "M": return [-l.w * 0.33, 0];
    case "D": return [l.w * 0.33, 0];
    case "B": return [0, l.buccal * l.h * 0.32];
    case "L": return [0, -l.buccal * l.h * 0.32];
    default: return [0, 0];
  }
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
      <svg viewBox="0 0 720 628" className="odon-svg" role="img" aria-label="歯式チャート">
        <defs>
          <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e8edf2" />
            <stop offset="55%" stopColor="#c4cdd6" />
            <stop offset="100%" stopColor="#dde3ea" />
          </linearGradient>
          <radialGradient id="ivory" cx="0.42" cy="0.4" r="0.85">
            <stop offset="0%" stopColor="#fffef8" />
            <stop offset="70%" stopColor="#faf5e7" />
            <stop offset="100%" stopColor="#efe7d2" />
          </radialGradient>
        </defs>

        {/* 歯肉帯 */}
        <path d={GUM_U} fill="none" stroke="#f6e9e4" strokeWidth={62} strokeLinecap="round" />
        <path d={GUM_L} fill="none" stroke="#f6e9e4" strokeWidth={62} strokeLinecap="round" />
        <path d={GUM_U} fill="none" stroke="#eedcd5" strokeWidth={62} strokeLinecap="round" opacity={0.35} strokeDasharray="1 7" />
        <path d={GUM_L} fill="none" stroke="#eedcd5" strokeWidth={62} strokeLinecap="round" opacity={0.35} strokeDasharray="1 7" />

        {/* 正中線・咬合平面 */}
        <line x1={360} y1={36} x2={360} y2={592} className="odon-axis" />
        <line x1={48} y1={314} x2={672} y2={314} className="odon-axis" />
        <text x={38} y={319} className="odon-side">右</text>
        <text x={668} y={319} className="odon-side">左</text>
        <text x={360} y={216} className="odon-jaw" textAnchor="middle">上顎</text>
        <text x={360} y={424} className="odon-jaw" textAnchor="middle">下顎</text>

        {/* ブリッジ連結 */}
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
          const r = Math.max(l.w, l.h) / 2 + 5;
          return (
            <g
              key={l.fdi}
              className="tooth-g"
              transform={`translate(${l.x},${l.y})`}
              onClick={() => onToggle(l.fdi)}
              onMouseEnter={() => setHover(l.fdi)}
              onMouseLeave={() => setHover(null)}
            >
              <circle r={Math.max(r, 23)} fill="transparent" />
              {isSelected && (
                <>
                  <circle r={r} fill="var(--brand-soft)" opacity={0.85} />
                  <circle r={r} fill="none" stroke="var(--brand)" strokeWidth={2.4} />
                </>
              )}
              <ToothShape l={l} state={state} isPontic={isPontic} />
              {(surfaces?.[l.fdi] ?? []).map((s) => {
                const [ox, oy] = surfaceOffset(s, l);
                return (
                  <g key={s} transform={`rotate(${l.rot})`}>
                    <circle cx={ox} cy={oy} r={3.6} fill="#d92d20" stroke="#fff" strokeWidth={1.2} />
                  </g>
                );
              })}
              {state === "caries" && (
                <g transform={`translate(${l.w * 0.5},${-l.h * 0.55})`}>
                  <circle r={7.5} fill="#d92d20" />
                  <text y={3.2} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#fff" fontFamily="Inter, sans-serif">C</text>
                </g>
              )}
            </g>
          );
        })}

        {LAYOUT.map((l) => (
          <text
            key={`n-${l.fdi}`}
            x={l.nx}
            y={l.ny}
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
            top: `${((hoverLayout.y - 50) / 628) * 100}%`,
          }}
        >
          <strong>{toJapaneseNotation(parseTooth(hoverLayout.fdi))}</strong> {POSITION_NAMES[hoverLayout.position]}
          <span className={`odon-tip-state s-${hoverState}`}>{pontics.has(hoverLayout.fdi) ? "ポンティック（ブリッジ）" : STATUS_LABELS[hoverState]}</span>
        </div>
      )}

      <div className="chart-legend">
        <span className="key"><span className="swatch" style={{ background: "#faf5e7" }} />健全</span>
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
