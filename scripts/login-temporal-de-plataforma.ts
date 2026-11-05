import { appendFile } from "node:fs/promises";
import { ejecutarLoginTemporal } from "./ejecutar-login-temporal-de-plataforma";

/**
 * Abre o cierra el login temporal del rol de plataforma: `npm run plataforma:login-temporal -- <abrir|cerrar>`. Lo corre el
 * workflow `preparar-empresa-de-pruebas.yml`; el detalle está en `ejecutar-login-temporal-de-plataforma.ts`.
 */

// Una falla que se escape no puede volcar la pila ni su mensaje al registro: solo el tipo.
function fallaInesperada(falla: unknown): void {
  console.error(`ERROR inesperado (${falla instanceof Error ? falla.name : "falla"}).`);
  process.exit(1);
}
process.on("uncaughtException", fallaInesperada);
process.on("unhandledRejection", fallaInesperada);

process.exitCode = await ejecutarLoginTemporal({
  accion: process.argv[2],
  entorno: process.env,
  info: (linea) => console.log(linea),
  error: (linea) => console.error(linea),
  comando: (linea) => console.log(linea),
  agregarAlEntorno: (ruta, texto) => appendFile(ruta, texto),
});

// Red de seguridad: si algún socket quedara abierto, el proceso termina igual.
setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
