import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "info" | "success" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const KIND_STYLES: Record<ToastKind, string> = {
  info: "border-base-600/60 bg-base-800 text-ink-100",
  success: "border-accent-500/40 bg-base-800 text-accent-300",
  error: "border-danger-500/40 bg-base-800 text-danger-400",
};

/**
 * Provedor de toasts efêmeros.
 *
 * Notificações curtas para ações como "link copiado" ou erros de conexão.
 * Auto-expiram e nunca bloqueiam a interface.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current, { id, kind, message }]);
      window.setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={[
              "pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-2.5",
              "text-sm shadow-xl backdrop-blur animate-slide-up",
              KIND_STYLES[toast.kind],
            ].join(" ")}
          >
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Fechar aviso"
              className="text-ink-500 transition-colors hover:text-ink-100"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Hook para disparar toasts de qualquer componente. */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast precisa estar dentro de <ToastProvider>.");
  }
  return context;
}
