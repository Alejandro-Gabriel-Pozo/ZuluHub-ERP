import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadConSignoDesdeTexto } from "../../../primitivas/cantidad/con-signo";
import { formatearDecimalFijo } from "../../../primitivas/cantidad/decimal-fijo";
import { dividirRedondeando } from "../../../primitivas/cantidad/redondeo-entero";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { fechaDeNegocio } from "../../../primitivas/tiempo/fecha-de-negocio";
import { datosDeJornada } from "../../empresas/publico";
import { esDisponible } from "../dominio/disponibilidad";
import { DECIMALES_DE_CANTIDAD } from "../dominio/movimiento";
import {
  disponibleDeLotes,
  situacionDeVencimiento,
  type SituacionDeVencimiento,
} from "../dominio/vencimientos";
import type {
  ControlDeLote,
  MovimientoDeLote,
  SaldoDeLoteLeido,
} from "../persistencia/repositorio-de-lotes";
import type { TxDeStock } from "./contrato";

/**
 * Lo que leen las consultas y el puerto de existencias de los lotes (E6 §3.2 y §3.5, T7): la jornada de cada sucursal, lo DISPONIBLE por
 * (depósito, artículo) con la regla única del dominio, la lista de lotes de un artículo, los que vencen y la trazabilidad. Una consulta no
 * importa el dominio (ADR-005): las cuentas viven acá. Todo corre en la transacción del llamador.
 */
type Tx = Pick<
  TxDeStock,
  "lotesDeStock" | "articulosDeStock" | "productosParaStock" | "costosDeStock"
> &
  Readonly<{ sucursales: Pick<TxDeStock["sucursales"], "jornadaDe"> }>;

const aUnidades = (texto: string): bigint => BigInt(texto.replace(".", ""));
export const unidadesATexto = (unidades: bigint): string =>
  formatearDecimalFijo(unidades, DECIMALES_DE_CANTIDAD);

/** La fecha de negocio de hoy en cada sucursal (su zona y su hora de corte). Una sucursal sin datos de jornada no figura: nada se adivina. */
export async function jornadasDe(
  tx: Pick<Tx, "sucursales">,
  sucursales: Iterable<SucursalId>,
  ahora: Date,
): Promise<ReadonlyMap<string, string>> {
  const fechas = new Map<string, string>();
  for (const sucursal of new Set(sucursales)) {
    const datos = await datosDeJornada(tx, sucursal);
    if (!datos.ok) continue;
    const fecha = fechaDeNegocio(ahora, datos.valor.zonaHoraria, datos.valor.horaDeCorte);
    if (fecha.ok) fechas.set(sucursal, fecha.valor);
  }
  return fechas;
}

export type ParDeExistencia = Readonly<{
  depositoId: string;
  articuloId: string;
  /** Un depósito de cuarentena o de rechazo no suma a lo disponible (D118). */
  uso: "NORMAL" | "CUARENTENA" | "RECHAZO";
  /** Texto decimal exacto, con signo. */
  existencia: string;
}>;

/**
 * Lo disponible de cada par (depósito, artículo), en texto decimal: el depósito `NORMAL` y, si el artículo lleva control de lote ACTIVO, solo los
 * lotes disponibles (sin calidad o liberados, no vencidos en la jornada de la sucursal del depósito: `disponibleDeLotes`). Sin control, lo que
 * hay (puede ser negativo: lo muestra el libro tal cual) en un depósito `NORMAL`; fuera de `NORMAL`, cero. Es la misma regla que elige los
 * lotes de una venta.
 */
export async function disponibleDe(
  tx: Tx,
  contexto: Pick<ContextoOperativo, "empresaId" | "ahora">,
  pares: readonly ParDeExistencia[],
): Promise<ReadonlyMap<string, string>> {
  const clave = (p: Pick<ParDeExistencia, "depositoId" | "articuloId">) =>
    JSON.stringify([p.depositoId, p.articuloId]);
  const resultado = new Map<string, string>();
  const articulos = [...new Set(pares.map((p) => p.articuloId))];
  const controles = await tx.lotesDeStock.controlesDe(contexto.empresaId, articulos);
  const conLotes = articulos.filter((a) => controles.get(a)?.activo === true);
  const saldos =
    conLotes.length === 0
      ? []
      : await tx.lotesDeStock.saldosDeLote(contexto.empresaId, {
          alcance: "TODAS",
          articuloIds: conLotes,
        });
  const jornadas = await jornadasDe(
    tx,
    saldos.map((s) => s.sucursalId),
    contexto.ahora,
  );
  for (const par of pares) {
    if (par.uso !== "NORMAL") {
      resultado.set(clave(par), unidadesATexto(0n));
      continue;
    }
    if (!conLotes.includes(par.articuloId)) {
      resultado.set(clave(par), par.existencia);
      continue;
    }
    const delPar = saldos.filter(
      (s) => s.depositoId === par.depositoId && s.lote.articuloId === par.articuloId,
    );
    const lotes = delPar.map((s) => ({
      calidad: s.lote.calidad,
      vence: s.lote.fechaDeVencimiento,
      existencia: aUnidades(s.existencia),
      sucursalId: s.sucursalId,
    }));
    // Sin jornada de la sucursal no se sabe qué está vencido: no se muestra nada disponible (fail closed).
    const sucursal = delPar[0]?.sucursalId;
    const fecha = sucursal === undefined ? undefined : jornadas.get(sucursal);
    resultado.set(
      clave(par),
      unidadesATexto(
        lotes.length === 0 ? 0n : fecha === undefined ? 0n : disponibleDeLotes(lotes, fecha),
      ),
    );
  }
  return resultado;
}

