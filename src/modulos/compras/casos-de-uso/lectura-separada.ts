import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import { crearDirectorioDePartes } from "../../clientes/publico";
import { esUuid } from "../dominio/identificadores";
import {
  estadoDeFacturaSeparada,
  estadoDeRecepcionSeparada,
  type EstadoDeFacturaSeparada,
  type EstadoDeRecepcionSeparada,
} from "../dominio/recepcion-separada";
import type { Recepcion } from "../persistencia/repositorio-de-recepciones";
import type { FiltroDeListaSeparada } from "../persistencia/repositorio-de-lecturas-separadas";
import type { TxDeConsultasDeCompras } from "./contrato";
import { fechaOpcional, TAMANO_DE_PAGINA } from "./lectura";

/**
 * La forma del cursor de las listas de recepción separada: `AAAA-MM-DD|<uuid>` (la fecha de negocio y el id de la última fila). Es DISTINTA de la de la lista de compras de N1 y N2 (`FORMA_DEL_CURSOR` de `lectura.ts`,
 * con un número de recepción): usar esa acá dejaba sin leer el cursor que esta misma lista entrega y la segunda página nunca abría. Una sola regla: `siguienteDe` la produce y `leerFiltro` la lee.
 */
export const FORMA_DEL_CURSOR_SEPARADO = /^(\d{4}-\d{2}-\d{2})\|([0-9a-fA-F-]{36})$/;

/**
 * Lo que leen las pantallas de N3 y N4 (E9 §3.10): las recepciones con su estado derivado (pendiente de confirmar, sin facturar, facturada en parte, facturada, anulada) y las
 * facturas con el suyo (falta recibir, falta conciliar, conciliada en parte, conciliada, anulada). Vive acá porque decide con el dominio. Todo filtra por la empresa del contexto; las recepciones,
 * además, por el alcance de sucursales de quien pide. Las compras de N1 y N2 salen en `listarCompras`, no acá.
 */

const directorio = crearDirectorioDePartes();

export type EntradaDeListarSeparadas = Readonly<{
  sucursalId?: string | undefined;
  proveedorId?: string | undefined;
  /** Fechas de negocio `YYYY-MM-DD`, inclusive. */
  desde?: string | undefined;
  hasta?: string | undefined;
  /** El `siguiente` de la página anterior. */
  despuesDe?: string | undefined;
}>;

export type RecepcionSeparadaDeLista = Readonly<{
  recepcionId: string;
  numero: number;
  sucursalId: string;
  proveedorId: string;
  /** El nombre del proveedor; `null` si no se puede mostrar (parte anonimizada). */
  proveedorNombre: string | null;
  fechaNegocio: string;
  remito: Recepcion["remito"];
  estado: EstadoDeRecepcionSeparada;
}>;

export type FacturaSeparadaDeLista = Readonly<{
  comprobanteId: string;
  proveedorId: string;
  /** El nombre del proveedor; `null` si no se puede mostrar (parte anonimizada). */
  proveedorNombre: string | null;
  tipo: string | null;
  puntoDeVenta: number | null;
  numero: number | null;
  fechaNegocio: string;
  totalSegunFactura: string;
  estado: EstadoDeFacturaSeparada;
}>;

export type PaginaDe<T> = Readonly<{ filas: readonly T[]; siguiente: string | null }>;

type RLectura<S> = Resultado<
  S,
  "CURSOR_INVALIDO" | "IDENTIFICADOR_INVALIDO" | "SUCURSAL_FUERA_DE_ALCANCE"
>;

async function leerFiltro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeListarSeparadas,
): Promise<RLectura<FiltroDeListaSeparada>> {
  const desde = fechaOpcional(entrada.desde);
  const hasta = fechaOpcional(entrada.hasta);
  if (desde === undefined || hasta === undefined) return err("IDENTIFICADOR_INVALIDO");
  for (const id of [entrada.sucursalId, entrada.proveedorId]) {
    if (id !== undefined && !esUuid(id)) return err("IDENTIFICADOR_INVALIDO");
  }
  let despuesDe: FiltroDeListaSeparada["despuesDe"] = null;
  if (entrada.despuesDe !== undefined) {
    const partes = FORMA_DEL_CURSOR_SEPARADO.exec(entrada.despuesDe);
    if (
      partes === null ||
      !esUuid(partes[2] as string) ||
      !fechaCivilDesdeTexto(partes[1] as string).ok
    ) {
      return err("CURSOR_INVALIDO");
    }
    despuesDe = { fechaNegocio: partes[1] as string, id: partes[2] as string };
  }
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  let sucursales: FiltroDeListaSeparada["sucursales"] = alcance;
  if (entrada.sucursalId !== undefined) {
    if (alcance !== "TODAS" && !alcance.some((s) => s === entrada.sucursalId)) {
      return err("SUCURSAL_FUERA_DE_ALCANCE");
    }
    sucursales = [entrada.sucursalId];
  }
  return ok({
    sucursales,
    proveedorId: entrada.proveedorId ?? null,
    desde,
    hasta,
    despuesDe,
    limite: TAMANO_DE_PAGINA + 1,
  });
}

const siguienteDe = <T extends { fechaNegocio: string; id: string }>(
  filas: readonly T[],
): string | null => {
  const ultima = filas.slice(0, TAMANO_DE_PAGINA).at(-1);
  return filas.length > TAMANO_DE_PAGINA && ultima !== undefined
    ? `${ultima.fechaNegocio}|${ultima.id}`
    : null;
};

export async function listarRecepcionesSeparadasDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeListarSeparadas,
): Promise<RLectura<PaginaDe<RecepcionSeparadaDeLista>>> {
  const filtro = await leerFiltro(tx, contexto, entrada);
  if (!filtro.ok) return filtro;
  const filas = await tx.lecturasSeparadas.recepciones(contexto.empresaId, filtro.valor);
  const pagina = filas.slice(0, TAMANO_DE_PAGINA);
  const nombres = await directorio.nombresParaMostrar(tx, contexto.empresaId, [
    ...new Set(pagina.map((f) => f.proveedorId)),
  ]);
  return ok({
    filas: pagina.map((f) => ({
      recepcionId: f.id,
      numero: f.numero,
      sucursalId: f.sucursalId,
      proveedorId: f.proveedorId,
      proveedorNombre: nombres.get(f.proveedorId) ?? null,
      fechaNegocio: f.fechaNegocio,
      remito: f.remito,
      estado: estadoDeRecepcionSeparada(f.estado, f.recibida, f.asignada),
    })),
    siguiente: siguienteDe(filas),
  });
}

export async function listarFacturasSeparadasDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeListarSeparadas,
): Promise<RLectura<PaginaDe<FacturaSeparadaDeLista>>> {
  const filtro = await leerFiltro(tx, contexto, entrada);
  if (!filtro.ok) return filtro;
  const filas = await tx.lecturasSeparadas.facturas(contexto.empresaId, filtro.valor);
  const pagina = filas.slice(0, TAMANO_DE_PAGINA);
  const nombres = await directorio.nombresParaMostrar(tx, contexto.empresaId, [
    ...new Set(pagina.map((f) => f.proveedorId)),
  ]);
  return ok({
    filas: pagina.map((f) => ({
      comprobanteId: f.id,
      proveedorId: f.proveedorId,
      proveedorNombre: nombres.get(f.proveedorId) ?? null,
      tipo: f.tipo,
      puntoDeVenta: f.puntoDeVenta,
      numero: f.numero,
      fechaNegocio: f.fechaNegocio,
      totalSegunFactura: f.totalSegunFactura,
      estado: estadoDeFacturaSeparada(f.estado, f.facturada, f.asignada, f.haySinConciliar),
    })),
    siguiente: siguienteDe(filas),
  });
}

export type FichaDeRecepcionSeparada = Readonly<{
  recepcionId: string;
  numero: number;
  sucursalId: string;
  proveedorId: string;
  proveedorNombre: string | null;
  fechaNegocio: string;
  remito: Recepcion["remito"];
  estado: EstadoDeRecepcionSeparada;
  /** Solo si está anulada: el motivo que escribió quien la anuló. */
  motivoDeAnulacion: string | null;
  lineas: readonly Readonly<{
    numero: number;
    productoNombre: string | null;
    /** Cantidad como se compró (la unidad de compra) y lo que entra al stock (la unidad base del producto). */
    cantidadDeCompra: string;
    unidadDeCompraId: string;
    cantidadEnStock: string;
    unidadDeStockId: string | null;
  }>[];
}>;

/**
 * La ficha de una recepción de recepción separada (N3 y N4): su estado derivado, el remito y las líneas con lo que se recibió, SIN precios ni costos (la recepción separada no los pide: el costo se completa
 * al tomarlo de la factura). Es una LECTURA. `null` si no existe, es de otra empresa, no es de recepción separada o es de una sucursal fuera del alcance de quien pide (indistinguible). Pide `recepciones.ver`
 * en la consulta que la envuelve. La pantalla de una compra de N1 y N2 sigue siendo `fichaDeCompra`.
 */
export async function fichaDeRecepcionSeparadaDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ recepcionId: string }>,
): Promise<Resultado<FichaDeRecepcionSeparada | null, "IDENTIFICADOR_INVALIDO">> {
  if (!esUuid(entrada.recepcionId)) return err("IDENTIFICADOR_INVALIDO");
  const recepcion = await tx.recepcionesSeparadas.obtenerSeparada(
    contexto.empresaId,
    entrada.recepcionId,
  );
  if (recepcion === null) return ok(null);
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  if (alcance !== "TODAS" && !alcance.some((s) => s === recepcion.sucursalId)) return ok(null);
  const [fila] = await tx.lecturasSeparadas.recepciones(contexto.empresaId, {
    sucursales: "TODAS",
    proveedorId: null,
    recepcionId: recepcion.id,
    desde: null,
    hasta: null,
    despuesDe: null,
    limite: 1,
  });
  if (fila === undefined) return ok(null);
  const lineas = await tx.recepciones.lineasDe(contexto.empresaId, recepcion.id);
  const productos = new Map(
    (
      await tx.productosParaCompras.deVarios(
        contexto.empresaId,
        lineas.map((l) => l.productoId),
      )
    ).map((p) => [p.id, p]),
  );
  const nombres = await directorio.nombresParaMostrar(tx, contexto.empresaId, [
    recepcion.proveedorId,
  ]);
  return ok({
    recepcionId: recepcion.id,
    numero: recepcion.numero,
    sucursalId: recepcion.sucursalId,
    proveedorId: recepcion.proveedorId,
    proveedorNombre: nombres.get(recepcion.proveedorId) ?? null,
    fechaNegocio: recepcion.fechaNegocio,
    remito: recepcion.remito,
    estado: estadoDeRecepcionSeparada(fila.estado, fila.recibida, fila.asignada),
    motivoDeAnulacion: recepcion.estado === "ANULADA" ? recepcion.motivoDeAnulacion : null,
    lineas: lineas.map((l) => ({
      numero: l.numero,
      productoNombre: productos.get(l.productoId)?.nombre ?? null,
      cantidadDeCompra: l.cantidadDeCompra,
      unidadDeCompraId: l.unidadDeCompraId,
      cantidadEnStock: l.cantidadEnStock,
      unidadDeStockId: productos.get(l.productoId)?.unidadBaseId ?? null,
    })),
  });
}
