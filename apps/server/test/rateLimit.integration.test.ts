import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CREATE_ROOM_RATE, JOIN_ROOM_RATE, type RoomJoinedData } from "@tela/shared";
import { emitAck, startTestServer, type TestServer } from "./helpers.js";

/**
 * Este arquivo NÃO chama `resetRateLimits` — justamente porque o que está sob
 * teste é o próprio limite. Todos os clientes saem do mesmo IP (127.0.0.1),
 * então os contadores são compartilhados, como no mundo real.
 *
 * Arquivo próprio porque o vitest roda cada arquivo num worker separado, com
 * seu próprio servidor e seus próprios limiters.
 */
let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

describe("rate limit por IP", () => {
  it(`bloqueia criação após ${CREATE_ROOM_RATE.limit} salas na janela`, async () => {
    const client = await server.connectClient();

    for (let i = 0; i < CREATE_ROOM_RATE.limit; i += 1) {
      const result = await emitAck<RoomJoinedData>(client, "room:create", {});
      expect(result.ok).toBe(true);
    }

    const blocked = await emitAck<RoomJoinedData>(client, "room:create", {});
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;

    expect(blocked.error.code).toBe("RATE_LIMITED");
    // A mensagem precisa ser amigável, não o código bruto do erro.
    expect(blocked.error.message).not.toBe("RATE_LIMITED");
    expect(blocked.error.message.length).toBeGreaterThan(0);
  });

  it("aplica o limite por IP, não por conexão", async () => {
    // Um segundo socket vem do mesmo IP (127.0.0.1), então herda o bloqueio.
    // Se o limite fosse por conexão, este socket teria cota própria.
    const other = await server.connectClient();
    const blocked = await emitAck<RoomJoinedData>(other, "room:create", {});
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.code).toBe("RATE_LIMITED");
  });

  it(`bloqueia entrada após ${JOIN_ROOM_RATE.limit} tentativas na janela`, async () => {
    const client = await server.connectClient();

    // Códigos inexistentes ainda contam como tentativa: o limite é consumido
    // antes da validação, senão um atacante poderia contorná-lo.
    for (let i = 0; i < JOIN_ROOM_RATE.limit; i += 1) {
      const result = await emitAck<RoomJoinedData>(client, "room:join", {
        roomCode: "ZZZZZZ",
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      // Antes de estourar o limite, o motivo é "sala não existe".
      expect(result.error.code).toBe("ROOM_NOT_FOUND");
    }

    const blocked = await emitAck<RoomJoinedData>(client, "room:join", {
      roomCode: "ZZZZZZ",
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.code).toBe("RATE_LIMITED");
    expect(blocked.error.message).not.toBe("RATE_LIMITED");
  });
});
