# 算定条件リサーチ依頼プロンプト（令和8年6月版・残りギャップの収集）

このファイルは、ディープリサーチ系ツール（Web検索が使えるもの）にそのまま貼り付けて使う**依頼文**。
出力は `data/rules/santei-rules-R8.json` に**そのまま機械マージできる JSON** で受け取り、こちらで
引用マーカー除去→ローダー（`src/billing/rules-db-loader.ts`）経由でエンジンに取り込む。

---

## いまの網羅状況（このリサーチで埋めたい穴）

すでに取り込み済み（=出力に**含めなくてよい既存分**。重複は弾く）:

- 保険項目・実点数: 診療行為マスタ 3,748 コード ＝ **網羅済み**
- 機械的算定条件（電子点数表 由来）: 算定回数（回数制限）・背反（併算定不可）・包括 ＝ **網羅済み**
- 摘要欄 必須コメント（別表I 歯科 189 件）＝ **網羅済み**
- 臨床判断ルール（**ここが部分的**。今回の収集対象）:
  - 病名↔処置 適応（審査情報提供事例）: **46 / 約255 件**しか入っていない
  - 施設基準: **10 件**だけ（歯初診・外安全・外感染ほか）。歯科の全施設基準には足りない
  - 年齢/時間/部位 細則（通則・注）: **17 件**だけ。各項目の算定要件 全文は未構造化

→ 欲しいのは **(1) 残りの審査情報提供事例、(2) 歯科の全施設基準、(3) 各項目の通則・注の算定要件、
(4) 支払基金コンピュータチェック対象事例** の4種。

---

## 依頼文（ここから下をリサーチツールに貼る）

あなたは日本の歯科保険診療報酬（令和8年度改定・**令和8年6月1日施行**）の算定ルールを、
一次資料から正確に収集する調査員です。以下の4カテゴリの情報を、**指定の JSON スキーマ**で出力してください。

### 収集対象と一次資料

1. **病名↔処置の適応（審査情報提供事例 歯科）** → `diagnosis_procedure` 配列
   - 出典: 社会保険診療報酬支払基金「審査情報提供事例（歯科）」
     https://www.ssk.or.jp/shinryohoshu/sinsa_jirei/teikyojirei/shika/index.html
   - **公開されている歯科事例を全件**。各事例について「この処置にはこの病名が必要／この病名では認めない」を抽出。
   - 注意書き「画一的・一律的に適用されるものではない／最終適否は審査委員会の歯科医学的判断による」を尊重し、
     全件 `requires_dentist_review: true`、`severity` は原則 `"warning"`（明確な禁忌のみ `"error"`）。

2. **歯科の施設基準（全件）** → `facility_standard` 配列
   - 出典: 令和8年厚生労働省告示第70号・第71号、保医発0305第7号・第8号（施設基準・届出）、
     地方厚生局「施設基準の届出受理状況（歯科）」の届出区分一覧。
   - 各施設基準について「届出が無いと算定できない／減算される処置（区分番号）」を `gated_procedure_codes` に。
     歯科外来診療環境体制加算（外来環/外安全/外感染）、歯科治療時医療管理料、在宅療養支援歯科診療所、
     CAD/CAM、歯科技工士連携、口腔粘膜処置、歯科疾患管理の各加算など、**届出を要する歯科の施設基準を網羅的に**。

3. **各項目の通則・注 算定要件（年齢/時間/部位/回数きざみ等）** → `age_time_site` 配列
   - 出典: 令和8年厚生労働省告示第69号（歯科点数表）、保医発0305第6号（留意事項通知 歯科）。
   - 電子点数表に入っていない**散文の算定要件**を構造化: 乳幼児/年齢加算、時間外・休日・深夜、
     同一部位・同一歯・1口腔単位、月N回まで・週N回まで等の「注」条件を `type`（年齢/時間/部位/回数/通則）で分類。

4. **支払基金コンピュータチェック対象事例** → `computer_check` 配列
   - 出典: 支払基金「コンピュータチェック対象事例」
     https://www.ssk.or.jp/seikyushiharai/ssk_cc/ssk_cc_300320/index.html
   - 歯科に関係する本部点検条件（病名×診療行為、回数、併算定）を要約。CSV があれば該当行の論理を要約。

### 厳守ルール

- **令和8年6月版（令和8年度改定）が基準**。R6 以前発出でも現行有効なら採用し、改定で取扱い変更の疑いがある事例は
  `"needs_verification": true` を付す。
