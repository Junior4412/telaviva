import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  CREATE_ROOM_RATE,
  ERROR_CODES,
  JOIN_ROOM_RATE,
  MAX_ICE_CANDIDATE_LENGTH,
  MAX_SDP_LENGTH,
  sanitizeRoomCode,
  toUserMessage,
  type AckResult,
  type ClientToServerEvents,
  type IceCandidatePayload,
  type RoomJoinedData,
  type SdpPayload,
  type ServerToClientEvents,
} from "@tela/shared";
import { config } from "./config.js";
import { RateLimiter } from "./rateLimit.js";
import { RoomManager, toParticipant, type JoinFailureReason } from "./roomManager.js";

/** Socket.IO com os eventos tipados do contrato compartilhado. */
export type TelaServer = Server<ClientToServerEvents, ServerToClientEvents>;
export type TelaSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Extrai o IP real do cliente, considerando o proxy do Render. */
function resolveClientIp(socket: TelaSocket): string {
  const headers = socket.handshake.headers;
  const forwarded = headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return socket.handshake.address ?? "unknown";
}

/** Mapeia uma falha de entrada para o código de erro do protocolo. */
function toErrorCode(reason: JoinFailureReason): string {
  switch (reason) {
    case "ROOM_NOT_FOUND":
      return ERROR_CODES.ROOM_NOT_FOUND;
    case "PASSWORD_REQUIRED":
    case "INVALID_PASSWORD":
      return ERROR_CODES.PASSWORD_REQUIRED;
    default:
      return ERROR_CODES.INTERNAL;
  }
}

/** Cria um resultado de erro tipado para o ack. */
function fail<T>(code: string, message: string): AckResult<T> {
  return { ok: false, error: { code, message } };
}

/** Valida um SDP recebido antes de encaminhar. */
function isValidSdp(sdp: unknown): sdp is SdpPayload {
  if (typeof sdp !== "object" || sdp === null) return false;
  const candidate = sdp as Record<string, unknown>;
  const type = candidate.type;
  if (
    type !== "offer" &&
    type !== "answer" &&
    type !== "pranswer" &&
    type !== "rollback"
  ) {
    return false;
  }
  if (candidate.sdp !== undefined) {
    if (typeof candidate.sdp !== "string") return false;
    if (candidate.sdp.length > MAX_SDP_LENGTH) return false;
  }
  return true;
}

/** Valida um candidato ICE recebido antes de encaminhar. */
function isValidIce(candidate: unknown): candidate is IceCandidatePayload {
  if (typeof candidate !== "object" || candidate === null) return false;
  const record = candidate as Record<string, unknown>;
  if (typeof record.candidate !== "string") return false;
  if (record.candidate.length > MAX_ICE_CANDIDATE_LENGTH) return false;
  return true;
}

/**
 * Aplica o CORS restrito às origens configuradas.
 *
 * O Socket.IO não herda o CORS do Express, então precisamos validar a origem
 * no `cors.origin` e também no `allowRequest` para bloquear handshakes.
 */
function isOriginAllowed(origin: string | undefined): boolean {
  // Requisições sem Origin (ex.: testes via Node, curl) são permitidas, mas o
  // CORS do navegador é quem protege o usuário final.
  if (!origin) return true;
  return config.allowedOrigins.includes(origin);
}

export interface SocketContext {
  io: TelaServer;
  rooms: RoomManager;
  createLimiter: RateLimiter;
  joinLimiter: RateLimiter;
}

