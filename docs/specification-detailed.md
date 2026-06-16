# Sourirette 詳細仕様書

レセコン一体型 歯科電子カルテ — モジュール・型・アルゴリズム・レコード・コード体系の技術リファレンス

| 項目 | 内容 |
|---|---|
| 対象読者 | 開発者・保守者・突合検証者 |
| 準拠改定 | 令和8年度診療報酬改定（令和8年6月1日施行） |
| 文書バージョン | 1.0（2026-06-15 実装基準） |
| 上位文書 | 概要は `docs/specification.md`。本書はその細目 |
| 検証 | `npm test` 199件パス |

> 本書は実装の細部（型・定数・分岐）を正確に記述する。点数・コードはハードコードせず
> 公式マスタ由来。コード体系（別表6/20/21等）は仕様固定の分類記号でハードコード対象外。

---

## 0. モジュール構成と依存方向

```
domain/         ドメイン型（純粋・依存なし）
  types.ts      Patient/Visit/Diagnosis/PerformedProcedure/TimeClass/ageAt
  tooth.ts, tooth-code.ts   歯式（FDI⇔6桁）
  chart.ts      カルテ確定・ハッシュ連鎖（node:crypto）
  perio.ts      P検

billing/        算定（src/billing 配下は fs 非依存＝ブラウザ可）
  engine.ts             CalculationEngine / Rule / ClaimLine / CalculationIssue
  master.ts             MasterRepository / InMemoryMaster
  master-loader.ts      Shift_JIS復号・診療行為マスタパース・normalizeDate
  disease-loader.ts     傷病名マスタパース・コード索引・名称索引
  betsu1-loader.ts      別表Ⅰ・区分⇔コード・摘要欄コメント
  tensuhyo-loader.ts    電子点数表（回数/背反/包括）
  rule-tables.ts        データ駆動ルール工場
  rules-db-loader.ts    調査DBパース・病名トークン解決・診断
  rules/basic-visit.ts, additions.ts, site-diagnosis.ts
  accounting.ts         費用区分集計
  copayment.ts          窓口負担・高額療養費
  clinic.ts             医院プロファイル
  official-engine.ts    工場（全結線）

alerts/         types.ts / engine.ts / store.ts
karte/          store.ts（KarteStore）
receipt/        records.ts / uke.ts / build.ts / from-claim.ts / validate.ts /
                receipt-type.ts / resubmit.ts / process.ts / batch.ts /
                submission-sim.ts / shift-jis.ts / cli.ts / clinic-sim.ts
server.ts, batch-cli.ts, shiken-cli.ts, verify-plan-cli.ts
```

依存方向は一方向: `domain → billing → receipt → (server/cli)`。`alerts`/`karte` は `billing`/`domain` に依存。循環なし。

---

## 1. ドメイン型（`src/domain/types.ts`）

```ts
type VisitType = "first" | "followup";              // 初診 / 再診
type TimeClass = "regular" | "afterHours" | "holiday" | "midnight";
interface Patient   { id: string; birthDate: string /*YYYY-MM-DD*/; sex: "M"|"F"; }
interface Visit     { id; patientId; visitDate /*YYYY-MM-DD*/; visitType; timeClass?; }
interface Diagnosis { diseaseCode; modifierCodes?: string[]; teeth?: string[] /*FDI2桁*/;
                      onsetDate; outcome?: "cured"|"died"|"stopped"|"transferred"; }
interface PerformedProcedure { procedureCode; teeth?: string[]; quantity: number; }
```

`ageAt(birthDate, onDate): number` — YYYY-MM-DD を**整数比較**で年齢算出（`new Date` のUTC解釈を避け
タイムゾーン非依存）。誕生日当日＝満年齢（境界は `om<bm || (om===bm && od<bd)` で1減算）。

---

## 2. 算定エンジン中核（`src/billing/engine.ts`）

### 2.1 型

```ts
interface ClaimLine {
  procedureCode; name; points: number; quantity: number;
  teeth?: string[]; category?: string /*別表20診療識別*/;
  additions?: { code: string; quantity?: number }[];
}
interface CalculationIssue {
  severity: "error"|"warning"; ruleId; message; procedureCode?;
  excludesFromBilling?: boolean;   // true=この行を請求対象から除外（包括等）
}
interface CalculationResult { lines: ClaimLine[]; issues: CalculationIssue[]; totalPoints: number; }
interface Rule { id; validFrom; validTo?; evaluate(ctx): { lines?; issues? }; }
interface CalculationContext { patient; visit; procedures; diagnoses; history; facility; master; }
interface CalculationHistory { countInMonth(code, visitDate): number; /*当日を除く*/ }
```

