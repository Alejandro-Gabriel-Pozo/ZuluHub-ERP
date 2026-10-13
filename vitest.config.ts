import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./test/integracion/global.ts"],
    // Las pruebas de integración crean bases enteras (siete migraciones): con la máquina cargada, 5 s no alcanza.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
