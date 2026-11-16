import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { MAXIMO_DE_PERSONAS_POR_CONSULTA } from "../modulos/identidad/publico";
import type {
  PaginaDeIngredientes,
  PaginaDeRecetas,
  RecetaDeProducto,
  VistaPreviaDeReceta,
} from "../modulos/stock/publico";
import { aRespuestaDeExcepcion, errorAPublico, type DependenciasDeRespuesta } from "./a-respuesta";
import { identificador } from "./entradas-de-facturacion";
import { codificarLaPagina } from "./entradas-de-productos";
import {
  leerLaEntradaDeLaListaDeRecetas,
  leerLaEntradaDeLosIngredientes,
  type EntradaDeLaListaDeRecetas,
  type EntradaDeLosIngredientes,
} from "./entradas-de-recetas";
import { traducirErrorDeReceta } from "./errores-de-recetas";
import type { Web } from "./web";

/**
 * Las LECTURAS de la pantalla de Recetas (B1 a B5 de `recetas-pantalla.md` §8): la lista, una receta con su última versión, los ingredientes que se ofrecen, la vista previa de lo que se
 * arma y las versiones con el nombre de quien las guardó. Viven acá, y no en `apps/web`, para probarse con la base real sin levantar Next (igual que `ficha-de-producto-web.ts`). La pantalla
 * (otra tarea) las llama desde el servidor; guardar es `guardarComposicion` con `traducirErrorDeReceta`.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/recetas-web.test.ts`):
 *  - **Leer no escribe.** Son consultas de solo lectura: no hay escritura ni auditoría.
 *  - **El permiso es de la consulta.** Ver exige `stock.ver` y los costos `costos.ver`, con el rol de la misma transacción: acá no se decide ningún permiso. Con el módulo apagado o sin el
 *    permiso sale el motivo del guard, sin dato alguno.
 *  - **La empresa y la persona las pone el servidor**: el pedido no las trae. Un producto de otra empresa, un id mal formado y un producto que no lleva receta son indistinguibles de uno que
 *    no existe (`null`); una entrada fuera de la lista de permitidos es una lista vacía, no un error que distinga.
 *  - **El dinero sale como texto decimal con su moneda** (`costoPorUnidad` con `moneda`), y «sin costo» es `null`, nunca cero (D125).
 *  - **Nada de más sale.** Las versiones no llevan el id de la persona sino su nombre (el correo, decisión 26A del 15/11/2026); una persona que ya no figura queda sin nombre.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016): un fallo inesperado sale sin detalle y con referencia.
 */

export type DependenciasDeRecetasWeb = Readonly<{
  consultas: () => Pick<
    ReturnType<Web["consultasDeStock"]>,
    | "listarRecetas"
    | "recetaDeProducto"
    | "ingredientesParaReceta"
    | "vistaPreviaDeReceta"
    | "versionesDeReceta"
  >;
  personas: () => Pick<ReturnType<Web["consultasDeIdentidad"]>, "personasParaMostrar">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Una página de la lista de recetas con la clave de la que sigue tal como va en la dirección (`null` si no hay más). */
export type PaginaDeRecetasParaLaPantalla = Readonly<{
  recetas: PaginaDeRecetas["recetas"];
  siguiente: string | null;
}>;

export type PaginaDeIngredientesParaLaPantalla = Readonly<{
  ingredientes: PaginaDeIngredientes["ingredientes"];
  siguiente: string | null;
}>;

/** Una versión de la receta para la lista de versiones: quién la guardó sale con su nombre, no con su id. */
export type VersionParaLaPantalla = Readonly<{
  version: number;
  rinde: string;
  pasos: string | null;
  creadaPorNombre: string | null;
  creadaEn: Date;
  /** SOLO con `costos.ver`: costo de una unidad con los precios de hoy (texto decimal) o `null` si no se sabe. */
  costoPorUnidad?: string | null | undefined;
  /** SOLO con `costos.ver`. */
  moneda?: "ARS" | undefined;
}>;

const conError = (error: unknown, d: DependenciasDeRecetasWeb): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeReceta(error), d.respuesta),
});

const siguienteDe = (pagina: Readonly<{ nombreClave: string; id: string }> | null) =>
  pagina === null ? null : codificarLaPagina(pagina);

