import {
  listarNotasDeCreditoDentro,
  listarNotasDeDebitoDentro,
  notasDeUnaFacturaDentro,
  obtenerNotaDeCreditoDentro,
  obtenerNotaDeDebitoDentro,
  type EntradaDeListarNotasDeCredito,
  type NotaDeDetalle,
  type NotaDeLista,
  type NotasDeUnaFactura,
  type PaginaDeNotasDeCredito,
} from "../casos-de-uso/lectura-notas-de-credito";
import { esUuid } from "../persistencia/filas";
import { err } from "../../../primitivas/resultado/resultado";
import { type Lector, type RDeConsulta } from "./comun";

export type {
  EntradaDeListarNotasDeCredito,
  NotaDeDetalle,
  NotaDeLista,
  NotasDeUnaFactura,
  PaginaDeNotasDeCredito,
};

export function armarConsultasDeNotasDeCredito(leer: Lector) {
  return {
    /** Las notas de crédito del proveedor con su estado, de la más nueva a la más vieja, paginadas por cursor (guard `notas_de_credito_de_proveedor.ver`). */
    listarNotasDeCredito(
      contexto: Parameters<Lector>[0],
      entrada: EntradaDeListarNotasDeCredito = {},
    ): Promise<RDeConsulta<PaginaDeNotasDeCredito>> {
      return leer(contexto, ["notas_de_credito_de_proveedor.ver"], (tx) =>
        listarNotasDeCreditoDentro(tx, contexto, entrada),
      ).then((r) => (r.ok ? r.valor : r));
    },
    /** El detalle de una nota con sus importes por alícuota y lo acreditado de su factura (guard `notas_de_credito_de_proveedor.ver`); `null` si no existe. */
    obtenerNotaDeCredito(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ comprobanteId: string }>,
    ): Promise<RDeConsulta<NotaDeDetalle | null>> {
      if (!esUuid(entrada.comprobanteId)) return Promise.resolve(err("IDENTIFICADOR_INVALIDO"));
      return leer(contexto, ["notas_de_credito_de_proveedor.ver"], (tx) =>
        obtenerNotaDeCreditoDentro(tx, contexto, { comprobanteId: entrada.comprobanteId }),
      );
    },
    /** Las notas de débito del proveedor con su estado, de la más nueva a la más vieja, paginadas por cursor (guard `notas_de_debito_de_proveedor.ver`). */
    listarNotasDeDebito(
      contexto: Parameters<Lector>[0],
      entrada: EntradaDeListarNotasDeCredito = {},
    ): Promise<RDeConsulta<PaginaDeNotasDeCredito>> {
      return leer(contexto, ["notas_de_debito_de_proveedor.ver"], (tx) =>
        listarNotasDeDebitoDentro(tx, contexto, entrada),
      ).then((r) => (r.ok ? r.valor : r));
    },
    /** El detalle de una nota de débito con sus importes por alícuota (guard `notas_de_debito_de_proveedor.ver`); `null` si no existe. */
    obtenerNotaDeDebito(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ comprobanteId: string }>,
    ): Promise<RDeConsulta<NotaDeDetalle | null>> {
      if (!esUuid(entrada.comprobanteId)) return Promise.resolve(err("IDENTIFICADOR_INVALIDO"));
      return leer(contexto, ["notas_de_debito_de_proveedor.ver"], (tx) =>
        obtenerNotaDeDebitoDentro(tx, contexto, { comprobanteId: entrada.comprobanteId }),
      );
    },
    /** Las notas de una factura (crédito y débito, vigentes y anuladas), lo que acreditan y suman, lo que hay que pagar y el saldo a favor informativo; pide las dos acciones de ver; `null` si no existe. */
    notasDeLaFactura(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ facturaId: string }>,
    ): Promise<RDeConsulta<NotasDeUnaFactura | null>> {
      if (!esUuid(entrada.facturaId)) return Promise.resolve(err("IDENTIFICADOR_INVALIDO"));
      return leer(
        contexto,
        ["notas_de_credito_de_proveedor.ver", "notas_de_debito_de_proveedor.ver"],
        (tx) => notasDeUnaFacturaDentro(tx, contexto, { facturaId: entrada.facturaId }),
      );
    },
  };
}
