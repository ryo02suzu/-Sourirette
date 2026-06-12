/** コマンドパレット（⌘K / Ctrl+K）: 画面ジャンプ・患者検索をどこからでも。 */
import { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteAction {
  group: string;
  label: string;
  icon: string;
  hint?: string;
  run(): void;
}

interface Props {
  open: boolean;
  onClose(): void;
  actions: PaletteAction[];
}

export function CommandPalette({ open, onClose, actions }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => `${a.label} ${a.hint ?? ""}`.toLowerCase().includes(q));
  }, [actions, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  const select = (a: PaletteAction | undefined) => {
    if (!a) return;
    onClose();
    a.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter") select(filtered[index]);
  };

  let lastGroup = "";

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-inputrow">
          <span style={{ color: "var(--ink-3)" }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            placeholder="画面名・患者名・カルテ番号で検索…"
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list">
          {filtered.length === 0 && <div className="empty-note">該当なし</div>}
          {filtered.map((a, i) => {
            const showGroup = a.group !== lastGroup;
            lastGroup = a.group;
            return (
              <div key={`${a.group}-${a.label}`}>
                {showGroup && <div className="palette-group">{a.group}</div>}
                <button
                  type="button"
                  className={`palette-item ${i === index ? "active" : ""}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => select(a)}
                >
                  <span className="icon">{a.icon}</span>
                  <span>{a.label}</span>
                  {a.hint && <span className="hint">{a.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
