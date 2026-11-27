import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base";
import { leerEstadoDelAlta } from "../src/adaptadores/postgres/estado-del-alta";
import { armarPlataforma } from "../src/composicion/plataforma";
import { PEDERNAL_DB_PLATAFORMA } from "../src/composicion/entorno-de-plataforma";
import { armarCasosDeLaLista } from "./ejecutar-caso-desde-archivo";
import { ejecutorDeCasos } from "./ejecutar-preparar-empresa-de-pruebas";
import { reemitirInvitacionDeCliente } from "./ejecutar-reemitir-invitacion-de-cliente";

/**
 * Reemite la invitación del gerente de un cliente: `npm run plataforma:reemitir-invitacion -- <ambiente> [--validar]`. Lo corre `.github/workflows/reemitir-invitacion-de-cliente.yml`; el detalle está en
 * `ejecutar-reemitir-invitacion-de-cliente.ts`.
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
  process.exitCode = await reemitirInvitacionDeCliente({
    ambiente: process.argv[2],
    entorno: process.env,
    soloValidar,
    leerEstado: leerEstadoDelAlta,
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