/** La lista de recetas (con o sin receta). Una entrada que ningún producto puede cumplir es una página vacía. */
export async function listarLasRecetas(
  d: DependenciasDeRecetasWeb,
  contexto: ContextoOperativo,
  entrada: EntradaDeLaListaDeRecetas,
): Promise<Respuesta<PaginaDeRecetasParaLaPantalla>> {
  const consulta = leerLaEntradaDeLaListaDeRecetas(entrada);
  if (consulta === null) return { ok: true, dato: { recetas: [], siguiente: null } };
  try {
    const pagina = await d.consultas().listarRecetas(contexto, consulta);
    if (!pagina.ok) return conError(pagina.error, d);
    return {
      ok: true,
      dato: { recetas: pagina.valor.recetas, siguiente: siguienteDe(pagina.valor.siguiente) },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Una receta con su última versión (H6) y la ficha de la versión pedida; `null` si no existe (también un id mal formado). */
export async function verLaReceta(
  d: DependenciasDeRecetasWeb,
  contexto: ContextoOperativo,
  entrada: Readonly<{ productoId: string; version?: number | undefined }>,
): Promise<Respuesta<RecetaDeProducto | null>> {
  if (!identificador.safeParse(entrada.productoId).success) return { ok: true, dato: null };
  try {
    const receta = await d.consultas().recetaDeProducto(contexto, entrada);
    return receta.ok ? { ok: true, dato: receta.valor } : conError(receta.error, d);
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Los ingredientes que se ofrecen (sin insumos). Una entrada que ningún producto puede cumplir es una página vacía. */
export async function ofrecerLosIngredientes(
  d: DependenciasDeRecetasWeb,
  contexto: ContextoOperativo,
  entrada: EntradaDeLosIngredientes,
): Promise<Respuesta<PaginaDeIngredientesParaLaPantalla>> {
  const consulta = leerLaEntradaDeLosIngredientes(entrada);
  if (consulta === null) return { ok: true, dato: { ingredientes: [], siguiente: null } };
  try {
    const pagina = await d.consultas().ingredientesParaReceta(contexto, consulta);
    if (!pagina.ok) return conError(pagina.error, d);
    return {
      ok: true,
      dato: {
        ingredientes: pagina.valor.ingredientes,
        siguiente: siguienteDe(pagina.valor.siguiente),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** El neto de cada línea y, con `costos.ver`, el costo de lo que se está armando, sin guardar nada. `null` si lo pedido no se puede calcular. */
export async function verLaVistaPreviaDeLaReceta(
  d: DependenciasDeRecetasWeb,
  contexto: ContextoOperativo,
  entrada: Readonly<{ productoId: string; rinde: string; componentes: readonly unknown[] }>,
): Promise<Respuesta<VistaPreviaDeReceta | null>> {
  if (!identificador.safeParse(entrada.productoId).success) return { ok: true, dato: null };
  try {
    const vista = await d.consultas().vistaPreviaDeReceta(contexto, entrada);
    return vista.ok ? { ok: true, dato: vista.valor } : conError(vista.error, d);
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Las versiones de la receta, de la más nueva a la más vieja, con el nombre de quien guardó cada una y, con `costos.ver`, su costo por unidad. */
export async function listarLasVersionesDeLaReceta(
  d: DependenciasDeRecetasWeb,
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<readonly VersionParaLaPantalla[]>> {
  if (!identificador.safeParse(productoId).success) return { ok: true, dato: [] };
  try {
    const versiones = await d.consultas().versionesDeReceta(contexto, { productoId });
    if (!versiones.ok) return conError(versiones.error, d);
    // Los nombres de todas las personas, de a `MAXIMO_DE_PERSONAS_POR_CONSULTA` (una receta tiene pocos autores; el tope no recorta en silencio).
    const ids = [...new Set(versiones.valor.map((v) => v.creadaPor))];
    const nombres = new Map<string, string>();
    for (let i = 0; i < ids.length; i += MAXIMO_DE_PERSONAS_POR_CONSULTA) {
      const personas = await d
        .personas()
        .personasParaMostrar(contexto, { ids: ids.slice(i, i + MAXIMO_DE_PERSONAS_POR_CONSULTA) });
      if (!personas.ok) return conError(personas.error, d);
      for (const [id, nombre] of personas.valor) nombres.set(id, nombre);
    }
    return {
      ok: true,
      dato: versiones.valor.map((v) => ({
        version: v.version,
        rinde: v.rinde,
        pasos: v.pasos,
        creadaPorNombre: nombres.get(v.creadaPor) ?? null,
        creadaEn: v.creadaEn,
        ...(v.moneda === undefined
          ? {}
          : { costoPorUnidad: v.costoPorUnidad ?? null, moneda: v.moneda }),
      })),
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
