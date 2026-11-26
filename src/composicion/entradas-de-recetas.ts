import { z } from "zod";
import type {
  EntradaDeGuardarComposicion,
  EntradaDeIngredientes,
  EntradaDeListarRecetas,
} from "../modulos/stock/publico";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { textoDeBusquedaDeProductoDesdeTexto } from "../primitivas/texto/termino-de-busqueda-de-producto";
import { leerLaPagina } from "./entradas-de-productos";
import { decimal, entero, identificador, leer, texto } from "./entradas-de-facturacion";

/**
 * Las entradas de la lista de recetas y de los ingredientes (B1 y B3 de `recetas-pantalla.md` §8): de lo que pide la dirección de la pantalla (todo texto) a lo que aceptan
 * `listarRecetas` y `ingredientesParaReceta`. Pura: sin base ni servidor. Lista de permitidos, como la de productos (misma búsqueda y misma clave de página, una regla un lugar): pasa
 * solo lo que cada filtro declara; lo que no pasa devuelve `null` («nada puede coincidir») y nunca se ensancha el filtro. Vacío es «sin filtrar» (y «primera página»).
 * Previene: un id con forma inválida que llega al `::uuid` de la consulta y un filtro libre que llega sin validar. Chequeo: `entradas-de-recetas.test.ts`.
 */

/** Lo que la dirección pide para la lista de recetas, sin validar. `conReceta`: `""`, `"con"` o `"sin"`; `activo`: `""`, `"si"` o `"no"`. */
export type EntradaDeLaListaDeRecetas = Readonly<{
  texto: string;
  conReceta: string;
  activo: string;
  despues: string;
}>;

/** Lo que la dirección pide para los ingredientes que se ofrecen, sin validar. */
export type EntradaDeLosIngredientes = Readonly<{
  texto: string;
  despues: string;
  /** El producto de la receta que se arma; vacío o ausente: no se excluye ninguno. */
  excluirProductoId?: string | undefined;
}>;

const CON_RECETA = { con: true, sin: false } as const;
const ACTIVO = { si: true, no: false } as const;

const deLaLista = <T extends Readonly<Record<string, boolean>>>(
  tabla: T,
  valor: string,
): boolean | undefined | null =>
  valor === "" ? undefined : Object.hasOwn(tabla, valor) ? tabla[valor as keyof T] : null;

/** Lo que acepta `listarRecetas`, o `null` si nada puede coincidir con lo pedido. */
export function leerLaEntradaDeLaListaDeRecetas(
  entrada: EntradaDeLaListaDeRecetas,
): EntradaDeListarRecetas | null {
  const texto = textoDeBusquedaDeProductoDesdeTexto(entrada.texto);
  const conReceta = deLaLista(CON_RECETA, entrada.conReceta);
  const activo = deLaLista(ACTIVO, entrada.activo);
  const pagina = entrada.despues === "" ? undefined : leerLaPagina(entrada.despues);
  if (!texto.ok || conReceta === null || activo === null || pagina === null) return null;
  return {
    ...(texto.valor === null ? {} : { texto: texto.valor }),
    ...(conReceta === undefined ? {} : { conReceta }),
    ...(activo === undefined ? {} : { activo }),
    ...(pagina === undefined ? {} : { despuesDe: pagina }),
  };
}