### 2.2 `CalculationEngine.calculate(ctx)` アルゴリズム

1. 各ルールを配列順に評価。診療日が `[validFrom, validTo]` 外のルールはスキップ（`date < validFrom || (validTo && date > validTo)`、ISO文字列比較）。
2. 全ルールの `lines` を `allLines` に、`issues` を集約。
3. **包括等の除外適用**: `issues` のうち `excludesFromBilling===true` かつ `procedureCode` 有りのコード集合を作り、`allLines` からそのコードの行を除外 → `lines`。
4. `totalPoints = Σ lines[i].points × lines[i].quantity`（除外後）。

> 設計原則: エンジンは確定しない（最終確定は歯科医師）。ただし包括除外・自動加算など
> 機械的に一意な事項は適用する。`issues` は除外後も保持（指摘は消さない）。

---

## 3. データ層 — パース仕様

### 3.1 Shift_JIS / 共通（`master-loader.ts`）
- `decodeSjis(Uint8Array): string` — Shift_JIS復号。
- `parseCsvLine(line): string[]` — CSV分割。
- `normalizeDate(raw): string|undefined` — `YYYYMMDD` → `YYYY-MM-DD`。`""`/`"0"`/`"00000000"`/`"99999999"` と8桁数字以外は `undefined`（無期限）。**出力はISO**（`asOf` と同形式で比較）。

### 3.2 診療行為マスタ（`h_ALL20260611.csv`）
- `parseDentalProcedureMaster(text): DentalProcedureRow[]` → `{ code, name, points, validFrom, validTo? }`。
- `InMemoryMaster.findProcedure(code, onDate)` — 診療日時点で有効な世代を返す。3,748コード。

### 3.3 傷病名マスタ（`b_*.txt` 全 + `hb_*.txt` 歯科）
- レイアウト: 項番2=識別("B")、3=コード(7桁)、4=移行先、5=基本名称桁、6=基本名称、7=省略名称桁、8=省略名称、9=カナ桁、10=カナ。
- `parseDiseaseMaster(utf8): DiseaseRow[]` → `{ code, name, shortName, kana, transferTo? }`（識別"B"・7桁コードのみ）。
- `buildDiseaseIndex(rows): Map<code, row>`（コード検証用）。
- `buildDiseaseNameIndex(rows): Map<name|shortName, code[]>`（和名トークン解決用）。b+hb 合算で約35,716件。
- `isKnownDiseaseCode(code, index)` — `"0000999"`（未コード化）は常に真。

### 3.4 電子点数表（`tensuhyo-loader.ts`）

**算定回数（04）** `santeiKaisuToFrequencyLimits(rows, asOf): FrequencyLimit[]`
- `FrequencyLimit { code; maxCount; per: "month"|"day"; note }`。
- 加算コード`00000`の行のみ・期間有効・`maxCount>0`。期間は`月`/`日`のみ正規化（週/歯/個/一連/口腔は対象外）。`code/per` で重複排除（先勝ち）。→ 有効1,341件。

**背反（03-1〜03-5）** `haihanToMutualExclusions(rows, scope, asOf): MutualExclusion[]`
- `MutualExclusion { codeA; codeB; scope: "same-day"|"same-month"; note }`、`codeA < codeB` 正規化で対称重複排除。基本行為どうし（加算`00000`）のみ。
- スコープ表 `HAIHAN_TABLE_SCOPE`: `03-1=same-day` / `03-2=same-month` / `03-3=same-day`(同時≈同日・保守的) / `03-4=unsupported`(同一部位) / `03-5=unsupported`(週)。→ 同日4,494＋同月918＝5,412件取込（official-engineは03-1+03-2を使用）。

**包括（01補助マスター×02包括）**
- `parseHojoMasterGroups → Map<group, Set<親code>>`、`parseHokatsuChildren → Map<group, Set<子code>>`。
- `createInclusionGroupRule(parents, children, validFrom, scope="same-day")` — 子→グループ→親を索引化。子と同日（scope）に親が算定されていれば、子に `error + excludesFromBilling:true` を付す。→ 有効56グループ。

