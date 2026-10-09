import {
  DEFAULT_PARTICIPANT_NAME,
  EMPTY_ROOM_TTL_MS,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  generateRoomCode,
  type Participant,
} from "@tela/shared";
import { hashPassword, verifyPassword } from "./password.js";

/** Motivo pelo qual uma operação de sala falhou. */
export type JoinFailureReason =
  | "ROOM_NOT_FOUND"
  | "PASSWORD_REQUIRED"
  | "INVALID_PASSWORD";

/** Resultado de uma tentativa de entrada em sala. */
export type JoinResult =
  | { ok: true; room: Room; member: RoomMember; alreadyExisted: boolean }
  | { ok: false; reason: JoinFailureReason };

/** Interno: um membro conectado. Expõe `Participant` publicamente. */
export interface RoomMember {
  id: string;
  name: string;
  isSharing: boolean;
  joinedAt: number;
  isOwner: boolean;
}

/** Interno: uma sala em memória. */
export interface Room {
  code: string;
  /** Hash scrypt da senha, ou `null` quando a sala é aberta. */
  passwordHash: string | null;
  createdAt: number;
  /** Última vez que a sala teve ao menos um membro. */
  lastOccupiedAt: number;
  members: Map<string, RoomMember>;
}

/** Opções para criar ou entrar em uma sala. */
export interface MemberOptions {
  /** Id do socket do cliente. */
  socketId: string;
  /** Nome exibido, opcional. */
  name?: string;
  /** Senha informada pelo cliente, opcional. */
  password?: string;
}

/** Converte um membro interno na forma pública. */
export function toParticipant(member: RoomMember): Participant {
  return {
    id: member.id,
    name: member.name,
    isSharing: member.isSharing,
    joinedAt: member.joinedAt,
    isOwner: member.isOwner,
  };
}

/**
 * Normaliza e limita o nome exibido.
 *
 * Truncamos em vez de rejeitar para que um nome longo não bloqueie a entrada.
 */
function normalizeName(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return DEFAULT_PARTICIPANT_NAME;
  return trimmed.slice(0, MAX_NAME_LENGTH);
}

/** Valida e normaliza uma senha de sala, ou a descarta se for fraca/longa. */
function normalizePassword(raw: string | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length < MIN_PASSWORD_LENGTH) return null;
  return trimmed.slice(0, MAX_PASSWORD_LENGTH);
}

