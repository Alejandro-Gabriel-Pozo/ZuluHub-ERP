import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../dominio/identificadores";
import type { EstadoDeComprobante } from "../persistencia/repositorio-de-comprobantes";
import type { FiltroDeListaDeNotas } from "../persistencia/repositorio-de-notas-de-credito";
import type { TxDeConsultasDeCompras } from "./contrato";
import { TAMANO_DE_PAGINA } from "./lectura";

/**
 * Lo que leen las pantallas de notas de crédito del proveedor (N4, E9 §3.10): la lista con su estado y el detalle con sus importes por alícuota y lo acreditado de la factura que corrige.
 * Todo filtra por la empresa del contexto; la nota no tiene sucursal: la ve quien tiene alcance sobre alguna (el alcance vacío no ve nada), como una factura.
 */

export type EntradaDeListarNotasDeCredito = Readonly<{
  facturaId?: string | undefined;
  proveedorId?: string | undefined;
  estado?: string | undefined;
  /** El `siguiente` de la página anterior. */
  despuesDe?: string | undefined;
}>;

export type NotaDeLista = Readonly<{
  comprobanteId: string;
  proveedorId: string;
  /** La factura que corrige. */
  facturaId: string;
  tipo: string;
  puntoDeVenta: number;
  numero: number;
  fechaNegocio: string;
  /** Lo que dice el papel de la nota. */
  total: string;
  estado: EstadoDeComprobante;
}>;

export type PaginaDeNotasDeCredito = Readonly<{
  filas: readonly NotaDeLista[];
  siguiente: string | null;
}>;

export type NotaDeDetalle = Readonly<{
  comprobanteId: string;
  proveedorId: string;
  facturaId: string;
  tipo: string;
  puntoDeVenta: number;
  numero: number;
  fechaDelComprobante: string;
  fechaNegocio: string;
  netoGravado: string;
  noGravado: string;
  exento: string;
  iva: string;
  totalCalculado: string;
  /** Lo que dice el papel de la nota. */
  totalSegunNota: string;
  estado: EstadoDeComprobante;
  anuladoEn: Date | null;
  motivoDeAnulacion: string | null;
  importes: readonly Readonly<{ alicuota: string; neto: string; iva: string }>[];
  /** El total de la factura que corrige y lo que acreditan todas sus notas vigentes (esta incluida si está vigente). */
  totalDeLaFactura: string;
  acreditadoDeLaFactura: string;
}>;

type RLectura<S> = Resultado<S, "CURSOR_INVALIDO" | "IDENTIFICADOR_INVALIDO">;

/** `fecha_negocio` (fecha civil) y el id, separados por `|`. */
const FORMA_DEL_CURSOR_DE_NOTAS = /^(\d{4}-\d{2}-\d{2})\|([0-9a-f-]{36})$/;

const ESTADOS: readonly string[] = [
  "REGISTRADO",
  "ANULADO",
] satisfies readonly EstadoDeComprobante[];
const esEstado = (texto: string): texto is EstadoDeComprobante => ESTADOS.includes(texto);

export async function listarNotasDeCreditoDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeListarNotasDeCredito,
): Promise<RLectura<PaginaDeNotasDeCredito>> {
  for (const id of [entrada.facturaId, entrada.proveedorId]) {
    if (id !== undefined && !esUuid(id)) return err("IDENTIFICADOR_INVALIDO");
  }
  if (entrada.estado !== undefined && !esEstado(entrada.estado)) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  let despuesDe: FiltroDeListaDeNotas["despuesDe"] = null;
  if (entrada.despuesDe !== undefined) {
    const partes = FORMA_DEL_CURSOR_DE_NOTAS.exec(entrada.despuesDe);
    if (partes === null || !esUuid(partes[2] as string)) return err("CURSOR_INVALIDO");
    despuesDe = { fechaNegocio: partes[1] as string, id: partes[2] as string };
  }
  const filas = await tx.notasDeCredito.listar(contexto.empresaId, {
    sucursales: await tx.autorizacion.sucursalesDelActor(contexto),
    facturaId: entrada.facturaId ?? null,
    proveedorId: entrada.proveedorId ?? null,
    estado: entrada.estado ?? null,
    despuesDe,
    limite: TAMANO_DE_PAGINA + 1,
  });
  const ultima = filas.slice(0, TAMANO_DE_PAGINA).at(-1);
  return ok({
    filas: filas.slice(0, TAMANO_DE_PAGINA).map((f) => ({
      comprobanteId: f.id,
      proveedorId: f.proveedorId,
      facturaId: f.facturaId,
      tipo: f.tipo,
      puntoDeVenta: f.puntoDeVenta,
      numero: f.numero,
      fechaNegocio: f.fechaNegocio,
      total: f.total,
      estado: f.estado,
    })),
    siguiente:
      filas.length > TAMANO_DE_PAGINA && ultima !== undefined
        ? `${ultima.fechaNegocio}|${ultima.id}`
        : null,
  });
}

/** El detalle de una nota; `null` si no existe, es de otra empresa, no es una nota o quien pide no tiene alcance sobre ninguna sucursal (indistinguibles). */
export async function obtenerNotaDeCreditoDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ comprobanteId: string }>,
): Promise<NotaDeDetalle | null> {
  const { empresaId } = contexto;
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  if (alcance !== "TODAS" && alcance.length === 0) return null;
  const nota = await tx.comprobantesDeProveedor.obtener(empresaId, entrada.comprobanteId);
  if (
    nota === null ||
    nota.clase !== "NOTA_DE_CREDITO" ||
    nota.comprobanteAsociadoId === null ||
    nota.tipo === null ||
    nota.puntoDeVenta === null ||
    nota.numero === null ||
    nota.fechaDelComprobante === null
  ) {
    return null;
  }
  const factura = await tx.comprobantesDeProveedor.obtener(empresaId, nota.comprobanteAsociadoId);
  if (factura === null) throw new Error("la nota de crédito guardada no tiene su factura");
  const importes = await tx.detalleDeComprobantes.importesDe(empresaId, nota.id);
  return {
    comprobanteId: nota.id,
    proveedorId: nota.proveedorId,
    facturaId: factura.id,
    tipo: nota.tipo,
    puntoDeVenta: nota.puntoDeVenta,
    numero: nota.numero,
    fechaDelComprobante: nota.fechaDelComprobante,
    fechaNegocio: nota.fechaNegocio,
    netoGravado: nota.netoGravado,
    noGravado: nota.noGravado,
    exento: nota.exento,
    iva: nota.iva,
    totalCalculado: nota.totalCalculado,
    totalSegunNota: nota.totalSegunFactura,
    estado: nota.estado,
    anuladoEn: nota.anuladoEn,
    motivoDeAnulacion: nota.motivoDeAnulacion,
    importes: importes.map((i) => ({ alicuota: i.alicuota, neto: i.neto, iva: i.iva })),
    totalDeLaFactura: factura.totalSegunFactura,
    acreditadoDeLaFactura: await tx.notasDeCredito.acreditadoDe(empresaId, factura.id),
  };
}
