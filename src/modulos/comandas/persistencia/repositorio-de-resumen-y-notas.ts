import { sql, type Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { ComandasDb } from "./esquema";
import type { ResumenDeComandas } from "./contrato-de-envios";

/**
 * Lo que `repositorio-de-envios.ts` delega para no pasar del tope de líneas: el resumen de comandas de varias cuentas en UNA consulta y la NOTA LIBRE de cada plato (0104, SAL-G). Misma transacción, siempre por empresa.
 *  - `cambiarNota`: `UPDATE … WHERE envio_id IS NULL` (como `cambiarSalida`): la edición vale solo mientras el plato no se envió; `false` si ya salió (el árbitro contra un envío a la vez).
 *  - `notasDeLasLineas`: la nota viva de esas líneas CON `FOR SHARE`: el envío la copia a la foto del papel y la base exige que la foto lleve exactamente la guardada; con el bloqueo, una edición a la vez espera al fin del envío.
 */
export function crearResumenYNotas(db: Kysely<ComandasDb>) {
  return {
    async resumenPorCuentas(
      empresa: EmpresaId,
      cuentaIds: readonly string[],
    ): Promise<Map<string, ResumenDeComandas>> {
      const resumen = new Map<string, ResumenDeComandas>();
      if (cuentaIds.length === 0) return resumen;
      // Una línea vigente sin fila cuenta como para enviar (fail closed): se parte de `linea_cuenta` y se une la comanda.
      const filas = await sql<{
        cuenta_id: string;
        para_enviar: string;
        en_espera: string;
        envios: string;
      }>`
        select c.id as cuenta_id,
               (select count(*) from linea_cuenta l left join linea_de_comanda d on d.empresa_id = l.empresa_id and d.linea_id = l.id
                 where l.empresa_id = c.empresa_id and l.cuenta_id = c.id and l.estado = 'VIGENTE'
                   and d.envio_id is null and coalesce(d.salida, 'AHORA') = 'AHORA') as para_enviar,
               (select count(*) from linea_cuenta l join linea_de_comanda d on d.empresa_id = l.empresa_id and d.linea_id = l.id
                 where l.empresa_id = c.empresa_id and l.cuenta_id = c.id and l.estado = 'VIGENTE'
                   and d.envio_id is null and d.salida = 'DESPUES') as en_espera,
               -- Los envíos de la cuenta, o los de los que vienen sus ítems ya enviados (una cuenta hija de una división o el destino de una unión no tuvo
               -- envíos propios, pero lo que heredó ya salió a cocina).
               greatest(
                 (select count(*) from envio_de_comanda e where e.empresa_id = c.empresa_id and e.cuenta_id = c.id),
                 (select count(distinct d.envio_id) from linea_cuenta l join linea_de_comanda d on d.empresa_id = l.empresa_id and d.linea_id = l.id
                   where l.empresa_id = c.empresa_id and l.cuenta_id = c.id and l.estado = 'VIGENTE' and d.envio_id is not null)) as envios
          from cuenta_consumo c
         where c.empresa_id = ${empresa} and c.id in (${sql.join(cuentaIds.map((id) => sql`${id}::uuid`))})`.execute(
        db,
      );
      for (const f of filas.rows) {
        resumen.set(f.cuenta_id, {
          paraEnviar: Number(f.para_enviar),
          enEspera: Number(f.en_espera),
          envios: Number(f.envios),
        });
      }
      return resumen;
    },

    async cambiarNota(empresa: EmpresaId, lineaId: string, nota: string | null): Promise<boolean> {
      const r = await db
        .updateTable("linea_de_comanda")
        .set({ nota })
        .where("empresa_id", "=", empresa)
        .where("linea_id", "=", lineaId)
        .where("envio_id", "is", null)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async notasDeLasLineas(
      empresa: EmpresaId,
      lineaIds: readonly string[],
    ): Promise<Map<string, string | null>> {
      const notas = new Map<string, string | null>();
      if (lineaIds.length === 0) return notas;
      const filas = await db
        .selectFrom("linea_de_comanda")
        .select(["linea_id", "nota"])
        .where("empresa_id", "=", empresa)
        .where("linea_id", "in", [...lineaIds])
        .forShare()
        .execute();
      for (const f of filas) notas.set(f.linea_id, f.nota);
      return notas;
    },
  };
}