/** Configura todos os handlers de um socket conectado. */
function registerHandlers(ctx: SocketContext, socket: TelaSocket): void {
  const { io, rooms, createLimiter, joinLimiter } = ctx;
  const ip = resolveClientIp(socket);

  /** Envia o estado completo da sala para um socket específico. */
  const sendState = (target: TelaSocket, roomCode: string): void => {
    const room = rooms.getRoom(roomCode);
    if (!room) return;
    const payload = {
      roomCode,
      selfId: target.id,
      participants: rooms.listParticipants(room),
    };
    target.emit("room:state", payload);
  };

  /** Notifica todos os membros da sala sobre o estado atual. */
  const broadcastState = (roomCode: string): void => {
    const room = rooms.getRoom(roomCode);
    if (!room) return;
    for (const memberId of room.members.keys()) {
      const memberSocket = io.sockets.sockets.get(memberId);
      if (memberSocket) sendState(memberSocket, roomCode);
    }
  };

  socket.on("room:create", (payload, ack) => {
    try {
      if (typeof ack !== "function") return;

      const limit = createLimiter.consume(ip);
      if (!limit.allowed) {
        return void ack(
          fail(ERROR_CODES.RATE_LIMITED, "Muitas salas criadas. Aguarde um instante."),
        );
      }

      // Um socket só pode estar em uma sala por vez.
      rooms.leaveRoom(socket.id);

      const name = typeof payload?.name === "string" ? payload.name : undefined;
      const password =
        typeof payload?.password === "string" ? payload.password : undefined;

      const { room, member } = rooms.createRoom({ socketId: socket.id, name, password });
      void socket.join(room.code);

      const data: RoomJoinedData = {
        roomCode: room.code,
        selfId: member.id,
        requiresPassword: room.passwordHash !== null,
        participants: rooms.listParticipants(room),
        createdAt: room.createdAt,
      };
      ack({ ok: true, data });
      sendState(socket, room.code);
    } catch (error) {
      console.error("[room:create]", error);
      if (typeof ack === "function") {
        ack(fail(ERROR_CODES.INTERNAL, "Erro interno ao criar a sala."));
      }
    }
  });

  socket.on("room:join", (payload, ack) => {
    try {
      if (typeof ack !== "function") return;

      const limit = joinLimiter.consume(ip);
      if (!limit.allowed) {
        return void ack(
          fail(ERROR_CODES.RATE_LIMITED, "Muitas tentativas. Aguarde um minuto."),
        );
      }

      const rawCode = typeof payload?.roomCode === "string" ? payload.roomCode : "";
      // Normaliza E valida: só um código com 6 caracteres do alfabeto permitido
      // é aceito. Assim formato errado vira INVALID_ROOM_CODE em vez de
      // ROOM_NOT_FOUND, o que dá uma mensagem correta ao usuário.
      const code = sanitizeRoomCode(rawCode);
      if (!code) {
        return void ack(
          fail(ERROR_CODES.INVALID_ROOM_CODE, "Código de sala inválido."),
        );
      }

      const name = typeof payload?.name === "string" ? payload.name : undefined;
      const password =
        typeof payload?.password === "string" ? payload.password : undefined;

      // Sai da sala anterior antes de entrar na nova.
      const previous = rooms.leaveRoom(socket.id);
      if (previous) {
        void socket.leave(previous.room.code);
        socket.to(previous.room.code).emit("peer:left", {
          participantId: previous.member.id,
        });
        broadcastState(previous.room.code);
      }

      const result = rooms.joinRoom(code, { socketId: socket.id, name, password });

      if (!result.ok) {
        const code = toErrorCode(result.reason);
        return void ack(fail(code, toUserMessage(code)));
      }

      const { room, member, alreadyExisted } = result;
      void socket.join(room.code);

      const data: RoomJoinedData = {
        roomCode: room.code,
        selfId: member.id,
        requiresPassword: room.passwordHash !== null,
        participants: rooms.listParticipants(room),
        createdAt: room.createdAt,
      };
      ack({ ok: true, data });

      if (!alreadyExisted) {
        socket.to(room.code).emit("peer:joined", { participant: toParticipant(member) });
      }
      broadcastState(room.code);
    } catch (error) {
      console.error("[room:join]", error);
      if (typeof ack === "function") {
        ack(fail(ERROR_CODES.INTERNAL, "Erro interno ao entrar na sala."));
      }
    }
  });

  socket.on("room:leave", () => {
    leaveCurrentRoom("room:leave");
  });

  socket.on("screen:state", (payload) => {
    const sharing = payload?.sharing === true;
    const room = rooms.getRoomBySocket(socket.id);
    if (!room) return;

    if (!rooms.setSharing(socket.id, sharing)) return;

    socket.to(room.code).emit("screen:changed", {
      participantId: socket.id,
      sharing,
    });
    broadcastState(room.code);
  });

  socket.on("signal:offer", (payload) => {
    forwardSignal("signal:offer", payload, (to, sdp) => ({ to, sdp }), isValidSdp, (p) => p?.sdp);
  });

  socket.on("signal:answer", (payload) => {
    forwardSignal("signal:answer", payload, (to, sdp) => ({ to, sdp }), isValidSdp, (p) => p?.sdp);
  });

  socket.on("signal:ice", (payload) => {
    forwardSignal(
      "signal:ice",
      payload,
      (to, candidate) => ({ to, candidate }),
      isValidIce,
      (p) => p?.candidate,
    );
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom("disconnect");
  });

  /**
   * Encaminha um payload de sinalização para o par alvo, sem interpretar o
   * conteúdo além da validação de formato e tamanho.
   */
  function forwardSignal<T>(
    event: "signal:offer" | "signal:answer" | "signal:ice",
    payload: { to?: string; value?: unknown },
    build: (to: string, value: T) => Record<string, unknown>,
    validate: (value: unknown) => value is T,
    extract: (payload: Record<string, unknown> | undefined) => unknown,
  ): void {
    const room = rooms.getRoomBySocket(socket.id);
    if (!room) return;

    const record = payload as Record<string, unknown> | undefined;
    const to = record?.to;
    if (typeof to !== "string" || to.length === 0) return;

    // O alvo precisa estar na mesma sala — senão seria um vetor de spam.
    if (!room.members.has(to)) {
      socket.emit("error", {
        code: ERROR_CODES.PEER_NOT_FOUND,
        message: "O destinatário não está mais na sala.",
      });
      return;
    }

    const value = extract(record);
    if (!validate(value)) {
      socket.emit("error", {
        code: ERROR_CODES.PAYLOAD_TOO_LARGE,
        message: "Payload de sinalização inválido ou grande demais.",
      });
      return;
    }

    const target = io.sockets.sockets.get(to);
    if (!target) return;

    target.emit(event, { from: socket.id, ...build(to, value) } as never);
  }

  /** Remove o socket da sala atual e notifica os demais. */
  function leaveCurrentRoom(reason: string): void {
    const removed = rooms.leaveRoom(socket.id);
    if (!removed) return;

    void socket.leave(removed.room.code);
    socket.to(removed.room.code).emit("peer:left", {
      participantId: removed.member.id,
    });
    broadcastState(removed.room.code);

    if (config.debug) {
      console.log(`[leave] ${removed.member.id} saiu de ${removed.room.code} (${reason})`);
    }
  }
}

