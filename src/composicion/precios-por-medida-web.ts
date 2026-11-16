import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { precioDeVentaDesdeTexto } from "../primitivas/dinero/precio-de-venta";
import { vendeLaClase, type FichaDeProducto } from "../modulos/catalogo/publico";
import { aRespuestaDeExcepcion, errorAPublico, type DependenciasDeRespuesta } from "./a-respuesta";
import { idDerivado } from "./conjunto-de-opciones";
import { identificador } from "./entradas-de-facturacion";
import {
  leerElPedidoDePreciosPorMedida,
  nombreDeCampoDePrecio,
  type PedidoDePreciosPorMedida,
} from "./entradas-de-precios-por-medida";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";
import { mismoPrecio } from "./precios-de-producto-web";
import type { Web } from "./web";

/**
 * Los precios por medida de un producto (A13, tramo Medidas; maqueta `productos.html`, solapa «Precios» con variante): ver el precio de la EMPRESA de cada medida y cambiarlo. Vive acá,
 * y no en `apps/web`, para probarse con la base real (igual que los precios del producto sin variante). El precio por sucursal no se ofrece en este tramo (pregunta pendiente).
 *
 * Reglas (cada una con su prueba en `test/integracion/precios-por-medida-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta**: ver exige `productos.ver`; cambiar, `productos.cambiar_precio` con alcance sobre todas las sucursales.
 *  - **Todo o nada**: las medidas tocadas se guardan con UN caso de uso atómico (`cambiarPreciosPorMedida`): una transacción, el control de versión de cada medida (`precioIdEsperado`)
 *    validado junto, auditoría por medida; si una falla no se guarda ninguna (la pantalla no deja una lista de precios a medias).
 *  - **Repetir no duplica**: el id de cada cambio se deriva de la clave de la pantalla y la posición de la medida; el doble toque manda lo mismo y el caso de uso lo reconoce (todo en «ya estaba»). Un precio igual al
 *    vigente no escribe, y una medida sin precio escrito no se toca.
 *  - **Nada de más sale**: solo las medidas activas con su vigente de la empresa.
 */

export type DependenciasDePreciosPorMedidaWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeCatalogo"]>, "cambiarPreciosPorMedida">;
  consultas: () => Pick<ReturnType<Web["consultasDeCatalogo"]>, "verProducto">;
  respuesta: DependenciasDeRespuesta;
  nuevoId: () => string;
}>;

export type MedidaConPrecio = Readonly<{
  opcionId: string;
  nombre: string;
  /** La fila vigente de la empresa para esa medida; `null` si no tiene precio. */
  vigente: Readonly<{ precioId: string; importe: string }> | null;
}>;

export type PreciosPorMedidaParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  medidas: readonly MedidaConPrecio[];
  claveDelCambio: string;
}>;

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

const conError = (error: unknown, respuesta: DependenciasDeRespuesta): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeCatalogo(error), respuesta),
});

type Ficha = FichaDeProducto;

/** Las medidas activas de la variante, con el vigente de la empresa; `null` si el producto no se vende o no tiene variante activa. */
function medidasDe(ficha: Ficha): readonly MedidaConPrecio[] | null {
  if (!vendeLaClase(ficha.producto.claseDeUso)) return null;
  const variante = ficha.grupos.find((g) => g.clase === "VARIANTE" && g.activo);
  if (variante === undefined) return null;
  return [...variante.opciones]
    .filter((o) => o.activa)
    .sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id))
    .map((o) => {
      const fila = ficha.preciosVigentes.find((f) => f.opcionId === o.id && f.sucursalId === null);
      return {
        opcionId: o.id,
        nombre: o.nombre,
        vigente:
          fila === undefined || fila.precio === null
            ? null
            : { precioId: fila.id, importe: fila.precio },
      };
    });
}

