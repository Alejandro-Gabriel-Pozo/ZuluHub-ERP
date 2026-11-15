import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  cajaParaVentas,
  type ErrorAlConsultarOpcionesDeCobro,
  type OpcionesDeCobro,
} from "../../caja/publico";
import { esUuid } from "../dominio/identificadores";
import type { TxDeConsultasDeVentas } from "./contrato";

/**
 * «Opciones para cobrar» (mostrador, K1): los medios activos, sus cuentas de la sucursal de LA CAJA, los datos que pide cada medio y las marcas
 * de tarjeta. Lo resuelve caja (`opcionesDeCobro`, puerto que corre en la transacción de ventas y NO autoriza); ventas aporta lo que a caja no
 * le toca: el guard `ventas.ver` (lo pone `consultas.ts`) y que la sucursal de la caja esté en el alcance de quien pide. Sin esa comprobación
 * una caja de otra sucursal mostraría sus cuentas de cobro. Una caja que no existe o está desactivada no ofrece nada. SOLO LEE.
 * Aparte de `consultas.ts` por el tope de tamaño del archivo; el nombre es otro que el del puerto (`cobrar-no-expuesto.test.ts`).
 */
export type EntradaDeOpcionesParaCobrar = Readonly<{ cajaId: string }>;

export type ErrorDeOpcionesParaCobrar =
  ErrorAlConsultarOpcionesDeCobro | ErrorDeAlcance | "IDENTIFICADOR_INVALIDO";

export async function opcionesParaCobrar(
  tx: TxDeConsultasDeVentas,
  contexto: ContextoOperativo,
  alcance: "TODAS" | readonly SucursalId[],
  entrada: EntradaDeOpcionesParaCobrar,
): Promise<Resultado<OpcionesDeCobro, ErrorDeOpcionesParaCobrar>> {
  if (!esUuid(entrada.cajaId)) return err("IDENTIFICADOR_INVALIDO");
  const caja = await tx.cajas.obtener(contexto.empresaId, entrada.cajaId);
  if (caja === null) return err("CAJA_NO_ENCONTRADA");
  const permitida = exigirSucursal(alcance, caja.sucursalId);
  if (!permitida.ok) return permitida;
  return cajaParaVentas.opcionesDeCobro(tx, contexto, entrada.cajaId);
}
