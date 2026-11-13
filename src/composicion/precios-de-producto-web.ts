import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { vendeLaClase } from "../modulos/catalogo/publico";
import { precioDeVentaDesdeTexto } from "../primitivas/dinero/precio-de-venta";
import { err } from "../primitivas/resultado/resultado";
import { hoyEnArgentina } from "../primitivas/tiempo/fecha-civil-hasta-hoy";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { identificador } from "./entradas-de-facturacion";
import { leerElPedidoDePrecio } from "./entradas-de-precios-de-producto";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";
import type { Web } from "./web";

/**
 * Los precios de un producto (A1, T3; maqueta aprobada `productos.html`, solapa «Precios»): ver el precio vigente de la empresa y su historial, y cambiarlo. Vive acá, y no en
 * `apps/web`, para probarse con la base real sin levantar Next (igual que la ficha de datos).
 *
 * Alcance de este tramo: el precio de la EMPRESA de un producto SIN variante. Un producto con variante activa se dice «según medida» y no se edita acá (la grilla por medida es de
 * las variantes), y el precio de una sucursal no se ofrece (necesita elegir la sucursal). El caso de uso ya lo soporta: se suma cuando la maqueta se construya completa.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/precios-de-producto-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta.** Ver exige `productos.ver` y cambiar `productos.cambiar_precio` (con alcance sobre todas las sucursales, por ser precio de la
 *    empresa) al guard dentro de su transacción: acá no se decide ningún permiso. Con `catalogo` en desarrollo (hoy) o sin el permiso sale el motivo del guard, sin dato alguno.
 *  - **La empresa y la persona las pone el servidor**; la sucursal y la opción las fija este tramo (precio de la empresa, del producto): el pedido no las trae.
 *  - **Nada se pisa ni se borra.** Cambiar agrega una fila al historial. El pedido lleva la fila que la persona vio como vigente (`precioIdEsperado`): con otra (alguien cambió antes) el caso
 *    de uso rechaza sin escribir y la respuesta trae el importe vigente. Dos cambios simultáneos se serializan en el caso de uso: gana uno.
 *  - **Repetir no duplica.** La clave del cambio (`precioId`) la fija la pantalla al armarse: el doble toque y el reintento mandan la misma y el caso de uso la reconoce. Dejar el mismo
 *    precio que ya rige no escribe nada (la maqueta tampoco: «c2 !== p2.precio»).
 *  - **La vigencia es «desde ahora».** El caso de uso no recibe una fecha (rige desde el instante del cambio, nunca pasada); lo que se muestra es ese día civil de Argentina (UTC-3).
 *  - **Nada de más sale.** Lista blanca campo por campo: no salen quién cargó cada precio, la unidad ni el paso, ni los precios de sucursales o medidas.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeCatalogo`): un fallo inesperado sale sin detalle y con referencia.
 */

export type DependenciasDePreciosDeProductoWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeCatalogo"]>, "cambiarPrecio">;
  consultas: () => Pick<ReturnType<Web["consultasDeCatalogo"]>, "verProducto">;
  respuesta: DependenciasDeRespuesta;
  /** Un identificador nuevo (uuid) para la clave del cambio; entra como dato para poder probarlo. */
  nuevoId: () => string;
}>;

/** Un precio con su día civil de vigencia en Argentina (`AAAA-MM-DD`); `importe` nulo es «precio abierto». */
export type PrecioConFecha = Readonly<{ importe: string | null; desde: string }>;

export type PreciosParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  /** `SEGUN_MEDIDA`: tiene variante activa y el precio es de cada medida (no se edita acá). */
  tipo: "DE_LA_EMPRESA" | "SEGUN_MEDIDA";
  /** La fila que rige hoy para la empresa; `null` si nunca tuvo precio o el producto es según medida. */
  vigente: (PrecioConFecha & Readonly<{ precioId: string }>) | null;
  /** Los anteriores al vigente, del más nuevo al más viejo. Vacío si es según medida. */
  historial: readonly PrecioConFecha[];
  /** La clave de idempotencia del próximo cambio: una por pantalla armada. */
  claveDelCambio: string;
}>;

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

