import { CATALOGO_DE_TEXTOS } from "../../../../../src/capacidades/vocabulario/catalogo";
import { claveDelNombreDeLaAccion } from "../../../../../src/capacidades/vocabulario/nombre-de-la-accion";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * El modelo de «Roles»: de lo que entrega el servidor a lo que dibuja la pantalla, con el texto ya resuelto. Puro: sin React ni servidor.
 */

/**
 * El nombre que ve el gerente para una acción del catálogo (clave `roles.accion.<id>`). Una acción sin nombre es un error de programación y no se disfraza con el id: falla (la prueba
 * `catalogo-de-acciones.test.ts` lo atrapa antes, para las 188 del catálogo).
 */
export function textoDeLaAccion(diccionario: DiccionarioResuelto, accion: string): string {
  const clave = claveDelNombreDeLaAccion(accion);
  if (!Object.hasOwn(CATALOGO_DE_TEXTOS, clave)) {
    throw new RangeError(`La acción «${accion}» no tiene nombre en el catálogo de textos.`);
  }
  return texto(diccionario, clave as keyof typeof CATALOGO_DE_TEXTOS);
}
