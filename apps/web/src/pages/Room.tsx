import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  DEFAULT_PARTICIPANT_NAME,
  formatRoomCode,
  toUserMessage,
  type Participant,
} from "@tela/shared";
import { Brand } from "../components/Brand";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { RemoteVideo } from "../components/RemoteVideo";
import { usePeers } from "../hooks/usePeers";
import { useRoom } from "../state/RoomContext";
import { useToast } from "../components/Toast";

/** Estado da doação de tela, isolado em um hook para a página da sala. */
interface ScreenShareState {
  isSharing: boolean;
  localStream: MediaStream | null;
  error: string | null;
  /**
   * `true` quando existe uma trilha de áudio ao vivo sendo transmitida. Pode
   * ser `false` mesmo com o compartilhamento de áudio solicitado — nem toda
   * origem (janela/monitor) oferece áudio.
   */
  hasAudio: boolean;
}

/** Retorno do hook: estado puro + ações de iniciar/encerrar. */
type ScreenShareApi = ScreenShareState & {
  start: (
    withAudio?: boolean,
  ) => Promise<{ started: boolean; hasAudio: boolean } | null>;
  stop: () => void;
};

/**
 * Hook que controla o compartilhamento de tela do próprio usuário.
 *
 * Usa `getDisplayMedia` real, sem simulação. Encerra a transmissão quando o
 * usuário clica em "Parar compartilhamento" na barra do navegador, e limpa os
 * tracks para liberar o indicador de gravação do sistema.
 */
function useScreenShare(): ScreenShareApi {
  const [state, setState] = useState<ScreenShareState>({
    isSharing: false,
    localStream: null,
    error: null,
    hasAudio: false,
  });
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    setState({ isSharing: false, localStream: null, error: null, hasAudio: false });
  }, []);

  const start = useCallback(
    async (
      withAudio = false,
    ): Promise<{ started: boolean; hasAudio: boolean } | null> => {
      // Navegadores móveis não oferecem getDisplayMedia.
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        setState((current) => ({
          ...current,
          error:
            "Seu navegador não permite compartilhar a tela. Tente no Chrome ou Edge num computador.",
        }));
        return null;
      }

      try {
        // `audio: true` pede áudio ao seletor do navegador (áudio de aba em
        // Chrome/Firefox). Nem toda origem oferece — daí a checagem abaixo.
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30, max: 60 } },
          audio: withAudio,
        });

        streamRef.current = stream;
        const hasAudio = stream.getAudioTracks().length > 0;
        setState({ isSharing: true, localStream: stream, error: null, hasAudio });

        // O usuário pode parar pela barra do próprio navegador.
        const [track] = stream.getVideoTracks();
        track?.addEventListener("ended", stop);

        return { started: true, hasAudio };
      } catch (caught) {
        const name = caught instanceof Error ? caught.name : "";
        const message =
          name === "NotAllowedError"
            ? "Você cancelou o compartilhamento da tela."
            : name === "NotFoundError"
              ? "Nenhuma janela ou tela foi encontrada."
              : "Não foi possível iniciar o compartilhamento.";
        setState((current) => ({ ...current, error: message }));
        return null;
      }
    },
    [stop],
  );

  // Ao desmontar, garante que nada fique transmitindo.
  useEffect(() => stop, [stop]);

  return { ...state, start, stop };
}

/** Linha da lista de participantes. */
function ParticipantRow({
  participant,
  isSelf,
}: {
  participant: Participant;
  isSelf: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={[
            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            isSelf
              ? "bg-accent-500/20 text-accent-300"
              : "bg-base-700/70 text-ink-300",
          ].join(" ")}
          aria-hidden="true"
        >
          {participant.name.charAt(0).toUpperCase()}
        </span>
        <span className="truncate text-sm text-ink-100">
          {participant.name}
          {isSelf && <span className="text-ink-700"> (você)</span>}
        </span>
      </div>

      {participant.isSharing && (
        <span className="shrink-0 rounded-full bg-accent-500/15 px-2 py-0.5 text-[11px] font-medium text-accent-300">
          ao vivo
        </span>
      )}
    </li>
  );
}