const conError = (error: unknown, respuesta: DependenciasDeRespuesta): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeCatalogo(error), respuesta),
});

/** El día civil de Argentina de un instante. Un instante sin día civil representable es un defecto: sale como inesperado. */
function diaCivil(instante: Date): string {
  const dia = hoyEnArgentina(instante);
  if (!dia.ok) throw new Error("INSTANTE_SIN_DIA_CIVIL");
  return dia.valor;
}

/** Los precios de un producto de la empresa. Es una LECTURA: no escribe ni audita. */
export async function verLosPreciosDeUnProducto(
  d: DependenciasDePreciosDeProductoWeb,
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<PreciosParaLaPantalla>> {
  // Lo que no tiene la forma de un id no puede ser el de ningún producto: no se consulta.
  if (!identificador.safeParse(productoId).success) return { ok: false, error: GENERICO };
  try {
    const ficha = await d.consultas().verProducto(contexto, { productoId });
    if (!ficha.ok) return conError(ficha.error, d.respuesta);
    if (ficha.valor === null) return { ok: false, error: GENERICO };
    const { producto, grupos, preciosVigentes, historial } = ficha.valor;
    // Una clase que no se vende no tiene solapa de precios (maqueta): sale como un producto que no está.
    if (!vendeLaClase(producto.claseDeUso)) return { ok: false, error: GENERICO };
    const base = { id: producto.id, nombre: producto.nombre, claveDelCambio: d.nuevoId() };
    if (grupos.some(({ clase, activo }) => clase === "VARIANTE" && activo)) {
      return {
        ok: true,
        dato: { ...base, tipo: "SEGUN_MEDIDA", vigente: null, historial: [] },
      };
    }
    const fila = preciosVigentes.find((f) => f.opcionId === null && f.sucursalId === null);
    const vigente =
      fila === undefined
        ? null
        : { precioId: fila.id, importe: fila.precio, desde: diaCivil(fila.vigenteDesde) };
    return {
      ok: true,
      dato: {
        ...base,
        tipo: "DE_LA_EMPRESA",
        vigente,
        historial: historial
          .filter((h) => h.opcionId === null && h.sucursalId === null && h.precioId !== fila?.id)
          .map((h) => ({ importe: h.precio, desde: diaCivil(h.desde) })),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** ¿Es el mismo precio? Compara el valor exacto (no el texto: «13000.00» y «13000.000000» son iguales). Un texto que no es un precio no es igual a nada. */
function mismoPrecio(a: string | null, b: string): boolean {
  if (a === null) return false;
  const x = precioDeVentaDesdeTexto(a);
  const y = precioDeVentaDesdeTexto(b);
  return x.ok && y.ok && x.valor.unidades === y.valor.unidades;
}

/** Cambia el precio de la empresa de un producto; devuelve su id. Ver las reglas arriba. */
export async function cambiarElPrecioDeUnProducto(
  d: DependenciasDePreciosDeProductoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ productoId: string }>>> {
  const pedido = leerElPedidoDePrecio(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  const { productoId, precioId, precioIdEsperado, precio } = pedido.valor;
  try {
    // Lo que rige HOY: si es el mismo precio que se pide, no hay nada que cambiar (y no se agrega una fila repetida al historial).
    const leida = await d.consultas().verProducto(contexto, { productoId });
    if (!leida.ok) return conError(leida.error, d.respuesta);
    if (leida.valor !== null) {
      const hoy = leida.valor.preciosVigentes.find(
        (f) => f.opcionId === null && f.sucursalId === null,
      );
      if (hoy !== undefined && mismoPrecio(hoy.precio, precio)) {
        return { ok: true, dato: { productoId } };
      }
    }
    const cambiado = await d.casosDeUso().cambiarPrecio(contexto, {
      precioId,
      productoId,
      opcionId: null,
      sucursalId: null,
      precioIdEsperado,
      precio,
    });
    return aRespuesta(
      cambiado.ok ? cambiado : err(traducirErrorDeCatalogo(cambiado.error)),
      d.respuesta,
      () => ({ productoId }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
