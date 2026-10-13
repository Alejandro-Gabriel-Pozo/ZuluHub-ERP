import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Dónde está el Chromium. En el CI se instala con `npx playwright install chromium` y Playwright lo
// encuentra solo (la variable no se define). Un entorno que ya trae uno propio apunta acá a su
// ejecutable con `ZULUHUB_NAVEGADOR`. No es un secreto: es una ruta.
const ejecutable = process.env["ZULUHUB_NAVEGADOR"] ?? "";

export default defineConfig({
  test: {
    projects: [
      {
        // El proyecto de siempre (Node): dominio, arquitectura e integración. Sin cambios.
        test: {
          name: "node",
          include: ["src/**/*.test.ts", "test/**/*.test.ts"],
          environment: "node",
          globalSetup: ["./test/integracion/global.ts"],
          // Tope de 60 s solo para las pruebas de integración (crean bases enteras con la máquina cargada).
          setupFiles: ["./test/integracion/topes.ts"],
        },
      },
      {
        // W2: componentes y patrones en Chromium real (foco, `<dialog>`, contraste con axe). Corre con
        // `npm run test:componentes`; no entra en `npm test` para que las pruebas de Node y la mutación
        // no necesiten navegador.
        test: {
          name: "componentes",
          include: ["apps/web/ui/**/*.test.{ts,tsx}"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              ...(ejecutable === "" ? {} : { launchOptions: { executablePath: ejecutable } }),
            }),
            // Celular (ASUMIDO en el spec de la web, P-8): 390 x 844.
            instances: [{ browser: "chromium", viewport: { width: 390, height: 844 } }],
          },
        },
      },
    ],
  },
});
