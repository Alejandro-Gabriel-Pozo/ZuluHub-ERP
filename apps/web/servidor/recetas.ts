import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ErrorPublico, Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  leerElFormularioDeReceta,
  type EntradaDeLaListaDeRecetas,
} from "../../../src/composicion/entradas-de-recetas";
import {
  guardarLaReceta,
  listarLasRecetas,
  ofrecerTodosLosIngredientes,
  ofrecerTodosLosProductosSinReceta,
  verLaConfirmacionDeLaReceta,
  verLaFichaDeCocina,
  verLaReceta,
  type ConfirmacionDeLaReceta,
  type DependenciasDeRecetasWeb,
  type PaginaDeRecetasParaLaPantalla,
} from "../../../src/composicion/recetas-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import type { FichaDeCocina, RecetaDeProducto } from "../../../src/modulos/stock/publico";
import { rutaDeLaReceta, RUTA_DE_RECETAS } from "../ui/plantillas/recetas/filtros-de-recetas";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";

/**
 * Las lecturas de «Recetas» (maqueta `receta.html`): la lista, la ficha de una receta y su ficha de cocina. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa (el contexto lo
 * armó el servidor para este pedido) y llaman a `src/composicion/recetas-web.ts`, donde se prueba el resto. Una receta es de la EMPRESA, no de una sucursal: no hace falta sucursal elegida.
 * El permiso (`stock.ver`), los costos (`costos.ver`) y el módulo apagado los decide la consulta dentro de la transacción: la pantalla no replica ninguna regla.
 *
 * Guardar (REC-B): del formulario solo se toman el producto (al crear), el rinde, los pasos y las líneas (`receta_<línea>_ingrediente|bruto|merma`); la versión que la persona vio y la unidad de cada
 * ingrediente las liga la página (`bind`, cifradas por Next): el navegador no puede cambiar una unidad ni pisar una versión que no vio. Qué es una receta válida, quién puede guardar (`composiciones.editar`,
 * con alcance de todas las sucursales) y el módulo apagado los decide `guardarComposicion` dentro de su transacción: la pantalla no replica ninguna regla. Repetir no duplica: el mismo contenido es
 * `yaExistia` y no crea otra versión; dos guardados a la vez con la misma versión vista dejan una sola.
 */

const dependencias: DependenciasDeRecetasWeb = {
  casosDeUso: web.casosDeUsoDeStock,
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

/** Los productos que se pueden elaborar y todavía no tienen receta (el selector de «Nueva receta»), todos. */
export function cargarLosProductosSinReceta(
  contexto: ContextoOperativo,
): Promise<Respuesta<PaginaDeRecetasParaLaPantalla["recetas"]>> {
  return ofrecerTodosLosProductosSinReceta(dependencias, contexto);
}

/** Los ingredientes que se ofrecen para la receta de un producto (sin el propio producto), todos. */
export function cargarLosIngredientes(
  contexto: ContextoOperativo,
  productoId: string,
): ReturnType<typeof ofrecerTodosLosIngredientes> {
  return ofrecerTodosLosIngredientes(dependencias, contexto, productoId);
}

/** Lo que la página liga a las acciones de guardar y de confirmar. `productoId` es `null` al crear: entonces el producto viene del formulario. */
export type LigadoDeLaReceta = Readonly<{
  productoId: string | null;
  versionEsperada: number;
  unidades: Readonly<Record<string, string>>;
}>;

/** El pedido que entiende la composición: lo del formulario más lo que ligó la página. */
function pedidoDe(ligado: LigadoDeLaReceta, datos: FormData): unknown {
  const formulario = leerElFormularioDeReceta(datos.entries());
  return {
    productoId: ligado.productoId ?? formulario.producto,
    versionEsperada: ligado.versionEsperada,
    rinde: formulario.rinde,
    pasos: formulario.pasos,
    lineas: formulario.lineas,
    unidades: ligado.unidades,
  };
}

/** Guarda la receta; si sale bien, vuelve a su ficha (con la versión nueva); si no, devuelve el error ya traducido y pide la pantalla de nuevo. */
export async function guardarLaRecetaDelFormulario(
  ligado: LigadoDeLaReceta,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    guardarLaReceta(dependencias, contexto, pedidoDe(ligado, datos)),
  );
  revalidatePath(RUTA_DE_RECETAS);
  if (!respuesta.ok) return { error: respuesta.error };
  revalidatePath(rutaDeLaReceta(respuesta.dato.productoId));
  redirect(rutaDeLaReceta(respuesta.dato.productoId));
}

/** Lo que devuelve la acción de confirmar: el error ya traducido, o lo que calculó el servidor (`null` si lo pedido no se puede calcular). */
export type ResultadoDeLaConfirmacion = Readonly<
  { error: ErrorPublico } | { error: null; vista: ConfirmacionDeLaReceta | null }
>;

/** Calcula, sin guardar, lo que se muestra antes de guardar: el neto de cada ingrediente y el costo antes, ahora y la diferencia. */
export async function confirmarLaReceta(
  ligado: LigadoDeLaReceta,
  datos: FormData,
): Promise<ResultadoDeLaConfirmacion> {
  const respuesta = await conLaEmpresa((contexto) =>
    verLaConfirmacionDeLaReceta(dependencias, contexto, pedidoDe(ligado, datos)),
  );
  return respuesta.ok ? { error: null, vista: respuesta.dato } : { error: respuesta.error };
}
