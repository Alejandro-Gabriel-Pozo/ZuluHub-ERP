import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base";
import { armarPlataforma } from "../src/composicion/plataforma";
import { PEDERNAL_DB_PLATAFORMA } from "../src/composicion/entorno-de-plataforma";
import { armarCasosDeLaLista } from "./ejecutar-caso-desde-archivo";
import { ejecutarCreacionDelPrimerAdmin } from "./ejecutar-crear-primer-admin";
import { ejecutorDeCasos, prepararEmpresaDePruebas } from "./ejecutar-preparar-empresa-de-pruebas";

/**
 * Prepara la empresa de pruebas en Preview: `npm run plataforma:preparar-prueba`. Lo corre el workflow
 * `.github/workflows/preparar-empresa-de-pruebas.yml`; el detalle está en `ejecutar-preparar-empresa-de-pruebas.ts`.
 */

// Una falla que se escape no puede volcar la pila (ni el texto crudo de la red) al registro de la corrida.
function fallaInesperada(falla: unknown): void {
  console.error(
    `ERROR inesperado: ${ocultarSecretos(describirFallaDeBase(falla, process.env[PEDERNAL_DB_PLATAFORMA]), process.env["PEDERNAL_CLAVE_CONTEXTO"]?.split(":")[1])}. ` +
      "Repetir el flujo es seguro.",
  );
  process.exit(1);
}
process.on("uncaughtException", fallaInesperada);
process.on("unhandledRejection", fallaInesperada);

const plataforma = armarPlataforma({
  registrar: (detalle) => console.error(`Entorno: ${detalle}`),
});
try {
  process.exitCode = await prepararEmpresaDePruebas({
    entorno: process.env,
    sembrarAdmin: (email, salida) =>
      ejecutarCreacionDelPrimerAdmin({
        argumentos: [email],
        entorno: process.env,
        info: salida.info,
        error: salida.error,
      }),
    ejecutarCaso: ejecutorDeCasos({
      entorno: process.env,
      ahora: () => new Date(),
      buscarAdmin: plataforma.buscarAdmin,
      casos: armarCasosDeLaLista(plataforma),
    }),
    info: (linea) => console.log(linea),
    error: (linea) => console.error(linea),
    comando: (linea) => console.log(linea),
  });
} finally {
  await plataforma.cerrar();
}

// Red de seguridad: si algún socket quedara abierto, el proceso termina igual.
setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
