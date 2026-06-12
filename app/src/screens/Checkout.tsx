/** 会計画面: 算定結果 → 窓口負担 → 領収書・診療明細書（発行は法令上の義務）。 */
export function CheckoutScreen() {
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
                <tr><td>再診料</td><td className="num">55</td></tr>
                <tr><td>歯科疾患管理料</td><td className="num">110</td></tr>
                <tr><td>歯周精密検査</td><td className="num">400</td></tr>
                <tr><td>SPT（歯周病安定期治療）</td><td className="num">680</td></tr>
                <tr><td>機械的歯面清掃</td><td className="num">39</td></tr>
              </tbody>
            </table>
            <div className="tiny" style={{ marginTop: 8 }}>⚠ デモ表示（サンプル値）</div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>窓口負担</h2></div>
          <div className="card-body">
            <div className="pay-row"><span>保険点数 合計</span><span className="v">1,284 点</span></div>
            <div className="pay-row"><span>医療費 総額（10割）</span><span className="v">12,840 円</span></div>
            <div className="pay-row"><span>負担割合</span><span className="v">3割</span></div>
            <div className="pay-row total"><span>窓口請求額</span><span className="v">3,850円</span></div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexDirection: "column" }}>
              <button type="button" className="btn primary lg">領収書・診療明細書を発行</button>
              <div className="tiny">明細書の無償交付は義務（療担規則）。標準様式（別紙様式5）で出力します。</div>
              <button type="button" className="btn">キャッシュレス決済（Phase 4 連携予定）</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