### 3.5 別表Ⅰ（`betsu1_shika_20260601.csv`）
- `Betsu1Entry { kubun; recordingNote; commentCode; displayText; ... }`。コメントコード無し行は除外。
- `buildCodeToKubun(masterText): Map<9桁code, 区分>` / `buildKubunToCodes` / `codesForKubun`。
- `requiredCommentsFor(code, codeToKubun, betsu1Index)` — 処置コード→区分→コメント候補。189件。

### 3.6 算定ルール調査DB（`data/rules/santei-rules-R8.json`）
- キー: `meta`, `disease_master`(24), `diagnosis_procedure`(60), `facility_standard`(26), `age_time_site`(36), `computer_check`(13)。
- `diagnosis_procedure` 各: `{ id; procedure_kubun; procedure_codes[]; procedure_name; required_diseases[]; forbidden_diseases[]; relation:"適応"|"不適応"; source; confidence:"high"|"medium"|"low"; severity; requires_dentist_review; needs_code_mapping?; needs_verification?; note }`。
- `facility_standard` 各: `{ id; standard_name; besshi5_code; gated_procedure_codes[]; requirement_summary; source; confidence; requires_dentist_review }`。
- `age_time_site` 各: `{ id; type:"年齢"|"時間"|"時間外"|"部位"|"回数"|"通則"; procedure_codes[]; kubun; condition; value; source; confidence; needs_code_mapping? }`。

> 出所と信頼度: リサーチ起源・一部未検証（`needs_verification`/`needs_code_mapping`）。テストは
> 「コード通り動く」ことの証明であって「ルールが正しい」ことではない。最も不確実な
> diagnosis_procedure は warning 非ブロック、施設基準ゲートは加算コード未特定分を無効化。

---

## 4. 病名トークン解決（`rules-db-loader.ts`）

`resolveDiseaseCodes(token, resolver): string[]` — `resolver = { abbrToCodes; nameToCodes? }`。
1. `UNRESOLVABLE_TOKEN = /以外|→|複数回|算定なし|疑い病名/` に一致＝解決しない（プロセス記述）。
2. `/` で分割（併記＝OR）。各部について:
   - 7桁数字ならコードとして採用。
   - 括弧 `（…）`/`(...)` 内の和名を抽出。括弧と末尾限定句 `(単独|のみ|等)+$` を除いた残りを `bare`。
   - `abbrToCodes[bare]`（disease_master略号）・`nameToCodes[和名]`・`nameToCodes[bare]` を合算。

`reportUnresolvedDiseaseTokens(db, resolver): {ruleId, field, token}[]` — 故意未解決を除き、解決0件のトークンを列挙（現状11件・`docs/curation-backlog.md`）。`official-engine` が `counts.unresolvedDiseaseTokens` と `unresolvedDiseaseTokens[]` で露出。

`buildDiagnosisRequirements(db, kubunToCodes, nameToCodes?)` — `relation==="不適応"` のみ `DiagnosisRequirement{ code, forbiddenDiseaseCodes, severity:"warning", note }` 化。`procedure_codes` 空なら区分から9桁展開。`code#forbidden` で重複排除。→ 85ルール。

---

## 5. 自動加算ルール（`rules/additions.ts`）

初診料/再診料が算定済みのとき、年齢（6歳未満）と `timeClass` から加算をマスタ**正式名称**で解決し付与。

| base | timeClass | infant | 解決名称 |
|---|---|---|---|
| 初診 | regular | true | 乳幼児加算（初診） |
| 初診 | afterHours/holiday/midnight | false | 時間外/休日/深夜加算（初診） |
| 初診 | 同上 | true | 乳幼児時間外/休日/深夜加算（初診） |
| 再診 | regular | true | 乳幼児加算（再診） |
| 再診 | afterHours… | false | 時間外/休日/深夜加算（再診）（入院外） |
| 再診 | 同上 | true | 乳幼児時間外/休日/深夜加算（再診）（入院外） |
| 初診/再診 | regular | false | （加算なし） |

- 判定: `SHOSHIN_KUBUN={A000}` / `SAISHIN_KUBUN={A001,A002}`。両方存在＝error（初再診併算定）で加算しない。
- `buildAdditionIndex(masterRows)` が上記名称→`{code,points}` を構築。名称がマスタに無ければ付与しない。
- 既に同コードが手入力済みなら二重付与しない。付与行は `category:"11"`、`quantity:1`。

---

## 6. アラートエンジン（`alerts/engine.ts`）

