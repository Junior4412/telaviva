import { useId, type InputHTMLAttributes, type ReactNode } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  /** Mensagem de erro exibida abaixo do campo. */
  error?: string | null;
  /** Texto auxiliar exibido abaixo do campo quando não há erro. */
  hint?: string;
}

/**
 * Campo de formulário com label, mensagem de erro e acessibilidade.
 *
 * O `useId` liga o `<label>` ao `<input>` corretamente, e `aria-invalid` +
 * `aria-describedby` deixam o erro acessível para leitores de tela.
 */
export function Field({ label, error, hint, id, className = "", ...rest }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink-300">
        {label}
      </label>

      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          "w-full rounded-xl border bg-base-900 px-3.5 py-2.5 text-ink-100",
          "placeholder:text-ink-700 transition-colors duration-150",
          "disabled:cursor-not-allowed disabled:opacity-60",
          error
            ? "border-danger-500/60 focus:border-danger-400"
            : "border-base-700 focus:border-accent-500",
          className,
        ].join(" ")}
        {...rest}
      />

      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-danger-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-ink-700">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