/**
 * Página da sala.
 *
 * Exige um `roomCode` na URL. Se o usuário ainda não entrou na sala (entrou
 * pelo link, por exemplo), mostra um formulário de nome/senha antes de
 * conectar. Depois disso, prioriza o vídeo da tela em tela cheia.
 */
export function RoomPage() {
  const { roomCode = "" } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { state, joinRoom, leaveRoom, teardown, socket } = useRoom();
  const screen = useScreenShare();

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Checkbox "Compartilhar áudio" — desligado por padrão (é opcional). */
  const [shareWithAudio, setShareWithAudio] = useState(false);
  /** Palco em tela cheia (seguindo o elemento que a API promoveu). */
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // Mantém o estado de tela cheia em sincronia — inclusive quando o usuário
  // sai pelo ESC do sistema.
  useEffect(() => {
    const handleChange = (): void => {
      setIsFullscreen(document.fullscreenElement === stageRef.current);
    };
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  const joined = state.status === "joined";
  const participants = state.participants;

  // Malha WebRTC: mantém uma conexão por participante para levar a tela até
  // eles. Precisa vir depois de `joined`/`participants` por depender deles.
  const { remoteStreams } = usePeers({
    selfId: state.selfId,
    participants,
    localStream: screen.localStream,
    active: joined,
  });

  /** Entra na sala com o nome/senha informados. */
  const handleJoin = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setJoinError(null);
      setSubmitting(true);
      try {
        await joinRoom({
          roomCode,
          name: name.trim() || DEFAULT_PARTICIPANT_NAME,
          password: password || undefined,
        });
      } catch (caught) {
        const message =
          caught && typeof caught === "object" && "message" in caught
            ? String((caught as { message: string }).message)
            : toUserMessage("INTERNAL");
        setJoinError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [joinRoom, name, password, roomCode],
  );

  /** Copia o link de convite para a área de transferência. */
  const handleCopyInvite = useCallback(async () => {
    const link = `${window.location.origin}/r/${roomCode}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.push("Link de convite copiado!", "success");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback para navegadores/contexts sem clipboard assíncrono.
      toast.push("Não foi possível copiar. Copie da barra de endereço.", "error");
    }
  }, [roomCode, toast]);

  /** Sai da sala e volta para a home. */
  const handleLeave = useCallback(() => {
    screen.stop();
    leaveRoom();
    navigate("/");
  }, [leaveRoom, navigate, screen]);

  /**
   * Inicia o compartilhamento respeitando o checkbox de áudio. Se o usuário
   * pediu áudio e a origem escolhida não ofereceu (ex.: janela de programa,
   * ou o seletor sem "compartilhar som"), avisamos com um toast informativo
   * em vez de falhar — o vídeo continua normalmente.
   */
  const handleStartShare = useCallback(async () => {
    const result = await screen.start(shareWithAudio);
    if (result?.started && shareWithAudio && !result.hasAudio) {
      toast.push(
        "Esta origem não tem áudio — a tela foi compartilhada apenas com vídeo.",
        "info",
      );
    }
  }, [screen, shareWithAudio, toast]);

  /** Entra ou sai da tela cheia do palco de vídeo. */
  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }

    if (typeof stage.requestFullscreen !== "function") {
      toast.push("Seu navegador não suporta tela cheia.", "error");
      return;
    }

    void stage.requestFullscreen().catch(() => {
      toast.push("Não foi possível ativar a tela cheia.", "error");
    });
  }, [toast]);

  // Sai da sala ao desmontar de verdade.
  //
  // O StrictMode do React 18 monta, desmonta e remonta o componente uma vez
  // em desenvolvimento. Uma saída imediata derrubaria a sala recém-criada no
  // meio do fluxo de entrada. Por isso adiamos a saída por um tick e a
  // cancelamos se o componente remontar — assim só saímos em navegação real.
  const leaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }

    return () => {
      leaveTimerRef.current = window.setTimeout(() => {
        teardown();
        leaveTimerRef.current = null;
      }, 0);
    };
  }, [teardown]);

  // Garante que um timer pendente não sobreviva ao desmonte completo.
  useEffect(() => {
    return () => {
      if (leaveTimerRef.current !== null) {
        window.clearTimeout(leaveTimerRef.current);
      }
    };
  }, []);

  // Informa ao servidor quando este cliente começa ou para de compartilhar.
  // Fica em um efeito separado para cobrir também o caso em que o usuário
  // encerra o compartilhamento pela própria barra do navegador.
  useEffect(() => {
    if (!joined) return;
    socket.current?.emit("screen:state", { sharing: screen.isSharing });
  }, [joined, screen.isSharing, socket]);

  /** Participantes ordenados: você primeiro, depois os outros. */
  const orderedParticipants = useMemo(() => {
    const others = participants.filter((p) => p.id !== state.selfId);
    const self = participants.find((p) => p.id === state.selfId);
    return self ? [self, ...others] : others;
  }, [participants, state.selfId]);

  /** Mapa de id -> nome, usado para rotular os vídeos remotos. */
  const participantNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const participant of participants) {
      names.set(participant.id, participant.name);
    }
    return names;
  }, [participants]);

  const needsEntryForm = !joined && state.status !== "joining";

  return (
    <div className="flex min-h-screen flex-col bg-base-950">
      {/* Cabeçalho */}
      <header className="flex items-center justify-between border-b border-base-800 px-4 py-3 sm:px-6">
        <Brand compact />

        {joined && (
          <button
            type="button"
            onClick={handleCopyInvite}
            className="group flex items-center gap-2 rounded-lg border border-base-700/70 bg-base-850 px-3 py-1.5 transition-colors hover:border-accent-500/50"
          >
            <span className="font-mono text-sm tracking-wider text-ink-100">
              {formatRoomCode(state.roomCode ?? roomCode)}
            </span>
            <span className="text-xs text-ink-500 group-hover:text-accent-300">
              {copied ? "copiado ✓" : "copiar"}
            </span>
          </button>
        )}

        <div className="flex items-center gap-2">
          {/* Indicador de conexão */}
          <span
            className={[
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
              state.connection === "connected"
                ? "bg-accent-500/10 text-accent-300"
                : state.connection === "reconnecting"
                  ? "bg-warning-500/10 text-warning-400 animate-pulse-soft"
                  : "bg-danger-500/10 text-danger-400",
            ].join(" ")}
            title={`Conexão: ${state.connection}`}
          >
            <span
              className={[
                "size-1.5 rounded-full",
                state.connection === "connected"
                  ? "bg-accent-400"
                  : state.connection === "reconnecting"
                    ? "bg-warning-400"
                    : "bg-danger-400",
              ].join(" ")}
              aria-hidden="true"
            />
            {state.connection === "connected"
              ? "online"
              : state.connection === "reconnecting"
                ? "reconectando"
                : "offline"}
          </span>

          {joined && (
            <Button variant="ghost" size="sm" onClick={handleLeave}>
              Sair
            </Button>
          )}
        </div>
      </header>

      <main className="flex flex-1 flex-col lg:flex-row">
        {/* Palco de vídeo — prioridade máxima */}
        <section className="relative flex flex-1 items-center justify-center p-4 sm:p-6">
          <div
            ref={stageRef}
            className={[
              "relative flex items-center justify-center overflow-hidden bg-base-900",
              // Em tela cheia o palco ocupa a tela inteira sem borda/raio;
              // fora dela mantém o formato de vídeo do layout.
              isFullscreen
                ? "size-full"
                : "aspect-video w-full max-w-5xl rounded-2xl border border-base-800",
            ].join(" ")}
          >
            {stageContent({
              isSharing: screen.isSharing,
              localStream: screen.localStream,
              hasAudio: screen.hasAudio,
              remoteStreams,
              participantNames,
              joined,
              participants,
              onCopyInvite: handleCopyInvite,
            })}

            {/* Erro de compartilhamento sobreposto */}
            {screen.error && (
              <div
                role="alert"
                className="absolute inset-x-4 bottom-4 rounded-xl border border-danger-500/40 bg-base-900/90 px-4 py-3 text-sm text-danger-400 backdrop-blur animate-fade-in"
              >
                {screen.error}
              </div>
            )}

            {/* Tela cheia — só aparece quando há vídeo no palco */}
            {joined &&
              (screen.isSharing || Object.keys(remoteStreams).length > 0) && (
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
                  title={
                    isFullscreen ? "Sair da tela cheia (Esc)" : "Tela cheia"
                  }
                  className="absolute right-3 top-3 z-10 rounded-lg border border-white/10 bg-base-950/70 p-2 text-ink-200 backdrop-blur transition-colors hover:bg-base-800 hover:text-ink-50"
                >
                  {isFullscreen ? (
                    /* Sai da tela cheia: setas apontando para o centro */
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-4"
                      aria-hidden="true"
                    >
                      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                    </svg>
                  ) : (
                    /* Tela cheia: setas apontando para fora */
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-4"
                      aria-hidden="true"
                    >
                      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                    </svg>
                  )}
                </button>
              )}
          </div>

          {/* Controles discretos */}
          {joined && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
              {screen.isSharing ? (
                <Button variant="danger" onClick={screen.stop}>
                  Encerrar compartilhamento
                </Button>
              ) : (
                <>
                  {/* Áudio é opcional e desligado por padrão. */}
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-300 select-none">
                    <input
                      type="checkbox"
                      checked={shareWithAudio}
                      onChange={(event) =>
                        setShareWithAudio(event.target.checked)
                      }
                      className="size-4 rounded border-base-600 bg-base-900 accent-accent-500"
                    />
                    Compartilhar áudio
                  </label>
                  <Button onClick={() => void handleStartShare()}>
                    Compartilhar minha tela
                  </Button>
                </>
              )}
              <Button variant="secondary" onClick={handleCopyInvite}>
                {copied ? "Copiado ✓" : "Copiar convite"}
              </Button>
            </div>
          )}
        </section>

        {/* Painel lateral de participantes */}
        {joined && (
          <aside className="w-full shrink-0 border-t border-base-800 p-4 sm:p-6 lg:w-72 lg:border-l lg:border-t-0">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">
                Na sala
              </h2>
              <span className="text-xs text-ink-700">
                {participants.length} {participants.length === 1 ? "pessoa" : "pessoas"}
              </span>
            </div>

            <ul className="mt-3 flex flex-col gap-1">
              {orderedParticipants.map((participant) => (
                <ParticipantRow
                  key={participant.id}
                  participant={participant}
                  isSelf={participant.id === state.selfId}
                />
              ))}
            </ul>

            <p className="muted mt-6 leading-relaxed">
              Mande o link ou o código acima para alguém entrar. A tela aparece
              para todo mundo automaticamente.
            </p>
          </aside>
        )}
      </main>

      {/* Formulário de entrada, quando acessado direto pelo link */}
      {needsEntryForm && (
        <EntryOverlay
          roomCode={roomCode}
          name={name}
          password={password}
          error={joinError ?? state.error?.message ?? null}
          submitting={submitting}
          onNameChange={setName}
          onPasswordChange={setPassword}
          onSubmit={handleJoin}
        />
      )}
    </div>
  );
}

/**
 * Decide o conteúdo do palco de vídeo.
 *
 * Prioriza o que os outros participantes estão transmitindo; se ninguém estiver
 * transmitindo mas você estiver, mostra sua própria prévia. Como a sala aceita
 * vários transmissores ao mesmo tempo, os fluxos remotos são dispostos em grade.
 */
function stageContent({
  isSharing,
  localStream,
  hasAudio,
  remoteStreams,
  participantNames,
  joined,
  participants,
  onCopyInvite,
}: {
  isSharing: boolean;
  localStream: MediaStream | null;
  hasAudio: boolean;
  remoteStreams: Record<string, MediaStream>;
  participantNames: Map<string, string>;
  joined: boolean;
  participants: Participant[];
  onCopyInvite: () => void;
}) {
  const remoteEntries = Object.entries(remoteStreams);

  // Há fluxos remotos: grade de vídeos, com sua prévia incluída se estiver
  // compartilhando também.
  if (remoteEntries.length > 0) {
    const count = remoteEntries.length + (isSharing && localStream ? 1 : 0);
    // Ajusta as colunas conforme a quantidade de telas simultâneas.
    const columns =
      count <= 1 ? "grid-cols-1" : count <= 4 ? "grid-cols-2" : "grid-cols-3";

    return (
      <div className={`grid ${columns} size-full gap-2 p-2`}>
        {remoteEntries.map(([peerId, stream]) => (
          <div key={peerId} className="relative overflow-hidden rounded-xl bg-black">
            <RemoteVideo
              stream={stream}
              label={participantNames.get(peerId) ?? "Participante"}
            />
          </div>
        ))}

        {isSharing && localStream && (
          <div className="relative overflow-hidden rounded-xl bg-black">
            <LocalVideo stream={localStream} compact withAudio={hasAudio} />
          </div>
        )}
      </div>
    );
  }

  // Ninguém remoto transmitindo, mas você está: prévia em destaque.
  if (isSharing && localStream) {
    return <LocalVideo stream={localStream} withAudio={hasAudio} />;
  }

  // Nada transmitindo ainda.
  return (
    <EmptyStage
      joined={joined}
      participants={participants}
      onCopyInvite={onCopyInvite}
    />
  );
}

/** Vídeo local do próprio compartilhamento. */
function LocalVideo({
  stream,
  compact = false,
  withAudio = false,
}: {
  stream: MediaStream;
  compact?: boolean;
  /** `true` quando há trilha de áudio sendo transmitida junto. */
  withAudio?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.srcObject = stream;
    // `play()` pode rejeitar se o autoplay for bloqueado; ignoramos pois o
    // vídeo local é um preview e nunca toca o próprio áudio (eco).
    void element.play().catch(() => undefined);
  }, [stream]);

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="size-full bg-black object-contain"
        aria-label="Pré-visualização da sua tela compartilhada"
      />
      <span
        className={[
          "absolute left-3 top-3 rounded-full bg-accent-500/90 px-2.5 py-1 font-semibold text-base-950",
          compact ? "text-[10px]" : "text-xs",
        ].join(" ")}
      >
        Você está compartilhando
        {withAudio && " · com áudio"}
      </span>
    </>
  );
}

/** Estado vazio do palco antes de alguém compartilhar. */
function EmptyStage({
  joined,
  participants,
  onCopyInvite,
}: {
  joined: boolean;
  participants: Participant[];
  onCopyInvite: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 text-center">
      <span className="text-4xl" aria-hidden="true">
        🖥️
      </span>
      <p className="text-base font-medium text-ink-100">
        {joined ? "Ninguém está compartilhando a tela" : "Entrando na sala..."}
      </p>
      <p className="max-w-sm text-sm text-ink-500">
        {joined
          ? "Quando alguém iniciar o compartilhamento, a tela aparece aqui automaticamente."
          : "Aguarde um instante."}
      </p>

      {joined && participants.length === 1 && (
        <Button variant="secondary" size="sm" onClick={onCopyInvite} className="mt-2">
          Convide alguém
        </Button>
      )}
    </div>
  );
}

/** Overlay de entrada com nome e senha. */
function EntryOverlay({
  roomCode,
  name,
  password,
  error,
  submitting,
  onNameChange,
  onPasswordChange,
  onSubmit,
}: {
  roomCode: string;
  name: string;
  password: string;
  error: string | null;
  submitting: boolean;
  onNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-base-950/90 px-4 backdrop-blur-sm">
      <form
        onSubmit={onSubmit}
        className="surface w-full max-w-sm p-6 animate-slide-up"
      >
        <h1 className="text-lg font-semibold text-ink-100">Entrar na sala</h1>
        <p className="muted mt-1">
          Código <span className="font-mono text-ink-300">{formatRoomCode(roomCode)}</span>
        </p>

        <div className="mt-5 flex flex-col gap-4">
          <Field
            label="Seu nome"
            placeholder="Como quer ser chamado?"
            value={name}
            maxLength={24}
            autoFocus
            onChange={(event) => onNameChange(event.target.value)}
          />

          <Field
            label="Senha da sala"
            type="password"
            placeholder="Se a sala for protegida"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            hint="Deixe em branco se a sala não tiver senha."
          />
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-danger-400">
            {error}
          </p>
        )}

        <Button type="submit" loading={submitting} className="mt-6 w-full">
          Entrar
        </Button>
      </form>
    </div>
  );
}
