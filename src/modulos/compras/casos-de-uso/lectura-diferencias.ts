import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { SIN_TOLERANCIAS, type Tolerancias } from "../dominio/diferencias";
import { esUuid } from "../dominio/identificadores";
import type {
  DiferenciaGuardada,
  EstadoDeDiferencia,
  FiltroDeListaDeDiferencias,
} from "../persistencia/repositorio-de-diferencias";
import type { TxDeConsultasDeCompras } from "./contrato";
import { TAMANO_DE_PAGINA } from "./lectura";

/**
 * Lo que leen las pantallas de las diferencias de la conciliación de tres vías (N4): la lista con su estado y las tolerancias vigentes de la empresa. Todo filtra por la empresa del
 * contexto. Los importes que muestran las diferencias son de dinero: la consulta los entrega a quien tiene `diferencias_de_compra.ver` (gerente y administrador, que también ven costos).
 */

export type EntradaDeListarDiferencias = Readonly<{
  estado?: string | undefined;
  tipo?: string | undefined;
  comprobanteId?: string | undefined;
  /** El `siguiente` de la página anterior. */
  despuesDe?: string | undefined;
}>;

export type DiferenciaDeLista = Omit<DiferenciaGuardada, "id" | "version"> &
  Readonly<{ diferenciaId: string }>;

export type PaginaDeDiferencias = Readonly<{
  filas: readonly DiferenciaDeLista[];
  siguiente: string | null;
}>;

export type ToleranciasVigentes = Readonly<{
  /** 0 si todavía no se fijó ninguna (es la versión que se manda al configurar). */
  version: number;
  tolerancias: Tolerancias;
}>;

type RLectura<S> = Resultado<S, "CURSOR_INVALIDO" | "IDENTIFICADOR_INVALIDO">;

const ESTADOS = ["ABIERTA", "RESUELTA", "ANULADA"] as const;
const TIPOS = [
  "FACTURADO_DISTINTO_DE_LO_RECIBIDO",
  "PRECIO_DISTINTO",
  "FACTURADO_Y_NO_RECIBIDO",
] as const;
const FORMA_DEL_CURSOR_DE_DIFERENCIAS =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::\d{2})?)\|([0-9a-f-]{36})$/;

export async function listarDiferenciasDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeListarDiferencias,
): Promise<RLectura<PaginaDeDiferencias>> {
  if (entrada.estado !== undefined && !(ESTADOS as readonly string[]).includes(entrada.estado)) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  if (entrada.tipo !== undefined && !(TIPOS as readonly string[]).includes(entrada.tipo)) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  if (entrada.comprobanteId !== undefined && !esUuid(entrada.comprobanteId)) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  let despuesDe: FiltroDeListaDeDiferencias["despuesDe"] = null;
  if (entrada.despuesDe !== undefined) {
    const partes = FORMA_DEL_CURSOR_DE_DIFERENCIAS.exec(entrada.despuesDe);
    if (partes === null || !esUuid(partes[2] as string)) return err("CURSOR_INVALIDO");
    despuesDe = { registradoTexto: partes[1] as string, id: partes[2] as string };
  }
  const filas = await tx.diferenciasDeCompra.listar(contexto.empresaId, {
    estado: (entrada.estado as EstadoDeDiferencia | undefined) ?? null,
    tipo: (entrada.tipo as FiltroDeListaDeDiferencias["tipo"] | undefined) ?? null,
    comprobanteId: entrada.comprobanteId ?? null,
    despuesDe,
    limite: TAMANO_DE_PAGINA + 1,
  });
  const pagina = filas.slice(0, TAMANO_DE_PAGINA);
  const ultima = pagina.at(-1);
  return ok({
    filas: pagina.map((f) => ({
      diferenciaId: f.id,
      conciliacionId: f.conciliacionId,
      tipo: f.tipo,
      comprobanteId: f.comprobanteId,
      lineaDeComprobante: f.lineaDeComprobante,
      recepcionId: f.recepcionId,
      lineaDeRecepcion: f.lineaDeRecepcion,
      cantidadDeDiferencia: f.cantidadDeDiferencia,
      importeDeDiferencia: f.importeDeDiferencia,
      precioFacturado: f.precioFacturado,
      precioDeReferencia: f.precioDeReferencia,
      origenDelPrecioDeReferencia: f.origenDelPrecioDeReferencia,
      dentroDeTolerancia: f.dentroDeTolerancia,
      estado: f.estado,
      resolucion: f.resolucion,
      motivo: f.motivo,
    })),
    siguiente:
      filas.length > TAMANO_DE_PAGINA && ultima !== undefined
        ? `${ultima.registradoTexto}|${ultima.id}`
        : null,
  });
}

/** Las tolerancias vigentes de la empresa; sin ninguna guardada, todas «no definidas» y versión 0. */
export async function obtenerToleranciasDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
): Promise<ToleranciasVigentes> {
  const guardadas = await tx.toleranciasDeCompra.leer(contexto.empresaId);
  return guardadas === null
    ? { version: 0, tolerancias: SIN_TOLERANCIAS }
    : { version: guardadas.version, tolerancias: guardadas.tolerancias };
}
