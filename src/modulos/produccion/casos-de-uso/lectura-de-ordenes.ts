import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadConSignoDesdeTexto } from "../../../primitivas/cantidad/con-signo";
import { formatearDecimalFijo } from "../../../primitivas/cantidad/decimal-fijo";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { mermaDeLote, recetaCambiada } from "../dominio/esperados";
import { esUuid } from "../dominio/identificadores";
import { esEstadoDeOrden, type EstadoDeOrden } from "../dominio/orden";
import type { OrdenGuardada } from "../persistencia/modelo";
import type { TxDeConsultasDeProduccion } from "./contrato";

/**
 * Lo que leen las consultas de órdenes (E6 §3.5): la lista y la ficha con lo esperado y lo real, la merma de lote, el costo congelado (solo con
 * `costos.ver`), el lote y `recetaCambiada` (hay una versión de la receta posterior a la sellada al abrir: el cierre NO se bloquea, S-2). Una consulta
 * no importa el dominio (ADR-005): las cuentas viven acá.
 */
export const TOPE_DE_ORDENES_DE_LA_LISTA = 200;

export type OrdenDeLista = Readonly<{
  ordenId: string;
  numero: number;
  estado: EstadoDeOrden;
  productoId: string;
  nombre: string;
  /** En la unidad de stock del producto, texto decimal exacto. */
  cantidadEsperada: string;
  cantidadObtenida: string | null;
  unidadId: string;
  depositoId: string;
  depositoDestinoId: string;
  abiertaEn: Date;
}>;

export type RenglonDeFichaDeOrden = Readonly<{
  productoId: string;
  nombre: string;
  /** Lo esperado (sellado al abrir) y lo real (`null` hasta cerrar), en la unidad de stock del insumo. */
  esperado: string;
  real: string | null;
  unidadId: string;
}>;

export type FichaDeOrden = Readonly<{
  ordenId: string;
  numero: number;
  estado: EstadoDeOrden;
  productoId: string;
  nombre: string;
  unidadId: string;
  /** La versión de la receta sellada al abrir, y si desde entonces hay una más nueva. */
  version: number;
  recetaCambiada: boolean;
  depositoId: string;
  depositoDestinoId: string;
  cantidadEsperada: string;
  cantidadObtenida: string | null;
  /** `esperado − obtenido`; `null` hasta cerrar. */
  mermaDeLote: string | null;
  vence: string | null;
  lote: Readonly<{ loteId: string; codigo: string }> | null;
  renglones: readonly RenglonDeFichaDeOrden[];
  movimientos: Readonly<{
    consumoId: string | null;
    productoId: string | null;
    anulacionDeConsumoId: string | null;
    anulacionDeProductoId: string | null;
  }>;
  motivo: string | null;
  abiertaEn: Date;
  cerradaEn: Date | null;
  fechaDeNegocio: string | null;
  /** SOLO con `costos.ver`: el costo congelado al cerrar (6 decimales; `null` si no se cerró o quedó sin costo) y su estado. */
  costo?:
    | Readonly<{ costoUnitario: string | null; costoEstado: "SIN_COSTO" | "DEFINITIVO" | null }>
    | undefined;
}>;

type Tx = TxDeConsultasDeProduccion;

/** Un id de orden bien formado (en minúsculas) o `null`: un id mal formado da lo mismo que uno ajeno. */
export const ordenIdBienFormado = (texto: unknown): string | null =>
  typeof texto === "string" && esUuid(texto) ? texto.toLowerCase() : null;

/** El filtro de la lista, validado; `null` si viene mal formado (la lista sale vacía). */
export function filtroDeLaLista(
  entrada: Readonly<{ estado?: unknown; sucursalId?: unknown }>,
): Readonly<{ estado: EstadoDeOrden | undefined; sucursalId: string | undefined }> | null {
  const { estado, sucursalId } = entrada;
  if (estado !== undefined && !(typeof estado === "string" && esEstadoDeOrden(estado))) return null;
  if (sucursalId !== undefined && ordenIdBienFormado(sucursalId) === null) return null;
  return {
    estado: estado,
    sucursalId:
      sucursalId === undefined ? undefined : (ordenIdBienFormado(sucursalId) ?? undefined),
  };
}

