import "server-only";

import { armarConexiones } from "../../../src/composicion/conexiones";
import { armarEmisionFiscal } from "../../../src/composicion/emision-fiscal";
import { armarSistema } from "../../../src/composicion/sistema";
import { armarTrabajos } from "../../../src/composicion/trabajos";
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

/**
 * Quién habla con ARCA (H7 facturación): un cliente por (empresa, emisor, ambiente), con las credenciales de ESE
 * emisor. Lo comparten la web (resincronizar una serie) y los trabajos (validar y reconciliar). Armarlo no lee nada:
 * la clave de los certificados se pide recién al hablar con ARCA. Lo que no pudo armarse va al registro del
 * servidor, sin secretos.
 */
const emision = armarEmisionFiscal(conexiones, {
  registrar: (detalle) => {
    console.error(detalle);
  },
});

/** Casos de uso y consultas de la web. Cada grupo se arma al pedirlo: `web.consultasDeEmpresas()`. */
export const web = armarWeb(conexiones, { emision });

/**
 * La cola de trabajos (ADR-007): `trabajos.procesador()` lo usan el cron y el despacho inmediato. Un problema
 * que el procesador no pudo guardar en la cola va al registro del servidor, con el id del trabajo y un texto
 * ya filtrado de secretos (nunca datos del trabajo).
 */
export const trabajos = armarTrabajos(conexiones, {
  emision,
  alRegistrarProblema: (problema) => {
    console.error(
      `[trabajos] fase=${problema.fase} trabajo=${problema.trabajoId ?? "-"} ${problema.mensaje}`,
    );
  },
});

/** La guarda de migración, la salud y el secreto del cron (W6). */
export const sistema = armarSistema(conexiones, {
  registrar: (detalle) => {
    console.error(detalle);
  },
});
