import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type {
  ConsultasDeCatalogo,
  PaginaParaVender,
  ProductoParaVender,
} from "../modulos/catalogo/publico";
import type { ImporteJson } from "../primitivas/dinero/importe";
import { aRespuestaDeExcepcion, errorAPublico } from "./a-respuesta";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeCotizarElCarrito } from "./entradas-de-venta-rapida";
import { accionDeVentas, traducirErrorDeVentas } from "./errores-de-ventas";
import type { Web } from "./web";

/**
 * La pantalla VENTA RÁPIDA del mostrador (E4; maqueta `venta-rapida-v4.html`): lo que se ofrece en la sucursal y el total del carrito. Vive acá (no en `apps/web`) para probarse con la
 * base real sin levantar Next, igual que `cajas-web.ts`. Solo LECTURAS: nada se escribe ni se audita; cobrar es otra pantalla.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/venta-rapida-web.test.ts`):
 *  - **La sucursal la fija el servidor** (la elegida en el dispositivo, validada contra el alcance): llega como argumento, nunca del pedido del navegador. Cada consulta la vuelve a validar. Nunca «todas».
 *  - **El permiso es de la consulta** (`productos.ver` para la lista, `ventas.ver` para cotizar): acá no se decide ninguno.
 *  - **El total sale del servidor** (`cotizarVentaRapida`, la misma cuenta que el cierre) en cada cambio del carrito: la pantalla no suma nada. Cotizar dos veces lo mismo da lo mismo; el
 *    precio nunca viene del navegador (salvo el importe de un producto sin precio, que el servidor rechaza si el catálogo trae uno).
 *  - **Nada de más sale.** Lista blanca campo por campo; el dinero, como texto decimal con su moneda; sin ids internos que la pantalla no use.
 *  - **Lo que no se pudo completar no sale a medias:** la lista dice `incompleta` si quedó algo sin traer (más de `MAXIMO_DE_PAGINAS` páginas); un error de cualquier página es el error de todo.
 *  - Todo resultado sale por el camino común (`aRespuesta`, ADR-016): un error de negocio es el genérico; un fallo inesperado, sin detalle y con referencia.
 */

/** Páginas de `productosParaVender` que se traen en una carga (100 productos por página): 1000 productos. Pasado eso, `incompleta`. */
export const MAXIMO_DE_PAGINAS_DE_LA_VENTA_RAPIDA = 10;

export type DependenciasDeVentaRapidaWeb = Readonly<{
  consultasDeCatalogo: () => Pick<ConsultasDeCatalogo, "productosParaVender">;
  consultasDeVentas: () => Pick<ReturnType<Web["consultasDeVentas"]>, "cotizarVentaRapida">;
  respuesta: DependenciasDeRespuesta;
}>;

export type VentaRapidaParaLaPantalla = Readonly<{
  secciones: readonly Readonly<{ id: string; nombre: string }>[];
  productos: readonly ProductoParaVender[];
  /** `true` si hay más productos que los que una carga trae: la pantalla no debe mostrarlos como si fueran todos. */
  incompleta: boolean;
}>;

export type CarritoCotizado = Readonly<{
  total: ImporteJson;
  lineas: readonly Readonly<{ precioUnitario: ImporteJson; importe: ImporteJson }>[];
}>;

/** Lista blanca de lo que sale de un producto: nada más que lo que la pantalla usa. */
const productoParaLaPantalla = (p: ProductoParaVender): ProductoParaVender => ({
  id: p.id,
  nombre: p.nombre,
  seccionId: p.seccionId,
  unidadDeVentaId: p.unidadDeVentaId,
  pasoMinimo: p.pasoMinimo,
  porcionesOfrecidas: [...p.porcionesOfrecidas],
  precio: p.precio,
  variante:
    p.variante === null
      ? null
      : {
          grupoId: p.variante.grupoId,
          nombre: p.variante.nombre,
          esTamano: p.variante.esTamano,
          opciones: p.variante.opciones.map((o) => ({
            id: o.id,
            nombre: o.nombre,
            precio: o.precio,
          })),
        },
  grupos: p.grupos.map((g) => ({
    id: g.id,
    clase: g.clase,
    nombre: g.nombre,
    obligatorio: g.obligatorio,
    admiteVarias: g.admiteVarias,
    opciones: g.opciones.map((o) => ({ id: o.id, nombre: o.nombre, recargo: o.recargo })),
  })),
});

/**
 * Lo que el mostrador ofrece en la sucursal con la que trabaja la persona: las secciones y los productos (con su precio de la sucursal, medidas, opciones y recargos). Trae las páginas
 * de a una, cada una en su lectura; si alguna falla, falla todo (nunca una lista a medias sin avisar). Es una LECTURA: no escribe ni audita.
 */
export async function cargarVentaRapida(
  d: DependenciasDeVentaRapidaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<VentaRapidaParaLaPantalla>> {
  try {
    let secciones: PaginaParaVender["secciones"] = [];
    const productos: ProductoParaVender[] = [];
    let despuesDe: PaginaParaVender["siguiente"] = null;
    let pagina = 0;
    do {
      const r = await d.consultasDeCatalogo().productosParaVender(contexto, {
        sucursalId,
        ...(despuesDe === null ? {} : { despuesDe }),
      });
      if (!r.ok)
        return { ok: false, error: errorAPublico(traducirErrorDeVentas(r.error), d.respuesta) };
      secciones = r.valor.secciones;
      productos.push(...r.valor.productos);
      despuesDe = r.valor.siguiente;
      pagina += 1;
    } while (despuesDe !== null && pagina < MAXIMO_DE_PAGINAS_DE_LA_VENTA_RAPIDA);
    return {
      ok: true,
      dato: {
        secciones: secciones.map((s) => ({ id: s.id, nombre: s.nombre })),
        productos: productos.map(productoParaLaPantalla),
        incompleta: despuesDe !== null,
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/**
 * El total del carrito y el precio e importe de cada línea, calculados por el servidor con la cuenta del cierre. `crudo` es el pedido del navegador (`{ lineas }`); la sucursal la pone el
 * servidor. Es una LECTURA: cotizar no reserva, no descuenta stock ni audita, así que repetirla (clic doble, reintento) no puede duplicar nada.
 */
export function cotizarElCarrito(
  d: DependenciasDeVentaRapidaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<CarritoCotizado>> {
  return accionDeVentas(
    d.respuesta,
    crudo,
    entradaDeCotizarElCarrito,
    (entrada) =>
      d.consultasDeVentas().cotizarVentaRapida(contexto, { sucursalId, lineas: entrada.lineas }),
    (salida) => ({
      total: { moneda: salida.total.moneda, monto: salida.total.monto },
      lineas: salida.lineas.map((l) => ({
        precioUnitario: { moneda: l.precioUnitario.moneda, monto: l.precioUnitario.monto },
        importe: { moneda: l.importe.moneda, monto: l.importe.monto },
      })),
    }),
  );
}
