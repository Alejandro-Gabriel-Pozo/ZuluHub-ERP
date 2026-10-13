import { expect, vi } from "vitest";

/**
 * Topes de tiempo de las pruebas de integración (se cargan antes de cada archivo, ver `vitest.config.ts`).
 *
 * Qué previene: con la máquina cargada (CI compartido, varios agentes) crear una base aparte, migrarla o
 * encadenar carreras con reintentos tarda más que los 5 s (casos) y 10 s (ganchos) por defecto de vitest
 * y la prueba falla sin ningún defecto del sistema (visto en `identidad-concurrencia`, `concurrencia`,
 * `catalogo`, `autorizacion`, `plataforma-auditoria-idempotencia`). Un colgado real (una transacción que
 * no termina, un bloqueo que no se libera) sigue haciendo fallar la prueba, solo que a los 60 s. Las
 * pruebas unitarias no pasan por acá y conservan sus topes cortos. Un archivo que necesite más lo sube
 * con su propio `vi.setConfig`.
 */
if (expect.getState().testPath?.includes("/test/integracion/") === true) {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
}
