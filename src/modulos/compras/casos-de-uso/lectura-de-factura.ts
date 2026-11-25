import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { crearDirectorioDePartes } from "../../clientes/publico";
import { pendienteDeLinea } from "../dominio/conciliacion-separada";
import { leerCantidad, textoDeCantidad } from "../dominio/decimal";
import { esUuid } from "../dominio/identificadores";
import {
  esNivelDeRecepcionSeparada,
  estadoDeFacturaSeparada,
  type EstadoDeFacturaSeparada,
} from "../dominio/recepcion-separada";
import type { TxDeConsultasDeCompras } from "./contrato";

const directorio = crearDirectorioDePartes();

/** Lo recibido (CONFIRMADO, de una sucursal del alcance de quien mira) de un producto de la factura, por sucursal, y cuánto de eso falta repartir. */
export type RecibidoPorSucursal = Readonly<{
  sucursalId: string;
  recibida: string;
  /** Lo recibido menos lo ya asignado a alguna factura (decimal de 4). */
  sinConciliar: string;
}>;

export type LineaDeFacturaSeparada = Readonly<{
  numero: number;
  productoId: string | null;
  productoNombre: string | null;
  unidadDeStockId: string | null;
  facturada: string;
  /** Lo ya conciliado de esta línea (decimal de 4). */
  conciliada: string;
  recibidoPorSucursal: readonly RecibidoPorSucursal[];
}>;

export type ConciliacionDeFactura = Readonly<{
  conciliacionId: string;
  fechaNegocio: string;
  anulada: boolean;
  /** `true` si quien mira tiene alcance sobre TODAS las sucursales que repartió: solo entonces puede anularla (anular exige el alcance de cada una). */
  anulableEnAlcance: boolean;
  asignaciones: readonly Readonly<{
    lineaDeFactura: number;
    recepcionNumero: number;
    sucursalId: string;
    lineaDeRecepcion: number;
    cantidad: string;
  }>[];
}>;

export type FichaDeFacturaSeparada = Readonly<{
  comprobanteId: string;
  proveedorId: string;
  proveedorNombre: string | null;
  tipo: string | null;
  puntoDeVenta: number | null;
  numero: number | null;
  fechaNegocio: string;
  totalSegunFactura: string;
  estado: EstadoDeFacturaSeparada;
  lineas: readonly LineaDeFacturaSeparada[];
}>;

/**
 * El detalle de una factura de N3 o N4 (Compras 4, F6): por línea lo **facturado**, lo **conciliado** y lo **recibido por sucursal** (solo lo CONFIRMADO, y solo de las sucursales del alcance de quien mira: cada gerente ve
 * lo suyo), que responde «qué falta recibir» y «qué falta conciliar». Es una LECTURA (pide `comprobantes_de_proveedor.ver` en la consulta que la envuelve; las conciliaciones hechas son otra consulta, `conciliacionesDeFactura`,
 * `null` si no existe, es de otra empresa o no es de N3 o N4 (indistinguible); alcance vacío no ve nada.
 */
export async function fichaDeFacturaSeparadaDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ comprobanteId: string }>,
): Promise<Resultado<FichaDeFacturaSeparada | null, "IDENTIFICADOR_INVALIDO">> {
  if (!esUuid(entrada.comprobanteId)) return err("IDENTIFICADOR_INVALIDO");
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  const [fila] = await tx.lecturasSeparadas.facturas(contexto.empresaId, {
    sucursales: alcance,
    proveedorId: null,
    comprobanteId: entrada.comprobanteId,
    desde: null,
    hasta: null,
    despuesDe: null,
    limite: 1,
  });
  if (fila === undefined) return ok(null);
  const comprobante = await tx.comprobantesDeProveedor.obtener(contexto.empresaId, fila.id);
  if (comprobante === null || !esNivelDeRecepcionSeparada(comprobante.nivel)) return ok(null);

  const lineas = await tx.detalleDeComprobantes.lineasDe(contexto.empresaId, fila.id);
  const saldos = await tx.conciliacionesDeCompra.saldosDeFactura(contexto.empresaId, fila.id);
  const recibidas = await tx.recepcionesSeparadas.lineasConciliables(
    contexto.empresaId,
    fila.proveedorId,
    alcance,
  );
  const productos = new Map(
    (
      await tx.productosParaCompras.deVarios(contexto.empresaId, [
        ...new Set(
          lineas.flatMap((l) =>
            l.productoId === null || l.productoId === undefined ? [] : [l.productoId],
          ),
        ),
      ])
    ).map((p) => [p.id, p]),
  );
  const nombres = await directorio.nombresParaMostrar(tx, contexto.empresaId, [fila.proveedorId]);

  const deLaFactura: LineaDeFacturaSeparada[] = lineas.map((l) => {
    const producto =
      l.productoId === null || l.productoId === undefined ? undefined : productos.get(l.productoId);
    const porSucursal = new Map<string, { recibida: bigint; asignada: bigint }>();
    for (const r of recibidas) {
      if (r.productoId !== l.productoId) continue;
      const acumulada = porSucursal.get(r.sucursalId) ?? { recibida: 0n, asignada: 0n };
      porSucursal.set(r.sucursalId, {
        recibida: acumulada.recibida + (leerCantidad(r.recibida) ?? 0n),
        asignada: acumulada.asignada + (leerCantidad(r.asignada) ?? 0n),
      });
    }
    const saldo = saldos.find((s) => s.linea === l.numero);
    return {
      numero: l.numero,
      productoId: l.productoId ?? null,
      productoNombre: producto?.nombre ?? null,
      unidadDeStockId: producto?.unidadBaseId ?? null,
      facturada: saldo?.facturada ?? l.cantidadFacturada,
      conciliada: saldo?.asignada ?? "0.0000",
      recibidoPorSucursal: [...porSucursal.entries()].map(([sucursalId, v]) => ({
        sucursalId,
        recibida: textoDeCantidad(v.recibida),
        sinConciliar:
          pendienteDeLinea(textoDeCantidad(v.recibida), textoDeCantidad(v.asignada)) ?? "0.0000",
      })),
    };
  });

  return ok({
    comprobanteId: fila.id,
    proveedorId: fila.proveedorId,
    proveedorNombre: nombres.get(fila.proveedorId) ?? null,
    tipo: fila.tipo,
    puntoDeVenta: fila.puntoDeVenta,
    numero: fila.numero,
    fechaNegocio: fila.fechaNegocio,
    totalSegunFactura: fila.totalSegunFactura,
    estado: estadoDeFacturaSeparada(
      fila.estado,
      fila.facturada,
      fila.asignada,
      fila.haySinConciliar,
    ),
    lineas: deLaFactura,
  });
}

/**
 * Las conciliaciones hechas de una factura de N3 o N4 (Compras 4, F6), con lo que repartió cada una, la más vieja primero. Es una LECTURA aparte con su propia acción (`conciliaciones.ver` en la consulta que la envuelve: el operador
 * no la tiene y no ve conciliaciones). **Solo las que repartieron alguna sucursal del alcance de quien mira**, y de cada una solo lo de esas sucursales (cada gerente ve y corrige lo de su sucursal); `anulableEnAlcance` dice si
 * quien mira tiene alcance sobre TODAS las que repartió (solo entonces `anularConciliacion` la deja anular). `null` si la factura no existe, es de otra empresa o no es de N3 o N4 (indistinguible).
 */
export async function conciliacionesDeFacturaDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ comprobanteId: string }>,
): Promise<Resultado<readonly ConciliacionDeFactura[] | null, "IDENTIFICADOR_INVALIDO">> {
  if (!esUuid(entrada.comprobanteId)) return err("IDENTIFICADOR_INVALIDO");
  const comprobante = await tx.comprobantesDeProveedor.obtener(
    contexto.empresaId,
    entrada.comprobanteId,
  );
  if (
    comprobante === null ||
    comprobante.clase !== "FACTURA" ||
    comprobante.esAtajo ||
    !esNivelDeRecepcionSeparada(comprobante.nivel)
  ) {
    return ok(null);
  }
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  const historial = await tx.conciliacionesDeCompra.historialDe(contexto.empresaId, comprobante.id);
  const enAlcance = (sucursalId: string): boolean =>
    alcance === "TODAS" || alcance.some((s) => s === sucursalId);
  return ok(
    historial
      .filter((c) => c.asignaciones.some((a) => enAlcance(a.sucursalId)))
      .map((c) => ({
        conciliacionId: c.id,
        fechaNegocio: c.fechaNegocio,
        anulada: c.anulada,
        anulableEnAlcance: c.asignaciones.every((a) => enAlcance(a.sucursalId)),
        asignaciones: c.asignaciones
          .filter((a) => enAlcance(a.sucursalId))
          .map((a) => ({
            lineaDeFactura: a.lineaDeComprobante,
            recepcionNumero: a.recepcionNumero,
            sucursalId: a.sucursalId,
            lineaDeRecepcion: a.lineaDeRecepcion,
            cantidad: a.cantidad,
          })),
      })),
  );
}