`evaluateAlerts(input: AlertInput, cfg: AlertConfig): Alert[]`。`cfg = { rulesDb; codeToKubun; diseaseNameToCodes?; acknowledged? }`。

### 6.1 前処理
- `billedByKubun: Map<区分, code[]>`、`billedCodes: Set`、`billedKubuns: Set` を入力 procedureCodes から構築。
- `matchedCodes(kubunField, procCodes?)` — procedure_codes の billed 該当 ∪ kubunField（`/`分割・`/[A-Z]\d{3}(?:-\d+)?/` で区分抽出）の billed 該当。

### 6.2 セクション1: 病名↔処置（不適応のみ）
- 各 `diagnosis_procedure` で `matchedCodes` ヒット時、`forbidden_diseases` を解決し患者病名に一致があれば `warning` を1件（`hits[0]`）。`forbiddenSeen=Set(code#disease)` で同一(処置×病名)を1件集約。
- **「対応病名なし（required欠落）」は発火させない**（適応≠必須＝誤検知の温床）。

### 6.3 セクション2: 施設基準（error）
- `input.notifiedStandards` 指定時のみ。`besshi5_code` が未届かつ `gated_procedure_codes` がbilled該当 → `error` を施設基準あたり1件。

### 6.4 セクション3: 年齢/時間/部位（proposal）
- `age_time_site` で `matchedCodes` ヒット時 `proposal`。`type==="その他"` は除外。`ageConditionExcluded`（"N歳未満"に患者年齢が該当しない）なら除外。
- **自動加算が担当する初診/再診（区分 A000/A001/A002）は提案しない**（二重提示防止）。

### 6.5 最終集約・既読
- `acknowledged` に含む contextKey は除外（`push` 時）。
- 末尾で `(ruleId × diseaseCode)` の重複を1件に集約。
- `Alert { level; category; ruleId; title; message; source; procedureCode?; diseaseCode?; contextKey; requiresDentistReview }`。`contextKey = ruleId#disease#proc`（`makeContextKey`）。
- 結果: 正常レセプト0件、誤り（抜髄×Per）1件。

---

## 7. UKE レコード定義（`records.ts`）— 全16レコード

モード: `num`=半角数字(小数点可) / `alnum`=半角英数 / `kanji`=全角 / `alnum-or-kanji`=いずれか一方（混在不可）。`fixed`=最大バイトちょうど記録。算定日情報=1〜31日の各3バイト数字（SS/SI/IY/TO）。

| Rec | 主要フィールド（モード/バイト） |
|---|---|
| **UK** 受付 | 審査支払機関(num1F)・都道府県(num2F)・点数表(num1F)・医療機関(num7F)・名称(kanji40)・請求年月(num6F)・届出(alnum40)・マルチVol(num2F) |
| **IR** 医療機関 | 同上＋電話(alnum15)・届出(alnum40) |
| **RE** 共通 | レセプト番号(num6)・種別(num4F)・診療年月(num6F)・氏名(alnum-or-kanji40)・男女(num1F)・生年月日(num8F)・給付割合(num3)・診療開始日(num8)・転帰(num1)・特記(alnum10)・カルテ番号(alnum20)・カナ氏名(kanji80)… |
| **HO** 保険者 | 保険者番号(alnum8F)・記号(alnum-or-kanji38)・番号(38)・診療実日数(num2)・合計点数(num8)・職務上事由(num1)・負担金額(num9)… |
| **KO** 公費 | 負担者番号(alnum8F)・受給者番号(num7)・任意給付(num1)・診療実日数(num2)・合計点数(num8)・負担金額(num8)・公費給付対象一部負担金(num6) |
| **SN** 資格確認 | 負担者種別(num1F)・確認区分(num2F)・保険者番号(alnum8)・記号(38)・番号(38)・枝番(alnum2)・受給者番号(num7) |
| **JD** 受診日 | 負担者種別(num1F)＋31日（各num1） |
| **MF** 窓口負担額 | 窓口負担額区分(num2F)＋31予備(各num9) |
| **HS** 傷病名部位 | 診療開始日(num8)・転帰(num1)・歯式コード(alnum384=6B×64)・傷病名コード(num7F)・修飾語(alnum80=4B×20)・傷病名称(kanji40)・主傷病(num2)・コメントコード(num9)… |
| **SS** 歯科診療行為 | 診療識別(num2)・負担区分(alnum1F)・診療行為コード(num9F)・数量1/2(num8)・**加算コード×35(alnum5)＋加算数量×35(num8)**・点数(num7)・回数(num3)＋31日 |
| **SI** 医科診療行為 | 診療識別・負担区分・コード(num9F)・数量(num8)・点数(num7)・回数(num3)＋31日 |
| **IY** 医薬品 | 診療識別・負担区分・医薬品コード(num9F)・使用量(num11)・点数(num7)・回数(num3)・**医薬品区分(alnum1)**＋31日 |
| **TO** 特定器材 | 診療識別・負担区分・コード(num9F)・使用量(num9)・単位(num3)・単価(num11)・加算等×2・商品名(kanji300)・点数(num7)・回数(num3)＋31日 |
| **CO** コメント | 診療識別・負担区分・コメントコード(num9F)・文字データ(kanji400)・歯式(alnum384) |
| **SJ** 症状詳記 | 区分(num2)・データ(kanji2400) |
| **GO** 請求書 | 総件数(num6)・総合計点数(num10)・マルチVol(num2F) |

