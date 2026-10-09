import { useEffect, useRef, useState } from "react";

/**
 * Vídeo remoto de um participante que está compartilhando a tela.
 *
 * Começa com `muted` porque a política de autoplay dos navegadores bloqueia
 * vídeo com som antes de interação do usuário. Como o MVP é só vídeo (sem
 * trilha de áudio), manter mudo não afeta nada — mas mantemos a disciplina
 * correta caso áudio seja adicionado depois.
 */
export function RemoteVideo({
  stream,
  label,
}: {
  stream: MediaStream;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasFrames, setHasFrames] = useState(false);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;

    element.srcObject = stream;

    const handlePlay = (): void => setHasFrames(true);
    element.addEventListener("playing", handlePlay);

    // `play()` pode rejeitar se o autoplay for barrado; tentamos de novo após
    // qualquer interação do usuário com a página.
    void element.play().catch(() => {
      const retry = (): void => {
        void element.play().catch(() => undefined);
      };
      window.addEventListener("pointerdown", retry, { once: true });
      window.addEventListener("keydown", retry, { once: true });
    });

    return () => {
      element.removeEventListener("playing", handlePlay);
      element.srcObject = null;
    };
  }, [stream]);

  return (
    <div className="relative size-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="size-full object-contain"
        aria-label={`Tela compartilhada por ${label}`}
      />

      {/* Placeholder até o primeiro frame chegar do par. */}
      {!hasFrames && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex items-center gap-2 rounded-full bg-base-800/80 px-3 py-1.5 text-xs text-ink-300">
            <span className="size-1.5 animate-pulse-soft rounded-full bg-accent-400" />
            conectando ao fluxo...
          </span>
        </div>
      )}

      <span className="absolute left-3 top-3 rounded-full bg-base-950/80 px-2.5 py-1 text-xs font-medium text-ink-100 backdrop-blur">
        {label}
      </span>
    </div>
  );
}
