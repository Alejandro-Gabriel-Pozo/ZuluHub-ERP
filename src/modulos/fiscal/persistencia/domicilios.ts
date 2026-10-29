import type { Kysely, Selectable } from "kysely";
import type { Domicilio } from "../../../primitivas/domicilio/domicilio";
import { provinciaDesdeCodigo } from "../../../primitivas/domicilio/provincias";
import { empresaId, type EmpresaId } from "../../../primitivas/identificadores/marca";
import { domicilioId, type DomicilioId } from "../dominio/identificadores";
import type { FiscalDb } from "./tablas";

/**
 * Lectura de domicilios, aparte de `repositorios.ts` (un archivo sobre el tope de líneas no puede crecer): la fila
 * convertida a `DomicilioGuardado`, una sola vez para `obtener` y para `domiciliosPorIds`.
 */
export type DomicilioGuardado = Readonly<{
  id: DomicilioId;
  empresaId: EmpresaId;
  domicilio: Domicilio;
}>;

export function aDomicilioGuardado(fila: Selectable<FiscalDb["domicilio"]>): DomicilioGuardado {
  const provincia = provinciaDesdeCodigo(fila.provincia);
  if (provincia === null)
    throw new RangeError(`provincia desconocida en la base: ${fila.provincia}`);
  return {
    id: domicilioId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    domicilio: {
      calle: fila.calle,
      numero: fila.numero,
      piso: fila.piso,
      departamento: fila.departamento,
      localidad: fila.localidad,
      provincia: provincia.codigo,
      codigoPostal: fila.codigo_postal,
    },
  };
}

/**
 * Los domicilios de esa empresa con esos ids, en UNA lectura (sin N+1). Filtra por empresa aunque la RLS ya lo imponga: un
 * id inexistente o de otra empresa no aparece; el orden no está garantizado.
 */
export async function domiciliosPorIds(
  db: Kysely<FiscalDb>,
  empresa: EmpresaId,
  ids: readonly DomicilioId[],
): Promise<DomicilioGuardado[]> {
  if (ids.length === 0) return [];
  const filas = await db
    .selectFrom("domicilio")
    .selectAll()
    .where("empresa_id", "=", empresa)
    .where("id", "in", [...ids])
    .execute();
  return filas.map(aDomicilioGuardado);
}
