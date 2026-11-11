import type { ContextoOperativo } from "../../../contexto/contexto";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { estadoDerivadoDeCompra, type EstadoDeCompra } from "../dominio/niveles";
import { esUuid } from "../dominio/identificadores";
import type {
  FiltroDeCompras,
  FilaDeListaDeCompras,
  LineaDeRecepcion,
  Recepcion,
} from "../persistencia/repositorio-de-recepciones";
import type { TxDeConsultasDeCompras } from "./contrato";

/**
 * Lo que leen las consultas de compras (E9 §3.10). Vive acá y no en `consultas/` porque decide con el dominio (el estado derivado de la compra) y las
 * consultas no importan el dominio de su módulo. Todo filtra por la empresa del contexto y por el alcance de sucursales de quien pide; el dato ausente se
 * muestra como `null` («Sin precio»), nunca como cero. La compra no guarda estado (S-12): se deriva de la recepción y su comprobante.
 */

export type EntradaDeListarCompras = Readonly<{
  sucursalId?: string | undefined;
  proveedorId?: string | undefined;
  estado?: EstadoDeCompra | undefined;
  /** Fechas de negocio `YYYY-MM-DD`, inclusive. */
  desde?: string | undefined;
  hasta?: string | undefined;
  /** El `siguiente` de la página anterior. */
  despuesDe?: string | undefined;
}>;

export type CompraDeLista = Readonly<{
  recepcionId: string;
  numero: number;
  sucursalId: string;
  proveedorId: string;
  fechaNegocio: string;
  remito: Recepcion["remito"];
  estado: EstadoDeCompra;
}>;

export type PaginaDeCompras = Readonly<{
  compras: readonly CompraDeLista[];
  siguiente: string | null;
}>;

type RLectura<S> = Resultado<
  S,
  "CURSOR_INVALIDO" | "IDENTIFICADOR_INVALIDO" | "SUCURSAL_FUERA_DE_ALCANCE"
>;

/** Cuántas compras trae una página. */
const TAMANO_DE_PAGINA = 50;

const FORMA_DEL_CURSOR = /^(\d{4}-\d{2}-\d{2})\|([0-9a-f-]{36})$/;

function fechaOpcional(texto: string | undefined): string | null | undefined {
  if (texto === undefined) return null;
  return fechaCivilDesdeTexto(texto).ok ? texto : undefined;
}

export async function listarComprasDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeListarCompras,
): Promise<RLectura<PaginaDeCompras>> {
  const desde = fechaOpcional(entrada.desde);
  const hasta = fechaOpcional(entrada.hasta);
  if (desde === undefined || hasta === undefined) return err("IDENTIFICADOR_INVALIDO");
  for (const id of [entrada.sucursalId, entrada.proveedorId]) {
    if (id !== undefined && !esUuid(id)) return err("IDENTIFICADOR_INVALIDO");
  }
  let despuesDe: FiltroDeCompras["despuesDe"] = null;
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
  let sucursales: FiltroDeCompras["sucursales"] = alcance;
  if (entrada.sucursalId !== undefined) {
    if (alcance !== "TODAS" && !alcance.some((s) => s === entrada.sucursalId)) {
      return err("SUCURSAL_FUERA_DE_ALCANCE");
    }
    sucursales = [entrada.sucursalId];
  }
  const pedido = entrada.estado;
  const filas = await tx.recepciones.listar(contexto.empresaId, {
    sucursales,
    proveedorId: entrada.proveedorId ?? null,
    estado: pedido === undefined ? null : pedido === "ANULADA" ? "ANULADA" : "CONFIRMADA",
    facturada:
      pedido === "RECIBIDA_Y_FACTURADA" ? true : pedido === "RECIBIDA_SIN_FACTURAR" ? false : null,
    desde,
    hasta,
    despuesDe,
    limite: TAMANO_DE_PAGINA + 1,
  });
  const pagina = filas.slice(0, TAMANO_DE_PAGINA);
  const ultima = pagina.at(-1);
  return ok({
    compras: pagina.map(aCompraDeLista),
    siguiente:
      filas.length > TAMANO_DE_PAGINA && ultima !== undefined
        ? `${ultima.fechaNegocio}|${ultima.id}`
        : null,
  });
}

const aCompraDeLista = (f: FilaDeListaDeCompras): CompraDeLista => ({
  recepcionId: f.id,
  numero: f.numero,
  sucursalId: f.sucursalId,
  proveedorId: f.proveedorId,
  fechaNegocio: f.fechaNegocio,
  remito: f.remito,
  estado: estadoDerivadoDeCompra(f.estado, f.comprobanteEstado),
});

