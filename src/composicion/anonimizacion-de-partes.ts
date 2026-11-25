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
 * Una fuente de impedimentos: un módulo que sabe algo de la parte y puede impedir que se anonimice. Devuelve los suyos (vacío: no impide) y NO captura errores: si no
 * puede leer, la excepción corta la transacción y no se anonimiza (falla cerrado). Los módulos que se conecten después (la ficha de cuenta corriente del cliente, CC-1;
 * las cuentas a cobrar de clientes) suman la suya a la lista de `armarAnonimizacionDePartesEnTx`.
 */
export type FuenteDeImpedimentos = (
  empresa: Parameters<ImpedimentosDeAnonimizacion["impedimentos"]>[0],
  parteId: string,
) => Promise<readonly ImpedimentoDeAnonimizacion[]>;

/** Lo que impide anonimizar a una parte: los impedimentos de TODAS las fuentes, en orden, sin cortar en la primera (el caso de uso los devuelve todos). */
export function crearImpedimentosDeAnonimizacion(
  fuentes: readonly FuenteDeImpedimentos[],
): ImpedimentosDeAnonimizacion {
  return {
    async impedimentos(empresa, parteId) {
      const todos: ImpedimentoDeAnonimizacion[] = [];
      for (const fuente of fuentes) todos.push(...(await fuente(empresa, parteId)));
      return todos;
    },
  };
}

/**
 * La fuente del libro de saldos: la parte tiene saldo distinto de cero, a favor o en contra (decisión del dueño, 25/11/2026), en cualquiera de los dos sentidos (lo que debe
 * y lo que se le debe), en el total o en CUALQUIER centro de costo (un +10 en una sucursal y un −10 en otra suman cero pero siguen siendo saldo). Lee `saldo_de_parte` y
 * su desglose, que mantiene la base. LIMITACIÓN: solo ve lo que ya está asentado en el libro (proveedores, desde que Compras lo conecte); lo que no está en el libro (por
 * ejemplo las cuentas a cobrar de clientes) no lo ve.
 */
export function fuenteDeSaldoDelLibro(
  saldos: Pick<RepositorioDeSaldos, "saldoDeParte" | "saldoPorCentroDeCosto">,
): FuenteDeImpedimentos {
  const cero = importeCero(ARS);
  return async (empresa, parteId) => {
    for (const sentido of SENTIDOS) {
      const total = await saldos.saldoDeParte(empresa, parteId, sentido);
      const centros = await saldos.saldoPorCentroDeCosto(empresa, parteId, sentido);
      if (!importesIguales(total, cero) || centros.some((c) => !importesIguales(c.importe, cero))) {
        return [{ modulo: "saldos_de_partes", motivo: "SALDO_DISTINTO_DE_CERO" }];
      }
    }
    return [];
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
      impedimentos: crearImpedimentosDeAnonimizacion([
        fuenteDeSaldoDelLibro(crearRepositorioDeSaldos(db.withTables<SaldosDb>())),
      ]),
      copias: crearCopiasDePartes(),
    },
  };
}
