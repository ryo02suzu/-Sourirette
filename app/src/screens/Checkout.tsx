/** 会計画面: 算定結果 → 窓口負担 → 領収書・診療明細書（発行は法令上の義務）。 */
import { useState } from "react";
import { useToast } from "../components/toast.js";
import {
  checkHealth,
  DEMO_ENCOUNTER,
  generateReceipt,
  type ServerAccounting,
  type ServerCopayment,
} from "../services/algorithm-api.js";

/** 厚労省標準様式の費用区分（領収証）。サーバ未接続時のデモ値 */
const RECEIPT_SECTIONS: [string, number][] = [
  ["初・再診料", 55],
  ["医学管理等", 110],
  ["検査", 400],
  ["処置（歯周治療）", 719],
  ["手術", 0],
];

interface RealAccounting {
  accounting: ServerAccounting;
  copayment?: ServerCopayment;
}

export function CheckoutScreen() {
  const [preview, setPreview] = useState(false);
  const [real, setReal] = useState<RealAccounting | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // 算定サーバで実点数の費用区分集計・窓口負担・高額療養費を計算する
  const loadReal = async () => {
    setBusy(true);
    try {
      const health = await checkHealth();
      if (!health.ok) {
        toast("算定サーバ未起動（npm run serve）。デモ値を表示しています", "info");
        return;
      }
      const r = await generateReceipt({ ...DEMO_ENCOUNTER, copay: { copayRatio: 0.3, category: "ウ" } });
      setReal({ accounting: r.accounting, ...(r.copayment ? { copayment: r.copayment } : {}) });
      setPreview(true);
      toast(`実点数で会計を計算しました（${r.accounting.totalPoints}点）`);
    } catch (e) {
      toast(`会計計算に失敗: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const sections: [string, number][] = real ? real.accounting.byCategory.map((c) => [c.category, c.points]) : RECEIPT_SECTIONS;
  const totalPoints = real ? real.accounting.totalPoints : 1284;
  const gross = real ? (real.copayment?.grossMedicalCost ?? totalPoints * 10) : 12840;
  const burden = real ? (real.copayment?.windowBurden ?? Math.round((totalPoints * 10 * 0.3) / 10) * 10) : 3850;

  return (
    <div style={{ maxWidth: 860 }}>
      <h2 className="section-title">会計待ち（1名）</h2>
      <div className="clinical" style={{ gridTemplateColumns: "3fr 2fr" }}>
        <div className="card">
          <div className="card-head">
            <h2>佐藤 美咲 ・ 社保 本人（3割） ・ SPT（定期メンテ）</h2>
            <span className="chip ok" style={{ marginLeft: "auto" }}>カルテ確定済</span>
          </div>
          <div className="card-body">
            <table className="claim-table">
              <thead><tr><th>診療行為</th><th style={{ textAlign: "right" }}>点数</th></tr></thead>
              <tbody>
                {real ? (
                  real.accounting.detail.map((d, i) => (
                    <tr key={i}><td>{d.name}{d.quantity > 1 ? ` ×${d.quantity}` : ""}</td><td className="num">{d.points * d.quantity}</td></tr>
                  ))
                ) : (
                  <>
                    <tr><td>再診料</td><td className="num">55</td></tr>
                    <tr><td>歯科疾患管理料</td><td className="num">110</td></tr>
                    <tr><td>歯周精密検査</td><td className="num">400</td></tr>
                    <tr><td>SPT（歯周病安定期治療）</td><td className="num">680</td></tr>
                    <tr><td>機械的歯面清掃</td><td className="num">39</td></tr>
                  </>
                )}
              </tbody>
            </table>
            <div className="tiny" style={{ marginTop: 8 }}>
              {real ? "✓ 算定サーバの実点数（公式マスタ）" : "⚠ デモ表示（サンプル値）"}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>窓口負担</h2></div>
          <div className="card-body">
            <div className="pay-row"><span>保険点数 合計</span><span className="v">{totalPoints.toLocaleString()} 点</span></div>
            <div className="pay-row"><span>医療費 総額（10割）</span><span className="v">{gross.toLocaleString()} 円</span></div>
            <div className="pay-row"><span>負担割合</span><span className="v">3割</span></div>
            {real?.copayment && real.copayment.highCostBenefit > 0 && (
              <div className="pay-row"><span>高額療養費（限度額超過分）</span><span className="v">▲{real.copayment.highCostBenefit.toLocaleString()} 円</span></div>
            )}
            <div className="pay-row total"><span>窓口請求額</span><span className="v">{burden.toLocaleString()}円</span></div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexDirection: "column" }}>
              <button type="button" className="btn primary lg" onClick={loadReal} disabled={busy}>
                {busy ? "計算中…" : "実点数で会計を計算（サーバ）"}
              </button>
              <button type="button" className="btn" onClick={() => setPreview(!preview)}>
                領収書・診療明細書を{preview ? "閉じる" : "発行"}
              </button>
              <div className="tiny">明細書の無償交付は義務（療担規則）。標準様式（別紙様式5）で出力します。</div>
            </div>
            {preview && (
              <div className="receipt-preview">
                <div style={{ textAlign: "center", fontWeight: 800, marginBottom: 8 }}>領 収 証（プレビュー）</div>
                <div className="tiny" style={{ textAlign: "center", marginBottom: 10 }}>
                  すずき歯科クリニック ・ 2026年6月12日 ・ {real ? "基金 花子" : "佐藤 美咲"} 様
                </div>
                {sections.map(([label, points]) => (
                  <div className="pay-row" key={label} style={{ fontSize: 12.5 }}>
                    <span>{label}</span><span className="v">{points.toLocaleString()} 点</span>
                  </div>
                ))}
                <div className="pay-row" style={{ fontSize: 12.5 }}><span>保険合計</span><span className="v">{totalPoints.toLocaleString()} 点</span></div>
                <div className="pay-row" style={{ fontSize: 12.5 }}><span>患者負担額（3割）</span><span className="v">{burden.toLocaleString()} 円</span></div>
                <div className="tiny" style={{ marginTop: 8 }}>
                  ※ 厚労省標準様式（別紙様式2）の費用区分。{real ? "実点数で区分別に集計しています。" : "サンプル表示。"}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
