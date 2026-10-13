import type { SucursalId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { DatosDeJornada } from "./dominio/sucursal";
import type { RepositorioDeSucursales } from "./persistencia/repositorios";

/**
 * Puerto `datosDeJornada` de empresas (conciliación §2 y §3.2): la zona horaria de la empresa y la hora
 * de corte de la sucursal, que caja, stock y ventas combinan con `fechaDeNegocio` de `primitivas/tiempo`
 * para sellar la fecha de negocio. Corre en la transacción del llamador, SIN guard propio (no autoriza:
 * lo autorizó el caso de uso que lo llama) y SIN caché: se lee en cada llamada, así un cambio de corte
 * confirmado un instante antes ya rige. La RLS limita a la empresa del contexto: una sucursal ajena es
 * indistinguible de una que no existe. Previene que cada módulo lea `sucursal` y `empresa` por su cuenta
 * y que dos de ellos fechen el mismo hecho con cortes distintos.
 */
export async function datosDeJornada(
  tx: Readonly<{ sucursales: Pick<RepositorioDeSucursales, "jornadaDe"> }>,
  sucursal: SucursalId,
): Promise<Resultado<DatosDeJornada, "SUCURSAL_NO_ENCONTRADA">> {
  const datos = await tx.sucursales.jornadaDe(sucursal);
  return datos === null ? err("SUCURSAL_NO_ENCONTRADA") : ok(datos);
}
