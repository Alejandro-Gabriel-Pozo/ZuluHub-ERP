import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { vendeLaClase, type FichaDeProducto } from "../modulos/catalogo/publico";
import { aRespuestaDeExcepcion, errorAPublico, type DependenciasDeRespuesta } from "./a-respuesta";
import { idDerivado } from "./conjunto-de-opciones";
import { identificador } from "./entradas-de-facturacion";
import {
  leerElPedidoDePreciosPorMedida,
  nombreDeCampoDePrecio,
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
 *  - **Cada medida es un cambio de precio del caso de uso** (`cambiarPrecio`, con su control de versión por medida: `precioIdEsperado`), así que cada una es atómica, auditada e idempotente por
 *    sí misma. El guardado de varias medidas a la vez NO es una sola transacción: se aplican en orden y se corta en la primera que falla (lo ya cambiado queda y se ve al volver a pedir la
 *    pantalla). SUPUESTO (DEC-0528): hacerlo atómico pide un caso de uso nuevo en el catálogo (el dueño decide).
 *  - **Repetir no duplica**: el id de cada cambio se deriva de la clave de la pantalla y la posición de la medida; el doble toque manda lo mismo y el caso de uso lo reconoce. Un precio igual al
 *    vigente no escribe, y una medida sin precio escrito no se toca.
 *  - **Nada de más sale**: solo las medidas activas con su vigente de la empresa.
 */

export type DependenciasDePreciosPorMedidaWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeCatalogo"]>, "cambiarPrecio">;
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
    for (const [i, fila] of pedido.filas.entries()) {
      if (fila.precio.trim() === "") continue;
      // Solo una medida del producto: un id ajeno no se manda al caso de uso.
      const medida = medidas.find((m) => m.opcionId === fila.opcionId);
      if (medida === undefined) return { ok: false, error: GENERICO };
      if (medida.vigente !== null && mismoPrecio(medida.vigente.importe, fila.precio)) continue;
      const cambiado = await d.casosDeUso().cambiarPrecio(contexto, {
        precioId: idDerivado(pedido.claveDelCambio, i),
        productoId: pedido.productoId,
        opcionId: fila.opcionId,
        sucursalId: null,
        precioIdEsperado: fila.precioIdEsperado,
        precio: fila.precio,
      });
      if (!cambiado.ok) {
        const publico = conError(cambiado.error, d.respuesta);
        // El error de un precio se asocia al campo de ESA medida.
        return publico.ok || publico.error.campo !== "precio"
          ? publico
          : { ok: false, error: { ...publico.error, campo: nombreDeCampoDePrecio(i) } };
      }
    }
    return { ok: true, dato: { productoId: pedido.productoId } };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
