import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-accent-500 text-base-950 hover:bg-accent-400 disabled:bg-accent-700 disabled:text-ink-100/60 shadow-lg shadow-accent-500/10",
  secondary:
    "bg-base-700/70 text-ink-100 hover:bg-base-600/70 border border-base-600/60",
  ghost: "bg-transparent text-ink-300 hover:bg-base-800 hover:text-ink-100",
  danger:
    "bg-danger-500/15 text-danger-400 border border-danger-500/30 hover:bg-danger-500/25",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

/**
 * Botão padrão da aplicação.
 *
 * `loading` desabilita o botão e mostra um spinner, garantindo que o usuário
 * não dispare a mesma ação duas vezes enquanto ela processa.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      disabled={isDisabled}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium",
        "transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-70",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(" ")}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

/** Indicador de carregamento simples, herdando a cor do contexto. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}
