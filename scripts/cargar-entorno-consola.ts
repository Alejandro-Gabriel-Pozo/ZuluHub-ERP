import { ejecutarCargaDeLaConsola } from "./ejecutar-cargar-entorno-consola";

/**
 * Deja la consola de plataforma de `preview` con sus variables: `npm run consola:cargar-entorno`. Lo corre el workflow
 * `cargar-entorno-consola.yml`; el detalle está en `ejecutar-cargar-entorno-consola.ts`.
 */

// Una falla que se escape no puede volcar la pila ni su mensaje al registro: solo el tipo.
function fallaInesperada(falla: unknown): void {
  console.error(`ERROR inesperado (${falla instanceof Error ? falla.name : "falla"}).`);
  process.exit(1);
}
process.on("uncaughtException", fallaInesperada);
process.on("unhandledRejection", fallaInesperada);

process.exitCode = await ejecutarCargaDeLaConsola({
  entorno: process.env,
  info: (linea) => console.log(linea),
  error: (linea) => console.error(linea),
  comando: (linea) => console.log(linea),
});

// Red de seguridad: si algún socket quedara abierto, el proceso termina igual.
setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
