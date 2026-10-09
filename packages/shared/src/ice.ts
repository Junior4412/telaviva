/**
 * Formato de um servidor ICE entregue ao navegador.
 *
 * Espelha o objeto `RTCIceServer` do WebRTC, mas como tipo próprio para que
 * o backend (que não tem lib DOM) possa construir a resposta sem depender de
 * tipos do navegador.
 */
export interface IceServerConfig {
  /** URLs STUN/TURN deste servidor. */
  urls: string[];

  /** Usuário TURN, quando exigido. */
  username?: string;

  /** Credencial TURN temporária (gerada no servidor, com TTL). */
  credential?: string;
}