### 7.1 直列化・エンコード（`uke.ts`）
- `serializeRecord` — 識別子＋フィールドをカンマ連結。フィールド内に `, " \r \n \x1a` を禁止（引用符規定）。
- `serializeFile` — 各レコード末尾 CR+LF。
- `encodeUkeFile` — Shift_JIS化 ＋ 末尾に **EOF 0x1A** を1個付与。
- `decodeUkeFile` — EOF除去・Shift_JIS復号・行分割（末尾空行除去）。`encode→decode` は厳密往復。

### 7.2 算定日マージ・診療識別グループ化（`from-claim.ts`）
- `mergeMonthlyLines` — `lineKey = code#category#points#additions` で同一算定単位を1行に。受診日ごとに `daily[day]+=quantity`、`回数 = Σdaily`（＝算定日合計、validate と整合）。
- `buildDetailRecords` — SSを**診療識別（別表20）昇順**にソートし、同一識別の2件目以降は診療識別を**省略**（空）。
- `診療実日数 = Distinct(算定行が1件以上ある受診日)`（算定ゼロの受診は数えない）。

---

## 8. コード体系（`receipt-type.ts`）

### 8.1 レセプト種別（別表6・歯科4桁）`determineReceiptType`
- 第1桁=`3`（歯科固定）。
- medical: `31` + (1+公費種数) + 第4桁。koki: `33` + (1+公費種数) + 第4桁。public-only: `32` + 公費種数 + (入院`1`/入院外`2`)。
- 第4桁（医保）[入院,入院外]: principal=[1,2]/preschool=[3,4]/family=[5,6]/elderly-general=[7,8]/elderly-7=[9,0]。koki: general=[7,8]/7=[9,0]。

### 8.2 負担区分（別表21）`determineBurden(payers)`
- `[医保, 公費①〜④]` の true/false 5ビット → 記号。例: `10000→1`, `11000→2`, `01000→5`, `00100→6`, `11111→9`, `11110→V` … （全32通りの `BURDEN_TABLE`）。
- 男女: `sexCode` M→1/F→2。転帰: `outcomeCode` 継続→1/治癒→2/死亡→3/中止転医→4。

---

## 9. 提出前自己点検（`validate.ts`）— L1/L2 全コード

`validateUkeRecords(records, { isKnownDiseaseCode? }): ValidationIssue[]`。`ValidationIssue { severity:"reject"|"review"; code; message; receiptNo? }`。`isSubmittable` = reject 0件。

| コード | 重大度 | 内容 |
|---|---|---|
| 1001 | reject | レコード空 |
| 1002/1003 | reject | 先頭UK/末尾GOでない |
| 1004/1005 | reject | UK/GOが1個でない |
| 1006 | reject | レセプト0件 |
| 1007/1008 | reject | GO総件数/総合計点数 不整合 |
| 2001/2002/2003 | reject | IR先頭でない/RE無し/IR次がREでない |
| 2004 | reject | レセプト種別が歯科(3始まり4桁)でない |
| 2005/2006 | reject | 未知識別子/出現順序不正 |
| 2007/2008/2009 | reject | HO/KOいずれか必須/HO複数/KO>4 |
| 2010/2011 | reject | 保険者/公費番号チェックデジット不正 |
| 2012/2013 | reject | HS無し/HS≥100件 |
| 2014 | reject | 明細(SS/SI/IY/TO)無し |
| 2015 | reject | 回数≠算定日合計 |
| 2016 | reject | 傷病名コード不在（オプション検証時） |

