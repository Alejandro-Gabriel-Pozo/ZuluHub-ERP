import {
  listarDiferenciasDentro,
  obtenerToleranciasDentro,
  type DiferenciaDeLista,
  type EntradaDeListarDiferencias,
  type PaginaDeDiferencias,
  type ToleranciasVigentes,
} from "../casos-de-uso/lectura-diferencias";
import { type Lector, type RDeConsulta } from "./comun";

export type {
  DiferenciaDeLista,
  EntradaDeListarDiferencias,
  PaginaDeDiferencias,
  ToleranciasVigentes,
};

export function armarConsultasDeDiferencias(leer: Lector) {
  return {
    /** Las diferencias de la conciliación de tres vías, de la más nueva a la más vieja, paginadas por cursor y filtradas por estado, tipo o factura (guard `diferencias_de_compra.ver`). */
    listarDiferencias(
      contexto: Parameters<Lector>[0],
      entrada: EntradaDeListarDiferencias = {},
    ): Promise<RDeConsulta<PaginaDeDiferencias>> {
      return leer(contexto, ["diferencias_de_compra.ver"], (tx) =>
        listarDiferenciasDentro(tx, contexto, entrada),
      ).then((r) => (r.ok ? r.valor : r));
    },
    /** Las tolerancias vigentes de la empresa y su versión (guard `diferencias_de_compra.ver`). */
    obtenerTolerancias(contexto: Parameters<Lector>[0]): Promise<RDeConsulta<ToleranciasVigentes>> {
      return leer(contexto, ["diferencias_de_compra.ver"], (tx) =>
        obtenerToleranciasDentro(tx, contexto),
      );
    },
  };
}
