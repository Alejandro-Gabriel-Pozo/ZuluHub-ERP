import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../dominio/identificadores";
import type { EstadoDeComprobante } from "../persistencia/repositorio-de-comprobantes";
import { leerImporte, textoDeImporte } from "../dominio/decimal";
import type {
  ClaseDeNotaListable,
  FilaDeListaDeNotas,
  FiltroDeListaDeNotas,
} from "../persistencia/repositorio-de-notas-de-credito";
import { netoAPagar } from "../dominio/pago";
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
  /** La factura que corrige (la nota de crédito siempre) o que vincula (la de débito, si la tiene). */
  facturaId: string | null;
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
  facturaId: string | null;
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
  /** El total de la factura que corrige o vincula y lo que acreditan todas sus notas de crédito vigentes (esta incluida si está vigente); `null` en una nota de débito sin factura. */
  totalDeLaFactura: string | null;
  acreditadoDeLaFactura: string | null;
}>;

type RLectura<S> = Resultado<S, "CURSOR_INVALIDO" | "IDENTIFICADOR_INVALIDO">;

/** `fecha_negocio` (fecha civil) y el id, separados por `|`. */
const FORMA_DEL_CURSOR_DE_NOTAS = /^(\d{4}-\d{2}-\d{2})\|([0-9a-f-]{36})$/;

const ESTADOS: readonly string[] = [
  "REGISTRADO",
  "ANULADO",
] satisfies readonly EstadoDeComprobante[];
const esEstado = (texto: string): texto is EstadoDeComprobante => ESTADOS.includes(texto);

const enLista = (f: FilaDeListaDeNotas): NotaDeLista => ({
  comprobanteId: f.id,
  proveedorId: f.proveedorId,
  facturaId: f.facturaId,
  tipo: f.tipo,
  puntoDeVenta: f.puntoDeVenta,
  numero: f.numero,
  fechaNegocio: f.fechaNegocio,
  total: f.total,
  estado: f.estado,
});

/** Lo que un pago ya hecho supera a lo que hay que pagar hoy (texto decimal), o `null` si no lo supera. */
function excesoDelPago(pagado: string, neto: string): string | null {
  const p = leerImporte(pagado);
  const n = leerImporte(neto);
  return p === null || n === null || p <= n ? null : textoDeImporte(p - n);
}

async function listarNotasDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeListarNotasDeCredito,
  clase: ClaseDeNotaListable,
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
    clase,
    sucursales: await tx.autorizacion.sucursalesDelActor(contexto),
    facturaId: entrada.facturaId ?? null,
    proveedorId: entrada.proveedorId ?? null,
    estado: entrada.estado ?? null,
    despuesDe,
    limite: TAMANO_DE_PAGINA + 1,
  });
  const ultima = filas.slice(0, TAMANO_DE_PAGINA).at(-1);
  return ok({
    filas: filas.slice(0, TAMANO_DE_PAGINA).map(enLista),
    siguiente:
      filas.length > TAMANO_DE_PAGINA && ultima !== undefined
        ? `${ultima.fechaNegocio}|${ultima.id}`
        : null,
  });
}

export const listarNotasDeCreditoDentro = (
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeListarNotasDeCredito,
) => listarNotasDentro(tx, contexto, entrada, "NOTA_DE_CREDITO");
export const listarNotasDeDebitoDentro = (
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeListarNotasDeCredito,
) => listarNotasDentro(tx, contexto, entrada, "NOTA_DE_DEBITO");

/** El detalle de una nota de la clase pedida; `null` si no existe, es de otra empresa, no es una nota de esa clase o quien pide no tiene alcance sobre ninguna sucursal (indistinguibles). */
async function obtenerNotaDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ comprobanteId: string }>,
  clase: ClaseDeNotaListable,
): Promise<NotaDeDetalle | null> {
  const { empresaId } = contexto;
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  if (alcance !== "TODAS" && alcance.length === 0) return null;
  const nota = await tx.comprobantesDeProveedor.obtener(empresaId, entrada.comprobanteId);
  if (
    nota === null ||
    nota.clase !== clase ||
    (clase === "NOTA_DE_CREDITO" && nota.comprobanteAsociadoId === null) ||
    nota.tipo === null ||
    nota.puntoDeVenta === null ||
    nota.numero === null ||
    nota.fechaDelComprobante === null
  ) {
    return null;
  }
  const factura =
    nota.comprobanteAsociadoId === null
      ? null
      : await tx.comprobantesDeProveedor.obtener(empresaId, nota.comprobanteAsociadoId);
  if (nota.comprobanteAsociadoId !== null && factura === null) {
    throw new Error("la nota guardada no tiene su factura");
  }
  const importes = await tx.detalleDeComprobantes.importesDe(empresaId, nota.id);
  return {
    comprobanteId: nota.id,
    proveedorId: nota.proveedorId,
    facturaId: factura?.id ?? null,
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
    totalDeLaFactura: factura?.totalSegunFactura ?? null,
    acreditadoDeLaFactura:
      factura === null ? null : await tx.notasDeCredito.acreditadoDe(empresaId, factura.id),
  };
}

