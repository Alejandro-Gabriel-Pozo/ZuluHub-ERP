import { ejecutarBajaDeAdmin } from "./ejecutar-baja-de-admin";
import { instalarRedDeSeguridad } from "./entrada-del-dueno";

/**
 * Da de baja a un administrador de plataforma y cierra todas sus sesiones, con la cadena DIRECTA del dueño. Lo corre el
 * dueño en su terminal: `npm run plataforma:baja-admin -- <email>`. El detalle está en `ejecutar-baja-de-admin.ts`.
 */
instalarRedDeSeguridad();

process.exitCode = await ejecutarBajaDeAdmin({
  argumentos: process.argv.slice(2),
  entorno: process.env,
  info: (linea) => console.log(linea),
  error: (linea) => console.error(linea),
});

// Red de seguridad: si algún socket quedara abierto, el proceso termina igual.
setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