/**
 * Gerenciador de salas em memória.
 *
 * Sem banco de dados de propósito: nada é persistido, então reiniciar o
 * servidor encerra todas as salas e nenhuma transmissão fica registrada.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  /** Índice inverso: socketId -> código da sala. Evita varrer todas as salas. */
  private readonly membership = new Map<string, string>();

  /** Quantidade de salas ativas. */
  get roomCount(): number {
    return this.rooms.size;
  }

  /** Soma de membros em todas as salas. */
  get memberCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.members.size;
    return total;
  }

  /**
   * Cria uma sala e adiciona o criador como dono.
   *
   * Tenta gerar um código único, mas com um limite de tentativas para não
   * entrar em loop infinito em caso de colisão estatística improvável.
   */
  createRoom(options: MemberOptions): { room: Room; member: RoomMember } {
    const code = this.generateUniqueCode();
    const password = normalizePassword(options.password);

    const room: Room = {
      code,
      passwordHash: password ? hashPassword(password) : null,
      createdAt: Date.now(),
      lastOccupiedAt: Date.now(),
      members: new Map(),
    };
    this.rooms.set(code, room);

    const member: RoomMember = {
      id: options.socketId,
      name: normalizeName(options.name),
      isSharing: false,
      joinedAt: Date.now(),
      isOwner: true,
    };
    room.members.set(member.id, member);
    this.membership.set(member.id, code);

    return { room, member };
  }

  /**
   * Adiciona um cliente a uma sala existente.
   *
   * Se o socket já estiver na sala (ex.: reconexão), reutiliza a entrada
   * existente em vez de criar duplicata.
   */
  joinRoom(code: string, options: MemberOptions): JoinResult {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, reason: "ROOM_NOT_FOUND" };

    // Reentrada do mesmo socket: devolve o estado atual sem duplicar entrada.
    const existing = room.members.get(options.socketId);
    if (existing) {
      return { ok: true, room, member: existing, alreadyExisted: true };
    }

    if (room.passwordHash) {
      const password = (options.password ?? "").trim();
      if (password.length === 0) {
        return { ok: false, reason: "PASSWORD_REQUIRED" };
      }
      if (!verifyPassword(password, room.passwordHash)) {
        return { ok: false, reason: "INVALID_PASSWORD" };
      }
    }

    const member: RoomMember = {
      id: options.socketId,
      name: normalizeName(options.name),
      isSharing: false,
      joinedAt: Date.now(),
      isOwner: false,
    };
    room.members.set(member.id, member);
    room.lastOccupiedAt = Date.now();
    this.membership.set(member.id, code);

    return { ok: true, room, member, alreadyExisted: false };
  }

  /** Recupera uma sala pelo código. */
  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** Recupera a sala à qual um socket pertence. */
  getRoomBySocket(socketId: string): Room | undefined {
    const code = this.membership.get(socketId);
    return code ? this.rooms.get(code) : undefined;
  }

  /** Recupera um membro pelo id do socket. */
  getMemberBySocket(socketId: string): RoomMember | undefined {
    const room = this.getRoomBySocket(socketId);
    return room?.members.get(socketId);
  }

  /**
   * Remove um socket de sua sala.
   *
   * Retorna a sala e o membro removidos, ou `null` se o socket não estava em
   * nenhuma sala.
   *
   * Uma sala que esvazia NÃO é apagada na hora: ela é marcada como recém-vazia
   * e o `sweep` a remove após EMPTY_ROOM_TTL_MS. Isso mantém o link de convite
   * válido por alguns minutos mesmo que todos saiam de uma vez (ex.: refresh do
   * criador), sem reter memória indefinidamente.
   */
  leaveRoom(socketId: string): { room: Room; member: RoomMember } | null {
    const code = this.membership.get(socketId);
    if (!code) return null;

    const room = this.rooms.get(code);
    if (!room) {
      this.membership.delete(socketId);
      return null;
    }

    const member = room.members.get(socketId);
    room.members.delete(socketId);
    this.membership.delete(socketId);

    if (room.members.size === 0) {
      // Reinicia o relógio do TTL a partir de agora.
      room.lastOccupiedAt = Date.now();
    }

    return member ? { room, member } : null;
  }

  /**
   * Marca ou desmarca um socket como compartilhando a tela.
   *
   * Retorna `false` se o socket não estiver em sala nenhuma.
   */
  setSharing(socketId: string, sharing: boolean): boolean {
    const member = this.getMemberBySocket(socketId);
    if (!member) return false;
    member.isSharing = sharing;
    return true;
  }

  /**
   * Lista pública dos participantes de uma sala.
   */
  listParticipants(room: Room): Participant[] {
    return Array.from(room.members.values(), toParticipant);
  }

  /**
   * Remove salas vazias cuja última ocupação passou do TTL.
   *
   * É este varredor — e não `leaveRoom` — que efetivamente apaga as salas
   * vazias. Roda a cada poucos segundos no servidor.
   */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.members.size === 0 && now - room.lastOccupiedAt > EMPTY_ROOM_TTL_MS) {
        this.rooms.delete(code);
        removed += 1;
      }
    }
    return removed;
  }

  /** Remove todas as salas. Usado em shutdown e testes. */
  clear(): void {
    this.rooms.clear();
    this.membership.clear();
  }

  /** Gera um código que ainda não está em uso. */
  private generateUniqueCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = generateRoomCode();
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("Não foi possível gerar um código de sala único.");
  }
}
