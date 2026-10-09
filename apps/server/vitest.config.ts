import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Cada teste de integração sobe seu próprio servidor, então rodam em
    // paralelo sem interferir. Os de unidade são rápidos de qualquer forma.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
