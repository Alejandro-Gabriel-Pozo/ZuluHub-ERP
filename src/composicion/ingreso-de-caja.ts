import type { ContextoOperativo } from "../contexto/contexto";
import type { Resultado } from "../primitivas/resultado/resultado";
import { cajaParaIngresos } from "../modulos/caja/publico";
import type {
  EntradaDeAnularIngresoPorOrigen,
  EntradaDeIngresoPorOrigen,
  ErrorAlAnularIngreso,
  ErrorAlIngresar,
  SalidaDeAnularIngresoPorOrigen,
  SalidaDeIngresoPorOrigen,
  TxDeCaja,
} from "../modulos/caja/publico";
import { PIEZAS_DE_CAJA } from "./egreso-de-caja";

/**
 * El ingreso de efectivo a la caja por origen (LB-5): el consumidor (reintegro de un proveedor, devolución del sobrante de un anticipo) declara su propio puerto
 * y esta composición lo implementa con caja, que no puede importar. Espejo de `egreso-de-caja.ts`. La transacción del consumidor es, en la aplicación, la
 * compuesta, que además trae los repositorios de caja sobre la MISMA conexión: por eso la operación y el ingreso son una sola transacción. Si por un defecto de
 * armado no los trae, se aborta antes de escribir (nunca se registra el reintegro o la devolución sin meter la plata en la caja).
 * Devuelve los errores de caja tal cual: cada consumidor los traduce a sus códigos. No autoriza (lo hace la acción del consumidor: gerente y administrador).
 */
export type IngresoDeCaja = Readonly<{
  registrar(
    tx: object,
    contexto: ContextoOperativo,
    entrada: EntradaDeIngresoPorOrigen,
  ): Promise<Resultado<SalidaDeIngresoPorOrigen, ErrorAlIngresar>>;
  anular(
    tx: object,
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularIngresoPorOrigen,
  ): Promise<Resultado<SalidaDeAnularIngresoPorOrigen, ErrorAlAnularIngreso>>;
}>;

function comoTxDeCaja(tx: object): TxDeCaja {
  for (const pieza of PIEZAS_DE_CAJA) {
    if (!Object.hasOwn(tx, pieza)) {
      throw new Error(`la transacción no trae la pieza de caja «${pieza}»`);
    }
  }
  return tx as unknown as TxDeCaja;
}

export function crearIngresoDeCaja(): IngresoDeCaja {
  return {
    registrar: async (tx, contexto, entrada) =>
      cajaParaIngresos.registrarIngresoEnTx(comoTxDeCaja(tx), contexto, entrada),
    anular: async (tx, contexto, entrada) =>
      cajaParaIngresos.anularIngresoEnTx(comoTxDeCaja(tx), contexto, entrada),
  };
}
