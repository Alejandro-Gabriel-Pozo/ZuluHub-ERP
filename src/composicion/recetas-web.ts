import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import {
  MAXIMO_DE_PERSONAS_POR_CONSULTA,
  type ConsultasDeIdentidad,
} from "../modulos/identidad/publico";
import { formatearDecimalFijo, parsearDecimalFijo } from "../primitivas/cantidad/decimal-fijo";
import { err } from "../primitivas/resultado/resultado";
import type {
  CasosDeUsoDeStock,
  ConsultasDeStock,
  FichaDeCocina,
  PaginaDeIngredientes,
  PaginaDeRecetas,
  RecetaDeProducto,
  VistaPreviaDeReceta,
} from "../modulos/stock/publico";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { identificador } from "./entradas-de-facturacion";
import { codificarLaPagina } from "./entradas-de-productos";
import {
  aEntradaDeGuardarReceta,
  leerLaEntradaDeLaListaDeRecetas,
  leerLaEntradaDeLosIngredientes,
  leerElPedidoDeReceta,
  type EntradaDeLaListaDeRecetas,
  type EntradaDeLosIngredientes,
} from "./entradas-de-recetas";
import { traducirErrorDeReceta } from "./errores-de-recetas";

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
 *  - **Cómo se muestra el costo lo decide la pantalla.** El servidor da 6 decimales en texto; el dueño pidió ver el costo por unidad redondeado a 2 decimales, mitad hacia arriba (como en Producción), y la
 *    pantalla de Recetas sigue lo mismo (decisión del orquestador, 16/11/2026): se redondea con la primitiva de dinero, nunca con `number`.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016): un fallo inesperado sale sin detalle y con referencia.
 */

export type DependenciasDeRecetasWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeStock, "guardarComposicion">;
  consultas: () => Pick<
    ConsultasDeStock,
    | "listarRecetas"
    | "recetaDeProducto"
    | "fichaDeCocina"
    | "ingredientesParaReceta"
    | "vistaPreviaDeReceta"
    | "versionesDeReceta"
  >;
  personas: () => Pick<ConsultasDeIdentidad, "personasParaMostrar">;
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

