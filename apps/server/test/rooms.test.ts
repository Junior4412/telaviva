import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type RoomJoinedData } from "@tela/shared";
import {
  createRoom,
  emitAck,
  resetRateLimits,
  settle,
  startTestServer,
  waitFor,
  waitForMatch,
  type TestClient,
  type TestServer,
} from "./helpers.js";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

beforeEach(() => {
  // Todos os clientes de teste saem do mesmo IP (127.0.0.1); sem isso, o
  // limite de 10 salas/min estouraria no meio da suíte e falharia testes que
  // não têm nada a ver com rate limit.
  resetRateLimits(server);
});

afterAll(async () => {
  await server.close();
});

describe("criação de sala", () => {
  it("cria uma sala e devolve código de 6 caracteres e o próprio id", async () => {
    const client = await server.connectClient();
    const data = await createRoom(client, { name: "Ana" });

    expect(data.roomCode).toHaveLength(6);
    expect(data.selfId).toBeTruthy();
    expect(data.requiresPassword).toBe(false);
    expect(data.participants).toHaveLength(1);
    expect(data.participants[0]?.name).toBe("Ana");
    expect(data.participants[0]?.isOwner).toBe(true);
    expect(data.createdAt).toBeGreaterThan(0);
  });

  it("usa um nome padrão quando nenhum é informado", async () => {
    const client = await server.connectClient();
    const data = await createRoom(client);

    expect(data.participants[0]?.name).toBeTruthy();
    expect(data.participants[0]?.name.length).toBeGreaterThan(0);
  });

  it("trunca nomes longos em vez de rejeitar", async () => {
    const client = await server.connectClient();
    const data = await createRoom(client, { name: "x".repeat(500) });

    expect(data.participants[0]?.name.length).toBeLessThanOrEqual(24);
  });

  it("marca a sala como protegida quando há senha", async () => {
    const client = await server.connectClient();
    const data = await createRoom(client, { password: "segredo123" });

    expect(data.requiresPassword).toBe(true);
  });

  it("descarta senha fraca (abaixo do mínimo) e cria sala aberta", async () => {
    const client = await server.connectClient();
    const data = await createRoom(client, { password: "abc" });

    expect(data.requiresPassword).toBe(false);
  });

  it("gera códigos distintos para salas diferentes", async () => {
    const a = await server.connectClient();
    const b = await server.connectClient();
    const dataA = await createRoom(a);
    const dataB = await createRoom(b);

    expect(dataA.roomCode).not.toBe(dataB.roomCode);
  });
});

describe("entrada na sala", () => {
  it("permite entrar com o código correto", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator, { name: "Ana" });

    const joiner = await server.connectClient();
    const result = await emitAck<RoomJoinedData>(joiner, "room:join", {
      roomCode: created.roomCode,
      name: "Bia",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.participants).toHaveLength(2);
    expect(result.data.roomCode).toBe(created.roomCode);
  });

  it("notifica os demais participantes sobre a entrada", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator);

    const peerJoined = waitFor<{ participant: { name: string } }>(
      creator,
      "peer:joined",
    );

    const joiner = await server.connectClient();
    await emitAck<RoomJoinedData>(joiner, "room:join", {
      roomCode: created.roomCode,
      name: "Bia",
    });

    const payload = await peerJoined;
    expect(payload.participant.name).toBe("Bia");
  });

  it("normaliza o código (espaços, hífens e caixa)", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator);

    const spaced = `${created.roomCode.slice(0, 3)} ${created.roomCode.slice(3)}`;
    const joiner = await server.connectClient();
    const result = await emitAck<RoomJoinedData>(joiner, "room:join", {
      roomCode: spaced.toLowerCase(),
    });

    expect(result.ok).toBe(true);
  });

  it("rejeita código inexistente com ROOM_NOT_FOUND", async () => {
    const client = await server.connectClient();
    const result = await emitAck<RoomJoinedData>(client, "room:join", {
      roomCode: "ZZZZZZ",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ROOM_NOT_FOUND");
    // A mensagem precisa ser legível, não o código bruto.
    expect(result.error.message).not.toBe("ROOM_NOT_FOUND");
    expect(result.error.message.length).toBeGreaterThan(0);
  });

  it("rejeita código com formato inválido", async () => {
    const client = await server.connectClient();
    const result = await emitAck<RoomJoinedData>(client, "room:join", {
      roomCode: "abc",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_ROOM_CODE");
  });

  it("aceita mais participantes que o antigo teto de 8 (sem limite por sala)", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator);

    const joiners: TestClient[] = [];
    for (let i = 1; i <= 12; i += 1) {
      const client = await server.connectClient();
      const result = await emitAck<RoomJoinedData>(client, "room:join", {
        roomCode: created.roomCode,
        name: `Pessoa ${i}`,
      });
      expect(result.ok).toBe(true);
      joiners.push(client);
    }

    // 13 no total, acima do antigo teto: o estado precisa refletir todos.
    const state = await waitForMatch<{ participants: unknown[] }>(
      creator,
      "room:state",
      (s) => s.participants.length === 13,
    );
    expect(state.participants).toHaveLength(13);

    for (const client of joiners) client.disconnect();
  });
});

