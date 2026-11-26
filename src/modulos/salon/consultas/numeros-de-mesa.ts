import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { cuentaPorId, esUuid } from "../../ventas/publico";
import { ANCLA_DE_MESA } from "../casos-de-uso/cuenta-de-mesa";
import type { TxDeConsultasDeSalon } from "./contrato";

/** Lo máximo que se pregunta de una vez: las anulaciones de mesas de UNA jornada, no una lista abierta. */
export const TOPE_DE_CUENTAS_POR_CONSULTA = 200;

export type EntradaDeNumerosDeMesa = Readonly<{
  sucursalId: string;
  cuentaIds: readonly string[];
}>;

export type NumeroDeMesaDeUnaCuenta = Readonly<{ cuentaId: string; numero: number }>;

/**
 * El número de la mesa de cada cuenta (SAL-F: el cierre del día dice «Diferencia por anulación de la mesa N»), por la mesa que ancla la cuenta HOY (cambiar de mesa la mueve): solo cuentas de ESA sucursal y mesas de ESA sucursal.
 * Una cuenta sin mesa (mostrador), de otra sucursal o inexistente simplemente no aparece: nunca se inventa un número. Es lectura pura (a lo sumo dos lecturas en lote), con el guard y el alcance de la sucursal de toda consulta del salón (`previo`).
 */
export async function numerosDeMesaDeCuentas(
  tx: TxDeConsultasDeSalon,
  contexto: ContextoOperativo,
  alcance: Parameters<typeof exigirSucursal>[0],
  entrada: EntradaDeNumerosDeMesa,
): Promise<
  Resultado<readonly NumeroDeMesaDeUnaCuenta[], ErrorDeAlcance | "IDENTIFICADOR_INVALIDO">
> {
  if (!esUuid(entrada.sucursalId) || entrada.cuentaIds.length > TOPE_DE_CUENTAS_POR_CONSULTA) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  const sucursal = sucursalId(entrada.sucursalId);
  const permitida = exigirSucursal(alcance, sucursal);
  if (!permitida.ok) return permitida;
  const { empresaId } = contexto;
  const mesaDeCuenta = new Map<string, string>();
  for (const id of new Set(entrada.cuentaIds)) {
    if (!esUuid(id)) return err("IDENTIFICADOR_INVALIDO");
    const cuenta = await cuentaPorId(tx, empresaId, id);
    if (cuenta?.sucursalId === sucursal && cuenta.ancla?.tipo === ANCLA_DE_MESA) {
      mesaDeCuenta.set(id, cuenta.ancla.id);
    }
  }
  const mesas = new Map(
    (await tx.mesas.obtenerVarias(empresaId, [...new Set(mesaDeCuenta.values())]))
      .filter((m) => m.sucursalId === sucursal)
      .map((m) => [m.id, m.numero]),
  );
  const numeros: NumeroDeMesaDeUnaCuenta[] = [];
  for (const [cuentaId, mesaId] of mesaDeCuenta) {
    const numero = mesas.get(mesaId);
    if (numero !== undefined) numeros.push({ cuentaId, numero });
  }
  return ok(numeros);
}
