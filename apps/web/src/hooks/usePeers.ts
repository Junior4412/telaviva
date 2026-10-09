import { useCallback, useEffect, useRef, useState } from "react";
import type {
  IceCandidatePayload,
  IceServerConfig,
  SdpPayload,
} from "@tela/shared";
import { fetchIceServers } from "../lib/ice";
import { getSocket } from "../lib/socket";

/** Estado interno de uma conexão com um par. */
interface PeerState {
  pc: RTCPeerConnection;
  /** Evita ofertas duplicadas durante uma renegociação. */
  makingOffer: boolean;
  /** Descarta uma oferta que perderia a corrida (padrão impolite). */
  ignoreOffer: boolean;
  /** `true` enquanto aplicamos uma resposta remota pendente. */
  isSettingRemoteAnswerPending: boolean;
  /** Quem é "educado" na resolução de conflito de oferta. */
  polite: boolean;
}

interface UsePeersInput {
  /** Id público deste cliente na sala. `null` quando não entrou ainda. */
  selfId: string | null;
  /** Lista atual de participantes vinda do servidor. */
  participants: { id: string }[];
  /** Stream local compartilhado, ou `null` quando não está compartilhando. */
  localStream: MediaStream | null;
  /** Só gerencia conexões quando `true` (dentro de uma sala). */
  active: boolean;
  /**
   * Teto de bitrate de vídeo em kbps (preset de qualidade do usuário).
   * `null` não aplica limite. Pode mudar durante a transmissão.
   */
  videoBitrateKbps: number | null;
}

/** Converte a descrição local do WebRTC no formato do protocolo. */
function toSdpPayload(description: RTCSessionDescription | null): SdpPayload | null {
  if (!description) return null;
  return {
    type: description.type as SdpPayload["type"],
    sdp: description.sdp ?? undefined,
  };
}

/**
 * Hook que mantém a malha WebRTC entre os participantes da sala.
 *
 * Cada par recebe um `RTCPeerConnection` próprio. A mídia (a tela) flui
 * diretamente entre os navegadores; o servidor só repassa SDP e ICE.
 *
 * Usa o padrão de "perfect negotiation": quando duas pessoas começam a
 * compartilhar ao mesmo tempo, ambos os lados podem emitir oferta e o
 * conflito é resolvido de forma determinística — o lado "educado" cede. Isso
 * é o que torna viável ter vários transmissores simultâneos na mesma sala.
 */
