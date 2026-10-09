/**
 * Teste de fumaça da sinalização, executado contra o servidor compilado.
 *
 * Valida o caminho real de rede: criar sala, entrar com código, receber o
 * estado, relay de sinalização entre dois sockets e limpeza ao sair.
 */
import { io } from "socket.io-client";

const SERVER = "http://localhost:3099";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return io(SERVER, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000,
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000);
    socket.timeout(5000).emit(event, payload, (err, res) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(res);
    });
  });
}

function waitFor(socket, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`wait timeout: ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function main() {
  console.log("1. Criar sala");
  const a = connect();
  await waitFor(a, "connect");
  const created = await emitAck(a, "room:create", { name: "Ana" });
  check("create responde ok", created.ok === true, JSON.stringify(created));
  const code = created.data.roomCode;
  check("codigo com 6 caracteres", typeof code === "string" && code.length === 6, code);
  check("selfId preenchido", typeof created.data.selfId === "string");
  check("participante criador presente", created.data.participants.length === 1);

  console.log("2. Entrar com codigo");
  const b = connect();
  await waitFor(b, "connect");
  const statePromise = waitFor(a, "room:state");
  const joined = await emitAck(b, "room:join", { roomCode: code, name: "Bia" });
  check("join responde ok", joined.ok === true, JSON.stringify(joined));
  check("dois participantes", joined.data.participants.length === 2, String(joined.data.participants.length));
  const state = await statePromise;
  check("room:state propagou para o criador", state.participants.length === 2, String(state.participants.length));

  console.log("3. Relay de sinalizacao");
  const offerPromise = waitFor(b, "signal:offer");
  a.emit("signal:offer", {
    to: joined.data.selfId,
    sdp: { type: "offer", sdp: "v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\n" },
  });
  const offer = await offerPromise;
  check("offer encaminhada com from correto", offer.from === created.data.selfId, offer.from);
  check("sdp preservado", offer.sdp.type === "offer" && offer.sdp.sdp.includes("v=0"));

  const icePromise = waitFor(a, "signal:ice");
  b.emit("signal:ice", {
    to: created.data.selfId,
    candidate: { candidate: "candidate:1 1 UDP 2130706431 192.168.1.5 50000 typ host", sdpMid: "0", sdpMLineIndex: 0 },
  });
  const ice = await icePromise;
  check("ice encaminhado", ice.candidate.candidate.includes("typ host"));

  console.log("4. Sinalizacao para peer inexistente");
  const errPromise = waitFor(a, "error");
  a.emit("signal:offer", { to: "id-que-nao-existe", sdp: { type: "offer", sdp: "x" } });
  const err = await errPromise;
  check("erro PEER_NOT_FOUND", err.code === "PEER_NOT_FOUND", err.code);

  console.log("5. Senha de sala");
  const c = connect();
  await waitFor(c, "connect");
  const protectedRoom = await emitAck(c, "room:create", { name: "Ca", password: "segredo123" });
  check("sala protegida criada", protectedRoom.ok === true);
  const d = connect();
  await waitFor(d, "connect");
  const noPass = await emitAck(d, "room:join", { roomCode: protectedRoom.data.roomCode, name: "Duda" });
  check("entrada sem senha recusada", noPass.ok === false && noPass.error.code === "PASSWORD_REQUIRED", JSON.stringify(noPass));
  const wrongPass = await emitAck(d, "room:join", { roomCode: protectedRoom.data.roomCode, password: "errada" });
  check("senha errada recusada", wrongPass.ok === false && wrongPass.error.code === "PASSWORD_REQUIRED", JSON.stringify(wrongPass));
  const rightPass = await emitAck(d, "room:join", { roomCode: protectedRoom.data.roomCode, password: "segredo123" });
  check("senha correta aceita", rightPass.ok === true, JSON.stringify(rightPass));

  console.log("6. Codigo inexistente");
  const e = connect();
  await waitFor(e, "connect");
  const missing = await emitAck(e, "room:join", { roomCode: "ZZZZZZ", name: "Ema" });
  check("sala inexistente recusada", missing.ok === false && missing.error.code === "ROOM_NOT_FOUND", JSON.stringify(missing));

  console.log("7. Limpeza ao desconectar");
  const leftPromise = waitFor(a, "peer:left");
  b.disconnect();
  const left = await leftPromise;
  check("peer:left emitido", left.participantId === joined.data.selfId, JSON.stringify(left));
  await sleep(200);
  const stateAfter = await new Promise((resolve) => {
    a.once("room:state", resolve);
    a.emit("room:leave");
    setTimeout(() => resolve(null), 1000);
  });
  check("estado atualizado apos saida", stateAfter === null || stateAfter.participants.length === 1, JSON.stringify(stateAfter));

  for (const s of [a, c, d, e]) s.disconnect();

  console.log(failures === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${failures} TESTE(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("ERRO FATAL:", error);
  process.exit(1);
});
