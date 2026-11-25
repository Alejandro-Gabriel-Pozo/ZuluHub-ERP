import {
  errorDeCodigo,
  type ErrorPublico,
  type Respuesta,
} from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { formatearDecimalFijo, parsearDecimalFijo } from "../primitivas/cantidad/decimal-fijo";
import { textoDeBusquedaDeProductoDesdeTexto } from "../primitivas/texto/termino-de-busqueda-de-producto";
import type {
  CasosDeUsoDeStock,
  ConsultasDeStock,
  CursorDeExistencias,
} from "../modulos/stock/publico";
import { aRespuestaDeExcepcion, errorAPublico, type DependenciasDeRespuesta } from "./a-respuesta";
import { identificador } from "./entradas-de-facturacion";
import { leerElPedidoDeControlDeStock } from "./entradas-de-control-de-stock";

/**
 * El tilde «Se controla el stock» de la ficha del producto (maqueta aprobada `productos.html`, tarjeta «Datos»): ver si el producto lleva existencia y movimientos, y fijarlo. Vive acá, y no en
 * `apps/web`, para probarse con la base real sin levantar Next (igual que `ocultar-web.ts`).
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/control-de-stock-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta.** Ver exige `stock.ver`; fijar, `articulos.controlar` / `articulos.dejar_de_controlar` con alcance sobre toda la empresa. Acá no se decide ningún permiso.
 *  - **Repetir no duplica ni deshace.** El pedido fija un ESTADO (`controlado: true|false`), no alterna: el doble toque es una sola escritura y una sola entrada de auditoría (`yaEstaba`).
 *    El caso de uso toma el artículo del producto con `FOR UPDATE`: dos pedidos a la vez se ponen en fila y el último estado pedido gana.
 *  - **Todo nace cerrado.** Ante cualquier error de negocio (clase que no se controla, producto desactivado o ajeno, receta vigente, permiso, alcance) sale el genérico «Esta acción no está permitida», sin
 *    decir cuál. Un fallo inesperado sale sin detalle y con referencia.
 *  - **Nada de más sale.** Lista blanca: solo `controlado`.
 */

export type DependenciasDeControlDeStockWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeStock, "controlarArticulo" | "dejarDeControlar">;
  consultas: () => Pick<ConsultasDeStock, "controlDeStockDelProducto" | "existencias">;
  respuesta: DependenciasDeRespuesta;
}>;

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

/** Los errores de negocio del módulo (cadenas con nombre) salen como el genérico; lo que no es de negocio (la base, un defecto) sigue su camino común. */
function conError(error: unknown, d: DependenciasDeControlDeStockWeb): ErrorPublico {
  // `{ error: "FUNCION_NO_INCLUIDA", perilla }`: el elaborado y el vendible sin la función «Producción» en el plan; también el genérico (si no, saldría como un fallo inesperado con referencia).
  const deObjeto =
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    error.error === "FUNCION_NO_INCLUIDA";
  return deObjeto || (typeof error === "string" && error !== "ERROR_DE_LA_BASE_NO_TRADUCIDO")
    ? GENERICO
    : errorAPublico(error, d.respuesta);
}

/** Si el producto lleva control de stock (artículo activo). Es una LECTURA: no escribe ni audita. */
export async function verElControlDeStock(
  d: DependenciasDeControlDeStockWeb,
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<Readonly<{ controlado: boolean }>>> {
  if (!identificador.safeParse(productoId).success) return { ok: false, error: GENERICO };
  try {
    const hecho = await d.consultas().controlDeStockDelProducto(contexto, { productoId });
    if (!hecho.ok) return { ok: false, error: conError(hecho.error, d) };
    return { ok: true, dato: { controlado: hecho.valor.controlado } };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Lo que devuelve fijar el control: el estado que quedó y si no cambió nada (ya estaba). */
export type ResultadoDeControlDeStock = Readonly<{
  productoId: string;
  controlado: boolean;
  yaEstaba: boolean;
}>;

/** Fija (no alterna) si el producto lleva control de stock: `true` lo controla, `false` deja de controlarlo. Ver las reglas arriba. */
export async function fijarElControlDeStock(
  d: DependenciasDeControlDeStockWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ResultadoDeControlDeStock>> {
  const pedido = leerElPedidoDeControlDeStock(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  const { productoId, controlado } = pedido.valor;
  try {
    if (controlado) {
      const hecho = await d.casosDeUso().controlarArticulo(contexto, { productoId });
      return hecho.ok
        ? { ok: true, dato: { productoId, controlado, yaEstaba: hecho.valor.yaExistia } }
        : { ok: false, error: conError(hecho.error, d) };
    }
    const hecho = await d.casosDeUso().dejarDeControlar(contexto, { productoId });
    return hecho.ok
      ? { ok: true, dato: { productoId, controlado, yaEstaba: hecho.valor.yaEstaba } }
      : { ok: false, error: conError(hecho.error, d) };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/**
 * La existencia PROPIA de un producto con stock propio (la franja «Tiene stock propio: …» de un elaborado o un vendible): la suma, en texto decimal exacto, de sus saldos en los depósitos que la persona
 * puede ver (lo decide la consulta: `stock.ver` y su alcance de sucursales). Sale de la lista de existencias filtrada por el nombre del producto (no hay una consulta por producto). Falla CERRADO:
 * si el nombre no sirve de búsqueda, o hay tantas filas con ese nombre que no se recorren todas, devuelve `null` (no se sabe) y la franja no muestra el número; nunca un cero inventado. Un producto
 * que nunca se movió no tiene filas: su existencia es cero de verdad. Es una LECTURA: no escribe ni audita.
 */
export type ExistenciaPropia = Readonly<{ existencia: string; unidadId: string }>;

/** Cuántas páginas de existencias se recorren como máximo (50 filas cada una): un tope de seguridad, no una regla de negocio. */
const MAXIMO_DE_PAGINAS_DE_EXISTENCIAS = 5;
const ESCALA_DE_LA_EXISTENCIA = 4;

export async function verLaExistenciaPropia(
  d: DependenciasDeControlDeStockWeb,
  contexto: ContextoOperativo,
  entrada: Readonly<{ productoId: string; nombre: string; unidadId: string }>,
): Promise<Respuesta<ExistenciaPropia | null>> {
  if (!identificador.safeParse(entrada.productoId).success) return { ok: false, error: GENERICO };
  const busqueda = textoDeBusquedaDeProductoDesdeTexto(entrada.nombre);
  if (!busqueda.ok || busqueda.valor === null) return { ok: true, dato: null };
  try {
    let suma = 0n;
    let unidadId = entrada.unidadId;
    let despuesDe: CursorDeExistencias | undefined;
    for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS_DE_EXISTENCIAS; pagina++) {
      const r = await d.consultas().existencias(contexto, { texto: busqueda.valor, despuesDe });
      if (!r.ok) return { ok: false, error: conError(r.error, d) };
      for (const fila of r.valor.existencias) {
        if (fila.productoId !== entrada.productoId) continue;
        suma += parsearDecimalFijo(fila.existencia, ESCALA_DE_LA_EXISTENCIA, "existencia");
        unidadId = fila.unidadId;
      }
      if (r.valor.siguiente === null) {
        return {
          ok: true,
          dato: { existencia: formatearDecimalFijo(suma, ESCALA_DE_LA_EXISTENCIA), unidadId },
        };
      }
      despuesDe = r.valor.siguiente;
    }
    return { ok: true, dato: null };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
