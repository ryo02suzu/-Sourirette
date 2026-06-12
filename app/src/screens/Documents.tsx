/**
 * 文書発行: 算定要件に直結する文書を ✦AI 下書き → 医師確認 → 交付記録の流れで発行。
 * 交付の記録自体が算定要件（歯科疾患管理料等）になるため、発行＝診療録への記録とセット。
 */
import { useState } from "react";
import { useToast } from "../components/toast.js";

interface DocTemplate {
  id: string;
  name: string;
  requirement?: string;
  body: string;
}

const TEMPLATES: DocTemplate[] = [
  {
    id: "kanri",
    name: "歯科疾患管理計画書",
    requirement: "歯科疾患管理料の算定要件",
    body:
      "田中 花子 様（45歳）\n\n【現在の状態】\n右上6番に中等度のう蝕（C2）を認め、本日コンポジットレジン充填を行いました。" +
      "また全体に歯周炎の所見があり、歯ぐきからの出血が認められます（BOP 44%）。\n\n【治療計画】\n" +
      "1. 本日: 右上6番 う蝕処置・充填（完了）\n2. 次回〜: 歯周基本治療（歯石除去を2〜3回に分けて実施）\n" +
      "3. 再評価検査ののち、必要に応じて深い部位の処置（SRP）\n4. 安定後は3ヶ月ごとの定期管理へ移行\n\n" +
      "【ご自宅でのケア】\n・就寝前のフロス使用（特に右上の奥歯）\n・歯ぐきの境目を意識したブラッシング（本日指導した方法）\n\n" +
      "【次回予約】2026年6月26日（金）10:00 歯石除去（上顎）",
  },
  {
    id: "shokai",
    name: "診療情報提供書（紹介状）",
    requirement: "診療情報提供料の算定要件",
    body:
      "〇〇口腔外科クリニック 御侍史\n\n患者: 伊藤 さくら 様（29歳・女性）\n\n" +
      "いつもお世話になっております。下顎右側智歯（48）の抜歯適応についてご高診をお願いいたします。\n" +
      "パノラマX線にて48は近心傾斜半埋伏、歯冠周囲に透過像を認め、智歯周囲炎を繰り返しています（直近3ヶ月で2回）。\n" +
      "下顎管との位置関係について、貴院でのCBCT精査と抜歯のご検討をお願い申し上げます。\n" +
      "アレルギー・既往: 特記事項なし。抗凝固薬の服用なし。",
  },
  {
    id: "setsumei",
    name: "患者向け治療説明文書",
    body:
      "【今日の治療について】田中 花子 様\n\n今日は右上の奥歯（6番）の虫歯の治療をしました。\n" +
      "虫歯は神経まで達していなかったため、白い詰め物（コンポジットレジン）で治療が完了しています。\n\n" +
      "・麻酔は2〜3時間で切れます。それまで食事は反対側で噛んでください\n" +
      "・詰めた歯がしみる感じが数日続くことがありますが、徐々に落ち着きます\n" +
      "・1週間以上痛みが続く場合はご連絡ください\n\n次回は歯ぐきの治療（歯石除去）を行います。",
  },
  {
    id: "doui",
    name: "抜歯同意書",
    body:
      "抜歯処置に関する説明と同意\n\n処置内容: 下顎右側智歯（親知らず）の抜歯\n\n" +
      "【起こりうる合併症】\n・術後の腫れ・痛み（2〜3日がピーク）\n・出血（圧迫止血で対応）\n" +
      "・下唇のしびれ（下歯槽神経麻痺: 発生率は低いものの可能性あり）\n・ドライソケット（治癒不全）\n\n" +
      "上記について説明を受け、内容を理解した上で処置に同意します。\n\n日付:        署名:",
  },
];

export function DocumentsScreen() {
  const toast = useToast();
  const [activeId, setActiveId] = useState("kanri");
  const [issued, setIssued] = useState<Set<string>>(new Set());
  const active = TEMPLATES.find((t) => t.id === activeId)!;

  return (
    <div className="clinical" style={{ gridTemplateColumns: "minmax(300px, 3fr) minmax(460px, 6fr)" }}>
      <div className="card">
        <div className="card-head"><h2>文書テンプレート</h2></div>
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {TEMPLATES.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`doc-item ${activeId === t.id ? "active" : ""}`}
              onClick={() => setActiveId(t.id)}
            >
              <span style={{ fontWeight: 700 }}>📄 {t.name}</span>
              <span style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {t.requirement && <span className="chip warn" style={{ fontSize: 10 }}>{t.requirement}</span>}
                {issued.has(t.id) && <span className="chip ok" style={{ fontSize: 10 }}>✓ 本日交付済み</span>}
              </span>
            </button>
          ))}
          <div className="tiny" style={{ marginTop: 6 }}>
            💡 「算定要件」の付いた文書は、交付の記録がないとレセプト点検で警告になります。
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{active.name}</h2>
          <span className="chip ai" style={{ marginLeft: "auto" }}>✦ カルテから自動生成（下書き）</span>
        </div>
        <div className="card-body">
          <div className="doc-preview">{active.body}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button type="button" className="btn ghost-ai" onClick={() => toast("カルテの最新内容から文面を再生成しました", "info")}>✦ 再生成</button>
            <button type="button" className="btn">編集</button>
            <button
              type="button"
              className="btn primary"
              style={{ marginLeft: "auto" }}
              disabled={issued.has(active.id)}
              onClick={() => {
                setIssued((prev) => new Set(prev).add(active.id));
                toast(`「${active.name}」を印刷し、交付を診療録に記録しました${active.requirement ? "（算定要件を充足）" : ""}`);
              }}
            >
              🖨 印刷して交付を記録
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
