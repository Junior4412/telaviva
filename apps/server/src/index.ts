import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { buildIceServers } from "./ice.js";
import { createSocketServer } from "./socket.js";

/**
 * Ponto de entrada do servidor de sinalização.
 *
 * Sobe um HTTP com Express (para CORS, health check e endpoint ICE) e sobe o
 * Socket.IO sobre o mesmo servidor. Nada de mídia passa por aqui — apenas
 * sinais de controle e a lista de participantes.
 */

const app = express();

// CORS restrito às origens configuradas. Nada de "*" em produção.
app.use(cors({ origin: config.allowedOrigins }));
app.use(express.json({ limit: "16kb" }));

/** Responde 200 para o probe de saúde da hospedagem. */
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: Math.round(process.uptime()),
    env: config.nodeEnv,
  });
});

/**
 * Responde 200 na raiz.
 *
 * Várias plataformas (Render incluso) sondam `/` por padrão e marcam o
 * serviço como instável se receberem 404. O app real fica no frontend; aqui
 * só confirmamos que o processo de sinalização está vivo.
 */
app.get("/", (_req, res) => {
  res.status(200).json({ name: "TelaViva", role: "signaling" });
});

/**
 * Entrega a lista de servidores ICE ao cliente.
 *
 * As credenciais TURN retornadas aqui são temporárias. Este endpoint também é
 * protegido pelo CORS, então só o nosso frontend consegue chamá-lo a partir do
 * navegador — mas lembre-se que qualquer um pode chamar uma API pública via
 * curl; por isso usamos TTL curto e limites de acesso.
 */
app.get("/ice", (_req, res) => {
  res.status(200).json({ iceServers: buildIceServers() });
});

const httpServer = createServer(app);
const socketContext = createSocketServer(httpServer);

httpServer.listen(config.port, () => {
  console.log(`[telaviva] Sinalização em http://localhost:${config.port}`);
  console.log(`[telaviva] Origens permitidas: ${config.allowedOrigins.join(", ")}`);
  console.log(
    `[telaviva] ICE: ${buildIceServers()
      .map((server) => server.urls.join("|"))
      .join(", ")}`,
  );
});

/** Encerra de forma limpa, saindo das salas e fechando o listener. */
function shutdown(signal: string): void {
  console.log(`\n[telaviva] ${signal} recebido. Encerrando...`);
  socketContext.io.disconnectSockets(true);
  socketContext.rooms.clear();
  httpServer.close(() => {
    console.log("[telaviva] Servidor encerrado.");
    process.exit(0);
  });
  // Rede de segurança caso alguma conexão presa impeça o close.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
