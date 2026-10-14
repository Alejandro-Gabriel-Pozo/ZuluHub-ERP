import "server-only";

import type {
  ConsultaDeHost,
  LecturaDeMarca,
} from "../../../src/capacidades/experiencia/resolutor";
import { ok } from "../../../src/primitivas/resultado/resultado";

/**
 * De dónde sale la resolución de un host y la marca que lo atiende. ES EL ÚNICO LUGAR QUE HAY QUE
 * CAMBIAR PARA ENCHUFAR EL PUERTO REAL, y hoy NO está enchufado: todo host es desconocido, así que la
 * producción responde la página neutra en cada host (falla cerrado) hasta que se cumplan las dos cosas
 * que faltan:
 *  1. el rol `zuluhub_publico` con LOGIN y su cadena (`ZULUHUB_DB_PUBLICO`, ya declarada en
 *     `src/composicion/entorno.ts`) cargada por el dueño en Vercel;
 *  2. una lectura pública de la marca (`nombre`, tema resuelto con herencia y host canónico de la app
 *     de la versión vigente) que `modulos/marcas` todavía no ofrece: M4 resuelve el host y la marca, no
 *     su configuración.
 * Entonces: `consultarHost = (h, s) => web.resolucionDeHost().porHost(h, s)` (con `web` de
 * `./composicion`) y `leerMarca = (id) => <esa lectura>`. Las pruebas reemplazan este módulo por un falso
 * con dos marcas sembradas (`test/utilidades/puertas-falsas.ts`).
 */
export type FuenteDePuertas = Readonly<{
  consultarHost: ConsultaDeHost;
  leerMarca: LecturaDeMarca;
}>;

export const fuenteDePuertas: FuenteDePuertas = {
  consultarHost: () => Promise.resolve(ok(null)),
  leerMarca: () => Promise.resolve(null),
};
