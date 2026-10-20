import { instalarRedDeSeguridad } from "./entrada-del-dueno";
import { ejecutarReseteoDelSegundoFactor } from "./ejecutar-resetear-segundo-factor";

/**
 * Resetea el segundo factor de un administrador de plataforma que perdió su dispositivo y cierra todas sus sesiones, con
 * la cadena DIRECTA del dueño. Lo corre el dueño en su terminal: `npm run plataforma:resetear-segundo-factor -- <email>`.
 * El detalle está en `ejecutar-resetear-segundo-factor.ts`.
 */
instalarRedDeSeguridad();

process.exitCode = await ejecutarReseteoDelSegundoFactor({
  argumentos: process.argv.slice(2),
  entorno: process.env,
  info: (linea) => console.log(linea),
  error: (linea) => console.error(linea),
});

// Red de seguridad: si algún socket quedara abierto, el proceso termina igual.
setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
