import type { Kysely } from "kysely";
import type { PlanesDePlataformaDb } from "./tablas";
import type { RepositorioDePlanes } from "./tipos-de-planes";
import { crearPlanesYVersiones } from "./planes-y-versiones";
import { crearAsignacionesDePlanes } from "./asignaciones-de-planes";
import { crearAjustesYModulosDePlanes } from "./ajustes-y-modulos-de-planes";

/**
 * Repositorio de planes, asignaciones, ajustes y módulos de empresa para la PLATAFORMA (ADR-005, ADR-009;
 * M5). Las mismas reglas del repositorio de marcas:
 *
 *  - Es de plataforma: la aplicación solo LEE lo suyo (`lecturas.ts`); la plataforma escribe, y solo un ADMIN.
 *  - Los cambios sobre una fila existente son `UPDATE ... WHERE version = <la que se leyó>` y devuelven la
 *    fila nueva o `null`. Las asignaciones y los ajustes son solo inserción: se corrigen con otra fila.
 *  - Ninguna restricción de la base se atrapa acá: salen tal cual y el adaptador de transacciones las
 *    traduce a `ErrorDePersistencia` (la traducción a motivos de negocio está en `traducir.ts`).
 *  - Quién publica, asigna o ajusta NO lo elige quien llama: lo escribe `app_actor_plataforma()`, el actor
 *    del contexto firmado, y la política de la base exige que coincida.
 */

export type {
  AjusteCompleto,
  AjustePorEscribir,
  AsignacionBasica,
  AsignacionGuardada,
  AsignacionPorEscribir,
  ContenidoDeVersionDePlanGuardable,
  EstadoDePlan,
  ModuloDeEmpresaGuardado,
  PlanGuardado,
  PublicacionPorEscribir,
  RepositorioDePlanes,
  TenantConLaVersionVigente,
  VersionDePlanGuardada,
  VersionPublicadaDePlan,
} from "./tipos-de-planes";

export function crearRepositorioDePlanes(db: Kysely<PlanesDePlataformaDb>): RepositorioDePlanes {
  return {
    ...crearPlanesYVersiones(db),
    ...crearAsignacionesDePlanes(db),
    ...crearAjustesYModulosDePlanes(db),
  };
}
