import {
  errorDeCodigo,
  type ErrorPublico,
  type Respuesta,
} from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { formatearDecimalFijo, parsearDecimalFijo } from "../primitivas/cantidad/decimal-fijo";
import { textoDeBusquedaDeProductoDesdeTexto } from "../primitivas/texto/termino-de-busqueda-de-producto";
import {
  CONFIRMACION_DE_CUENTAS_ABIERTAS,
  type CasosDeUsoDeStock,
  type ConsultasDeStock,
  type CursorDeExistencias,
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
const AVISO_DE_CUENTAS_ABIERTAS = errorDeCodigo("PRODUCCION_CUENTAS_ABIERTAS");

/** Los errores de negocio del módulo (cadenas con nombre) salen como el genérico; lo que no es de negocio (la base, un defecto) sigue su camino común. */
function conError(error: unknown, d: DependenciasDeControlDeStockWeb): ErrorPublico {
  // `{ error: "FUNCION_NO_INCLUIDA", perilla }` (plan sin «Producción») es el genérico, no un fallo inesperado; `Object(...)` evita lanzar con `null` o cadenas.
  const nombre = (Object(error) as { error?: unknown }).error;
  // Encender el stock propio de un plato con cuentas abiertas: no es un fallo, la ficha pide confirmar. El aviso no lleva detalle de las cuentas (solo que hay).
  if (nombre === "CUENTAS_ABIERTAS_REQUIEREN_CONFIRMACION") {
    return AVISO_DE_CUENTAS_ABIERTAS;
  }
  const deObjeto = nombre === "FUNCION_NO_INCLUIDA";
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
  const { productoId, controlado, confirmarCuentasAbiertas } = pedido.valor;
  try {
    if (controlado) {
      const hecho = await d.casosDeUso().controlarArticulo(contexto, {
        productoId,
        ...(confirmarCuentasAbiertas === true
          ? { confirmaciones: [CONFIRMACION_DE_CUENTAS_ABIERTAS] }
          : {}),
      });
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
 * Existencia propia de un producto con stock propio: suma exacta de sus saldos en los depósitos que la persona ve (`stock.ver`). Falla cerrado: si no se puede saber, `null` (sin número inventado).
 */
export type ExistenciaPropia = Readonly<{ existencia: string; unidadId: string }>;

/** Tope de seguridad de páginas de existencias (50 filas cada una), no una regla de negocio. */
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
