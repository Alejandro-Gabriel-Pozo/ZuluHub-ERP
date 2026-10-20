import type { Generated } from "kysely";
import type {
  COLUMNAS_DE_AJUSTE_DE_PERILLA,
  COLUMNAS_DE_MODULO_DE_EMPRESA,
  COLUMNAS_DE_PLAN,
  COLUMNAS_DE_PLAN_DE_TENANT,
  COLUMNAS_DE_VERSION_DE_PLAN,
} from "./esquema";

/**
 * Las tablas de planes tal como las lee Kysely (migración 0007), con SOLO las columnas que la lectura
 * de derechos de uso pide: las que la migración le concede a la aplicación (`pedernal_app`, por columna)
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

/**
 * Las tablas de planes tal como las ve Kysely para ESCRIBIRLAS y leerlas completas desde la PLATAFORMA
 * (M5, casos de uso de plataforma): el rol de plataforma lee enteras todas estas tablas y escribe las
 * columnas que le concede 0007. A diferencia de `PlanesDb`, que son las columnas que la aplicación puede
 * leer, acá figuran todas. Las columnas son las de las listas de `esquema.ts`, que un test compara con
 * el catálogo de la base real. Lo que fija la base (`numero` de una versión al publicarla, `creado_en`,
 * `version`) va como `Generated`.
 */
export type PlanesDePlataformaDb = {
  plan: {
    id: Generated<string>;
    codigo: string;
    estado: Generated<string>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  version_de_plan: {
    id: Generated<string>;
    plan_id: string;
    numero: Generated<number | null>;
    estado: Generated<string>;
    nombre_comercial: string;
    /** `text[]`. */
    modulos: string[];
    /** `jsonb`: se escribe como texto JSON. */
    perillas: string;
    motivo: Generated<string | null>;
    publicada_en: Generated<Date | null>;
    publicada_por: Generated<string | null>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  plan_de_tenant: {
    id: Generated<string>;
    tenant_id: string;
    numero: number;
    version_de_plan_id: string;
    vigente_desde: Date;
    origen: string;
    reemplaza_programada: Generated<boolean>;
    motivo: string;
    asignado_por: string;
    creado_en: Generated<Date>;
  };
  ajuste_de_perilla: {
    id: Generated<string>;
    tenant_id: string;
    empresa_id: string | null;
    perilla: string;
    numero: number;
    valor: string;
    vigente_desde: Date;
    reemplaza_programada: Generated<boolean>;
    motivo: string;
    asignado_por: string;
    creado_en: Generated<Date>;
  };
  modulo_de_empresa: {
    empresa_id: string;
    modulo: string;
    activo: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  empresa: { id: string; tenant_id: string; estado: string };
  tenant: { id: string; nombre: string; estado: string; marca_id: string };
};

type Iguales<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type ColumnasDe<T extends keyof PlanesDePlataformaDb> = keyof PlanesDePlataformaDb[T];

/** Verificación en tiempo de compilación: las columnas de cada tabla son exactamente las de su lista de `esquema.ts`. */
export type ColumnasDePlanesCoinciden =
  Iguales<ColumnasDe<"plan">, (typeof COLUMNAS_DE_PLAN)[number]> extends true
    ? Iguales<
        ColumnasDe<"version_de_plan">,
        (typeof COLUMNAS_DE_VERSION_DE_PLAN)[number]
      > extends true
      ? Iguales<
          ColumnasDe<"plan_de_tenant">,
          (typeof COLUMNAS_DE_PLAN_DE_TENANT)[number]
        > extends true
        ? Iguales<
            ColumnasDe<"ajuste_de_perilla">,
            (typeof COLUMNAS_DE_AJUSTE_DE_PERILLA)[number]
          > extends true
          ? Iguales<
              ColumnasDe<"modulo_de_empresa">,
              (typeof COLUMNAS_DE_MODULO_DE_EMPRESA)[number]
            > extends true
            ? true
            : never
          : never
        : never
      : never
    : never;
export const COLUMNAS_DE_PLANES_COINCIDEN: ColumnasDePlanesCoinciden = true;
