import { join } from "node:path";
import { describirFallaDeBase } from "../src/adaptadores/postgres/describir-falla-de-base.ts";
import { VARIABLE_DE_LA_CADENA, ejecutarMigracion } from "./ejecutar-migracion.ts";

/**
 * Migra la base de datos real. Lo corre el workflow `.github/workflows/migrar-base.yml` con
 * `npm run migrar -- --ver` o `-- --aplicar`, y el dueño en su terminal con `-- --preparar-roles`. La
 * cadena de conexión viene de la variable de entorno ZULUHUB_DB_MIGRACIONES (en GitHub, el secreto de
 * un Environment), nunca de un archivo del repositorio.
 *
 * Se ejecuta directo con Node (borra los tipos al cargar), sin dependencias nuevas. El detalle de lo
 * que hace cada modo está en `ejecutar-migracion.ts`.
 */

// Una falla que se escape no puede volcar la pila (ni el texto crudo de la red) al registro.
function fallaInesperada(falla: unknown): void {
  console.error(
    `ERROR inesperado: ${describirFallaDeBase(falla, process.env[VARIABLE_DE_LA_CADENA])}`,
  );
  process.exit(1);
}
process.on("uncaughtException", fallaInesperada);
process.on("unhandledRejection", fallaInesperada);

process.exitCode = await ejecutarMigracion({
  argumentos: process.argv.slice(2),
  entorno: process.env,
  carpeta: join(import.meta.dirname, "..", "migraciones"),
  info: (linea) => console.log(linea),
  error: (linea) => console.error(linea),
  secreto: (linea) => console.log(linea),
});

// Red de seguridad: si algún socket quedara abierto, el proceso termina igual (no cuelga el workflow).
setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
