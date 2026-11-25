import type { ConfiguracionDeTransacciones } from "../adaptadores/postgres/transacciones";
import type {
  AnonimizacionDePartesEnTx,
  CopiasDePartes,
  ImpedimentoDeAnonimizacion,
  ImpedimentosDeAnonimizacion,
} from "../modulos/clientes/publico";
import {
  SENTIDOS,
  crearRepositorioDeSaldos,
  type RepositorioDeSaldos,
  type SaldosDb,
} from "../modulos/saldos_de_partes/publico";
import { importeCero, importesIguales } from "../primitivas/dinero/importe";
import { ARS } from "../primitivas/dinero/moneda";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../puertos/transacciones";

/**
 * Anonimizar una parte (`clientes`) sin que `clientes` conozca a los módulos de arriba (ADR-001): la composición arma, sobre la MISMA conexión de la transacción,
 * lo que impide anonimizar y las copias que se vacían. Previene: anonimizar a una persona que todavía debe o tiene a favor (el saldo quedaría sin nombre) y dejar
 * una copia de sus datos viva en otro módulo. Chequeo: `test/integracion/clientes-anonimizar.test.ts` y `anonimizacion-de-partes.test.ts`.
 */

/**
 * Lo que impide anonimizar a una parte: el libro de saldos con saldo distinto de cero en cualquiera de los dos sentidos (lo que debe y lo que se le debe), sea a
 * favor o en contra (decisión del dueño, 25/11/2026). Un saldo en cero (también el de una parte sin asientos) no lo impide. Lee el saldo derivado que ya mantiene la
 * base, con la parte bloqueada por quien llama.
 */
export function crearImpedimentosPorSaldo(
  saldos: Pick<RepositorioDeSaldos, "saldoDeParte">,
): ImpedimentosDeAnonimizacion {
  return {
    async impedimentos(empresa, parteId): Promise<readonly ImpedimentoDeAnonimizacion[]> {
      for (const sentido of SENTIDOS) {
        const saldo = await saldos.saldoDeParte(empresa, parteId, sentido);
        if (!importesIguales(saldo, importeCero(ARS))) {
          return [{ modulo: "saldos_de_partes", motivo: "SALDO_DISTINTO_DE_CERO" }];
        }
      }
      return [];
    },
  };
}

/** Un módulo que guarda una copia de datos personales de la parte y sabe vaciarla en la transacción de quien anonimiza. */
export type PasoDeCopiaDeParte = (
  empresa: Parameters<CopiasDePartes["anonimizarCopiasEnTx"]>[0],
  parteId: string,
  ahora: Date,
) => Promise<Resultado<null, ErrorDePersistencia>>;

/**
 * Las copias de la parte que se vacían en la misma transacción: los pasos de los módulos que las guardan, en orden; el primero que falla corta y la
 * transacción entera se revierte. Hoy no hay ninguno: compras y fiscal conservan la copia impresa de sus comprobantes por obligación fiscal, ventas no guarda datos
 * personales por su cuenta y `reservas` todavía no existe (cuando exista suma su paso `anonimizarCopiasDeParteEnTx` acá).
 */
export function crearCopiasDePartes(pasos: readonly PasoDeCopiaDeParte[] = []): CopiasDePartes {
  return {
    async anonimizarCopiasEnTx(empresa, parteId, ahora) {
      for (const paso of pasos) {
        const resultado = await paso(empresa, parteId, ahora);
        if (!resultado.ok) return resultado;
      }
      return ok(null);
    },
  };
}

export function armarAnonimizacionDePartesEnTx(
  db: Parameters<ConfiguracionDeTransacciones<unknown>["armar"]>[0],
): Readonly<{ anonimizacionDePartes: AnonimizacionDePartesEnTx }> {
  return {
    anonimizacionDePartes: {
      impedimentos: crearImpedimentosPorSaldo(crearRepositorioDeSaldos(db.withTables<SaldosDb>())),
      copias: crearCopiasDePartes(),
    },
  };
}
