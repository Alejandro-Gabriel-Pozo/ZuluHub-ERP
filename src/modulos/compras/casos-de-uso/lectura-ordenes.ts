import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../dominio/identificadores";
import { ESTADOS_DE_ORDEN, type EstadoDeOrden } from "../dominio/orden-de-compra";
import type { FiltroDeListaDeOrdenes } from "../persistencia/repositorio-de-ordenes";
import type { TxDeConsultasDeCompras } from "./contrato";
import { TAMANO_DE_PAGINA } from "./lectura";

/**
 * Lo que leen las pantallas de órdenes de compra (N4, E9 §3.10): la lista con su estado y el detalle con lo pedido y lo recibido por línea. Todo filtra por la empresa del
 * contexto y por el alcance de sucursales de quien pide (una orden sin sucursal de destino solo la ve quien tiene todas: nunca se asume «todas» por ella). Los precios solo se
 * leen si se piden y la consulta exige además `costos.ver` (el operador ve la orden sin precios).
 */

export type EntradaDeListarOrdenes = Readonly<{
  proveedorId?: string | undefined;
  estado?: string | undefined;
  /** El `siguiente` de la página anterior. */
  despuesDe?: string | undefined;
}>;

export type OrdenDeLista = Readonly<{
  ordenId: string;
  /** `null` mientras es BORRADOR. */
  numero: number | null;
  proveedorId: string;
  sucursalDestinoId: string | null;
  entrega: string | null;
  estado: EstadoDeOrden;
  cierreMotivo: "COMPLETA" | "CON_SALDO" | null;
  renglones: number;
}>;

export type PaginaDeOrdenes = Readonly<{
  filas: readonly OrdenDeLista[];
  siguiente: string | null;
}>;

export type LineaDeOrdenDeDetalle = Readonly<{
  numero: number;
  productoId: string;
  /** En la unidad base del producto. */
  cantidadPedida: string;
  /** Lo recibido contra la línea (solo una orden pedida o cerrada tiene saldo; en borrador es `null`). */
  cantidadRecibida: string | null;
  retirada: boolean;
  /** Solo si se pidió con precios (y la consulta exigió `costos.ver`); `undefined` si no. */
  precioUnitario?: string | null;
}>;

export type OrdenDeDetalle = Readonly<{
  ordenId: string;
  numero: number | null;
  proveedorId: string;
  sucursalDestinoId: string | null;
  entrega: string | null;
  estado: EstadoDeOrden;
  cierreMotivo: "COMPLETA" | "CON_SALDO" | null;
  version: number;
  lineas: readonly LineaDeOrdenDeDetalle[];
}>;

type RLectura<S> = Resultado<S, "CURSOR_INVALIDO" | "IDENTIFICADOR_INVALIDO">;

/** `creado_en` en texto de Postgres (con microsegundos y desfase) y el id, separados por `|`. */
const FORMA_DEL_CURSOR_DE_ORDENES =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::\d{2})?)\|([0-9a-f-]{36})$/;

const esEstadoDeOrden = (texto: string): texto is EstadoDeOrden =>
  (ESTADOS_DE_ORDEN as readonly string[]).includes(texto);

export async function listarOrdenesDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeListarOrdenes,
): Promise<RLectura<PaginaDeOrdenes>> {
  if (entrada.proveedorId !== undefined && !esUuid(entrada.proveedorId)) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  if (entrada.estado !== undefined && !esEstadoDeOrden(entrada.estado)) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  let despuesDe: FiltroDeListaDeOrdenes["despuesDe"] = null;
  if (entrada.despuesDe !== undefined) {
    const partes = FORMA_DEL_CURSOR_DE_ORDENES.exec(entrada.despuesDe);
    if (partes === null || !esUuid(partes[2] as string)) return err("CURSOR_INVALIDO");
    despuesDe = { creadoTexto: partes[1] as string, id: partes[2] as string };
  }
  const filas = await tx.ordenesDeCompra.listar(contexto.empresaId, {
    sucursales: await tx.autorizacion.sucursalesDelActor(contexto),
    proveedorId: entrada.proveedorId ?? null,
    estado: entrada.estado ?? null,
    despuesDe,
    limite: TAMANO_DE_PAGINA + 1,
  });
  const ultima = filas.slice(0, TAMANO_DE_PAGINA).at(-1);
  return ok({
    filas: filas.slice(0, TAMANO_DE_PAGINA).map((f) => ({
      ordenId: f.id,
      numero: f.numero,
      proveedorId: f.proveedorId,
      sucursalDestinoId: f.sucursalDestinoId,
      entrega: f.entrega,
      estado: f.estado,
      cierreMotivo: f.cierreMotivo,
      renglones: f.renglones,
    })),
    siguiente:
      filas.length > TAMANO_DE_PAGINA && ultima !== undefined
        ? `${ultima.creadoTexto}|${ultima.id}`
        : null,
  });
}

/** El detalle de una orden; `null` si no existe, es de otra empresa o no está en el alcance de quien pide (indistinguibles). */
export async function obtenerOrdenDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ ordenId: string; conPrecios: boolean }>,
): Promise<OrdenDeDetalle | null> {
  const { empresaId } = contexto;
  const orden = await tx.ordenesDeCompra.obtener(empresaId, entrada.ordenId);
  if (orden === null) return null;
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  if (
    alcance !== "TODAS" &&
    (orden.sucursalDestinoId === null || !alcance.some((s) => s === orden.sucursalDestinoId))
  ) {
    return null;
  }
  const lineas = await tx.ordenesDeCompra.lineasDe(empresaId, orden.id);
  const saldos = new Map(
    (await tx.ordenesDeCompra.saldosDe(empresaId, orden.id)).map((s) => [s.linea, s.recibida]),
  );
  return {
    ordenId: orden.id,
    numero: orden.numero,
    proveedorId: orden.proveedorId,
    sucursalDestinoId: orden.sucursalDestinoId,
    entrega: orden.entrega,
    estado: orden.estado,
    cierreMotivo: orden.cierreMotivo,
    version: orden.version,
    lineas: lineas.map((l) => ({
      numero: l.numero,
      productoId: l.productoId,
      cantidadPedida: l.cantidadPedida,
      cantidadRecibida: saldos.get(l.numero) ?? null,
      retirada: l.retirada,
      ...(entrada.conPrecios ? { precioUnitario: l.precioUnitario } : {}),
    })),
  };
}
