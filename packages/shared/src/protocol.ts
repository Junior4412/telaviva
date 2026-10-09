/**
 * Contrato de eventos Socket.IO compartilhado entre web e server.
 *
 * A tipagem aqui é aplicada nos dois lados via genéricos do Socket.IO, de
 * modo que renomear um evento ou trocar o formato de um payload quebra a
 * compilação em vez de virar um bug silencioso em runtime.
 */

import type { Participant } from "./participant.js";

/** Payload de SDP aceito pelo relay. Espelha `RTCSessionDescriptionInit`. */
export interface SdpPayload {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp?: string;
}

/** Payload de candidato ICE aceito pelo relay. Espelha `RTCIceCandidateInit`. */
export interface IceCandidatePayload {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** Um erro estruturado retornado pelo backend. */
export interface ProtocolError {
  code: string;
  message: string;
}

/** Resultado de um evento com acknowledgment (ack) do Socket.IO. */
export type AckResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ProtocolError };

// ---------------------------------------------------------------------------
// Cliente -> Servidor
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  /** Cria uma sala e faz o criador entrar nela. */
  "room:create": (
    payload: { name?: string; password?: string },
    ack: (res: AckResult<RoomJoinedData>) => void,
  ) => void;

  /** Entra em uma sala existente. */
  "room:join": (
    payload: { roomCode: string; name?: string; password?: string },
    ack: (res:AckResult<RoomJoinedData>) => void,
  ) => void;

  /** Sai da sala atual de forma explícita. */
  "room:leave": () => void;

  /** Encaminha um SDP para um par específico. O servidor não interpreta o conteúdo. */
  "signal:offer": (payload: { to: string; sdp: SdpPayload }) => void;

  /** Encaminha uma resposta SDP para um par específico. */
  "signal:answer": (payload: { to: string; sdp: SdpPayload }) => void;

  /** Encaminha um candidato ICE para um par específico. */
  "signal:ice": (payload: { to: string; candidate: IceCandidatePayload }) => void;

  /** Indica que o cliente iniciou ou parou de compartilhar a tela. */
  "screen:state": (payload: { sharing: boolean }) => void;
}

// ---------------------------------------------------------------------------
// Servidor -> Cliente
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
  /** Estado completo da sala. Enviado no join e sempre que a lista muda. */
  "room:state": (payload: RoomStateData) => void;

  /** Um participante entrou na sala. */
  "peer:joined": (payload: { participant: Participant }) => void;

  /** Um participante saiu ou foi desconectado. */
  "peer:left": (payload: { participantId: string }) => void;

  /** Um participante começou ou parou de compartilhar a tela. */
  "screen:changed": (payload: { participantId: string; sharing: boolean }) => void;

  /** Um SDP encaminhado por outro par chegou a este cliente. */
  "signal:offer": (payload: { from: string; sdp: SdpPayload }) => void;

  /** Uma resposta SDP encaminhada por outro par chegou a este cliente. */
  "signal:answer": (payload: { from: string; sdp: SdpPayload }) => void;

  /** Um candidato ICE encaminhado por outro par chegou a este cliente. */
  "signal:ice": (payload: { from: string; candidate: IceCandidatePayload }) => void;

  /** Um erro não ligado a um ack, ex.: rate limit ou kick. */
  "error": (payload: ProtocolError) => void;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/** Dados devolvidos ao cliente quando ele entra em uma sala com sucesso. */
export interface RoomJoinedData {
  roomCode: string;
  /** Id deste cliente na sala (equivale ao socket id no servidor). */
  selfId: string;
  /** Indica que a sala exige senha e o cliente já a informou corretamente. */
  requiresPassword: boolean;
  /** Lista de participantes já presentes, incluindo o próprio cliente. */
  participants: Participant[];
  /** Timestamp de criação da sala, em milissegundos. */
  createdAt: number;
}

/** Estado geral da sala enviado via `room:state`. */
export interface RoomStateData {
  roomCode: string;
  selfId: string;
  participants: Participant[];
}

// ---------------------------------------------------------------------------
// Mapas combinados para os genéricos do Socket.IO
// ---------------------------------------------------------------------------

/** Mapa de eventos usado pelo servidor (`new Server<..., ServerToClientEvents>`). */
export type { ServerToClientEvents as ServerEvents };

/** Mapa de eventos usado pelo cliente (`io<ServerToClientEvents, ClientToServerEvents>`). */
export type { ClientToServerEvents as ClientEvents };