export type FichaDeCompra = Readonly<{
  recepcionId: string;
  numero: number;
  sucursalId: string;
  proveedorId: string;
  nivel: string;
  remito: Recepcion["remito"];
  hechoEn: string;
  fechaNegocio: string;
  estado: EstadoDeCompra;
  registradoPor: string;
  anuladaPor: string | null;
  anuladaEn: string | null;
  motivoDeAnulacion: string | null;
  /** Cada línea con lo que entra a tu stock y el costo por unidad de stock; `null` = «Sin precio». */
  lineas: readonly LineaDeRecepcion[];
  /** La factura de la compra (la vigente, o la última si se anuló), con los dos totales: el calculado y el que dice el papel. */
  comprobante: Readonly<{
    id: string;
    tipo: string | null;
    puntoDeVenta: number | null;
    numero: number | null;
    fecha: string | null;
    vencimientoDePago: string | null;
    netoGravado: string;
    iva: string;
    tributosTotal: string;
    totalCalculado: string;
    totalSegunFactura: string;
    letraNoEsperada: boolean;
    estado: string;
  }> | null;
  /** Todos los pagos de la factura, del más viejo al más nuevo (el vigente tiene `estado: "VIGENTE"`). */
  pagos: readonly Readonly<{
    id: string;
    fechaDePago: string;
    medio: string;
    importe: string;
    estado: string;
    registradoPor: string;
    anuladoPor: string | null;
    motivoDeAnulacion: string | null;
  }>[];
}>;

export async function fichaDeCompraDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ recepcionId: string }>,
): Promise<Resultado<FichaDeCompra | null, "IDENTIFICADOR_INVALIDO">> {
  if (!esUuid(entrada.recepcionId)) return err("IDENTIFICADOR_INVALIDO");
  const recepcion = await tx.recepciones.obtener(contexto.empresaId, entrada.recepcionId);
  if (recepcion === null) return ok(null);
  // Fuera del alcance de sucursales: es indistinguible de una que no existe.
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  if (alcance !== "TODAS" && !alcance.some((s) => s === recepcion.sucursalId)) return ok(null);
  const comprobante = await tx.recepciones.estadoDelComprobante(contexto.empresaId, recepcion.id);
  const factura = await tx.comprobantesDeProveedor.delaRecepcion(contexto.empresaId, recepcion.id);
  const pagos =
    factura === null ? [] : await tx.pagosDeProveedor.deComprobante(contexto.empresaId, factura.id);
  return ok({
    recepcionId: recepcion.id,
    numero: recepcion.numero,
    sucursalId: recepcion.sucursalId,
    proveedorId: recepcion.proveedorId,
    nivel: recepcion.nivel,
    remito: recepcion.remito,
    hechoEn: recepcion.hechoEn.toISOString(),
    fechaNegocio: recepcion.fechaNegocio,
    estado: estadoDerivadoDeCompra(recepcion.estado, comprobante),
    registradoPor: recepcion.registradoPor,
    anuladaPor: recepcion.anuladaPor,
    anuladaEn: recepcion.anuladaEn?.toISOString() ?? null,
    motivoDeAnulacion: recepcion.motivoDeAnulacion,
    lineas: await tx.recepciones.lineasDe(contexto.empresaId, recepcion.id),
    comprobante:
      factura === null
        ? null
        : {
            id: factura.id,
            tipo: factura.tipo,
            puntoDeVenta: factura.puntoDeVenta,
            numero: factura.numero,
            fecha: factura.fechaDelComprobante,
            vencimientoDePago: factura.fechaDeVencimientoDePago,
            netoGravado: factura.netoGravado,
            iva: factura.iva,
            tributosTotal: factura.tributosTotal,
            totalCalculado: factura.totalCalculado,
            totalSegunFactura: factura.totalSegunFactura,
            letraNoEsperada: factura.letraNoEsperada,
            estado: factura.estado,
          },
    pagos: pagos.map((p) => ({
      id: p.id,
      fechaDePago: p.fechaDePago,
      medio: p.medio,
      importe: p.importe,
      estado: p.estado,
      registradoPor: p.registradoPor,
      anuladoPor: p.anuladoPor,
      motivoDeAnulacion: p.motivoDeAnulacion,
    })),
  });
}

/** Las compras confirmadas con alguna línea «Sin precio», de las sucursales del alcance de quien pide (hasta 200, las más nuevas primero). */
export async function comprasSinPrecioDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
): Promise<readonly CompraDeLista[]> {
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  const filas = await tx.recepciones.sinPrecio(contexto.empresaId, alcance, 200);
  return filas.map(aCompraDeLista);
}
