import { createHash } from "node:crypto";
import type { TipoDeDocumento } from "./impresion";
import type { TipoDeEnvio } from "./envio";

/**
 * LAS HUELLAS DE LO QUE PIDE QUIEN ENVÍA O IMPRIME (E7 §3.5): sha256 (hex) del contenido canónico. La clave de idempotencia con la misma huella
 * devuelve lo hecho; con otra huella es una reutilización (`CLAVE_REUTILIZADA`). Los ids se ordenan: el mismo pedido da la misma huella sin importar
 * el orden en que la pantalla los mande. Previene: que un reintento con otra intención pase por «el mismo pedido». Puro: sin reloj ni azar.
 */
const sha = (partes: readonly unknown[]): string =>
  createHash("sha256").update(JSON.stringify(partes)).digest("hex");

const ordenados = (ids: readonly string[]): string[] => [...ids].sort();

export function huellaDeEnvio(
  entrada: Readonly<{
    cuentaId: string;
    tipo: TipoDeEnvio;
    /** Las líneas pedidas (solo en «pedir que salga»), o `"TODAS"`. */
    lineaIds: readonly string[] | "TODAS";
  }>,
): string {
  return sha([
    "envio",
    entrada.cuentaId,
    entrada.tipo,
    entrada.lineaIds === "TODAS" ? "TODAS" : ordenados(entrada.lineaIds),
  ]);
}

export function huellaDeImpresion(
  entrada: Readonly<{
    documentoTipo: TipoDeDocumento;
    documentoId: string;
    impresoraId: string | null;
    esCopia: boolean;
  }>,
): string {
  return sha([
    "impresion",
    entrada.documentoTipo,
    entrada.documentoId,
    entrada.impresoraId,
    entrada.esCopia,
  ]);
}
