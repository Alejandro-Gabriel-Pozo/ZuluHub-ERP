import "server-only";

import { armarConexiones } from "../../../src/composicion/conexiones";
import { armarWeb } from "../../../src/composicion/web";

/**
 * Acceso de la aplicación a la composición (web-armazon §3.1). Es el único punto de `apps/web` que
 * importa `src/composicion` (regla R-W2) y solo se carga en el servidor (`server-only`): si un
 * componente de cliente lo importa, la compilación falla. No tiene lógica de negocio.
 *
 * Armar esto no lee ninguna variable: cada pieza valida las suyas la primera vez que se usa, así que
 * `next build` corre sin secretos (P-12). Si una variable falta, el pedido falla cerrado con un
 * error genérico y el NOMBRE de la variable queda solo en el registro del servidor (acá, la salida de
 * errores de la función); la pantalla muestra la referencia, nunca el nombre.
 */
const conexiones = armarConexiones({
  registrar: (detalle) => {
    console.error(`[entorno] ${detalle}`);
  },
  // Lo que cuenta la librería de ingreso de un fallo (ya viene con su prefijo): solo al registro, nunca a una respuesta.
  registrarDeIngreso: (detalle) => {
    console.error(detalle);
  },
});

/** Casos de uso y consultas de la web. Cada grupo se arma al pedirlo: `web.consultasDeEmpresas()`. */
export const web = armarWeb(conexiones);