/** Cria o servidor Socket.IO com CORS restrito e handlers registrados. */
export function createSocketServer(httpServer: HttpServer): SocketContext {
  const io: TelaServer = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Origem não permitida"), false);
        }
      },
      methods: ["GET", "POST"],
    },
    // Reduz o risco de payloads gigantes consumirem memória no plano grátis.
    maxHttpBufferSize: 1e6,
    // Heartbeat curto: detecta clientes mortos rápido em ambientes serverless.
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  const ctx: SocketContext = {
    io,
    rooms: new RoomManager(),
    createLimiter: new RateLimiter(CREATE_ROOM_RATE),
    joinLimiter: new RateLimiter(JOIN_ROOM_RATE),
  };

  // Varre salas vazias expiradas periodicamente.
  const sweeper = setInterval(() => {
    const removed = ctx.rooms.sweep();
    if (removed > 0 && config.debug) {
      console.log(`[sweep] ${removed} sala(s) vazia(s) removida(s)`);
    }
  }, 30_000);
  sweeper.unref?.();

  io.on("connection", (socket) => {
    if (config.debug) {
      console.log(`[connect] ${socket.id} de ${resolveClientIp(socket as TelaSocket)}`);
    }
    registerHandlers(ctx, socket as TelaSocket);
  });

  return ctx;
}

