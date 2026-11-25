import type { ContextoOperativo } from "../../../contexto/contexto";
import { NIVEL_INICIAL_DE_COMPRA, type NivelDeCompra } from "../dominio/niveles";
import type { TxDeConsultasDeCompras } from "./contrato";

export type NivelDeComprasVigente = Readonly<{ nivel: NivelDeCompra; version: number }>;

/** La versión de la fila recién creada (`DEFAULT 1` de la migración 0037): la que debe llevar quien guarda el nivel de una empresa que todavía no tiene fila. */
const VERSION_DE_LA_FILA_NUEVA = 1;

/**
 * El nivel de operación de las compras de la empresa y su versión, SIN escribir: una empresa que todavía no tiene fila ve el nivel inicial con la versión que tendrá la fila cuando `configurarCompras`
 * la cree (la pantalla la lleva y el caso de uso la compara bajo bloqueo). Mirar no crea nada (a diferencia de `leer` del repositorio, que la crea para los casos de uso que escriben).
 */
export async function nivelDeComprasDentro(
  tx: Pick<TxDeConsultasDeCompras, "configuracionDeCompras">,
  contexto: ContextoOperativo,
): Promise<NivelDeComprasVigente> {
  const fila = await tx.configuracionDeCompras.obtener(contexto.empresaId);
  return fila ?? { nivel: NIVEL_INICIAL_DE_COMPRA, version: VERSION_DE_LA_FILA_NUEVA };
}
