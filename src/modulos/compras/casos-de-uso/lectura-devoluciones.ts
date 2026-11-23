import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../dominio/identificadores";
import type {
  EstadoDeDevolucion,
  FiltroDeListaDeDevoluciones,
} from "../persistencia/repositorio-de-devoluciones";
import type { TxDeConsultasDeCompras } from "./contrato";
import { TAMANO_DE_PAGINA } from "./lectura";

/**
 * Lo que leen las pantallas de devoluciones al proveedor (N4, E9 §3.10): la lista con su estado y el detalle con sus líneas. Todo filtra por la empresa del contexto y por el
 * alcance de sucursales de quien pide (nunca se asume «todas» por una sucursal que no se eligió).
 */

export type EntradaDeListarDevoluciones = Readonly<{
  proveedorId?: string | undefined;
  estado?: string | undefined;
  /** El `siguiente` de la página anterior. */
  despuesDe?: string | undefined;
}>;

export type DevolucionDeLista = Readonly<{
  devolucionId: string;
  numero: number;
  sucursalId: string;
  proveedorId: string;
  /** El nombre del motivo en la lista del sistema. */
  motivo: string;
  /** Jornada de la sucursal (`YYYY-MM-DD`). */
  fechaNegocio: string;
  estado: EstadoDeDevolucion;
  renglones: number;
}>;

export type PaginaDeDevoluciones = Readonly<{
  filas: readonly DevolucionDeLista[];
  siguiente: string | null;
}>;

export type LineaDeDevolucionDeDetalle = Readonly<{
  numero: number;
  depositoId: string;
  articuloId: string;
  cantidad: string;
  /** De qué línea recibida se devolvió, si se dijo. */
  recepcionId: string | null;
  lineaDeRecepcion: number | null;
}>;

export type DevolucionDeDetalle = Readonly<{
  devolucionId: string;
  numero: number;
  sucursalId: string;
  proveedorId: string;
  motivo: string;
  remitoNumero: string | null;
  remitoFecha: string | null;
  fechaNegocio: string;
  estado: EstadoDeDevolucion;
  anuladaEn: Date | null;
  motivoDeAnulacion: string | null;
  lineas: readonly LineaDeDevolucionDeDetalle[];
}>;

type RLectura<S> = Resultado<S, "CURSOR_INVALIDO" | "IDENTIFICADOR_INVALIDO">;

/** `registrado_en` en texto de Postgres (con microsegundos y desfase) y el id, separados por `|`. */
const FORMA_DEL_CURSOR_DE_DEVOLUCIONES =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::\d{2})?)\|([0-9a-f-]{36})$/;

const ESTADOS: readonly string[] = [
  "CONFIRMADA",
  "ANULADA",
] satisfies readonly EstadoDeDevolucion[];
const esEstado = (texto: string): texto is EstadoDeDevolucion => ESTADOS.includes(texto);

export async function listarDevolucionesDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeListarDevoluciones,
): Promise<RLectura<PaginaDeDevoluciones>> {
  if (entrada.proveedorId !== undefined && !esUuid(entrada.proveedorId)) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  if (entrada.estado !== undefined && !esEstado(entrada.estado)) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  let despuesDe: FiltroDeListaDeDevoluciones["despuesDe"] = null;
  if (entrada.despuesDe !== undefined) {
    const partes = FORMA_DEL_CURSOR_DE_DEVOLUCIONES.exec(entrada.despuesDe);
    if (partes === null || !esUuid(partes[2] as string)) return err("CURSOR_INVALIDO");
    despuesDe = { registradoTexto: partes[1] as string, id: partes[2] as string };
  }
  const filas = await tx.devolucionesAProveedor.listar(contexto.empresaId, {
    sucursales: await tx.autorizacion.sucursalesDelActor(contexto),
    proveedorId: entrada.proveedorId ?? null,
    estado: entrada.estado ?? null,
    despuesDe,
    limite: TAMANO_DE_PAGINA + 1,
  });
  const ultima = filas.slice(0, TAMANO_DE_PAGINA).at(-1);
  return ok({
    filas: filas.slice(0, TAMANO_DE_PAGINA).map((f) => ({
      devolucionId: f.id,
      numero: f.numero,
      sucursalId: f.sucursalId,
      proveedorId: f.proveedorId,
      motivo: f.motivo,
      fechaNegocio: f.fechaNegocio,
      estado: f.estado,
      renglones: f.renglones,
    })),
    siguiente:
      filas.length > TAMANO_DE_PAGINA && ultima !== undefined
        ? `${ultima.registradoTexto}|${ultima.id}`
        : null,
  });
}

/** El detalle de una devolución; `null` si no existe, es de otra empresa o su sucursal no está en el alcance de quien pide (indistinguibles). */
export async function obtenerDevolucionDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ devolucionId: string }>,
): Promise<DevolucionDeDetalle | null> {
  const { empresaId } = contexto;
  const devolucion = await tx.devolucionesAProveedor.obtener(empresaId, entrada.devolucionId);
  if (devolucion === null) return null;
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  if (alcance !== "TODAS" && !alcance.some((s) => s === devolucion.sucursalId)) return null;
  const lineas = await tx.devolucionesAProveedor.lineasDe(empresaId, devolucion.id);
  return {
    devolucionId: devolucion.id,
    numero: devolucion.numero,
    sucursalId: devolucion.sucursalId,
    proveedorId: devolucion.proveedorId,
    motivo: devolucion.motivo,
    remitoNumero: devolucion.remitoNumero,
    remitoFecha: devolucion.remitoFecha,
    fechaNegocio: devolucion.fechaNegocio,
    estado: devolucion.estado,
    anuladaEn: devolucion.anuladaEn,
    motivoDeAnulacion: devolucion.motivoDeAnulacion,
    lineas: lineas.map((l) => ({
      numero: l.numero,
      depositoId: l.depositoId,
      articuloId: l.articuloId,
      cantidad: l.cantidad,
      recepcionId: l.recepcionId,
      lineaDeRecepcion: l.lineaDeRecepcion,
    })),
  };
}
