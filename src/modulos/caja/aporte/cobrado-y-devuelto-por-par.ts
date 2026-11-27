import { importeCero, sumar, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { ImportePorPar } from "../persistencia/repositorio-de-devoluciones-de-la-jornada";
import type { TxDeLecturaDeLaJornada } from "./contrato";

/** Lo cobrado y lo devuelto de un par (medio, cuenta) en una jornada: informativo, NO entra en la diferencia del cierre. */
export type CobradoYDevuelto = Readonly<{ cobrado: Importe; devuelto: Importe }>;

const llave = (medioDePagoId: string, cuentaDeCobroId: string | null) =>
  JSON.stringify([medioDePagoId, cuentaDeCobroId]);

const sumaPorPar = (filas: readonly ImportePorPar[]): ReadonlyMap<string, Importe> => {
  const suma = new Map<string, Importe>();
  for (const f of filas) {
    const clave = llave(f.medioDePagoId, f.cuentaDeCobroId);
    suma.set(clave, sumar(suma.get(clave) ?? importeCero(ARS), f.importe));
  }
  return suma;
};

/**
 * Lo cobrado (movimientos `COBRO`, en el medio con que se cobraron) y lo devuelto (egresos de devoluciones vigentes, en el medio por el que salió) de cada par (medio, cuenta) de
 * la jornada, para mostrarlo al lado de la conciliación. La conciliación misma no cambia: su `registrado` ya incluye el egreso de cada devolución en SU par, y su cuenta es el espejo
 * de `cierre_de_caja_verificar`. Las dos lecturas son de movimientos de solo inserción, así que valen igual para una jornada abierta y para una ya cerrada. Un par sin cobros ni
 * devoluciones da cero en los dos.
 */
export async function cobradoYDevueltoPorPar(
  tx: Pick<TxDeLecturaDeLaJornada, "devolucionesDeLaJornada">,
  empresa: EmpresaId,
  sucursal: SucursalId,
  fecha: FechaCivil,
): Promise<(medioDePagoId: string, cuentaDeCobroId: string | null) => CobradoYDevuelto> {
  const cobrado = sumaPorPar(
    await tx.devolucionesDeLaJornada.cobradoPorPar(empresa, sucursal, fecha),
  );
  const devuelto = sumaPorPar(
    await tx.devolucionesDeLaJornada.devueltoPorPar(empresa, sucursal, fecha),
  );
  return (medioDePagoId, cuentaDeCobroId) => ({
    cobrado: cobrado.get(llave(medioDePagoId, cuentaDeCobroId)) ?? importeCero(ARS),
    devuelto: devuelto.get(llave(medioDePagoId, cuentaDeCobroId)) ?? importeCero(ARS),
  });
}