describe("senha de sala", () => {
  it("exige senha quando a sala foi criada protegida", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator, { password: "segredo123" });

    const client = await server.connectClient();
    const result = await emitAck<RoomJoinedData>(client, "room:join", {
      roomCode: created.roomCode,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PASSWORD_REQUIRED");
  });

  it("rejeita senha incorreta", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator, { password: "segredo123" });

    const client = await server.connectClient();
    const result = await emitAck<RoomJoinedData>(client, "room:join", {
      roomCode: created.roomCode,
      password: "errada",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PASSWORD_REQUIRED");
  });

  it("aceita a senha correta", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator, { password: "segredo123" });

    const client = await server.connectClient();
    const result = await emitAck<RoomJoinedData>(client, "room:join", {
      roomCode: created.roomCode,
      password: "segredo123",
    });

    expect(result.ok).toBe(true);
  });
});

describe("saída e limpeza", () => {
  it("remove o participante e avisa os demais ao sair", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator, { name: "Ana" });

    const joiner = await server.connectClient();
    await emitAck<RoomJoinedData>(joiner, "room:join", {
      roomCode: created.roomCode,
      name: "Bia",
    });

    // Registra tudo ANTES de disparar a saída: o `room:state` resultante é
    // emitido logo depois do `peer:left`, e se esperássemos o par já teria
    // chegado sem listener. O filtro descarta o `room:state` pendente do join.
    const peerLeft = waitFor<{ participantId: string }>(creator, "peer:left");
    const statePromise = waitForMatch<{ participants: unknown[] }>(
      creator,
      "room:state",
      (state) => state.participants.length === 1,
    );

    joiner.emit("room:leave");

    const payload = await peerLeft;
    expect(payload.participantId).toBeTruthy();

    const state = await statePromise;
    expect(state.participants).toHaveLength(1);
  });

  it("limpa a sala quando todos desconectam abruptamente", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator);

    const joiner = await server.connectClient();
    await emitAck<RoomJoinedData>(joiner, "room:join", {
      roomCode: created.roomCode,
    });

    // Registrado antes da desconexão, com filtro que ignora o `room:state`
    // pendente do join (2 pessoas) e só resolve quando restar 1.
    const statePromise = waitForMatch<{ participants: unknown[] }>(
      creator,
      "room:state",
      (state) => state.participants.length === 1,
    );

    // Desconexão abrupta (sem room:leave), como um PC que caiu.
    joiner.disconnect();

    const state = await statePromise;
    expect(state.participants).toHaveLength(1);

    // A sala deve existir ainda, pois o criador continua nela.
    const found = await emitAck<RoomJoinedData>(
      await server.connectClient(),
      "room:join",
      { roomCode: created.roomCode },
    );
    expect(found.ok).toBe(true);
  });

  it("mantém a sala vazia por um tempo (o link de convite não quebra na hora)", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator);

    creator.emit("room:leave");
    creator.disconnect();
    await settle(100);

    // Dentro do TTL a sala ainda existe e pode ser reentrada por qualquer um
    // com o código — é o que mantém o convite útil após um refresh do criador.
    const client = await server.connectClient();
    const result = await emitAck<RoomJoinedData>(client, "room:join", {
      roomCode: created.roomCode,
    });

    expect(result.ok).toBe(true);
  });
});

describe("estado da sala", () => {
  it("propaga room:state para todos os participantes", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator, { name: "Ana" });

    const statePromise = waitFor<{
      roomCode: string;
      selfId: string;
      participants: { id: string }[];
    }>(creator, "room:state");

    const joiner = await server.connectClient();
    await emitAck<RoomJoinedData>(joiner, "room:join", {
      roomCode: created.roomCode,
      name: "Bia",
    });

    const state = await statePromise;
    expect(state.roomCode).toBe(created.roomCode);
    expect(state.selfId).toBe(created.selfId);
    expect(state.participants).toHaveLength(2);
  });
});