export const claveDePar = (depositoId: string, articuloId: string): string =>
  JSON.stringify([depositoId, articuloId]);

// ---- la lista de lotes de un artículo -------------------------------------------------------------------------------------------

export type LoteDeLista = Readonly<{
  loteId: string;
  codigo: string;
  referenciaDeOrigen: string | null;
  fechaDeElaboracion: string | null;
  fechaDeVencimiento: string | null;
  /** `null`: el artículo no lleva calidad. */
  calidad: string | null;
  esSinAsignar: boolean;
  version: number;
  /** Texto decimal exacto: la suma de lo que el lote tiene en los depósitos que se ven (puede ser negativa solo el «sin asignar»). */
  existencia: string;
  /** Lo que se puede vender o usar ya: lotes liberados, no vencidos, en depósitos `NORMAL`; nunca negativo. */
  disponible: string;
  depositos: readonly Readonly<{ depositoId: string; existencia: string }>[];
}>;

export type LotesDeUnArticulo = Readonly<{
  articuloId: string;
  control: Readonly<{ modo: string; conCalidad: boolean; activo: boolean }> | null;
  lotes: readonly LoteDeLista[];
}>;

export async function lotesDelArticulo(
  tx: Tx,
  contexto: Pick<ContextoOperativo, "empresaId" | "ahora">,
  alcance: AlcanceDeSucursales,
  articuloId: string,
  depositoId: string | undefined,
): Promise<LotesDeUnArticulo> {
  const control: ControlDeLote | undefined = (
    await tx.lotesDeStock.controlesDe(contexto.empresaId, [articuloId])
  ).get(articuloId);
  const saldos = await tx.lotesDeStock.saldosDeLote(contexto.empresaId, {
    alcance,
    articuloIds: [articuloId],
    depositoId,
    conExistencia: true,
  });
  const jornadas = await jornadasDe(
    tx,
    saldos.map((s) => s.sucursalId),
    contexto.ahora,
  );
  const porLote = new Map<string, SaldoDeLoteLeido[]>();
  for (const s of saldos) porLote.set(s.lote.id, [...(porLote.get(s.lote.id) ?? []), s]);
  const lotes = [...porLote.values()].map((filas): LoteDeLista => {
    const lote = filas[0]?.lote;
    if (lote === undefined) throw new RangeError("stock: un lote sin filas");
    let existencia = 0n;
    let disponible = 0n;
    for (const f of filas) {
      const cantidad = aUnidades(f.existencia);
      existencia += cantidad;
      const fecha = jornadas.get(f.sucursalId);
      if (
        f.uso === "NORMAL" &&
        cantidad > 0n &&
        fecha !== undefined &&
        esDisponible({ calidad: lote.calidad, vence: lote.fechaDeVencimiento }, fecha)
      ) {
        disponible += cantidad;
      }
    }
    return {
      loteId: lote.id,
      codigo: lote.codigo,
      referenciaDeOrigen: lote.referenciaDeOrigen,
      fechaDeElaboracion: lote.fechaDeElaboracion,
      fechaDeVencimiento: lote.fechaDeVencimiento,
      calidad: lote.calidad,
      esSinAsignar: lote.esSinAsignar,
      version: lote.version,
      existencia: unidadesATexto(existencia),
      disponible: unidadesATexto(disponible),
      depositos: filas.map((f) => ({ depositoId: f.depositoId, existencia: f.existencia })),
    };
  });
  return {
    articuloId,
    control:
      control === undefined
        ? null
        : { modo: control.modo, conCalidad: control.conCalidad, activo: control.activo },
    lotes,
  };
}

// ---- vencimientos ---------------------------------------------------------------------------------------------------------------

export type LoteQueVence = Readonly<{
  loteId: string;
  articuloId: string;
  productoId: string;
  nombre: string;
  codigo: string;
  depositoId: string;
  sucursalId: SucursalId;
  /** `AAAA-MM-DD`. */
  vence: string;
  /** Texto decimal exacto, en la unidad de stock. */
  existencia: string;
  unidadId: string;
  situacion: SituacionDeVencimiento;
  /** Solo en los vencidos y solo con `costos.ver`: existencia × promedio vigente (`null` = sin costo, nunca cero). Texto con 6 decimales. */
  seLosPierde?: string | null | undefined;
}>;

/**
 * Los lotes con existencia que vencen dentro de `dias` jornadas o ya vencieron (se pierden), con la situación de cada uno en la jornada de la
 * sucursal de su depósito. Solo lo que tiene existencia positiva. Orden: vence antes primero.
 */