/** Lo que acepta `ingredientesParaReceta`, o `null` si nada puede coincidir con lo pedido. */
export function leerLaEntradaDeLosIngredientes(
  entrada: EntradaDeLosIngredientes,
): EntradaDeIngredientes | null {
  const texto = textoDeBusquedaDeProductoDesdeTexto(entrada.texto);
  const pagina = entrada.despues === "" ? undefined : leerLaPagina(entrada.despues);
  const excluir = entrada.excluirProductoId ?? "";
  if (!texto.ok || pagina === null || (excluir !== "" && !identificador.safeParse(excluir).success))
    return null;
  return {
    ...(texto.valor === null ? {} : { texto: texto.valor }),
    ...(excluir === "" ? {} : { excluirProductoId: excluir }),
    ...(pagina === undefined ? {} : { despuesDe: pagina }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Guardar una receta (REC-B): lo que manda el formulario y lo que la página liga. Lista de permitidos: solo se leen las claves que se declaran acá.

/** Cotas de FORMA para no leer un pedido enorme; las reglas de la receta (cuántos ingredientes, qué cantidades, qué merma) las pone el dominio. */
const MAXIMO_DE_LINEAS_POR_PEDIDO = 200;
/** Un poco más que el tope de los pasos (2000, `pasos-de-receta.ts`): el largo exacto lo rechaza el dominio; acá solo se acota lo que se lee. */
const MAXIMO_DE_FORMA_DE_LOS_PASOS = 2100;

const FORMA_DE_UNA_LINEA_DE_RECETA = z.object({
  ingredienteId: identificador,
  bruto: decimal,
  merma: decimal,
});

const FORMA_DEL_PEDIDO_DE_RECETA = z.object({
  productoId: identificador,
  /** La última versión que vio la persona (0 si el producto nunca tuvo receta). */
  versionEsperada: entero,
  rinde: decimal,
  pasos: z.string().max(MAXIMO_DE_FORMA_DE_LOS_PASOS),
  lineas: z.array(FORMA_DE_UNA_LINEA_DE_RECETA).max(MAXIMO_DE_LINEAS_POR_PEDIDO),
  /** La unidad en que se carga cada ingrediente: la fija el SERVIDOR al armar la página (la persona no la elige), no el navegador. */
  unidades: z.record(identificador, texto),
});

export type PedidoDeReceta = z.output<typeof FORMA_DEL_PEDIDO_DE_RECETA>;
export type LineaDeRecetaPedida = z.output<typeof FORMA_DE_UNA_LINEA_DE_RECETA>;

/** El pedido de guardar o de calcular la confirmación, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export function leerElPedidoDeReceta(crudo: unknown): Resultado<PedidoDeReceta, "PEDIDO_INVALIDO"> {
  const forma = leer(FORMA_DEL_PEDIDO_DE_RECETA, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}

/** Cómo se llama cada campo de una línea de la receta: `receta_<línea>_<campo>`; la línea es `l<n>`. */
export const nombreDeCampoDeReceta = (
  linea: string,
  campo: "ingrediente" | "bruto" | "merma",
): string => `receta_${linea}_${campo}`;

const CAMPO_DE_RECETA = /^receta_(l\d{1,3})_(ingrediente|bruto|merma)$/;

/**
 * Lo que mandó el formulario: el producto (solo al crear), el rinde, los pasos y las líneas, en el orden en que aparecen. Una línea sin ingrediente no existe (el ingrediente es lo que la nombra);
 * sin bruto trae el texto vacío (lo rechaza el dominio); la merma vacía es «sin merma». Lo que no tiene la forma pedida o no es texto no se lee: lo que no se declara no existe. Una línea repetida
 * conserva el primer valor de cada campo.
 */
export function leerElFormularioDeReceta(campos: Iterable<readonly [string, unknown]>): Readonly<{
  producto: string;
  rinde: string;
  pasos: string;
  lineas: readonly LineaDeRecetaPedida[];
}> {
  const unicos: { producto?: string; rinde?: string; pasos?: string } = {};
  const lineas = new Map<string, { ingrediente?: string; bruto?: string; merma?: string }>();
  for (const [nombre, valor] of campos) {
    if (typeof valor !== "string") continue;
    if (nombre === "producto" || nombre === "rinde" || nombre === "pasos") {
      unicos[nombre] ??= valor;
      continue;
    }
    const partes = CAMPO_DE_RECETA.exec(nombre);
    if (partes === null) continue;
    const linea = lineas.get(partes[1] as string) ?? {};
    const campo = partes[2] as "ingrediente" | "bruto" | "merma";
    linea[campo] ??= valor;
    lineas.set(partes[1] as string, linea);
  }
  return {
    producto: unicos.producto ?? "",
    rinde: unicos.rinde ?? "",
    pasos: unicos.pasos ?? "",
    lineas: [...lineas.values()].flatMap((l) =>
      l.ingrediente === undefined || l.ingrediente === ""
        ? []
        : [{ ingredienteId: l.ingrediente, bruto: l.bruto ?? "", merma: l.merma ?? "" }],
    ),
  };
}

/**
 * De un pedido leído a lo que acepta `guardarComposicion` (y la vista previa), o `null` si algún ingrediente no tiene unidad fijada por el servidor (no se adivina una unidad). Los pasos
 * en blanco son «sin pasos» y la merma en blanco es «sin merma»: así el mismo contenido da siempre la misma versión (la idempotencia es por contenido).
 */
export function aEntradaDeGuardarReceta(
  pedido: PedidoDeReceta,
): EntradaDeGuardarComposicion | null {
  const componentes: EntradaDeGuardarComposicion["componentes"][number][] = [];
  for (const l of pedido.lineas) {
    const unidadId = Object.hasOwn(pedido.unidades, l.ingredienteId)
      ? pedido.unidades[l.ingredienteId]
      : undefined;
    if (unidadId === undefined) return null;
    componentes.push({
      productoId: l.ingredienteId,
      cantidad: l.bruto,
      unidadId,
      ...(l.merma.trim() === "" ? {} : { perdida: l.merma }),
    });
  }
  const pasos = pedido.pasos.trim();
  return {
    productoId: pedido.productoId,
    versionEsperada: pedido.versionEsperada,
    rinde: pedido.rinde,
    ...(pasos === "" ? {} : { pasos }),
    componentes,
  };
}
