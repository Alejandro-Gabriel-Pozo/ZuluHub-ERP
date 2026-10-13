/**
 * Las tablas de planes tal como las lee Kysely (migración 0007), con SOLO las columnas que la lectura
 * de derechos de uso pide: las que la migración le concede a la aplicación (`zuluhub_app`, por columna)
 * y a la plataforma. Pedir otra falla con `42501` (privilegio por columna).
 *
 * `numero` de `version_de_plan` es nulo en un borrador; la asignación solo apunta a versiones
 * PUBLICADAS, que siempre lo tienen (`version_de_plan_publicada_ck`).
 */
export type PlanesDb = {
  tenant: { id: string };
  plan_de_tenant: {
    id: string;
    tenant_id: string;
    numero: number;
    version_de_plan_id: string;
    vigente_desde: Date;
    origen: string;
    creado_en: Date;
  };
  version_de_plan: {
    id: string;
    plan_id: string;
    numero: number | null;
    nombre_comercial: string;
    /** `text[]`: el techo de módulos. */
    modulos: string[];
    /** `jsonb`: `perilla -> ValorDePerilla` etiquetado; la base solo impone su forma (`perillas_validas`). */
    perillas: unknown;
  };
  ajuste_de_perilla: {
    id: string;
    tenant_id: string;
    empresa_id: string | null;
    perilla: string;
    numero: number;
    valor: string;
    vigente_desde: Date;
    creado_en: Date;
  };
};