/** La ficha de cocina de la versión vigente (cantidades brutas y pasos, sin costos ni precios: la consulta no los trae); `null` si no hay receta (también un id mal formado). */
export async function verLaFichaDeCocina(
  d: DependenciasDeRecetasWeb,
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<FichaDeCocina | null>> {
  if (!identificador.safeParse(productoId).success) return { ok: true, dato: null };
  try {
    const ficha = await d.consultas().fichaDeCocina(contexto, { productoId });
    return ficha.ok ? { ok: true, dato: ficha.valor } : conError(ficha.error, d);
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

// ---------------------------------------------------------------------------------------------------------------
// Guardar una receta (REC-B). Reglas que cumple (cada una con su prueba en `recetas-web.test.ts` y `test/integracion/recetas-web.test.ts`):
//  - **La empresa y la persona las pone el servidor**; del navegador solo viene lo que dice el formulario, y el producto, la versión que se vio y la unidad de cada ingrediente las liga la página.
//  - **Todo o nada y una sola vez**: es `guardarComposicion` (una transacción, auditoría adentro); guardar dos veces el MISMO contenido es `yaExistia` (idempotencia por contenido, sin clave), y dos
//    guardados a la vez con la misma versión vista dejan UNA versión nueva y rechazan la otra (`COMPOSICION_DESACTUALIZADA`, que sale como el genérico).
//  - **Todo rechazo de la receta sale como el genérico** (`traducirErrorDeReceta`); un pedido que no tiene la forma pedida, también, sin decir cuál campo.
//  - **La confirmación calcula el servidor**: el neto y el costo «antes / ahora / diferencia» salen de la vista previa y de la receta vigente, con aritmética exacta (texto decimal, nunca `number`).

const GENERICO = errorDeCodigo("RECETA_ACCION_NO_PERMITIDA");

/** Lo que se guardó: el producto, la versión que quedó vigente y si ya estaba (el mismo contenido no crea otra versión). */
export type RecetaGuardada = Readonly<{ productoId: string; version: number; yaExistia: boolean }>;

/** Guarda la receta como versión nueva, o dice que ya estaba. `crudo` es el pedido armado por el servidor fino (`leerElPedidoDeReceta`). */
export async function guardarLaReceta(
  d: DependenciasDeRecetasWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<RecetaGuardada>> {
  const leido = leerElPedidoDeReceta(crudo);
  if (!leido.ok) return { ok: false, error: GENERICO };
  const entrada = aEntradaDeGuardarReceta(leido.valor);
  if (entrada === null) return { ok: false, error: GENERICO };
  try {
    const guardada = await d.casosDeUso().guardarComposicion(contexto, entrada);
    return aRespuesta(
      guardada.ok ? guardada : err(traducirErrorDeReceta(guardada.error)),
      d.respuesta,
      (valor) => ({
        productoId: entrada.productoId,
        version: valor.version,
        yaExistia: valor.yaExistia,
      }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/**
 * Lo que se le muestra a la persona antes de guardar. `netos`: el neto de cada ingrediente por su id. `costos`: SOLO con `costos.ver`; `ahora` es el costo de una unidad con los precios de hoy y
 * `null` si falta algún costo («Sin costo», nunca cero); `antes` y `diferencia` solo si el producto ya tenía receta (`antes` es `null` si ya era incompleta; `diferencia` es `null` si alguno de los dos
 * lo es y, si no, `ahora − antes` con signo).
 */
export type ConfirmacionDeLaReceta = Readonly<{
  netos: Readonly<Record<string, string>>;
  costos?:
    | Readonly<{
        moneda: "ARS";
        ahora: string | null;
        antes?: string | null | undefined;
        diferencia?: string | null | undefined;
      }>
    | undefined;
}>;

const ESCALA_DEL_COSTO = 6;

type CostosDeUnaVersion = Readonly<{ porUnidad: string; incompleto: boolean }>;
const costoSiSeSabe = (costos: CostosDeUnaVersion): string | null =>
  costos.incompleto ? null : costos.porUnidad;

/** `ahora − antes` con signo, exacto (los costos vienen con 6 decimales), o `null` si alguno no se sabe. */
function diferenciaDeCostos(ahora: string | null, antes: string | null): string | null {
  if (ahora === null || antes === null) return null;
  return formatearDecimalFijo(
    parsearDecimalFijo(ahora, ESCALA_DEL_COSTO, "ahora") -
      parsearDecimalFijo(antes, ESCALA_DEL_COSTO, "antes"),
    ESCALA_DEL_COSTO,
  );
}

/** Calcula la confirmación sin guardar nada. `null` si lo pedido no se puede calcular (un producto que no es de la empresa, una cantidad inválida…). */
export async function verLaConfirmacionDeLaReceta(
  d: DependenciasDeRecetasWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ConfirmacionDeLaReceta | null>> {
  const leido = leerElPedidoDeReceta(crudo);
  if (!leido.ok) return { ok: false, error: GENERICO };
  const entrada = aEntradaDeGuardarReceta(leido.valor);
  if (entrada === null) return { ok: false, error: GENERICO };
  try {
    const vista = await d.consultas().vistaPreviaDeReceta(contexto, {
      productoId: entrada.productoId,
      rinde: entrada.rinde,
      componentes: entrada.componentes,
    });
    if (!vista.ok) return conError(vista.error, d);
    if (vista.valor === null) return { ok: true, dato: null };
    const netos = Object.fromEntries(vista.valor.componentes.map((c) => [c.productoId, c.neto]));
    if (vista.valor.costos === undefined) return { ok: true, dato: { netos } };
    const ahora = costoSiSeSabe(vista.valor.costos);
    const costos = { moneda: vista.valor.costos.moneda, ahora };
    if (entrada.versionEsperada === 0) return { ok: true, dato: { netos, costos } };
    const vigente = await d
      .consultas()
      .recetaDeProducto(contexto, { productoId: entrada.productoId });
    if (!vigente.ok) return conError(vigente.error, d);
    const costosDeAntes = vigente.valor?.ficha?.costos;
    if (costosDeAntes === undefined) return { ok: true, dato: { netos, costos } };
    const antes = costoSiSeSabe(costosDeAntes);
    return {
      ok: true,
      dato: { netos, costos: { ...costos, antes, diferencia: diferenciaDeCostos(ahora, antes) } },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Cuántas páginas se recorren como máximo al armar una lista completa (50 por página): un tope de seguridad, no una regla de negocio. */
const MAXIMO_DE_PAGINAS = 20;

/**
 * TODOS los ingredientes que se ofrecen para una receta (de a páginas, hasta `MAXIMO_DE_PAGINAS`): la pantalla los ofrece en un selector y no puede esconder uno por cortar la lista. Si hay más
 * que el tope sale el genérico (falla cerrado): nunca una lista recortada en silencio.
 */
export async function ofrecerTodosLosIngredientes(
  d: DependenciasDeRecetasWeb,
  contexto: ContextoOperativo,
  /** El producto de la receta que se arma; vacío: no se excluye ninguno (una receta nueva todavía no tiene producto). */
  excluirProductoId: string,
): Promise<Respuesta<PaginaDeIngredientesParaLaPantalla["ingredientes"]>> {
  const todos: PaginaDeIngredientesParaLaPantalla["ingredientes"][number][] = [];
  let despues = "";
  for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS; pagina++) {
    const r = await ofrecerLosIngredientes(d, contexto, { texto: "", despues, excluirProductoId });
    if (!r.ok) return r;
    todos.push(...r.dato.ingredientes);
    if (r.dato.siguiente === null) return { ok: true, dato: todos };
    despues = r.dato.siguiente;
  }
  return { ok: false, error: GENERICO };
}

/** TODOS los productos activos que se pueden elaborar y todavía no tienen receta (el selector «Producto» de una receta nueva), con el mismo tope y la misma regla que los ingredientes. */
export async function ofrecerTodosLosProductosSinReceta(
  d: DependenciasDeRecetasWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<PaginaDeRecetasParaLaPantalla["recetas"]>> {
  const todos: PaginaDeRecetasParaLaPantalla["recetas"][number][] = [];
  let despues = "";
  for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS; pagina++) {
    const r = await listarLasRecetas(d, contexto, {
      texto: "",
      conReceta: "sin",
      activo: "si",
      despues,
    });
    if (!r.ok) return r;
    todos.push(...r.dato.recetas);
    if (r.dato.siguiente === null) return { ok: true, dato: todos };
    despues = r.dato.siguiente;
  }
  return { ok: false, error: GENERICO };
}
