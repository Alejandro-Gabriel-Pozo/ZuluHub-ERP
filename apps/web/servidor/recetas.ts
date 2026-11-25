import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import type { EntradaDeLaListaDeRecetas } from "../../../src/composicion/entradas-de-recetas";
import {
  listarLasRecetas,
  verLaFichaDeCocina,
  verLaReceta,
  type DependenciasDeRecetasWeb,
  type PaginaDeRecetasParaLaPantalla,
} from "../../../src/composicion/recetas-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import type { FichaDeCocina, RecetaDeProducto } from "../../../src/modulos/stock/publico";
import { web } from "./composicion";
import { dependenciasDeSesion } from "./sesion";

/**
 * Las lecturas de «Recetas» (maqueta `receta.html`): la lista, la ficha de una receta y su ficha de cocina. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa (el contexto lo
 * armó el servidor para este pedido) y llaman a `src/composicion/recetas-web.ts`, donde se prueba el resto. Una receta es de la EMPRESA, no de una sucursal: no hace falta sucursal elegida.
 * El permiso (`stock.ver`), los costos (`costos.ver`) y el módulo apagado los decide la consulta dentro de la transacción: la pantalla no replica ninguna regla. Solo lectura: no escribe ni audita.
 */

const dependencias: DependenciasDeRecetasWeb = {
  consultas: web.consultasDeStock,
  personas: web.consultasDeIdentidad,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Las recetas de la empresa con el filtro de la dirección. */
export function cargarLasRecetas(
  contexto: ContextoOperativo,
  entrada: EntradaDeLaListaDeRecetas,
): Promise<Respuesta<PaginaDeRecetasParaLaPantalla>> {
  return listarLasRecetas(dependencias, contexto, entrada);
}

/** La receta vigente de un producto de la empresa (`null` si no existe, es de otra empresa o el id está mal formado: indistinguibles). */
export function cargarLaReceta(
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<RecetaDeProducto | null>> {
  return verLaReceta(dependencias, contexto, { productoId });
}

/** La ficha de cocina de la versión vigente (`null` si no hay receta). */
export function cargarLaFichaDeCocina(
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<FichaDeCocina | null>> {
  return verLaFichaDeCocina(dependencias, contexto, productoId);
}
