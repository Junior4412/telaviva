import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { IceCandidatePayload, RoomJoinedData, SdpPayload } from "@tela/shared";
import {
  createRoom,
  emitAck,
  received,
  resetRateLimits,
  startTestServer,
  waitFor,
  waitForMatch,
  type TestServer,
} from "./helpers.js";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

beforeEach(() => {
  resetRateLimits(server);
});

afterAll(async () => {
  await server.close();
});

describe("relay de sinalização", () => {
  it("encaminha uma oferta para o par correto com o remetente original", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator, { name: "Ana" });

    const joiner = await server.connectClient();
    const joined = await emitAck<RoomJoinedData>(joiner, "room:join", {
      roomCode: created.roomCode,
      name: "Bia",
    });
    if (!joined.ok) throw new Error("join falhou");

    const offerPromise = waitFor<{ from: string; sdp: SdpPayload }>(
      joiner,
      "signal:offer",
    );

    const sdp: SdpPayload = {
      type: "offer",
      sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n",
    };
    creator.emit("signal:offer", { to: joined.data.selfId, sdp });

    const offer = await offerPromise;
    // O `from` precisa ser o do remetente real, nunca o que o cliente enviou.
    expect(offer.from).toBe(created.selfId);
    expect(offer.sdp.type).toBe("offer");
    expect(offer.sdp.sdp).toContain("v=0");
  });

  it("encaminha uma resposta SDP de volta", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator);

    const joiner = await server.connectClient();
    const joined = await emitAck<RoomJoinedData>(joiner, "room:join", {
      roomCode: created.roomCode,
    });
    if (!joined.ok) throw new Error("join falhou");

    const answerPromise = waitFor<{ from: string; sdp: SdpPayload }>(
      creator,
      "signal:answer",
    );

    joiner.emit("signal:answer", {
      to: created.selfId,
      sdp: { type: "answer", sdp: "v=0\r\n" },
    });

    const answer = await answerPromise;
    expect(answer.from).toBe(joined.data.selfId);
    expect(answer.sdp.type).toBe("answer");
  });

  it("encaminha candidatos ICE preservando os campos", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator);

    const joiner = await server.connectClient();
    const joined = await emitAck<RoomJoinedData>(joiner, "room:join", {
      roomCode: created.roomCode,
    });
    if (!joined.ok) throw new Error("join falhou");

    const icePromise = waitFor<{ from: string; candidate: IceCandidatePayload }>(
      creator,
      "signal:ice",
    );

    const candidate: IceCandidatePayload = {
      candidate: "candidate:1 1 UDP 2130706431 192.168.1.5 50000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };
    joiner.emit("signal:ice", { to: created.selfId, candidate });

    const payload = await icePromise;
    expect(payload.from).toBe(joined.data.selfId);
    expect(payload.candidate.candidate).toContain("typ host");
    expect(payload.candidate.sdpMid).toBe("0");
    expect(payload.candidate.sdpMLineIndex).toBe(0);
  });

  it("emite erro PEER_NOT_FOUND quando o alvo não está na sala", async () => {
    const creator = await server.connectClient();
    await createRoom(creator);

    const errorPromise = waitFor<{ code: string }>(creator, "error");
    creator.emit("signal:offer", {
      to: "id-que-nao-existe",
      sdp: { type: "offer", sdp: "v=0\r\n" },
    });

    const error = await errorPromise;
    expect(error.code).toBe("PEER_NOT_FOUND");
  });

  it("ignora sinalização de quem não está em sala nenhuma", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator);

    // Um socket que nunca entrou em sala tenta enviar sinalização.
    const outsider = await server.connectClient();
    outsider.emit("signal:offer", {
      to: created.selfId,
      sdp: { type: "offer", sdp: "v=0\r\n" },
    });

    // O criador não deve receber nada.
    expect(await received(creator, "signal:offer")).toBe(false);
  });

  it("não entrega sinalização entre salas diferentes", async () => {
    const roomAOwner = await server.connectClient();
    const roomA = await createRoom(roomAOwner);

    const roomBOwner = await server.connectClient();
    const roomB = await createRoom(roomBOwner);

    roomBOwner.emit("signal:offer", {
      to: roomA.selfId,
      sdp: { type: "offer", sdp: "v=0\r\n" },
    });

    expect(await received(roomAOwner, "signal:offer")).toBe(false);
    expect(roomA.roomCode).not.toBe(roomB.roomCode);
  });
});

describe("estado de compartilhamento", () => {
  it("notifica quando um participante começa a compartilhar", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator, { name: "Ana" });

    const joiner = await server.connectClient();
    const joined = await emitAck<RoomJoinedData>(joiner, "room:join", {
      roomCode: created.roomCode,
      name: "Bia",
    });
    if (!joined.ok) throw new Error("join falhou");

    const changedPromise = waitFor<{ participantId: string; sharing: boolean }>(
      creator,
      "screen:changed",
    );

    joiner.emit("screen:state", { sharing: true });

    const changed = await changedPromise;
    expect(changed.participantId).toBe(joined.data.selfId);
    expect(changed.sharing).toBe(true);
  });

  it("notifica o encerramento do compartilhamento", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator);

    const joiner = await server.connectClient();
    await emitAck<RoomJoinedData>(joiner, "room:join", {
      roomCode: created.roomCode,
    });

    joiner.emit("screen:state", { sharing: true });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const changedPromise = waitFor<{ sharing: boolean }>(
      creator,
      "screen:changed",
    );
    joiner.emit("screen:state", { sharing: false });

    const changed = await changedPromise;
    expect(changed.sharing).toBe(false);
  });

  it("reflete o compartilhamento no estado dos participantes", async () => {
    const creator = await server.connectClient();
    const created = await createRoom(creator, { name: "Ana" });

    const joiner = await server.connectClient();
    const joined = await emitAck<RoomJoinedData>(joiner, "room:join", {
      roomCode: created.roomCode,
      name: "Bia",
    });
    if (!joined.ok) throw new Error("join falhou");

    // O `room:state` do join pode ainda estar a caminho e teria
    // isSharing=false. Em vez de assumir ordem de entrega, filtramos até o
    // estado que de fato reflete o compartilhamento.
    const statePromise = waitForMatch<{
      participants: { id: string; isSharing: boolean }[];
    }>(
      creator,
      "room:state",
      (s) => s.participants.find((p) => p.id === joined.data.selfId)?.isSharing === true,
    );

    joiner.emit("screen:state", { sharing: true });

    const state = await statePromise;
    const bia = state.participants.find((p) => p.id === joined.data.selfId);
    expect(bia?.isSharing).toBe(true);
  });
});
