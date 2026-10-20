import { readFile } from "node:fs/promises";
import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base";
import { armarPlataforma } from "../src/composicion/plataforma";
import { PEDERNAL_DB_PLATAFORMA } from "../src/composicion/entorno-de-plataforma";
import { armarCasosDeLaLista, ejecutarCasoDePlataforma } from "./ejecutar-caso-desde-archivo";

/**
 * Ejecuta UN caso de plataforma de la lista cerrada, con los datos de un archivo .json, como el administrador
 * que se indica: `npm run plataforma:caso -- <caso> <archivo.json> --admin-email <email>`. Lo corre el dueño en
 * su terminal, con las variables PEDERNAL_DB_PLATAFORMA, PEDERNAL_CLAVE_CONTEXTO y PEDERNAL_SECRETO_INVITACIONES
 * cargadas ahí (nunca en un archivo del repositorio). El detalle está en `ejecutar-caso-desde-archivo.ts`.
 */

// Una falla que se escape no puede volcar la pila (ni el texto crudo de la red) a la terminal.
function fallaInesperada(falla: unknown): void {
  console.error(
    `ERROR inesperado: ${ocultarSecretos(describirFallaDeBase(falla, process.env[PEDERNAL_DB_PLATAFORMA]), process.env["PEDERNAL_CLAVE_CONTEXTO"]?.split(":")[1])}`,
  );
  process.exit(1);
}
process.on("uncaughtException", fallaInesperada);
process.on("unhandledRejection", fallaInesperada);

// Si falta o no sirve una variable, el detalle (solo NOMBRES de variables, nunca valores) va a la terminal.
const plataforma = armarPlataforma({
  registrar: (detalle) => console.error(`Entorno: ${detalle}`),
});
try {
  process.exitCode = await ejecutarCasoDePlataforma({
    argumentos: process.argv.slice(2),
    entorno: process.env,
    leerArchivo: (ruta) => readFile(ruta, "utf8"),
    ahora: () => new Date(),
    buscarAdmin: plataforma.buscarAdmin,
    casos: armarCasosDeLaLista(plataforma),
    info: (linea) => console.log(linea),
    error: (linea) => console.error(linea),
  });
} finally {
  await plataforma.cerrar();
}

// Red de seguridad: si algún socket quedara abierto, el proceso termina igual.
setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
