import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./test/integracion/global.ts"],
    setupFiles: ["./test/integracion/topes.ts"],
  },
});
