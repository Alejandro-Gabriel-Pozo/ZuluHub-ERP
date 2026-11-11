import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { Ancla } from "../dominio/ancla";
import { cuentaId, lineaId } from "../dominio/identificadores";
import type { Cuenta, Linea } from "../persistencia/repositorio-de-cuentas";
import type { RepositorioDeCuentas } from "../persistencia/repositorio-de-cuentas";

/**
 * Lecturas de la cuenta que ofrece ventas a los módulos de arriba (el salón y las comandas, E7 X1), dentro de la transacción del llamador y sin
 * permiso propio (lo exige quien llama): siempre filtran por la empresa.
 */
type ConCuentas<K extends keyof RepositorioDeCuentas> = Readonly<{
  cuentas: Pick<RepositorioDeCuentas, K>;
}>;

export type CuentaAbiertaDeAncla = Readonly<{
  anclaId: string;
  cuentaId: string;
  totalProvisorio: string;
  abiertaPor: PersonaId;
  abiertaEn: Date;
}>;

export const cuentaPorId = (
  tx: ConCuentas<"obtener">,
  empresa: EmpresaId,
  id: string,
): Promise<Cuenta | null> => tx.cuentas.obtener(empresa, cuentaId(id));

export const lineaPorId = (
  tx: ConCuentas<"obtenerLinea">,
  empresa: EmpresaId,
  id: string,
): Promise<Linea | null> => tx.cuentas.obtenerLinea(empresa, lineaId(id));

/** Las líneas de la cuenta (vigentes y anuladas), por posición, con la foto de sus opciones. */
export const lineasDeCuenta = (
  tx: ConCuentas<"lineasDeCuenta">,
  empresa: EmpresaId,
  id: string,
): Promise<Linea[]> => tx.cuentas.lineasDeCuenta(empresa, cuentaId(id));

/** La cuenta ABIERTA de un ancla, si hay (a lo sumo una: la única de la base). */
export const cuentaAbiertaPorAncla = (
  tx: ConCuentas<"abiertaPorAncla">,
  empresa: EmpresaId,
  ancla: Ancla,
): Promise<Cuenta | null> => tx.cuentas.abiertaPorAncla(empresa, ancla);

/** Las cuentas abiertas de varias anclas del mismo tipo en UNA lectura (el mapa de mesas no puede hacer una consulta por mesa). */
export async function cuentasAbiertasPorAncla(
  tx: ConCuentas<"abiertasPorAnclas">,
  empresa: EmpresaId,
  tipo: string,
  anclaIds: readonly string[],
): Promise<CuentaAbiertaDeAncla[]> {
  const cuentas = await tx.cuentas.abiertasPorAnclas(empresa, tipo, anclaIds);
  return cuentas.flatMap((c) =>
    c.ancla === null
      ? []
      : [
          {
            anclaId: c.ancla.id,
            cuentaId: c.id,
            totalProvisorio: c.totalProvisorio,
            abiertaPor: c.abiertaPor,
            abiertaEn: c.abiertaEn,
          },
        ],
  );
}