- チェックデジット `isValidPayerNumberCheckDigit`: 上位7桁×ウェイト[2,1,2,1,2,1,2]、各積の桁和合計 → `(10-合計%10)%10` が8桁目と一致。
- 回数突合 `dailyTotalMatchesCount`: 末尾31項目=算定日、回数位置は識別子別オフセット（**IY=末尾33番目**＝医薬品区分の分手前／他=末尾32番目）。
- 提出可否（`process.ts`）: `isSubmittable(validation) && !(算定エンジンのerrorで excludesFromBilling≠true が存在)`。＝**背反・初再診競合・不正コード・部位不一致は提出不可／包括は除外済みで提出可**。

---

## 10. 確認試験シミュレータ（`submission-sim.ts`）

`runKakuninShiken(ukeBytes, { isKnownDiseaseCode? }): KakuninShikenResult`。
1. `decodeUkeFile(ukeBytes)` で受付側として復号し直す（Shift_JIS化やレコード破損をここで露見）。
2. `validateUkeRecords`。`l1=reject&code^1`、`l2=reject&code^2`、`review`。
3. `stage = l1>0?"受付不能":l2>0?"返戻":"合格"`、`passed = isSubmittable`。`report` に結果通知テキスト。
- 形式・構造の確認試験の再現。審査委員の医学的判断（査定）は再現しない。

---

## 11. 会計

### 11.1 費用区分（`accounting.ts`）
- 区分アルファベット→費用区分: A=初・再診料/B=医学管理等/C=在宅医療/D=検査/E=画像診断/F=投薬/G=注射/H=リハ/I=処置/J=手術/K=麻酔/L=放射線治療/M=歯冠修復及び欠損補綴/N=歯科矯正、不明=その他。
- `buildAccounting(lines, codeToKubun)` → `{ byCategory[]（別紙様式2順・0除く）, detail[], totalPoints }`。

### 11.2 高額療養費（`copayment.ts`）
- 入力: `{ totalPoints; birthDate; copayRatio; category; onDate; isMultiple?; applyCapAtWindow? }`。
- `grossMedicalCost = totalPoints × 10`、`burdenBeforeCap = round10(gross × copayRatio)`。
- `monthlyLimit`: `isMultiple` なら多数回額。`threshold>0` なら `base + max(0, gross-threshold)×1%`、それ以外 `base`。
- `windowBurden = applyCap ? min(burdenBeforeCap, limit) : burdenBeforeCap`、`highCostBenefit = burdenBeforeCap - windowBurden`。

| 区分(70歳未満) | base | threshold | 多数回 |
|---|---|---|---|
| ア | 252,600 | 842,000 | 140,100 |
| イ | 167,400 | 558,000 | 93,000 |
| ウ | 80,100 | 267,000 | 44,400 |
| エ | 57,600 | — | 44,400 |
| オ | 35,400 | — | 24,600 |

70歳以上: 現役Ⅲ/Ⅱ/Ⅰ=ア/イ/ウと同式、一般 57,600/44,400、低所得Ⅱ 24,600、低所得Ⅰ 15,000。
※ 70歳以上一般の外来個人上限(18,000)・世帯合算は未実装（入力委ね）。

---

## 12. 電子カルテ保存（`domain/chart.ts` + `karte/store.ts`）

### 12.1 chart.ts（真正性の核）
- `ChartEntry { id; visitId; supersedesId?; status:"draft"|"final"; soap:{S,O,A,P}; authoredBy; finalizedBy?; finalizedAt?; contentHash? }`。
- `finalizeEntry(entry, by, at, prevHash)` — SHA-256(`{prev, visitId, supersedes, soap, authoredBy, finalizedBy, finalizedAt}`) を `contentHash` に。確定済み再確定不可。
- `reviseEntry(original, soap, by)` — 確定済みのみ訂正可。新draft（`supersedesId=original.id`）。
- `verifyChain(entries)` — 全件 final・`contentHash` 一致・連鎖（prev）整合で true。

