import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  listarLosProductos,
  type DependenciasDeProductosWeb,
  type ProductosParaLaPantalla,
} from "../../../src/composicion/productos-web";
import type { EntradaDeLaLista } from "../../../src/composicion/entradas-de-productos";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { dependenciasDeSesion } from "./sesion";

/**
 * La lista de productos (A1, T1): la lectura, fina a propósito (ADR-015, punto 2). El contexto (sesión, origen propio y empresa elegida, nunca los que diga el navegador) lo
 * resolvió la página; esto llama a `src/composicion/productos-web.ts`, donde se prueba el resto. El permiso (`productos.ver`) y la validez de los filtros los decide el servidor.
 */
const dependencias: DependenciasDeProductosWeb = {
  consultas: web.consultasDeCatalogo,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Una página de los productos de la empresa, con lo que dice la dirección (texto, clase, estado y página). */
export function cargarLosProductos(
  contexto: ContextoOperativo,
  entrada: EntradaDeLaLista,
): Promise<Respuesta<ProductosParaLaPantalla>> {
  return listarLosProductos(dependencias, contexto, entrada);
}
