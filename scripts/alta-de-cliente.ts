import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base";
import { armarPlataforma } from "../src/composicion/plataforma";
import { PEDERNAL_DB_PLATAFORMA } from "../src/composicion/entorno-de-plataforma";
import { altaDeCliente } from "./ejecutar-alta-de-cliente";
import { armarCasosDeLaLista } from "./ejecutar-caso-desde-archivo";
import { ejecutarCreacionDelPrimerAdmin } from "./ejecutar-crear-primer-admin";
import { ejecutorDeCasos } from "./ejecutar-preparar-empresa-de-pruebas";

/**
 * El alta de un cliente con base propia: `npm run plataforma:alta-de-cliente -- <ambiente> [--validar]`. Lo corre `.github/workflows/alta-de-cliente.yml`;
 * el detalle está en `ejecutar-alta-de-cliente.ts`.
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

const soloValidar = process.argv[3] === "--validar";
// En la revisión previa no hay conexión de plataforma: no se arma nada que la necesite.
const plataforma = soloValidar
  ? null
  : armarPlataforma({ registrar: (detalle) => console.error(`Entorno: ${detalle}`) });
try {
  process.exitCode = await altaDeCliente({
    ambiente: process.argv[2],
    entorno: process.env,
    soloValidar,
    sembrarAdmin: (email, salida) =>
      ejecutarCreacionDelPrimerAdmin({
        argumentos: [email],
        entorno: process.env,
        info: salida.info,
        error: salida.error,
      }),
    ejecutarCaso: async (caso, json, email, salida) => {
      if (plataforma === null) return { codigo: 2, datos: new Map() };
      return ejecutorDeCasos({
        entorno: process.env,
        ahora: () => new Date(),
        buscarAdmin: plataforma.buscarAdmin,
        casos: armarCasosDeLaLista(plataforma),
      })(caso, json, email, salida);
    },
    info: (linea) => console.log(linea),
    error: (linea) => console.error(linea),
    comando: (linea) => console.log(linea),
  });
} finally {
  await plataforma?.cerrar();
}

// Red de seguridad: si algún socket quedara abierto, el proceso termina igual.
setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
