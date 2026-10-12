import type { Kysely } from "kysely";
import type { Contexto } from "../../contexto/contexto";
import type { ConsultaDeIdempotencia, IdempotenciaDePlataforma } from "../../puertos/idempotencia";
import { exigirSinSecretos, type Dato } from "../../puertos/sin-secretos";
import { actorFirmado } from "./contexto-firmado";
import { decidirConsulta, exigirClaveYOperacion, huellaCanonica } from "./huella-canonica";

/**
 * Puerto de idempotencia de plataforma sobre `idempotencia_plataforma` (PK `(admin_id, clave)`; solo
 * inserción). El administrador sale del contexto de la transacción; se lee y se escribe solo lo suyo
 * (el filtro por `admin_id` se repite a propósito: la RLS ya lo impone, defensa en profundidad).
 *
 * `consultar` y `registrar` no guardan estado entre llamadas: cada una trae operación, clave y entrada.
 * Una transacción que se repite por un conflicto de serialización vuelve a consultar y ve lo que la otra
 * dejó. `registrar` es un `INSERT` simple, sin `ON CONFLICT`: si la clave ya existe sale el error de
 * unicidad y la transacción se revierte entera (nunca se pisa ni se duplica nada).
 */
export type IdempotenciaDb = {
  idempotencia_plataforma: {
    admin_id: string;
    clave: string;
    operacion: string;
    huella: string;
    resultado: unknown;
  };
};

export function crearIdempotenciaDePostgres(
  db: Kysely<IdempotenciaDb>,
  contexto: Contexto,
): IdempotenciaDePlataforma {
  /** El administrador del contexto; solo un administrador tiene claves de idempotencia. */
  function administrador(): string {
    if (contexto.tipo !== "PLATAFORMA") {
      throw new RangeError("idempotencia de plataforma: el contexto no es de plataforma");
    }
    if (contexto.actor.tipo !== "ADMIN") {
      throw new RangeError("idempotencia de plataforma: solo un administrador tiene claves");
    }
    return actorFirmado(contexto.actor);
  }

  return {
    async consultar(operacion, clave, entrada): Promise<ConsultaDeIdempotencia> {
      const adminId = administrador();
      exigirClaveYOperacion(clave, operacion);
      const huella = huellaCanonica(entrada);
      const fila = await db
        .selectFrom("idempotencia_plataforma")
        .select(["operacion", "huella", "resultado"])
        .where("admin_id", "=", adminId)
        .where("clave", "=", clave)
        .executeTakeFirst();
      return decidirConsulta(
        fila === undefined
          ? null
          : { operacion: fila.operacion, huella: fila.huella, resultado: fila.resultado as Dato },
        operacion,
        huella,
      );
    },

    async registrar(operacion, clave, entrada, resultado) {
      const adminId = administrador();
      exigirClaveYOperacion(clave, operacion);
      // La entrada solo se guarda como huella; el resultado sí se guarda y no lleva secretos.
      exigirSinSecretos(resultado, "idempotencia (resultado)");
      await db
        .insertInto("idempotencia_plataforma")
        .values({
          admin_id: adminId,
          clave,
          operacion,
          huella: huellaCanonica(entrada),
          resultado: JSON.stringify(resultado),
        })
        .execute();
    },
  };
}
