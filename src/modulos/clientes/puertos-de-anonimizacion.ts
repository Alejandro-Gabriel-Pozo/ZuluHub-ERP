import type { EmpresaId } from "../../primitivas/identificadores/marca";
import type { Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import type { ImpedimentoDeAnonimizacion } from "./dominio/anonimizacion";

/**
 * Lo que `clientes` le pide a la composición para anonimizar una parte sin conocer a los módulos de arriba (ADR-001, ADR-014): la composición los arma sobre
 * la MISMA conexión de la transacción y `anonimizarParte` los usa adentro de ella. Los dos se piden siempre (fail closed): sin ellos el caso de uso no
 * compila, así que nadie puede anonimizar sin que se mire lo que lo impide ni se vacíen las copias.
 */

/**
 * Los módulos que saben algo sobre la parte y pueden impedir que se anonimice (hoy, el libro de saldos: saldo distinto de cero, a favor o en contra). Devuelve
 * TODOS los impedimentos, ninguno con datos de la parte. Se llama con la parte ya bloqueada.
 */
export interface ImpedimentosDeAnonimizacion {
  impedimentos(empresa: EmpresaId, parteId: string): Promise<readonly ImpedimentoDeAnonimizacion[]>;
}

/**
 * Los módulos que guardan una COPIA de datos personales de la parte y pueden vaciarla en la misma transacción (hoy ninguno: compras y fiscal conservan la copia
 * impresa por obligación fiscal y reservas todavía no existe). Todo o nada: si falla, `anonimizarParte` no confirma nada. Repetible: se llama una sola vez por
 * anonimización, pero cada paso tiene que dejar el mismo resultado si corre de nuevo.
 */
export interface CopiasDePartes {
  anonimizarCopiasEnTx(
    empresa: EmpresaId,
    parteId: string,
    ahora: Date,
  ): Promise<Resultado<null, ErrorDePersistencia>>;
}

export type AnonimizacionDePartesEnTx = Readonly<{
  impedimentos: ImpedimentosDeAnonimizacion;
  copias: CopiasDePartes;
}>;
