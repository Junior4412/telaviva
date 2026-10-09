import { useEffect, useRef, useState } from "react";

/**
 * Vídeo remoto de um participante que está compartilhando a tela.
 *
 * Som vem ligado por padrão: quem assiste já clicou para entrar na sala, e
 * essa interação costuma liberar o autoplay com áudio na política dos
 * navegadores. Se ainda assim o navegador barrar, caímos para o modo mudo
 * (o vídeo continua) e tentamos de novo sozinhos na primeira interação —
 * o botão de som fica disponível o tempo todo, com volume regulável.
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
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  /** Marca quando o USUÁRIO silenciou de propósito (evita reativar sozinho). */
  const userMutedRef = useRef(false);

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

    /** Toca com som; se a política barrar, cai para mudo sem parar o vídeo. */
    const playWithSound = (): void => {
      element.muted = false;
      setMuted(false);
      void element.play().catch(() => {
        element.muted = true;
        setMuted(true);
        void element.play().catch(() => undefined);
      });
    };

    playWithSound();

    // Se o autoplay com som for barrado, a primeira interação com a página
    // libera a política — reativamos o som sozinhos, salvo se o usuário
    // tiver silenciado de propósito.
    const retry = (): void => {
      if (userMutedRef.current) {
        void element.play().catch(() => undefined);
        return;
      }
      if (element.muted) playWithSound();
    };
    window.addEventListener("pointerdown", retry);
    window.addEventListener("keydown", retry);

    return () => {
      element.removeEventListener("playing", handlePlay);
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      element.srcObject = null;
    };
  }, [stream]);

  // O React não reflete mudanças nas propriedades `muted`/`volume` de forma
  // confiável, então sincronizamos manualmente (o `muted` do JSX cuida do
  // valor inicial, antes de qualquer autoplay).
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume / 100;
  }, [volume]);

  /** Liga/desliga o som. O clique fornece a interação exigida pela política. */
  const toggleSound = (): void => {
    const element = videoRef.current;
    if (!element) return;

    if (!muted) {
      // Silencia sem perder o volume escolhido.
      userMutedRef.current = true;
      element.muted = true;
      setMuted(true);
      return;
    }

    userMutedRef.current = false;
    element.muted = false;
    setMuted(false);
    void element.play().catch(() => undefined);
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

      {/* Controles de som — só existem quando a transmissão tem áudio. */}
      {hasAudio && (
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded-lg border border-white/10 bg-base-950/70 px-2 py-1.5 backdrop-blur">
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={!muted}
            aria-label={
              muted ? `Ativar som de ${label}` : `Desativar som de ${label}`
            }
            title={muted ? "Ativar som" : "Desativar som"}
            className="rounded p-0.5 text-ink-200 transition-colors hover:text-ink-50"
          >
            {muted ? "🔇" : "🔊"}
          </button>

          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            aria-label={`Volume de ${label}`}
            title={`Volume: ${volume}%`}
            className="volume-slider"
          />
        </div>
      )}
    </div>
  );
}
