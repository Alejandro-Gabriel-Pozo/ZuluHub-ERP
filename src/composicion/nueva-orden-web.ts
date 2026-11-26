import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CasosDeUsoDeProduccion } from "../modulos/produccion/publico";
import {
  CONTROL_DE_NEGATIVO,
  type ConsultasDeStock,
  type PaginaDeRecetas,
} from "../modulos/stock/publico";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeNuevaOrden } from "./entradas-de-nueva-orden";
import { traducirErrorDeProduccion } from "./errores-de-produccion";
import { accionDeProduccion } from "./produccion-web";

/**
 * «Nueva orden» de producción (maqueta `produccion.html`, spec `pantallas-de-produccion-inventario.md` §3): qué se puede producir y abrir la orden. Vive acá, y no en `apps/web`, para probarse con la base real
 * sin levantar Next (igual que `produccion-web.ts`).
 *
 * Reglas que cumple (cada una con su prueba en `nueva-orden-web.test.ts` y `test/integracion/nueva-orden-web.test.ts`):
 *  - **Lo que se ofrece lo decide el servidor.** Los productos son los activos con receta vigente Y artículo propio activo (la intersección de la lista de recetas con los artículos controlados: lo que `abrirOrden` exige);
 *    la unidad es la de stock del artículo y no se elige. El navegador manda solo el id: uno que no está en lo ofrecido sale como el genérico, sin decir por qué.
 *  - **SUPUESTO (DEC-PRO-002, O6): origen y destino son el depósito de venta de la sucursal elegida** (la maqueta no dibuja selector de depósito). Sin depósito de venta activo y normal, el genérico (nunca se asume otro).
 *  - **La empresa, la persona y la sucursal las pone el servidor**; el alcance de las dos sucursales, el permiso (`transformaciones.abrir`), el módulo y la perilla los decide el caso de uso dentro de su transacción.
 *  - **Repetir no duplica.** La clave es el UUID que fija la página al armar el formulario: el mismo gesto devuelve la misma orden con `yaExistia` (sin segunda orden, segundo número ni segunda auditoría). Con otro
 *    contenido la misma clave se rechaza (`ID_REUTILIZADO`, genérico).
 *  - **«Producir igual» es reenviar con la misma clave y `confirmar`.** Con el control en AVISAR y faltante, abrir sin confirmar sale como el aviso `STOCK_CONTROL_AVISA` y no escribe nada; el detalle de los faltantes no sale.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016): un error de la orden sin texto aprobado sale como el genérico; un fallo inesperado, sin detalle y con referencia.
 * Previene: abrir una orden de un producto que no se produce o de otra sucursal, y duplicar la orden por un clic doble o un reintento. Chequeo: las dos pruebas citadas.
 */

export type DependenciasDeNuevaOrdenWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeProduccion, "abrirOrden">;
  consultas: () => Pick<
    ConsultasDeStock,
    "listarRecetas" | "articulosControlados" | "listarDepositos"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

type ClaveDePaginaDeRecetas = NonNullable<PaginaDeRecetas["siguiente"]>;

export type ProductoParaProducir = Readonly<{ id: string; nombre: string; unidadId: string }>;
export type OfertaDeProduccion = Readonly<{
  productos: readonly ProductoParaProducir[];
  /** El depósito de venta de la sucursal: origen y destino de la orden. */
  depositoId: string;
}>;

/** Sin depósito de venta activo y normal en la sucursal: el genérico (el texto aprobado no distingue el motivo). */
const SIN_DEPOSITO_DE_VENTA = errorDeCodigo("PRODUCCION_ACCION_NO_PERMITIDA");

/** Páginas que se leen de la lista de recetas (50 por página): más allá, no se ofrece (lo que no se ve no se puede abrir; nunca se ofrece de más). */
const MAXIMO_DE_PAGINAS = 20;

/** Lo que se puede producir en la sucursal: activos con receta vigente y artículo propio activo, más el depósito de venta. */
async function loQueSePuedeProducir(
  d: DependenciasDeNuevaOrdenWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Resultado<OfertaDeProduccion, unknown>> {
  const depositos = await d.consultas().listarDepositos(contexto, { sucursalId });
  if (!depositos.ok) return depositos;
  const deposito = depositos.valor.find((x) => x.deVenta && x.activo && x.uso === "NORMAL");
  if (deposito === undefined) return err(SIN_DEPOSITO_DE_VENTA);
  const articulos = await d.consultas().articulosControlados(contexto);
  if (!articulos.ok) return articulos;
  const unidadDe = new Map(articulos.valor.map((a) => [a.productoId, a.unidadId]));

  const productos: ProductoParaProducir[] = [];
  let despuesDe: ClaveDePaginaDeRecetas | undefined;
  for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS; pagina++) {
    const lista = await d
      .consultas()
      .listarRecetas(contexto, { conReceta: true, activo: true, despuesDe });
    if (!lista.ok) return lista;
    for (const r of lista.valor.recetas) {
      const unidadId = unidadDe.get(r.productoId);
      if (unidadId !== undefined) productos.push({ id: r.productoId, nombre: r.nombre, unidadId });
    }
    if (lista.valor.siguiente === null) break;
    despuesDe = lista.valor.siguiente;
  }
  return ok({ productos, depositoId: deposito.id });
}

/** Lo que ofrece el formulario de la nueva orden. Es una LECTURA: no escribe ni audita. */
export async function cargarLaNuevaOrden(
  d: DependenciasDeNuevaOrdenWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<OfertaDeProduccion>> {
  try {
    const oferta = await loQueSePuedeProducir(d, contexto, sucursalId);
    return aRespuesta(
      oferta.ok ? oferta : err(traducirErrorDeProduccion(oferta.error)),
      d.respuesta,
      (o) => ({ productos: o.productos, depositoId: o.depositoId }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

export type OrdenAbierta = Readonly<{ ordenId: string; numero: number; yaExistia: boolean }>;

/** Abre la orden de un producto de los que se ofrecen, en el depósito de venta de la sucursal. Repetir con la misma clave devuelve la misma orden (`yaExistia`). */
export function abrirLaOrden(
  d: DependenciasDeNuevaOrdenWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<OrdenAbierta>> {
  return accionDeProduccion(
    d.respuesta,
    crudo,
    entradaDeNuevaOrden,
    async (e) => {
      const oferta = await loQueSePuedeProducir(d, contexto, sucursalId);
      if (!oferta.ok) return oferta;
      const producto = oferta.valor.productos.find((p) => p.id === e.productoId);
      if (producto === undefined) return err("PRODUCTO_NO_SE_PRODUCE" as const);
      return d.casosDeUso().abrirOrden(contexto, {
        id: e.clave,
        productoId: producto.id,
        cantidad: e.cantidad,
        unidadId: producto.unidadId,
        depositoId: oferta.valor.depositoId,
        depositoDestinoId: oferta.valor.depositoId,
        ...(e.confirmar ? { confirmaciones: [CONTROL_DE_NEGATIVO] } : {}),
      });
    },
    (s): OrdenAbierta => ({ ordenId: s.ordenId, numero: s.numero, yaExistia: s.yaExistia }),
  );
}
