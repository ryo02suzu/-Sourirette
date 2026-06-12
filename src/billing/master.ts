/**
 * 公式マスタ（支払基金 基本マスタ）の参照層。
 *
 * 原則: 点数・名称をコードにハードコードしない。算定エンジンは必ずこの層を通じて
 * 「診療日時点で有効な」マスタ行を引く。マスタは適用期間付きで複数世代が共存する
 * （診療報酬改定・毎月の追補に対応するため）。
 *
 * 実運用では支払基金が公開する CSV を取込む。カラムレイアウトは公式の
 * マスタファイル仕様書に従って実装すること（推測で実装しない）。
 */

export interface ProcedureMasterRow {
  code: string;
  name: string;
  points: number;
  /** 適用開始日（ISO 8601）。改定・追補での点数変更は新しい行として追加する */
  validFrom: string;
  /** 適用終了日。undefined = 現在も有効 */
  validTo?: string;
}

export interface MasterRepository {
  /** 診療日時点で有効な診療行為マスタ行を返す。存在しなければ undefined */
  findProcedure(code: string, onDate: string): ProcedureMasterRow | undefined;
}

/** テスト・開発用のインメモリ実装。本番は PostgreSQL（m_procedure 等）を背後に持つ。 */
export class InMemoryMaster implements MasterRepository {
  private readonly rows = new Map<string, ProcedureMasterRow[]>();

  add(row: ProcedureMasterRow): void {
    const list = this.rows.get(row.code) ?? [];
    list.push(row);
    this.rows.set(row.code, list);
  }

  findProcedure(code: string, onDate: string): ProcedureMasterRow | undefined {
    return this.rows
      .get(code)
      ?.find((r) => r.validFrom <= onDate && (r.validTo === undefined || onDate <= r.validTo));
  }
}
