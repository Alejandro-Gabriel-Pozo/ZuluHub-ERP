import { PEDERNAL_CLAVE_CONTEXTO } from "../src/adaptadores/postgres/contexto-firmado.ts";
import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base.ts";
import { VARIABLE_DE_LA_CADENA, ejecutarInstalacionDeClave } from "./ejecutar-instalar-clave.ts";

/**
 * Instala la clave de firma del contexto (`PEDERNAL_CLAVE_CONTEXTO`) en la base real, con la cadena DIRECTA del
 * dueño (`PEDERNAL_DB_MIGRACIONES`). Lo corre el workflow `.github/workflows/migrar.yml` con
 * `npm run instalar-clave`, y el dueño en su terminal. Se ejecuta directo con Node (borra los tipos al cargar),
 * sin dependencias nuevas; el detalle de lo que hace está en `ejecutar-instalar-clave.ts`.
 */

// Una falla que se escape no puede volcar la pila (ni el texto crudo de la red) al registro.
function fallaInesperada(falla: unknown): void {
  const descripcion = describirFallaDeBase(falla, process.env[VARIABLE_DE_LA_CADENA]);
  console.error(
    `ERROR inesperado: ${ocultarSecretos(descripcion, process.env[PEDERNAL_CLAVE_CONTEXTO])}`,
  );
  process.exit(1);
}
process.on("uncaughtException", fallaInesperada);
process.on("unhandledRejection", fallaInesperada);

process.exitCode = await ejecutarInstalacionDeClave({
  entorno: process.env,
  info: (linea) => console.log(linea),
  error: (linea) => console.error(linea),
});

// Red de seguridad: si algún socket quedara abierto, el proceso termina igual (no cuelga el workflow).
setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