export function usePeers({
  selfId,
  participants,
  localStream,
  active,
  videoBitrateKbps,
}: UsePeersInput) {
  /** Streams remotos por id de par, expostos para a UI. */
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const peersRef = useRef(new Map<string, PeerState>());
  const remoteStreamsRef = useRef(new Map<string, MediaStream>());
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const selfIdRef = useRef<string | null>(selfId);
  const icePromiseRef = useRef<Promise<IceServerConfig[]> | null>(null);
  /**
   * Candidatos ICE recebidos antes de a descrição remota existir.
   *
   * Oferta e candidatos viajam no mesmo socket, mas os handlers são
   * assíncronos e competem: `addIceCandidate` antes de
   * `setRemoteDescription` rejeita, e candidatos de um par cujo
   * `ensurePeer` ainda estava buscando os servidores ICE se perdiam em
   * silêncio. Em redes rápidas o Chrome envia todos os candidatos host
   * nessa janela — perdê-los derruba a conexão inteira (tracks chegam,
   * mas `muted`, sem vídeo e sem áudio). O padrão da spec é enfileirar.
   */
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const videoBitrateKbpsRef = useRef<number | null>(videoBitrateKbps);

  /** Aplica os candidatos pendentes de um par quando já há descrição remota. */
  const flushIce = useCallback((peerId: string) => {
    const state = peersRef.current.get(peerId);
    const queue = pendingIceRef.current.get(peerId);
    if (!state || !queue || queue.length === 0) return;
    if (!state.pc.remoteDescription) return;

    pendingIceRef.current.delete(peerId);
    for (const candidate of queue) {
      void state.pc.addIceCandidate(candidate).catch((error) => {
        // Candidato inválido ou duplicado não derruba a conexão.
        console.warn("[webrtc] ice", peerId, error);
      });
    }
  }, []);

  // Mantém as refs em sincronia com as props a cada render.
  localStreamRef.current = localStream;
  selfIdRef.current = selfId;
  videoBitrateKbpsRef.current = videoBitrateKbps;

  /**
   * Aplica o teto de bitrate do preset de qualidade nos senders de vídeo.
   * `setParameters()` não renegocia a conexão — dá pra mudar em transmissão.
   */
  const applyVideoBitrate = useCallback((state: PeerState) => {
    const kbps = videoBitrateKbpsRef.current;
    for (const sender of state.pc.getSenders()) {
      if (!sender.track || sender.track.kind !== "video") continue;
      try {
        const params = sender.getParameters();
        // Sem encoding ainda (pré-negociação em alguns navegadores): nada a
        // fazer — `syncTracks` reexecuta após a renegociação e reaplica.
        const encoding = params.encodings?.[0];
        if (!encoding) continue;
        encoding.maxBitrate = kbps ? kbps * 1000 : undefined;
        void sender.setParameters(params).catch(() => undefined);
      } catch {
        // Navegador sem suporte a setParameters: segue sem limite.
      }
    }
  }, []);

  /** Busca os servidores ICE uma única vez e reaproveita a promessa. */
  const getIceServers = useCallback(() => {
    if (!icePromiseRef.current) {
      icePromiseRef.current = fetchIceServers();
    }
    return icePromiseRef.current;
  }, []);

  /** Publica o mapa de streams remotos para a UI. */
  const publishRemote = useCallback(() => {
    setRemoteStreams(Object.fromEntries(remoteStreamsRef.current));
  }, []);

  /** Sincroniza as faixas enviadas com o stream local atual. */
  const syncTracks = useCallback((state: PeerState) => {
    const pc = state.pc;
    const local = localStreamRef.current;
    const senders = pc.getSenders();

    // Sem stream local: remove tudo o que estávamos enviando.
    if (!local) {
      for (const sender of senders) {
        if (sender.track) pc.removeTrack(sender);
      }
      return;
    }

    const localTracks = local.getTracks();

    // Remove faixas que saíram do stream local (ex.: fim do compartilhamento).
    for (const sender of senders) {
      if (!sender.track || !localTracks.includes(sender.track)) {
        pc.removeTrack(sender);
      }
    }

    // Adiciona faixas novas (ex.: início do compartilhamento).
    for (const track of localTracks) {
      const alreadySent = senders.some((sender) => sender.track === track);
      if (!alreadySent) pc.addTrack(track, local);
    }

    // Garante o teto de bitrate já nas faixas recém-adicionadas.
    applyVideoBitrate(state);
  }, [applyVideoBitrate]);

  /** Descarta um par e seu stream remoto. */
  const closePeer = useCallback(
    (peerId: string) => {
      const state = peersRef.current.get(peerId);
      if (state) {
        state.pc.onnegotiationneeded = null;
        state.pc.onicecandidate = null;
        state.pc.ontrack = null;
        state.pc.onconnectionstatechange = null;
        state.pc.close();
        peersRef.current.delete(peerId);
      }
      if (remoteStreamsRef.current.delete(peerId)) {
        publishRemote();
      }
      pendingIceRef.current.delete(peerId);
    },
    [publishRemote],
  );

  /** Garante que exista uma conexão com o par, criando-a se preciso. */
  const ensurePeer = useCallback(
    async (peerId: string): Promise<PeerState> => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const socket = getSocket();
      const self = selfIdRef.current;
      // "Polite" é o lado com o id maior; o menor é quem costuma ofertar antes.
      const polite = (self ?? "") > peerId;

      const iceServers = await getIceServers();
      const pc = new RTCPeerConnection({ iceServers });

      const state: PeerState = {
        pc,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        polite,
      };
      peersRef.current.set(peerId, state);

      pc.onicecandidate = ({ candidate }) => {
        if (!candidate || !socket.connected) return;
        const payload: IceCandidatePayload = {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          usernameFragment: candidate.usernameFragment,
        };
        socket.emit("signal:ice", { to: peerId, candidate: payload });
      };

      pc.onnegotiationneeded = async () => {
        try {
          state.makingOffer = true;
          await pc.setLocalDescription();
          const sdp = toSdpPayload(pc.localDescription);
          if (sdp && socket.connected) {
            socket.emit("signal:offer", { to: peerId, sdp });
          }
        } catch (error) {
          console.error("[webrtc] negotiationneeded", peerId, error);
        } finally {
          state.makingOffer = false;
        }
      };

      pc.ontrack = ({ track, streams }) => {
        let stream = streams[0];
        if (!stream) {
          stream = remoteStreamsRef.current.get(peerId) ?? new MediaStream();
          if (!stream.getTracks().includes(track)) stream.addTrack(track);
        }
        remoteStreamsRef.current.set(peerId, stream);
        publishRemote();

        // Reavisa quando a faixa volta a produzir dados ou termina.
        track.onunmute = publishRemote;
        track.onended = () => {
          stream?.removeTrack(track);
          if (stream && stream.getTracks().length === 0) {
            remoteStreamsRef.current.delete(peerId);
          }
          publishRemote();
        };
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          // Tenta se reconectar via ICE antes de desistir.
          try {
            pc.restartIce();
          } catch {
            closePeer(peerId);
          }
        } else if (pc.connectionState === "closed") {
          closePeer(peerId);
        }
      };

      syncTracks(state);
      return state;
    },
    [closePeer, getIceServers, publishRemote, syncTracks],
  );

  // Aplica ofertas, respostas e candidatos ICE vindos de outros participantes.
  useEffect(() => {
    if (!active) return;
    const socket = getSocket();

    const handleOffer = (payload: { from: string; sdp: SdpPayload }): void => {
      void (async () => {
        try {
          const state = await ensurePeer(payload.from);
          const pc = state.pc;

          const readyForOffer =
            !state.makingOffer &&
            (pc.signalingState === "stable" || state.isSettingRemoteAnswerPending);
          const offerCollision = payload.sdp.type === "offer" && !readyForOffer;

          // Lado impolite descarta a oferta que perdeu a corrida.
          state.ignoreOffer = !state.polite && offerCollision;
          if (state.ignoreOffer) return;

          await pc.setRemoteDescription(payload.sdp);
          state.isSettingRemoteAnswerPending = payload.sdp.type === "answer";

          // Descrição remota aplicada: candidatos que chegaram antes já podem
          // ser adicionados — é aqui que a fila é drenada.
          flushIce(payload.from);

          if (payload.sdp.type === "offer") {
            await pc.setLocalDescription();
            const sdp = toSdpPayload(pc.localDescription);
            if (sdp && socket.connected) {
              socket.emit("signal:answer", { to: payload.from, sdp });
            }
          }
        } catch (error) {
          console.error("[webrtc] offer", payload.from, error);
        }
      })();
    };

    const handleAnswer = (payload: { from: string; sdp: SdpPayload }): void => {
      void (async () => {
        try {
          const state = peersRef.current.get(payload.from);
          if (!state) return;
          state.isSettingRemoteAnswerPending = payload.sdp.type === "answer";
          await state.pc.setRemoteDescription(payload.sdp);
          flushIce(payload.from);
        } catch (error) {
          console.error("[webrtc] answer", payload.from, error);
        }
      })();
    };

    const handleIce = (payload: { from: string; candidate: IceCandidatePayload }): void => {
      // Enfileira SEMPRE e tenta drenar: a fila só é aplicada quando o pc já
      // tem descrição remota; até lá, os candidatos ficam guardados.
      const queue = pendingIceRef.current.get(payload.from) ?? [];
      queue.push(payload.candidate as RTCIceCandidateInit);
      pendingIceRef.current.set(payload.from, queue);
      flushIce(payload.from);
    };

    socket.on("signal:offer", handleOffer);
    socket.on("signal:answer", handleAnswer);
    socket.on("signal:ice", handleIce);

    return () => {
      socket.off("signal:offer", handleOffer);
      socket.off("signal:answer", handleAnswer);
      socket.off("signal:ice", handleIce);
    };
  }, [active, ensurePeer]);

  // Cria conexões para participantes novos e fecha as de quem saiu.
  useEffect(() => {
    if (!active || !selfId) return;

    const currentIds = new Set(participants.map((p) => p.id));

    for (const peerId of Array.from(peersRef.current.keys())) {
      if (!currentIds.has(peerId)) closePeer(peerId);
    }

    for (const participant of participants) {
      if (participant.id === selfId) continue;
      if (!peersRef.current.has(participant.id)) {
        void ensurePeer(participant.id);
      }
    }
  }, [active, closePeer, ensurePeer, participants, selfId]);

  // Quando o stream local muda (início/fim de compartilhamento), ajusta as
  // faixas de cada conexão; isso dispara `negotiationneeded` e renegocia.
  useEffect(() => {
    for (const state of peersRef.current.values()) {
      syncTracks(state);
    }
  }, [localStream, syncTracks]);

  // Mudou o preset de qualidade: reexecuta o teto de bitrate nos senders
  // existentes — setParameters não precisa de renegociação.
  useEffect(() => {
    for (const state of peersRef.current.values()) {
      applyVideoBitrate(state);
    }
  }, [applyVideoBitrate, videoBitrateKbps]);

  // Ao sair da sala ou desmontar, encerra todas as conexões.
  useEffect(() => {
    return () => {
      for (const peerId of Array.from(peersRef.current.keys())) {
        closePeer(peerId);
      }
    };
  }, [active, closePeer]);

  return { remoteStreams };
}
