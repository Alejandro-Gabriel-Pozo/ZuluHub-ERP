import type { Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { ClientesDb } from "./esquema";
import { aParte } from "./filas";
import type { Parte } from "./modelo";

/**
 * Las dos escrituras de anonimizar una parte (`RepositorioDePartes.anonimizar` y `apagarRelacionesDe`), en su archivo para que el repositorio no pase el tope de líneas.
 * Todo filtra por la empresa; el caso de uso las llama con la parte bloqueada.
 */

/** Vacía todos los datos personales de la parte y la deja `ANONIMIZADA`, en un solo `UPDATE` (la base fija `anonimizada_en` y la versión). `null` si no hay fila por anonimizar. */
export async function anonimizarParteEnDb(
  db: Kysely<ClientesDb>,
  empresa: EmpresaId,
  id: string,
): Promise<Parte | null> {
  const fila = await db
    .updateTable("parte")
    .set({
      estado: "ANONIMIZADA",
      nombre: null,
      apellido: null,
      alias: null,
      documento_tipo: null,
      documento_pais: null,
      documento_numero: null,
      condicion_iva: null,
      email: null,
      telefono: null,
      dom_pais: null,
      dom_calle: null,
      dom_numero: null,
      dom_piso: null,
      dom_departamento: null,
      dom_localidad: null,
      dom_provincia: null,
      dom_codigo_postal: null,
      dom_texto: null,
      nota: null,
    })
    .where("empresa_id", "=", empresa)
    .where("id", "=", id)
    .where("estado", "<>", "ANONIMIZADA")
    .returningAll()
    .executeTakeFirst();
  return fila === undefined ? null : aParte(fila);
}

/** Apaga los roles activos de la parte y los vínculos en los que participa, y les vacía el cargo. Devuelve cuántos cambió de cada uno. */
export async function apagarRelacionesEnDb(
  db: Kysely<ClientesDb>,
  empresa: EmpresaId,
  parteId: string,
): Promise<Readonly<{ roles: number; vinculos: number }>> {
  const roles = await db
    .updateTable("parte_rol")
    .set({ activo: false })
    .where("empresa_id", "=", empresa)
    .where("parte_id", "=", parteId)
    .where("activo", "=", true)
    .executeTakeFirst();
  const vinculos = await db
    .updateTable("parte_vinculo")
    .set({ activo: false, cargo: null })
    .where("empresa_id", "=", empresa)
    .where((eb) => eb.or([eb("parte_id", "=", parteId), eb("de_parte_id", "=", parteId)]))
    .where((eb) => eb.or([eb("activo", "=", true), eb("cargo", "is not", null)]))
    .executeTakeFirst();
  return { roles: Number(roles.numUpdatedRows), vinculos: Number(vinculos.numUpdatedRows) };
}