- **推測で点数・コード・条件を創作しない**。一次資料で確認できないものは出力しない（穴は穴のまま残す）。
- 区分番号（告示番号 例 A000, I005, M015-2）が分かるものは `procedure_kubun` / `kubun` に入れる。
  9桁の診療行為コードが特定できないものは `procedure_codes: []` のままにし、`needs_code_mapping: true` を付ける
  （こちらで 区分→コード を引き当てる）。
- 各エントリに **必ず `source`（告示番号・通知番号・事例番号などの一次出典）** を明記。
- 既存DBに**すでにある分は出力しない**（重複回避）。既存に含まれるもの: 抜髄/根管/歯周治療まわりの主要46事例、
  施設基準10件（歯初診・外安全・外感染ほか）、年齢/時間17件。判断に迷うものは出力し、`"possibly_duplicate": true` を付す。

### 出力フォーマット（**1つの JSON オブジェクトのみ**。前後に文章・引用カードを付けない）

```json
{
  "meta": {
    "version": "令和8年6月版（令和8年度診療報酬改定、令和8年6月1日施行）",
    "primary_sources": ["告示第69号 URL", "保医発0305第6号 URL", "告示第70/71号", "保医発0305第7/8号", "審査情報提供事例 URL", "コンピュータチェック URL"],
    "note": "収集範囲・限界・needs_verification の方針を記載"
  },
  "diagnosis_procedure": [
    {
      "id": "DPxxx",
      "procedure_kubun": "I005",
      "procedure_codes": [],
      "procedure_name": "抜髄",
      "required_diseases": ["Pul/5220063"],
      "forbidden_diseases": ["Per/8832354"],
      "relation": "適応 | 不適応",
      "source": "情提xxx",
      "confidence": "high | medium | low",
      "severity": "warning | error",
      "requires_dentist_review": true,
      "needs_code_mapping": true,
      "note": "事例の趣旨を1文で"
    }
  ],
  "facility_standard": [
    {
      "id": "FSxxx",
      "standard_name": "正式名称",
      "besshi5_code": "別表5の届出区分略称",
      "gated_procedure_codes": ["A000", "A002"],
      "requirement_summary": "未届出だと何が算定不可/減算かを1〜2文で",
      "source": "告示第70号／保医発0305第7号",
      "confidence": "high | medium | low",
      "requires_dentist_review": false
    }
  ],
  "age_time_site": [
    {
      "id": "ATxxx",
      "type": "年齢 | 時間 | 部位 | 回数 | 通則",
      "procedure_codes": [],
      "kubun": "A000",
      "condition": "適用条件（例: 6歳未満・初診）",
      "value": "加算/制限の内容（例: 乳幼児加算 40点）",
      "source": "告示第69号 A000注5／保医発0305第6号",
      "confidence": "high | medium | low",
      "needs_code_mapping": true
    }
  ],
  "computer_check": [
    {
      "id": "CCxxx",
      "check_name": "事例名",
      "target_codes": [],
      "logic_summary": "病名×診療行為/回数/併算定の判定ロジックを要約",
      "error_or_followup": "error | followup",
      "source_url": "URL"
    }
  ]
}
```

### スキーマ補足（既存DBと一致させること）

- 病名は `"略称/7桁コード"`（例 `"Pul/5220063"`）。コードが不明なら略称だけでも可、`needs_code_mapping: true`。
- `disease_master` を増やしたい場合のみ、`{abbr,name,code,also[],note,needs_code_mapping}` 形式で `disease_master` 配列に追加。
- `id` は各カテゴリ接頭辞（DP/FS/AT/CC）＋連番。既存最大番号（DP046, FS010, AT017, CC003）の**続き番号**から振る。

以上。**JSON のみ**を出力してください。

---

## 受領後のこちら側の取り込み手順（メモ）

1. 受領テキストから Claude 引用マーカー `[![](claude-citation:...)](url)` を正規表現で除去。
2. `data/rules/santei-rules-R8.json` に各配列をマージ（id 重複・`possibly_duplicate` を確認して弾く）。
3. `src/billing/rules-db-loader.ts` が `diagnosis_procedure`→DiagnosisRequirement、
   `age_time_site`→chargeHints、`facility_standard`→facilityGates を再生成。
4. `needs_code_mapping: true` の区分番号を `buildKubunToCodes` で 9桁コードへ展開。
5. `npm test` で取り込み件数の回帰を確認し、`docs/status-checklist.md` の該当行を更新。
