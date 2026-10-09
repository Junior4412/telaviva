/**
 * Identidade visual da TelaViva.
 *
 * Marca original: um retângulo de tela com um "raio" de transmissão saindo
 * do centro, sugerindo broadcast sem imitar logotipos de terceiros.
 */
export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      role="img"
      aria-label="TelaViva"
    >
      {/* Moldura da tela */}
      <rect
        x="6"
        y="10"
        width="36"
        height="24"
        rx="5"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      {/* Peana */}
      <path
        d="M18 40h12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M24 34v6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Ondas de transmissão */}
      <path
        d="M24 22c0-3.5 3-6.5 6.5-6.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d="M24 22c0-3.5-3-6.5-6.5-6.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.85"
      />
      {/* Núcleo */}
      <circle cx="24" cy="22" r="3" fill="currentColor" />
    </svg>
  );
}

/** Cabeçalho com marca e nome. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-accent-400">
        <Logo className={compact ? "size-6" : "size-7"} />
      </span>
      <span
        className={[
          "font-semibold tracking-tight text-ink-100",
          compact ? "text-base" : "text-lg",
        ].join(" ")}
      >
        Tela<span className="text-accent-400">Viva</span>
      </span>
    </div>
  );
}
