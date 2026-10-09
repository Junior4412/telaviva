import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARTICIPANT_NAME,
  EMPTY_ROOM_TTL_MS,
  MAX_NAME_LENGTH,
} from "@tela/shared";
import { RoomManager } from "../src/roomManager.js";

/** Cria um gerenciador isolado para o teste. */
function makeManager(): RoomManager {
  return new RoomManager();
}

describe("createRoom", () => {
  it("cria a sala com o criador como dono", () => {
    const manager = makeManager();
    const { room, member } = manager.createRoom({
      socketId: "s1",
      name: "Ana",
    });

    expect(room.code).toHaveLength(6);
    expect(member.isOwner).toBe(true);
    expect(member.name).toBe("Ana");
    expect(room.members.size).toBe(1);
    expect(manager.roomCount).toBe(1);
  });

  it("não exige senha por padrão", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({ socketId: "s1" });
    expect(room.passwordHash).toBeNull();
  });

  it("armazena a senha apenas como hash", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({
      socketId: "s1",
      password: "segredo123",
    });

    expect(room.passwordHash).toBeTruthy();
    expect(room.passwordHash).not.toContain("segredo123");
  });

  it("gera códigos únicos entre salas", () => {
    const manager = makeManager();
    const codes = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const { room } = manager.createRoom({ socketId: `s${i}` });
      codes.add(room.code);
    }
    expect(codes.size).toBe(50);
  });

  it("usa nome padrão quando ausente", () => {
    const manager = makeManager();
    const { member } = manager.createRoom({ socketId: "s1" });
    expect(member.name).toBe(DEFAULT_PARTICIPANT_NAME);
  });

  it("trunca nomes muito longos", () => {
    const manager = makeManager();
    const { member } = manager.createRoom({
      socketId: "s1",
      name: "x".repeat(500),
    });
    expect(member.name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
  });

  it("remove espaços excedentes do nome", () => {
    const manager = makeManager();
    const { member } = manager.createRoom({
      socketId: "s1",
      name: "  Ana   Maria  ",
    });
    expect(member.name).toBe("Ana Maria");
  });

  it("descarta senha abaixo do mínimo", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({ socketId: "s1", password: "abc" });
    expect(room.passwordHash).toBeNull();
  });
});

describe("joinRoom", () => {
  it("adiciona um participante à sala existente", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({ socketId: "s1" });

    const result = manager.joinRoom(room.code, { socketId: "s2", name: "Bia" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.member.isOwner).toBe(false);
    expect(result.member.name).toBe("Bia");
    expect(room.members.size).toBe(2);
  });

  it("falha com ROOM_NOT_FOUND para código inexistente", () => {
    const manager = makeManager();
    const result = manager.joinRoom("ZZZZZZ", { socketId: "s2" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("ROOM_NOT_FOUND");
  });

  it("falha com PASSWORD_REQUIRED sem senha", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({
      socketId: "s1",
      password: "segredo123",
    });

    const result = manager.joinRoom(room.code, { socketId: "s2" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("PASSWORD_REQUIRED");
  });

  it("falha com INVALID_PASSWORD para senha errada", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({
      socketId: "s1",
      password: "segredo123",
    });

    const result = manager.joinRoom(room.code, {
      socketId: "s2",
      password: "errada",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INVALID_PASSWORD");
  });

  it("aceita a senha correta", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({
      socketId: "s1",
      password: "segredo123",
    });

    const result = manager.joinRoom(room.code, {
      socketId: "s2",
      password: "segredo123",
    });

    expect(result.ok).toBe(true);
  });

  it("reutiliza a entrada quando o mesmo socket entra de novo", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({ socketId: "s1" });

    const first = manager.joinRoom(room.code, { socketId: "s2" });
    const second = manager.joinRoom(room.code, { socketId: "s2" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.alreadyExisted).toBe(true);
    // Não consumiu uma vaga extra.
    expect(room.members.size).toBe(2);
  });

  it("não impõe limite de participantes (decisão de produto)", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({ socketId: "creator" });

    // Bem acima do antigo teto de 8 — a sala continua aceitando entradas.
    for (let i = 1; i <= 40; i += 1) {
      const result = manager.joinRoom(room.code, { socketId: `s${i}` });
      expect(result.ok).toBe(true);
    }

    expect(room.members.size).toBe(41);
  });
});

describe("leaveRoom", () => {
  it("remove o participante e devolve sala e membro", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({ socketId: "s1" });
    manager.joinRoom(room.code, { socketId: "s2" });

    const removed = manager.leaveRoom("s2");

    expect(removed).not.toBeNull();
    expect(removed?.member.id).toBe("s2");
    expect(room.members.size).toBe(1);
  });

  it("mantém a sala vazia para o link de convite não morrer na hora", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({ socketId: "s1" });

    manager.leaveRoom("s1");

    // A sala existe, mas sem ninguém — o `sweep` vai removê-la após o TTL.
    expect(manager.getRoom(room.code)).toBe(room);
    expect(room.members.size).toBe(0);
    expect(manager.memberCount).toBe(0);
  });

  it("devolve null para socket fora de sala", () => {
    const manager = makeManager();
    expect(manager.leaveRoom("inexistente")).toBeNull();
  });

  it("limpa o índice de membros ao sair", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({ socketId: "s1" });

    manager.leaveRoom("s1");

    expect(manager.getRoomBySocket("s1")).toBeUndefined();
    expect(manager.getMemberBySocket("s1")).toBeUndefined();
    expect(manager.memberCount).toBe(0);
    expect(room.members.size).toBe(0);
  });
});

