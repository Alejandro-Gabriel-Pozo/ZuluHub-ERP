import type { Generated, Kysely } from "kysely";
import type { Contexto } from "../../contexto/contexto";
import {
  ACCIONES_DE_PLATAFORMA,
  type AuditoriaDePlataforma,
} from "../../puertos/auditoria-de-plataforma";
import { exigirSinSecretos } from "../../puertos/sin-secretos";
import { actorFirmado } from "./contexto-firmado";

/**
 * Puerto de auditoría de plataforma sobre `auditoria_plataforma` (solo inserción; un disparador impide
 * cambiarla). Va en la misma transacción del cambio que describe.
 *
 * El actor NO lo elige el llamador: sale del contexto de la transacción, con la misma función que firma
 * el contexto (`actorFirmado`), y la base (política restrictiva de 0004) exige además que coincida con el
 * actor firmado y que sea vigente (un administrador activo o `sistema`). Dos barreras: un error acá, o un
 * contexto distinto del firmado, lo rechaza la base.
 */
export type AuditoriaDePlataformaDb = {
  auditoria_plataforma: {
    id: Generated<string>;
    actor: string;
    accion: string;
    entidad: string;
    entidad_id: string;
    antes: string | null;
    despues: string | null;
  };
};

export function crearAuditoriaDePlataformaDePostgres(
  db: Kysely<AuditoriaDePlataformaDb>,
  contexto: Contexto,
): AuditoriaDePlataforma {
  return {
    async registrar(registro) {
      // Se valida al USAR, no al construir: la composición arma todos los adaptadores para cualquier
      // contexto, y solo el de plataforma puede auditar.
      if (contexto.tipo !== "PLATAFORMA") {
        throw new RangeError("auditoría de plataforma: el contexto no es de plataforma");
      }
      const actor = actorFirmado(contexto.actor);
      if (!ACCIONES_DE_PLATAFORMA.some((accion) => accion === registro.accion)) {
        throw new RangeError(`auditoría de plataforma: acción desconocida '${registro.accion}'`);
      }
      if (registro.entidad.trim() === "" || registro.entidadId.trim() === "") {
        throw new RangeError("auditoría de plataforma: la entidad y su id no pueden estar vacíos");
      }
      const antes = registro.antes ?? null;
      const despues = registro.despues ?? null;
      if (antes !== null) exigirSinSecretos(antes, "auditoría de plataforma (antes)");
      if (despues !== null) exigirSinSecretos(despues, "auditoría de plataforma (despues)");
      await db
        .insertInto("auditoria_plataforma")
        .values({
          actor,
          accion: registro.accion,
          entidad: registro.entidad,
          entidad_id: registro.entidadId,
          antes: antes === null ? null : JSON.stringify(antes),
          despues: despues === null ? null : JSON.stringify(despues),
        })
        .execute();
    },
  };
}