export async function ordenesDeLaLista(
  tx: Tx,
  contexto: Pick<ContextoOperativo, "empresaId">,
  alcance: AlcanceDeSucursales,
  filtro: Readonly<{ estado?: EstadoDeOrden | undefined; sucursalId?: SucursalId | undefined }>,
): Promise<readonly OrdenDeLista[]> {
  const ordenes = await tx.ordenesDeProduccion.listar(contexto.empresaId, {
    alcance,
    estado: filtro.estado,
    sucursalId: filtro.sucursalId,
    limite: TOPE_DE_ORDENES_DE_LA_LISTA,
  });
  const productos = await tx.productosParaStock.porIds(
    contexto.empresaId,
    ordenes.map((o) => o.productoId),
  );
  const productoDe = new Map(productos.map((p) => [p.id, p]));
  return ordenes.map((o) => ({
    ordenId: o.id,
    numero: o.numero,
    estado: o.estado,
    productoId: o.productoId,
    nombre: productoDe.get(o.productoId)?.nombre ?? o.productoId,
    cantidadEsperada: o.cantidadEsperada,
    cantidadObtenida: o.cantidadObtenida,
    unidadId: productoDe.get(o.productoId)?.unidadBaseId ?? "",
    depositoId: o.depositoId,
    depositoDestinoId: o.depositoDestinoId,
    abiertaEn: o.abiertaEn,
  }));
}

export async function fichaDeLaOrden(
  tx: Tx,
  contexto: Pick<ContextoOperativo, "empresaId">,
  orden: OrdenGuardada,
  conCostos: boolean,
): Promise<FichaDeOrden> {
  const empresa = contexto.empresaId;
  const producto = (await tx.productosParaStock.porIds(empresa, [orden.productoId]))[0];
  const sellada = await tx.composicionesDeStock.obtener(empresa, orden.composicionId);
  const vigente = await tx.composicionesDeStock.ultimaVersion(empresa, orden.productoId);
  if (sellada === null) throw new Error("producción: la receta sellada de una orden no existe");
  const renglones = await tx.ordenesDeProduccion.renglonesDe(empresa, orden.id);
  const insumos = await tx.articulosDeStock.porIds(
    empresa,
    renglones.map((r) => r.articuloId),
  );
  const insumoDe = new Map(insumos.map((a) => [a.id, a]));
  const productosDeInsumos = await tx.productosParaStock.porIds(
    empresa,
    insumos.map((a) => a.productoId),
  );
  const nombreDe = new Map(productosDeInsumos.map((p) => [p.id, p.nombre]));
  const lote = orden.loteId === null ? null : await tx.lotesDeStock.obtener(empresa, orden.loteId);
  let merma: string | null = null;
  if (orden.cantidadObtenida !== null) {
    const esperado = cantidadConSignoDesdeTexto(orden.cantidadEsperada);
    const obtenido = cantidadConSignoDesdeTexto(orden.cantidadObtenida);
    if (!esperado.ok || !obtenido.ok)
      throw new RangeError("producción: cantidad de la orden inválida");
    merma = formatearDecimalFijo(mermaDeLote(esperado.valor.unidades, obtenido.valor.unidades), 4);
  }
  return {
    ordenId: orden.id,
    numero: orden.numero,
    estado: orden.estado,
    productoId: orden.productoId,
    nombre: producto?.nombre ?? orden.productoId,
    unidadId: producto?.unidadBaseId ?? "",
    version: sellada.numero,
    recetaCambiada: vigente !== null && recetaCambiada(sellada.numero, vigente.numero),
    depositoId: orden.depositoId,
    depositoDestinoId: orden.depositoDestinoId,
    cantidadEsperada: orden.cantidadEsperada,
    cantidadObtenida: orden.cantidadObtenida,
    mermaDeLote: merma,
    vence: orden.vence,
    lote: lote === null ? null : { loteId: lote.id, codigo: lote.codigo },
    renglones: renglones.map((r) => {
      const insumo = insumoDe.get(r.articuloId);
      return {
        productoId: insumo?.productoId ?? r.articuloId,
        nombre: nombreDe.get(insumo?.productoId ?? "") ?? r.articuloId,
        esperado: r.cantidadEsperada,
        real: r.cantidadReal,
        unidadId: insumo?.unidadDeStockId ?? "",
      };
    }),
    movimientos: {
      consumoId: orden.movimientoDeConsumoId,
      productoId: orden.movimientoDeProductoId,
      anulacionDeConsumoId: orden.anulacionDeConsumoId,
      anulacionDeProductoId: orden.anulacionDeProductoId,
    },
    motivo: orden.motivo,
    abiertaEn: orden.abiertaEn,
    cerradaEn: orden.cerradaEn,
    fechaDeNegocio: orden.fechaDeNegocio,
    ...(conCostos
      ? { costo: { costoUnitario: orden.costoUnitario, costoEstado: orden.costoEstado } }
      : {}),
  };
}
