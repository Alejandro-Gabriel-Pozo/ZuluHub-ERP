import type { Kysely } from "kysely";
import {
  empresaId,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";

/**
 * Lo que la PLATAFORMA lee de las membresías (decisión F1 de H5): solo `empresa_id`, `persona_id`, `rol` y
 * `activo`, sin versión, fechas ni invitación. Es identidad, no operación. Con ese permiso por columna no se
 * puede usar el repositorio de membresías de identidad (que pide la versión); acá va lo mínimo que la
 * plataforma necesita saber.
 */
export type MembresiasParaPlataformaDb = {
  membresia: { empresa_id: string; persona_id: string; activo: boolean };
};

export interface MembresiasParaPlataforma {
  /**
   * Las empresas donde la persona tiene una membresía ACTIVA, ordenadas por id. Una membresía apagada no
   * cuenta: la persona ya no tiene acceso ahí, y lo que la afecta es la suspensión de otra cosa.
   */
  empresasConMembresiaActiva(persona: PersonaId): Promise<readonly EmpresaId[]>;
}

export function crearMembresiasParaPlataforma(
  db: Kysely<MembresiasParaPlataformaDb>,
): MembresiasParaPlataforma {
  return {
    async empresasConMembresiaActiva(persona) {
      const filas = await db
        .selectFrom("membresia")
        .select("empresa_id")
        .where("persona_id", "=", persona)
        .where("activo", "=", true)
        .orderBy("empresa_id")
        .execute();
      return filas.map((fila) => empresaId(fila.empresa_id));
    },
  };
}