### 12.2 KarteStore（運用機能）
- 役割別権限 `PERMISSIONS`: dentist={append,finalize,revise,read,export}、hygienist={append,revise,read}、reception={read}、admin={read,export}。違反は `AccessDeniedError`。
- `appendFinal/reviseFinal/read/readableText/verifyIntegrity/auditTrail/exportBackup` ＋ `static importBackup`。
- 監査証跡: 全操作を `AuditRecord{seq,at,userId,role,action,patientId,entryId?,hash}` で記録、ハッシュ連鎖で改ざん検知。
- バックアップ: AES-256-GCM（scryptで鍵導出、salt/iv/tag付き）。パスワード不一致・改ざんは復元時に例外。

---

## 13. API（`server.ts`）

`npm run serve`、:8787、CORS `*`、Node標準httpのみ。

- `GET /api/health` → `{ ok:true, counts:{ frequencyLimits, mutualExclusions, inclusionGroups, betsu1Entries, diseases, diagnosisRules, unresolvedDiseaseTokens } }`。
- `POST /api/receipt`（body=`ProcessReceiptInput`）→ `ProcessReceiptResult`:
  `{ recordsText; ukeBase64; recordCount; byteLength; totalPoints; visitDays; validation[]; submittable; algorithmIssues[]; commentCandidates[]; missedChargeHints[]; alerts[]; accounting; copayment? }`。
  エラー時 4xx＋`{ error }`。

---

## 14. CLI / npm スクリプト

| コマンド | 動作 |
|---|---|
| `npm test` | tsc＋node:test 199件 |
| `npm run build` | tsc |
| `npm run serve` | 算定サーバ :8787 |
| `npm run uke:demo` | デモUKE生成＋自己点検 |
| `npm run batch` | 複数レセプト→1 UKE |
| `npm run clinic:sim` | 仮想医院シミュレータ（回数/背反/包括の発火確認） |
| `npm run shiken` | 確認試験（仮想） |
| `npm run verify:plan` | 研鑽優先順位リスト再生成（docs/verification-priority.md） |
| `npm run verify:reconcile [path]` | 実医院突合（既存レセコンUKE↔当エンジン再計算のdiff・P0-2）。path省略でセルフデモ |

---

## 15. テスト内訳（199件・22ファイル）

uke(26)・validate(16)・receipt-mapping(16)・process(16)・official-engine(16)・alerts(16)・
karte-store(10)・tensuhyo-loader(9)・rule-tables(9)・betsu1-loader(8)・additions(8)・copayment(7)・
engine(6)・tooth(5)・master-loader(5)・perio(4)・disease-loader(4)・clinic(4)・chart(4)・
alerts-store(4)・batch(3)・accounting(3)。

**CSV由来層の回帰ロック**（改定追補でCSV形式がズレたら大声で落ちる）:
- 回数: 歯科初診料 月1回（parse）／月2回目=error・初回=errorなし（engine）。
- 背反: 03-1同日 301000110×302002210／03-2同月 301000110×314000310（parse）／同日背反=error（engine）。
- 包括: 抜髄⊇浸潤麻酔/根管貼薬/生活歯髄切断、感染根管⊇根管貼薬、生活歯髄切断⊇歯髄保護（engine・点数除外）／誤除外なし（初診料は残る・親不在なら子も残る）。

---

## 16. 既知の制約 / curation バックログ

- **手起こしルール層の臨床的正しさは未検証**（実医院突合＝研鑽でのみ確定）。優先順位は `docs/verification-priority.md`（Tier A→E）。
- **未解決病名トークン11件**（`docs/curation-backlog.md`）。実害は forbidden 側（脱離・義歯ハソン・義歯ハセツ・鉤ハセツ・ハセツなし）。
- **施設基準ゲート**: 加算コード未特定の任意加算（FS011/012/020 等）は誤発火防止で無効化中。
- 背反 03-3/04/05（同時/同一部位/週）未対応。診療識別省略は実機受付ASPでの確認推奨。
- DB永続化・公費併用・乳幼児医療助成・臨床UIの算定連動・様式第一号印刷は未。

---

## 17. 主要コード対応（早見）

| 種別 | 例 |
|---|---|
| 診療識別(別表20) | 11初・再診/13医学管理/31X線/41処置/…/80その他 |
| 区分(告示番号) | A000歯科初診料/A001再診/I005抜髄/I006感染根管/M009充填/J000抜歯 |
| 主要コード | 初診料301000110/再診料301000210/抜髄(単根)309002110/根管貼薬309003310/浸潤麻酔311000210 |
| 病名(例) | 歯髄炎Pul/5220063・急性根尖性歯周炎Per/8832354・う蝕8843836・慢性歯周炎8840351 |