export async function lotesQueVencen(
  tx: Tx,
  contexto: Pick<ContextoOperativo, "empresaId" | "ahora">,
  alcance: AlcanceDeSucursales,
  filtro: Readonly<{ sucursalId?: SucursalId | undefined; dias: number; conCostos: boolean }>,
): Promise<readonly LoteQueVence[]> {
  const saldos = (
    await tx.lotesDeStock.saldosDeLote(contexto.empresaId, {
      alcance,
      sucursalId: filtro.sucursalId,
      conExistencia: true,
    })
  ).filter((s) => s.lote.fechaDeVencimiento !== null && aUnidades(s.existencia) > 0n);
  if (saldos.length === 0) return [];
  const jornadas = await jornadasDe(
    tx,
    saldos.map((s) => s.sucursalId),
    contexto.ahora,
  );
  const articulos = await tx.articulosDeStock.porIds(contexto.empresaId, [
    ...new Set(saldos.map((s) => s.lote.articuloId)),
  ]);
  const articuloDe = new Map(articulos.map((a) => [a.id, a]));
  const productos = await tx.productosParaStock.porIds(
    contexto.empresaId,
    articulos.map((a) => a.productoId),
  );
  const productoDe = new Map(productos.map((p) => [p.id, p]));
  const promedios = filtro.conCostos
    ? await tx.costosDeStock.promediosEnDepositosDeVenta(
        contexto.empresaId,
        alcance,
        articulos.map((a) => a.id),
      )
    : new Map<string, string>();
  const salida: LoteQueVence[] = [];
  for (const s of saldos) {
    const vence = s.lote.fechaDeVencimiento;
    const fecha = jornadas.get(s.sucursalId);
    if (vence === null || fecha === undefined) continue;
    const situacion = situacionDeVencimiento(vence, fecha, filtro.dias);
    if (situacion === null) continue;
    const articulo = articuloDe.get(s.lote.articuloId);
    const producto = articulo === undefined ? undefined : productoDe.get(articulo.productoId);
    if (articulo === undefined || producto === undefined) continue;
    const base = {
      loteId: s.lote.id,
      articuloId: articulo.id,
      productoId: producto.id,
      nombre: producto.nombre,
      codigo: s.lote.codigo,
      depositoId: s.depositoId,
      sucursalId: s.sucursalId,
      vence,
      existencia: s.existencia,
      unidadId: articulo.unidadDeStockId,
      situacion,
    };
    if (situacion.tipo !== "VENCIDO" || !filtro.conCostos) {
      salida.push(base);
      continue;
    }
    const costo = promedios.get(articulo.id);
    salida.push({
      ...base,
      seLosPierde: costo === undefined ? null : importeDePerdida(costo, s.existencia),
    });
  }
  return salida.sort((a, b) =>
    a.vence < b.vence ? -1 : a.vence > b.vence ? 1 : a.loteId < b.loteId ? -1 : 1,
  );
}

/** existencia × costo, exacto (10⁻⁴ × 10⁻⁶ = 10⁻¹⁰) y redondeado UNA vez a 6 decimales con la política vigente; ambas cosas son texto decimal. */
function importeDePerdida(costoUnitario: string, existencia: string): string {
  const producto = aUnidades(existencia) * aUnidades(costoUnitario);
  return formatearDecimalFijo(dividirRedondeando(producto, 10_000n, POLITICA_VIGENTE), 6);
}

// ---- trazabilidad ---------------------------------------------------------------------------------------------------------------

export type TrazabilidadDeLote = Readonly<{
  loteId: string;
  articuloId: string;
  codigo: string;
  /** Hacia atrás: lo que lo ingresó (recepción, orden, ajuste). */
  ingresos: readonly MovimientoDeLote[];
  /** Hacia adelante: lo que salió (ticket, orden, baja). */
  salidas: readonly MovimientoDeLote[];
}>;

/** Cuántos movimientos del lote se leen (el más nuevo primero): el tope evita traer un historial sin fin. */
export const TOPE_DE_MOVIMIENTOS_DE_TRAZABILIDAD = 500;

export async function trazabilidadDe(
  tx: Pick<TxDeStock, "lotesDeStock">,
  contexto: Pick<ContextoOperativo, "empresaId">,
  alcance: AlcanceDeSucursales,
  loteId: string,
): Promise<TrazabilidadDeLote | null> {
  const lote = await tx.lotesDeStock.obtener(contexto.empresaId, loteId);
  if (lote === null) return null;
  const movimientos = await tx.lotesDeStock.movimientosDelLote(
    contexto.empresaId,
    alcance,
    lote.id,
    TOPE_DE_MOVIMIENTOS_DE_TRAZABILIDAD,
  );
  const signo = (m: MovimientoDeLote) => {
    const c = cantidadConSignoDesdeTexto(m.cantidad);
    if (!c.ok) throw new RangeError("stock: una cantidad de lote guardada no es válida");
    return c.valor.unidades;
  };
  return {
    loteId: lote.id,
    articuloId: lote.articuloId,
    codigo: lote.codigo,
    ingresos: movimientos.filter((m) => signo(m) > 0n),
    salidas: movimientos.filter((m) => signo(m) < 0n),
  };
}
