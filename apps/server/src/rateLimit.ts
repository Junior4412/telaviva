/**
 * Rate limiting em memória, por chave (normalmente o IP do cliente).
 *
 * Implementamos sliding window manual para evitar uma dependência extra e
 * para manter o comportamento explícito. O Map é varrido periodicamente para
 * não vazar memória quando clientes desconectam.
 */

interface Bucket {
  /** Timestamps das tentativas dentro da janela atual. */
  hits: number[];
}

export interface RateLimitRule {
  /** Máximo de eventos permitidos dentro da janela. */
  limit: number;
  /** Tamanho da janela, em milissegundos. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Tentativas restantes na janela atual. */
  remaining: number;
  /** Tempo até a próxima tentativa ser aceita, em ms. */
  retryAfterMs: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly rule: RateLimitRule;
  private timer: NodeJS.Timeout | null = null;

  constructor(rule: RateLimitRule, sweepIntervalMs = 60_000) {
    this.rule = rule;
    this.timer = setInterval(() => this.sweep(), sweepIntervalMs);
    // Não impede o processo de encerrar por causa do timer de limpeza.
    this.timer.unref?.();
  }

  /** Registra uma tentativa e informa se ela é permitida. */
  consume(key: string, cost = 1): RateLimitResult {
    const now = Date.now();
    const cutoff = now - this.rule.windowMs;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { hits: [] };
      this.buckets.set(key, bucket);
    }

    // Descarta tentativas que já saíram da janela.
    bucket.hits = bucket.hits.filter((ts) => ts > cutoff);

    if (bucket.hits.length + cost > this.rule.limit) {
      const oldest = bucket.hits[0] ?? now;
      return {
        allowed: false,
        remaining: Math.max(0, this.rule.limit - bucket.hits.length),
        retryAfterMs: Math.max(0, oldest + this.rule.windowMs - now),
      };
    }

    for (let i = 0; i < cost; i += 1) bucket.hits.push(now);

    return {
      allowed: true,
      remaining: Math.max(0, this.rule.limit - bucket.hits.length),
      retryAfterMs: 0,
    };
  }

  /** Zera o contador de uma chave, ex.: após um login bem-sucedido. */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Zera todos os contadores sem parar o timer.
   *
   * Usado nos testes para que um teste de outra feature não seja bloqueado
   * pelo rate limit que já foi consumido por testes anteriores.
   */
  clear(): void {
    this.buckets.clear();
  }

  /** Remove buckets vazios. Chamado pelo intervalo configurado. */
  private sweep(): void {
    const cutoff = Date.now() - this.rule.windowMs;
    for (const [key, bucket] of this.buckets) {
      const live = bucket.hits.filter((ts) => ts > cutoff);
      if (live.length === 0) {
        this.buckets.delete(key);
      } else {
        bucket.hits = live;
      }
    }
  }

  /** Para o timer de limpeza. Útil nos testes. */
  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.buckets.clear();
  }
}
