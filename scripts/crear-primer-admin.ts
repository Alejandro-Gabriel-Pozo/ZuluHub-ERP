import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base";
import {
  ejecutarCreacionDelPrimerAdmin,
  VARIABLE_DE_LA_CADENA,
} from "./ejecutar-crear-primer-admin";

/**
 * Siembra al primer administrador de plataforma, con la cadena DIRECTA del dueño. Lo corre el dueño en su
 * terminal: `npm run plataforma:primer-admin -- <email>`. Es el arranque de la puerta de plataforma: sin un
 * administrador sembrado nadie puede actuar como plataforma. El detalle está en `ejecutar-crear-primer-admin.ts`.
 */

// Una falla que se escape no puede volcar la pila (ni el texto crudo de la red) a la terminal.
function fallaInesperada(falla: unknown): void {
  const cadena = process.env[VARIABLE_DE_LA_CADENA];
  const descripcion = ocultarSecretos(describirFallaDeBase(falla, cadena), process.argv[2]?.trim());
  console.error(`ERROR inesperado: ${descripcion}`);
  process.exit(1);
}
process.on("uncaughtException", fallaInesperada);
process.on("unhandledRejection", fallaInesperada);

process.exitCode = await ejecutarCreacionDelPrimerAdmin({
  argumentos: process.argv.slice(2),
  entorno: process.env,
  info: (linea) => console.log(linea),
  error: (linea) => console.error(linea),
});

// Red de seguridad: si algún socket quedara abierto, el proceso termina igual.
setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
