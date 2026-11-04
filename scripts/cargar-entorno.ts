import { ejecutarCargaDeEntorno } from "./ejecutar-cargar-entorno.ts";

/**
 * Genera y carga en Vercel las variables que no dependen del dueño. Lo corre el workflow
 * `.github/workflows/cargar-entorno.yml` con `npm run cargar-entorno -- --vercel <destino>`; el detalle de lo que hace
 * está en `ejecutar-cargar-entorno.ts`. Se ejecuta directo con Node (borra los tipos al cargar), sin dependencias nuevas.
 */

// Una falla que se escape no puede volcar la pila ni su mensaje al registro: solo el tipo.
function fallaInesperada(falla: unknown): void {
  console.error(
    `ERROR inesperado (${falla instanceof Error ? falla.name : "falla"}): la corrida se cortó. ` +
      "Repetir el flujo es seguro: lo ya cargado figura como «ya existía».",
  );
  process.exit(1);
}
process.on("uncaughtException", fallaInesperada);
process.on("unhandledRejection", fallaInesperada);

process.exitCode = await ejecutarCargaDeEntorno({
  argumentos: process.argv.slice(2),
  entorno: process.env,
  info: (linea) => console.log(linea),
  error: (linea) => console.error(linea),
  comando: (linea) => console.log(linea),
});

// Red de seguridad: si algún socket quedara abierto, el proceso termina igual (no cuelga el workflow).
setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
