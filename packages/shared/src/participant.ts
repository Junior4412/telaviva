/**
 * Representação pública de um participante na sala.
 *
 * Este é o único dado de participante que trafega para os navegadores.
 * Coisas como IP, socket id interno ou senha nunca aparecem aqui.
 */
export interface Participant {
  /** Identificador público e efêmero do participante dentro da sala. */
  id: string;

  /** Nome exibido. Nunca vazio — o backend aplica um padrão se vazio. */
  name: string;

  /** Indica se este participante está transmitindo a tela agora. */
  isSharing: boolean;

  /** Timestamp de entrada na sala, em milissegundos. */
  joinedAt: number;

  /** Indica que este participante é quem criou a sala. */
  isOwner: boolean;
}
