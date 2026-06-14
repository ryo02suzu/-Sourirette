/**
 * 既読（承認パターン）ストア。
 *
 * 歯科医師が「これでOK」と承認したアラート（contextKey）を記録し、次回から抑制する（総量制御）。
 * まずは差し替え可能なインターフェース＋インメモリ/JSON実装。同じインターフェースで
 * DB（PostgreSQL等）実装に置き換えられる（acknowledged_pattern テーブル相当）。
 *
 * 推奨スキーマ（DB化時）:
 *   acknowledged_pattern(
 *     clinic_id text, context_key text, rule_id text, disease_code text, procedure_code text,
 *     acknowledged_by text, acknowledged_at timestamptz, note text,
 *     primary key (clinic_id, context_key))
 */
import type { AcknowledgedPattern } from "./types.js";

export interface AcknowledgmentStore {
  /** パターンを承認（既読化）する */
  acknowledge(contextKey: string, note?: string, at?: string): void;
  /** 承認を取り消す */
  revoke(contextKey: string): void;
  /** 承認済みか */
  isAcknowledged(contextKey: string): boolean;
  /** 承認済み contextKey の集合（evaluateAlerts に渡す） */
  acknowledgedKeys(): Set<string>;
  /** 全承認パターン */
  all(): AcknowledgedPattern[];
}

/** インメモリ実装（テスト・既定）。serialize で永続化用JSONを取り出せる */
export class InMemoryAcknowledgmentStore implements AcknowledgmentStore {
  private readonly map = new Map<string, AcknowledgedPattern>();

  constructor(initial: readonly AcknowledgedPattern[] = []) {
    for (const p of initial) this.map.set(p.contextKey, p);
  }

  acknowledge(contextKey: string, note?: string, at?: string): void {
    const pattern: AcknowledgedPattern = { contextKey, acknowledgedAt: at ?? new Date().toISOString() };
    if (note !== undefined) pattern.note = note;
    this.map.set(contextKey, pattern);
  }

  revoke(contextKey: string): void {
    this.map.delete(contextKey);
  }

  isAcknowledged(contextKey: string): boolean {
    return this.map.has(contextKey);
  }

  acknowledgedKeys(): Set<string> {
    return new Set(this.map.keys());
  }

  all(): AcknowledgedPattern[] {
    return [...this.map.values()];
  }

  /** 永続化用に全パターンをJSON文字列化する */
  serialize(): string {
    return JSON.stringify(this.all());
  }

  /** JSON文字列から復元する */
  static deserialize(json: string): InMemoryAcknowledgmentStore {
    const arr = JSON.parse(json) as AcknowledgedPattern[];
    return new InMemoryAcknowledgmentStore(Array.isArray(arr) ? arr : []);
  }
}
