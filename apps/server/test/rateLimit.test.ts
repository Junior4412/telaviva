import { describe, expect, it } from "vitest";
import { CREATE_ROOM_RATE, JOIN_ROOM_RATE } from "@tela/shared";
import { RateLimiter } from "../src/rateLimit.js";

describe("RateLimiter", () => {
  it("permite até o limite dentro da janela", () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });
    try {
      expect(limiter.consume("ip").allowed).toBe(true);
      expect(limiter.consume("ip").allowed).toBe(true);
      expect(limiter.consume("ip").allowed).toBe(true);
      // A quarta excede o limite.
      expect(limiter.consume("ip").allowed).toBe(false);
    } finally {
      limiter.dispose();
    }
  });

  it("reporta as tentativas restantes", () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });
    try {
      expect(limiter.consume("ip").remaining).toBe(2);
      expect(limiter.consume("ip").remaining).toBe(1);
      expect(limiter.consume("ip").remaining).toBe(0);
    } finally {
      limiter.dispose();
    }
  });

  it("reporta quanto tempo falta para uma nova tentativa", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });
    try {
      const first = limiter.consume("ip");
      expect(first.allowed).toBe(true);

      const second = limiter.consume("ip");
      expect(second.allowed).toBe(false);
      expect(second.retryAfterMs).toBeGreaterThan(0);
      expect(second.retryAfterMs).toBeLessThanOrEqual(1000);
    } finally {
      limiter.dispose();
    }
  });

  it("isola contadores por chave (IP)", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
    try {
      expect(limiter.consume("ip-a").allowed).toBe(true);
      expect(limiter.consume("ip-a").allowed).toBe(false);
      // Outro IP não é afetado pelo primeiro.
      expect(limiter.consume("ip-b").allowed).toBe(true);
    } finally {
      limiter.dispose();
    }
  });

  it("libera nova tentativa após a janela expirar", async () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 30 });
    try {
      expect(limiter.consume("ip").allowed).toBe(true);
      expect(limiter.consume("ip").allowed).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 45));

      expect(limiter.consume("ip").allowed).toBe(true);
    } finally {
      limiter.dispose();
    }
  });

  it("reset zera o contador da chave", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
    try {
      expect(limiter.consume("ip").allowed).toBe(true);
      expect(limiter.consume("ip").allowed).toBe(false);

      limiter.reset("ip");

      expect(limiter.consume("ip").allowed).toBe(true);
    } finally {
      limiter.dispose();
    }
  });

  it("suporta custo maior que uma unidade", () => {
    const limiter = new RateLimiter({ limit: 5, windowMs: 60_000 });
    try {
      expect(limiter.consume("ip", 4).allowed).toBe(true);
      expect(limiter.consume("ip", 4).allowed).toBe(false);
      expect(limiter.consume("ip", 1).allowed).toBe(true);
    } finally {
      limiter.dispose();
    }
  });

  it("usa os limites reais definidos no protocolo", () => {
    expect(CREATE_ROOM_RATE.limit).toBeGreaterThan(0);
    expect(JOIN_ROOM_RATE.limit).toBeGreaterThan(0);
    expect(CREATE_ROOM_RATE.windowMs).toBeGreaterThan(0);
    expect(JOIN_ROOM_RATE.windowMs).toBeGreaterThan(0);
  });
});
