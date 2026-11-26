import type { Kysely } from "kysely";
import { vigenteEn } from "../../capacidades/planes/vigencia";
import type {
  FuentesDelConjuntoLeidas,
  LecturaParaExplicar,
} from "../../plataforma/consultas/contrato";
import { listaDeAcciones, validarNombresDeModulo } from "./lecturas-de-permisos";
import type { SoporteDb } from "./soporte-de-plataforma-db";

/**
 * Lo que «explicar por qué» lee para repetir la decisión del guard real: los módulos (activados y del plan vigente) y de dónde sale el conjunto de acciones (plantilla vigente o rol propio). Lo lee
 * igual que `autorizacion.delActor`. Las reglas de `soporte-de-plataforma.ts` (solo tablas y columnas legibles por plataforma, sin secretos, solo lectura) rigen también acá.
 */
export function crearLecturasParaExplicarPermisos(
  db: Kysely<SoporteDb>,
): Pick<LecturaParaExplicar, "modulosDeLaEmpresa" | "fuentesDelConjunto"> {
  return {
    /**
     * Lo mismo que lee `autorizacion.delActor` (`leerModulosDe`): las filas ACTIVAS de `modulo_de_empresa` y los módulos de la versión de plan de la asignación VIGENTE del tenant
     * a `ahora` (`vigenteEn`), con la misma validación de nombres. Un tenant sin asignación vigente no tiene techo (`[]`); una asignación cuya versión no se ve es una falla. Una
     * empresa que no se ve da dos listas vacías.
     */
    async modulosDeLaEmpresa(empresa, ahora) {
      const fila = await db
        .selectFrom("empresa")
        .select("tenant_id")
        .where("id", "=", empresa)
        .executeTakeFirst();
      if (fila === undefined) return { activados: [], habilitados: [] };
      const activados = await db
        .selectFrom("modulo_de_empresa")
        .select("modulo")
        .where("empresa_id", "=", empresa)
        .where("activo", "=", true)
        .execute();
      const asignaciones = await db
        .selectFrom("plan_de_tenant as a")
        .leftJoin("version_de_plan as v", "v.id", "a.version_de_plan_id")
        .select(["a.numero", "a.vigente_desde", "v.modulos"])
        .where("a.tenant_id", "=", fila.tenant_id)
        .execute();
      const rige = vigenteEn(
        asignaciones.map((a) => ({
          numero: a.numero,
          vigenteDesde: a.vigente_desde,
          modulos: a.modulos,
        })),
        ahora,
      );
      if (rige !== null && rige.modulos === null) {
        throw new RangeError("la versión de plan vigente del tenant no existe en la base");
      }
      return {
        activados: validarNombresDeModulo(
          "activados",
          activados.map((m) => m.modulo),
        ),
        habilitados: validarNombresDeModulo("plan", rige?.modulos ?? []),
      };
    },

    /**
     * Lo mismo que lee `autorizacion.delActor` (`leerMembresiaDelActor`): las versiones vigentes (la de mayor número) de las plantillas de los dos roles base y la del rol propio al
     * que apunta la membresía, con su estado. Un valor que no es una lista de textos es un dato roto y falla.
     */
    async fuentesDelConjunto(persona, empresa): Promise<FuentesDelConjuntoLeidas> {
      const membresia = await db
        .selectFrom("membresia")
        .select("rol_propio_id")
        .where("persona_id", "=", persona)
        .where("empresa_id", "=", empresa)
        .executeTakeFirst();
      if (membresia === undefined) {
        return { plantillas: { ADMINISTRADOR: null, OPERADOR: null }, rolPropio: null };
      }
      const versiones = await db
        .selectFrom("version_de_plantilla")
        .select(["clave", "acciones"])
        .where("clave", "in", ["ADMINISTRADOR", "OPERADOR"])
        .orderBy("numero", "desc")
        .execute();
      // La primera de cada clave es la de mayor número.
      const vigente = (clave: "ADMINISTRADOR" | "OPERADOR") =>
        listaDeAcciones(
          versiones.find((v) => v.clave === clave)?.acciones ?? null,
          `la plantilla de ${clave}`,
        );
      const plantillas = { ADMINISTRADOR: vigente("ADMINISTRADOR"), OPERADOR: vigente("OPERADOR") };
      if (membresia.rol_propio_id === null) return { plantillas, rolPropio: null };
      const rol = await db
        .selectFrom("rol_de_empresa")
        .select("activo")
        .where("id", "=", membresia.rol_propio_id)
        .where("empresa_id", "=", empresa)
        .executeTakeFirst();
      const version = await db
        .selectFrom("version_de_rol")
        .select("acciones")
        .where("rol_id", "=", membresia.rol_propio_id)
        .where("empresa_id", "=", empresa)
        .orderBy("numero", "desc")
        .limit(1)
        .executeTakeFirst();
      const acciones = listaDeAcciones(version?.acciones ?? null, "el rol propio");
      return {
        plantillas,
        rolPropio: acciones === null ? null : { activo: rol?.activo === true, acciones },
      };
    },
  };
}
