import "server-only";

import { armarIngresoDeConsola } from "../../../src/composicion/ingreso-de-consola";

/**
 * Acceso de la consola a la composición (h5-p8 §7 y PR #71). Es el único punto de `apps/plataforma` que importa
 * `src/composicion` (regla R-W2) y solo se carga en el servidor (`server-only`). No tiene lógica de negocio.
 *
 * Armar esto no lee ninguna variable: cada pieza valida las suyas la primera vez que se usa, así que `next build`
 * corre sin secretos. Si una falta, el pedido falla cerrado con un error genérico y el NOMBRE de la variable queda
 * solo en el registro del servidor; la pantalla muestra la referencia, nunca el nombre.
 */
export const consola = armarIngresoDeConsola({
  registrar: (detalle) => {
    console.error(`[consola] ${detalle}`);
  },
  // Lo que cuenta la librería de ingreso (ya viene con su prefijo): solo al registro, nunca a una respuesta.
  registrarDeIngreso: (detalle) => {
    console.error(detalle);
  },
});
