import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
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
import { fechaOpcional, FORMA_DEL_CURSOR, TAMANO_DE_PAGINA } from "./lectura";

/**
 * Lo que leen las pantallas de N3 y N4 (E9 §3.10): las recepciones con su estado derivado (pendiente de confirmar, sin facturar, facturada en parte, facturada, anulada) y las
 * facturas con el suyo (falta recibir, conciliada en parte, conciliada, anulada). Vive acá porque decide con el dominio. Todo filtra por la empresa del contexto; las recepciones,
 * además, por el alcance de sucursales de quien pide. Las compras de N1 y N2 salen en `listarCompras`, no acá.
 */

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
  fechaNegocio: string;
  remito: Recepcion["remito"];
  estado: EstadoDeRecepcionSeparada;
}>;

export type FacturaSeparadaDeLista = Readonly<{
  comprobanteId: string;
  proveedorId: string;
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
    const partes = FORMA_DEL_CURSOR.exec(entrada.despuesDe);
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
  return ok({
    filas: filas.slice(0, TAMANO_DE_PAGINA).map((f) => ({
      recepcionId: f.id,
      numero: f.numero,
      sucursalId: f.sucursalId,
      proveedorId: f.proveedorId,
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
  return ok({
    filas: filas.slice(0, TAMANO_DE_PAGINA).map((f) => ({
      comprobanteId: f.id,
      proveedorId: f.proveedorId,
      tipo: f.tipo,
      puntoDeVenta: f.puntoDeVenta,
      numero: f.numero,
      fechaNegocio: f.fechaNegocio,
      totalSegunFactura: f.totalSegunFactura,
      estado: estadoDeFacturaSeparada(f.estado, f.facturada, f.asignada),
    })),
    siguiente: siguienteDe(filas),
  });
}