export const obtenerNotaDeCreditoDentro = (
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ comprobanteId: string }>,
) => obtenerNotaDentro(tx, contexto, entrada, "NOTA_DE_CREDITO");
export const obtenerNotaDeDebitoDentro = (
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ comprobanteId: string }>,
) => obtenerNotaDentro(tx, contexto, entrada, "NOTA_DE_DEBITO");

/** Las notas de una factura, de crédito y de débito, vigentes y anuladas, con lo que suman las vigentes y lo que hay que pagar. */
export type NotasDeUnaFactura = Readonly<{
  facturaId: string;
  /** El proveedor de la factura y cómo se la nombra (tipo, punto de venta y número): lo que necesita la pantalla de notas sin una segunda lectura. */
  proveedorId: string;
  tipo: string | null;
  puntoDeVenta: number | null;
  numero: number | null;
  totalDeLaFactura: string;
  /** Lo que acreditan las notas de crédito vigentes (resta del pago). */
  acreditado: string;
  /** Lo que suman las notas de débito vinculadas vigentes (se pagan aparte: no entran al neto). */
  debitado: string;
  /** Lo que hay que pagar de la factura (total menos lo acreditado); `0.00` si las notas lo acreditan todo. */
  netoAPagar: string;
  /** Dato informativo, sin asientos: lo que un pago vigente ya hecho supera al neto de hoy (una nota llegó después del pago); `null` sin pago vigente o sin exceso. */
  saldoAFavorPendiente: string | null;
  notas: readonly Readonly<NotaDeLista & { clase: ClaseDeNotaListable }>[];
}>;

/**
 * Las notas de una factura para quien puede ver las de crédito y las de débito (el lector pide las dos acciones); `null` si la factura no existe, es de otra empresa, no es una factura o quien pide no tiene
 * alcance sobre todas sus sucursales (indistinguibles). Es la lectura de «notas vigentes de la factura» que usa la regla de la conciliación con notas.
 */
export async function notasDeUnaFacturaDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ facturaId: string }>,
): Promise<NotasDeUnaFactura | null> {
  const { empresaId } = contexto;
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  if (alcance !== "TODAS" && alcance.length === 0) return null;
  const factura = await tx.comprobantesDeProveedor.obtener(empresaId, entrada.facturaId);
  if (factura === null || factura.clase !== "FACTURA") return null;
  const filtro = {
    sucursales: alcance,
    facturaId: factura.id,
    proveedorId: null,
    estado: null,
    despuesDe: null,
    limite: 500,
  } as const;
  const [creditos, debitos] = await Promise.all([
    tx.notasDeCredito.listar(empresaId, { ...filtro, clase: "NOTA_DE_CREDITO" }),
    tx.notasDeCredito.listar(empresaId, { ...filtro, clase: "NOTA_DE_DEBITO" }),
  ]);
  const acreditado = await tx.notasDeCredito.acreditadoDe(empresaId, factura.id);
  const neto = netoAPagar(factura.totalSegunFactura, acreditado) ?? "0.00";
  const pago = (await tx.pagosDeProveedor.vigenteDe(empresaId, factura.id)) ?? null;
  const exceso = pago === null ? null : excesoDelPago(pago.importe, neto);
  return {
    facturaId: factura.id,
    proveedorId: factura.proveedorId,
    tipo: factura.tipo,
    puntoDeVenta: factura.puntoDeVenta,
    numero: factura.numero,
    totalDeLaFactura: factura.totalSegunFactura,
    acreditado,
    debitado: await tx.notasDeCredito.debitadoDe(empresaId, factura.id),
    netoAPagar: neto,
    saldoAFavorPendiente: exceso,
    notas: [
      ...creditos.map((f) => ({ ...enLista(f), clase: "NOTA_DE_CREDITO" as const })),
      ...debitos.map((f) => ({ ...enLista(f), clase: "NOTA_DE_DEBITO" as const })),
    ].sort((a, b) =>
      a.fechaNegocio === b.fechaNegocio
        ? a.comprobanteId < b.comprobanteId
          ? 1
          : -1
        : a.fechaNegocio < b.fechaNegocio
          ? 1
          : -1,
    ),
  };
}
