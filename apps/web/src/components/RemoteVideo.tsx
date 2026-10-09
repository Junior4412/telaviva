import { useEffect, useRef, useState } from "react";

/**
 * Vídeo remoto de um participante que está compartilhando a tela.
 *
 * Começa com `muted` porque a política de autoplay dos navegadores bloqueia
 * vídeo com som antes de interação do usuário. Quando a transmissão tem
 * trilha de áudio, um botão de som aparece sobre o vídeo — e clicar nele é
 * justamente a interação que libera o autoplay com áudio.
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
  const [muted, setMuted] = useState(true);

  // A trilha de áudio pode chegar junto com o vídeo ou depois (renegociação
  // do WebRTC). O pai re-renderiza quando o mapa de fluxos muda, então
  // recalculamos aqui a cada render.
  const hasAudio = stream
    .getAudioTracks()
    .some((track) => track.readyState === "live");

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

  // O React não reflete mudanças na propriedade `muted` de forma confiável,
  // então sincronizamos o estado manualmente (o `muted` do JSX cuida do
  // valor inicial, antes de qualquer autoplay).
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  /** Liga/desliga o som — o clique fornece a interação exigida pelo autoplay. */
  const toggleSound = (): void => {
    const element = videoRef.current;
    if (!element) return;
    const next = !muted;
    element.muted = next;
    setMuted(next);
    if (!next) void element.play().catch(() => undefined);
  };

  return (
    <div className="relative size-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
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

      {/* Controle de som — só existe quando a transmissão tem áudio. */}
      {hasAudio && (
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={!muted}
          aria-label={
            muted ? `Ativar som de ${label}` : `Desativar som de ${label}`
          }
          title={muted ? "Ativar som" : "Desativar som"}
          className="absolute bottom-3 right-3 z-10 rounded-lg border border-white/10 bg-base-950/70 px-2.5 py-1.5 text-xs font-medium text-ink-200 backdrop-blur transition-colors hover:bg-base-800 hover:text-ink-50"
        >
          {muted ? "🔇 Ativar som" : "🔊 Desativar som"}
        </button>
      )}
    </div>
  );
}
