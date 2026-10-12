import type { ExpressionBuilder, Kysely } from "kysely";
import type { ColaDeTrabajos } from "../../puertos/cola-de-trabajos";
import type { Dato } from "../../puertos/sin-secretos";
import { empresaId as aEmpresaId } from "../../primitivas/identificadores/marca";

/**
 * Cola de trabajos sobre la tabla `trabajo`, lado del procesador (ADR-007). Se usa SIEMPRE con el
 * contexto `TRABAJOS` (rol `zuluhub_trabajos`: ve y avanza la cola, no lee ninguna otra tabla).
 *
 *  - Tomar es un único `UPDATE` condicionado (`PENDIENTE` vencido, o `EN_CURSO` con el plazo
 *    vencido) que cuenta el intento: el que llega segundo no encuentra la fila disponible. Sin
 *    `FOR UPDATE`: en `READ COMMITTED` la base vuelve a evaluar la condición tras esperar el
 *    bloqueo de la fila, así que dos tomas simultáneas dan una sola ganadora.
 *  - Un trabajo que todavía no tuvo ningún intento (`intentos = 0`) está siempre disponible: así no
 *    depende de que el reloj de quien lo toma coincida con el de la base, que fijó `proximo_intento`
 *    al encolar.
 *  - Los cierres están cercados por `intentos` (ver el puerto): si otro retomó el trabajo, no pisan.
 */
export type ColaDb = {
  trabajo: {
    id: string;
    empresa_id: string | null;
    tipo: string;
    datos: unknown;
    clave_idempotencia: string;
    estado: string;
    intentos: number;
    proximo_intento: Date;
    tomado_hasta: Date | null;
    ultimo_error: string | null;
  };
};

/** La condición de "se puede tomar ahora", compartida por la lectura de candidatos y por la toma. */
function disponible(eb: ExpressionBuilder<ColaDb, "trabajo">, ahora: Date) {
  return eb.or([
    eb.and([
      eb("estado", "=", "PENDIENTE"),
      eb.or([eb("proximo_intento", "<=", ahora), eb("intentos", "=", 0)]),
    ]),
    eb.and([eb("estado", "=", "EN_CURSO"), eb("tomado_hasta", "<=", ahora)]),
  ]);
}

function comoDatos(valor: unknown): Readonly<Record<string, Dato>> {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    throw new RangeError("trabajo.datos no es un objeto");
  }
  return valor as Readonly<Record<string, Dato>>;
}

export function crearColaDePostgres(db: Kysely<ColaDb>): ColaDeTrabajos {
  return {
    async candidatos(ahora, limite) {
      if (!Number.isInteger(limite) || limite < 1) {
        throw new RangeError(`limite debe ser un entero mayor o igual a 1 (llegó ${limite})`);
      }
      const filas = await db
        .selectFrom("trabajo")
        .select("id")
        .where((eb) => disponible(eb, ahora))
        .orderBy("proximo_intento")
        .orderBy("id")
        .limit(limite)
        .execute();
      return filas.map((f) => f.id);
    },

    async tomar(id, ahora, tomadoHasta) {
      const fila = await db
        .updateTable("trabajo")
        .set((eb) => ({
          estado: "EN_CURSO",
          intentos: eb("intentos", "+", 1),
          tomado_hasta: tomadoHasta,
        }))
        .where("id", "=", id)
        .where((eb) => disponible(eb, ahora))
        .returning(["id", "empresa_id", "tipo", "datos", "intentos"])
        .executeTakeFirst();
      if (fila === undefined) return null;
      return {
        id: fila.id,
        empresaId: fila.empresa_id === null ? null : aEmpresaId(fila.empresa_id),
        tipo: fila.tipo,
        datos: comoDatos(fila.datos),
        intentos: fila.intentos,
      };
    },

    async marcarHecho(id, intentos, nota) {
      const r = await db
        .updateTable("trabajo")
        .set({ estado: "HECHO", tomado_hasta: null, ultimo_error: nota })
        .where("id", "=", id)
        .where("estado", "=", "EN_CURSO")
        .where("intentos", "=", intentos)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async reprogramar(id, intentos, proximoIntento, error) {
      const r = await db
        .updateTable("trabajo")
        .set({
          estado: "PENDIENTE",
          proximo_intento: proximoIntento,
          tomado_hasta: null,
          ultimo_error: error,
        })
        .where("id", "=", id)
        .where("estado", "=", "EN_CURSO")
        .where("intentos", "=", intentos)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async marcarFallido(id, intentos, error) {
      const r = await db
        .updateTable("trabajo")
        .set({ estado: "FALLIDO", tomado_hasta: null, ultimo_error: error })
        .where("id", "=", id)
        .where("estado", "=", "EN_CURSO")
        .where("intentos", "=", intentos)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async idsPorClaves(empresa, claves) {
      if (claves.length === 0) return [];
      const filas = await db
        .selectFrom("trabajo")
        .select("id")
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "in", [...claves])
        .orderBy("id")
        .execute();
      return filas.map((f) => f.id);
    },
  };
}