/** Los precios por medida de un producto de la empresa. Es una LECTURA: no escribe ni audita. */
export async function verLosPreciosPorMedida(
  d: DependenciasDePreciosPorMedidaWeb,
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<PreciosPorMedidaParaLaPantalla>> {
  if (!identificador.safeParse(productoId).success) return { ok: false, error: GENERICO };
  try {
    const ficha = await d.consultas().verProducto(contexto, { productoId });
    if (!ficha.ok) return conError(ficha.error, d.respuesta);
    if (ficha.valor === null) return { ok: false, error: GENERICO };
    const medidas = medidasDe(ficha.valor);
    if (medidas === null) return { ok: false, error: GENERICO };
    return {
      ok: true,
      dato: {
        id: ficha.valor.producto.id,
        nombre: ficha.valor.producto.nombre,
        medidas,
        claveDelCambio: d.nuevoId(),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** La posición de la primera fila escrita cuya fila vista ya no es la vigente de la empresa; `-1` si no se puede decir. */
async function primeraDesactualizada(
  d: DependenciasDePreciosPorMedidaWeb,
  contexto: ContextoOperativo,
  pedido: PedidoDePreciosPorMedida,
): Promise<number> {
  const ficha = await d.consultas().verProducto(contexto, { productoId: pedido.productoId });
  if (!ficha.ok || ficha.valor === null) return -1;
  const medidas = medidasDe(ficha.valor) ?? [];
  return pedido.filas.findIndex((f) => {
    if (f.precio.trim() === "") return false;
    const vigente = medidas.find((m) => m.opcionId === f.opcionId)?.vigente ?? null;
    return (vigente === null ? null : vigente.precioId) !== f.precioIdEsperado;
  });
}

/** Cambia el precio de la empresa de las medidas que la persona tocó; devuelve el id del producto. Ver las reglas arriba. */
export async function cambiarLosPreciosPorMedida(
  d: DependenciasDePreciosPorMedidaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ productoId: string }>>> {
  const leido = leerElPedidoDePreciosPorMedida(crudo);
  if (!leido.ok) return { ok: false, error: GENERICO };
  const pedido = leido.valor;
  try {
    const ficha = await d.consultas().verProducto(contexto, { productoId: pedido.productoId });
    if (!ficha.ok) return conError(ficha.error, d.respuesta);
    if (ficha.valor === null) return { ok: false, error: GENERICO };
    const medidas = medidasDe(ficha.valor);
    if (medidas === null) return { ok: false, error: GENERICO };
    const cambios: {
      precioId: string;
      opcionId: string;
      precioIdEsperado: string | null;
      precio: string;
    }[] = [];
    for (const [i, fila] of pedido.filas.entries()) {
      if (fila.precio.trim() === "") continue;
      // Solo una medida del producto: un id ajeno no se manda al caso de uso.
      const medida = medidas.find((m) => m.opcionId === fila.opcionId);
      if (medida === undefined) return { ok: false, error: GENERICO };
      if (medida.vigente !== null && mismoPrecio(medida.vigente.importe, fila.precio)) continue;
      cambios.push({
        precioId: idDerivado(pedido.claveDelCambio, i),
        opcionId: fila.opcionId,
        precioIdEsperado: fila.precioIdEsperado,
        precio: fila.precio,
      });
    }
    if (cambios.length === 0) return { ok: true, dato: { productoId: pedido.productoId } };
    // Todas las medidas tocadas en UNA transacción: o se guardan todas o no se guarda ninguna.
    const cambiado = await d.casosDeUso().cambiarPreciosPorMedida(contexto, {
      productoId: pedido.productoId,
      cambios,
    });
    if (!cambiado.ok) {
      const publico = conError(cambiado.error, d.respuesta);
      if (publico.ok || publico.error.campo !== "precio") return publico;
      // El error de un precio se asocia al campo de la medida que lo causó: la PRIMERA (en el orden del caso de uso) con un precio ilegible (la misma primitiva que valida allá)
      // o con una fila vista que ya no es la vigente (se vuelve a leer: es lectura, no escribe).
      const posicion =
        publico.error.codigo === "CATALOGO_PRECIO_DESACTUALIZADO"
          ? await primeraDesactualizada(d, contexto, pedido)
          : pedido.filas.findIndex(
              (f) => f.precio.trim() !== "" && !precioDeVentaDesdeTexto(f.precio).ok,
            );
      return posicion < 0
        ? publico
        : { ok: false, error: { ...publico.error, campo: nombreDeCampoDePrecio(posicion) } };
    }
    return { ok: true, dato: { productoId: pedido.productoId } };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
