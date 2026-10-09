import { createServer, type Server as HttpServer } from "node:http";
import { io as clientIo, type Socket as ClientSocket } from "socket.io-client";
import {
  type AckResult,
  type ClientToServerEvents,
  type RoomJoinedData,
  type ServerToClientEvents,
} from "@tela/shared";
import { createSocketServer, type SocketContext } from "../src/socket.js";

/** Socket do cliente já tipado com o contrato compartilhado. */
export type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

export interface TestServer {
  /** URL base do servidor, ex.: http://127.0.0.1:54321 */
  url: string;
  context: SocketContext;
  /** Conecta um novo cliente já aguardando o handshake. */
  connectClient(): Promise<TestClient>;
  /** Desconecta todos os clientes e encerra o servidor. */
  close(): Promise<void>;
}

/**
 * Sobe um servidor Socket.IO real numa porta efêmera.
 *
 * Usamos um servidor HTTP de verdade por arquivo de teste para que os testes
 * exercitem o caminho de rede real (CORS, handshake, acks, desconexão), em vez
 * de mockar o Socket.IO. Porta efêmera evita colisão entre arquivos em paralelo.
 */
export async function startTestServer(): Promise<TestServer> {
  const httpServer: HttpServer = createServer();
  const context = createSocketServer(httpServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Não foi possível obter a porta do servidor de teste.");
  }
  const url = `http://127.0.0.1:${address.port}`;

  const clients: TestClient[] = [];

  const connectClient = async (): Promise<TestClient> => {
    const socket = clientIo(url, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 5000,
    });
    clients.push(socket);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Tempo esgotado aguardando o handshake.")),
        5000,
      );
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("connect_error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    return socket;
  };

  const close = async (): Promise<void> => {
    for (const socket of clients) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    context.io.disconnectSockets(true);
    context.createLimiter.dispose();
    context.joinLimiter.dispose();
    context.rooms.clear();

    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      // Força o fechamento de conexões keep-alive que seguram o listener.
      httpServer.closeAllConnections?.();
    });
  };

  return { url, context, connectClient, close };
}

/** Envia um evento com ack, respeitando o timeout do Socket.IO. */
export function emitAck<T>(
  socket: TestClient,
  event: string,
  payload: unknown,
  timeoutMs = 5000,
): Promise<AckResult<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`ack timeout: ${event}`)),
      timeoutMs,
    );

    // Mantemos a chamada como método para preservar o `this` do Socket.IO.
    type EmitFn = (
      name: string,
      data: unknown,
      cb: (error: Error | null, response?: AckResult<T>) => void,
    ) => void;
    const emitter = socket.timeout(timeoutMs) as unknown as { emit: EmitFn };

    emitter.emit(event, payload, (error, response) => {
      clearTimeout(timer);
      if (error) reject(error);
      else if (!response) reject(new Error(`resposta vazia: ${event}`));
      else resolve(response);
    });
  });
}

/** Aguarda um evento específico, com timeout para não travar o teste. */
export function waitFor<T>(
  socket: TestClient,
  event: keyof ServerToClientEvents,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout aguardando: ${String(event)}`));
    }, timeoutMs);

    const handler = (payload: T): void => {
      clearTimeout(timer);
      resolve(payload);
    };

    socket.once(event, handler as never);
  });
}

/**
 * Espera um evento cujo payload satisfaça `match`.
 *
 * Útil quando pode haver um evento "de fundo" a caminho (ex.: o `room:state`
 * do join) e só o seguinte interessa. Ignora payloads que não batem e só
 * rejeita se o tempo esgotar.
 */
export function waitForMatch<T>(
  socket: TestClient,
  event: keyof ServerToClientEvents,
  match: (payload: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const handler = (payload: T): void => {
      if (!match(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler as never);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      socket.off(event, handler as never);
      reject(new Error(`timeout aguardando: ${String(event)} (condição não satisfeita)`));
    }, timeoutMs);

    socket.on(event, handler as never);
  });
}

/** Cria uma sala e retorna o resultado já validado. */
export async function createRoom(
  client: TestClient,
  input: { name?: string; password?: string } = {},
): Promise<RoomJoinedData> {
  const result = await emitAck<RoomJoinedData>(client, "room:create", input);
  if (!result.ok) {
    throw new Error(`criação falhou: ${result.error.code}`);
  }
  return result.data;
}

/**
 * Zera os rate limits do servidor de teste.
 *
 * Chamado antes de cada teste de sala/sinalização para que o limite por IP
 * (compartilhado por todos os clientes de localhost) não contamine testes que
 * não têm relação com rate limiting. O próprio rate limit é coberto pelo
 * `rateLimit.test.ts` (unidade) e pelo `rateLimit.integration.test.ts`.
 */
export function resetRateLimits(server: TestServer): void {
  server.context.createLimiter.clear();
  server.context.joinLimiter.clear();
}

/**
 * Retorna `true` se o evento chega dentro de `ms`.
 *
 * Feito para afirmar AUSENCIA de eventos: o timeout do `waitFor` é engolido
 * aqui, então um evento que nunca chega vira `false` e não rejeita o teste.
 */
export async function received(
  socket: TestClient,
  event: keyof ServerToClientEvents,
  ms = 300,
): Promise<boolean> {
  return waitFor(socket, event, ms)
    .then(() => true)
    .catch(() => false);
}

/** Pequena pausa para que eventos em fila sejam entregues. */
export function settle(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
