/** トースト通知。すべての操作に視覚フィードバックを返す（UXの基本原則）。 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
  kind: "success" | "info" | "error";
}

type ShowToast = (message: string, kind?: Toast["kind"]) => void;

const ToastContext = createContext<ShowToast>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const show = useCallback<ShowToast>((message, kind = "success") => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3800);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="toast-icon">{t.kind === "success" ? "✓" : t.kind === "error" ? "⚠" : "ℹ"}</span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