describe("consultas", () => {
  it("localiza sala e membro pelo socket", () => {
    const manager = makeManager();
    const { room, member } = manager.createRoom({ socketId: "s1", name: "Ana" });

    expect(manager.getRoomBySocket("s1")).toBe(room);
    expect(manager.getMemberBySocket("s1")).toEqual(member);
    expect(manager.getRoom(room.code)).toBe(room);
  });

  it("lista participantes na forma pública", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({ socketId: "s1", name: "Ana" });
    manager.joinRoom(room.code, { socketId: "s2", name: "Bia" });

    const list = manager.listParticipants(room);

    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name).sort()).toEqual(["Ana", "Bia"]);
    // Não vaza dados internos além do contrato público.
    for (const participant of list) {
      expect(participant).toHaveProperty("id");
      expect(participant).toHaveProperty("name");
      expect(participant).toHaveProperty("isSharing");
      expect(participant).toHaveProperty("joinedAt");
      expect(participant).toHaveProperty("isOwner");
      expect(participant).not.toHaveProperty("socket");
    }
  });
});

describe("setSharing", () => {
  it("marca e desmarca o compartilhamento", () => {
    const manager = makeManager();
    manager.createRoom({ socketId: "s1" });

    expect(manager.setSharing("s1", true)).toBe(true);
    expect(manager.getMemberBySocket("s1")?.isSharing).toBe(true);

    expect(manager.setSharing("s1", false)).toBe(true);
    expect(manager.getMemberBySocket("s1")?.isSharing).toBe(false);
  });

  it("devolve false para socket fora de sala", () => {
    const manager = makeManager();
    expect(manager.setSharing("inexistente", true)).toBe(false);
  });
});

describe("sweep", () => {
  it("não remove salas ocupadas", () => {
    const manager = makeManager();
    manager.createRoom({ socketId: "s1" });

    // Timestamp no futuro bem além do TTL.
    const removed = manager.sweep(Date.now() + 60 * 60 * 1000);

    expect(removed).toBe(0);
    expect(manager.roomCount).toBe(1);
  });

  it("remove salas vazias além do TTL", () => {
    const manager = makeManager();
    manager.createRoom({ socketId: "s1" });
    manager.leaveRoom("s1");

    // A sala vazia fica; passado o TTL, a varredura a remove.
    expect(manager.roomCount).toBe(1);
    const removed = manager.sweep(Date.now() + EMPTY_ROOM_TTL_MS + 1000);

    expect(removed).toBe(1);
    expect(manager.roomCount).toBe(0);
  });

  it("não remove salas vazias antes do TTL", () => {
    const manager = makeManager();
    const { room } = manager.createRoom({ socketId: "s1" });
    manager.leaveRoom("s1");

    const removed = manager.sweep(Date.now());

    expect(removed).toBe(0);
    expect(manager.getRoom(room.code)).toBe(room);
  });
});

describe("clear", () => {
  it("remove tudo", () => {
    const manager = makeManager();
    manager.createRoom({ socketId: "s1" });
    manager.createRoom({ socketId: "s2" });

    manager.clear();

    expect(manager.roomCount).toBe(0);
    expect(manager.memberCount).toBe(0);
    expect(manager.getRoomBySocket("s1")).toBeUndefined();
  });
});
