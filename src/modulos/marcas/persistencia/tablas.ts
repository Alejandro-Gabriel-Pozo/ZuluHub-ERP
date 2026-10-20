import type { Generated } from "kysely";
import type {
  COLUMNAS_DE_DOMINIO,
  COLUMNAS_DE_MARCA,
  COLUMNAS_DE_VERSION_DE_MARCA,
} from "./esquema";

/**
 * La tabla `dominio` tal como la ve Kysely (migración 0007). Las columnas son las de
 * `COLUMNAS_DE_DOMINIO`, que un test compara con el catálogo de la base real; el tipo del final hace que
 * el compilador exija que ambas listas digan lo mismo.
 *
 * Tres cosas a tener en cuenta:
 *  - `marca_id` no se escribe: la fija el disparador del alta desde el dueño (marca o tenant de la empresa).
 *  - `registrado_por` lo escribe el repositorio con `app_actor_plataforma()`; la política de la base exige
 *    que sea el actor firmado.
 *  - La plataforma solo puede actualizar `estado`, `verificado_en` y `motivo`.
 */
export type DominiosDb = {
  dominio: {
    id: Generated<string>;
    host: string;
    superficie: string;
    duenio_marca_id: string | null;
    duenio_empresa_id: string | null;
    marca_id: Generated<string>;
    titular: string;
    es_canonico: Generated<boolean>;
    estado: Generated<string>;
    verificado_en: Generated<Date | null>;
    motivo: Generated<string | null>;
    registrado_por: string;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
};

type Iguales<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Verificación en tiempo de compilación: las columnas de `DominiosDb` son exactamente las de
 * `COLUMNAS_DE_DOMINIO`. Si una lista cambia sin la otra, esto no compila.
 */
export type ColumnasCoinciden =
  Iguales<keyof DominiosDb["dominio"], (typeof COLUMNAS_DE_DOMINIO)[number]> extends true
    ? true
    : never;
export const COLUMNAS_COINCIDEN: ColumnasCoinciden = true;

/**
 * Lo que lee la puerta PÚBLICA (rol `pedernal_publico`, sin contexto): la vista `resolucion_de_host`; de
 * `marca`, el identificador y el padre (la cadena de la herencia); de `dominio`, el host canónico de la
 * aplicación (`es_canonico`, que concede 0011); y de `version_de_marca`, lo que se pinta (nombre, tema y
 * aspecto). Son exactamente las columnas que las migraciones 0007, 0011 y 0014 le conceden a ese rol; pedir otra falla
 * con `42501`. Las políticas del rol dejan ver solo marcas ACTIVAS, dominios ACTIVOS y versiones
 * confirmadas y ya empezadas.
 */
export type PublicoDb = {
  resolucion_de_host: {
    host: string;
    superficie: string;
    duenio_marca_id: string | null;
    duenio_empresa_id: string | null;
    marca_id: string;
  };
  marca: { id: string; marca_padre_id: string | null };
  dominio: {
    host: string;
    superficie: string;
    duenio_marca_id: string | null;
    es_canonico: boolean;
  };
  version_de_marca: {
    marca_id: string;
    numero: number | null;
    vigente_desde: Date | null;
    nombre_visible: string | null;
    tema: unknown;
    aspecto: unknown;
  };
};

/**
 * Lo que lee la APLICACIÓN (rol `pedernal_app`, con contexto) para saber desde qué marca sale un mail:
 * el tenant, su marca, las versiones vigentes de esa marca y su dominio canónico. Las políticas de
 * 0007 muestran solo versiones confirmadas y ya vigentes, y solo dominios ACTIVOS y canónicos.
 */
export type MarcasParaMailDb = {
  tenant: { id: string; marca_id: string };
  marca: { id: string; es_principal: boolean };
  version_de_marca: {
    marca_id: string;
    numero: number | null;
    vigente_desde: Date | null;
    nombre_visible: string | null;
  };
  dominio: { host: string; superficie: string; marca_id: string; es_canonico: boolean };
};

/**
 * Las tablas `marca` y `version_de_marca` tal como las ve Kysely para ESCRIBIRLAS y leerlas completas
 * (M5, casos de uso de plataforma). Las columnas son las de `COLUMNAS_DE_MARCA` y
 * `COLUMNAS_DE_VERSION_DE_MARCA`, que un test compara con el catálogo de la base real. Lo que la
 * plataforma puede escribir lo fijan los privilegios por columna de 0007; lo demás lo fija la base:
 * `nivel` (desde el padre), `creado_en`, `actualizado_en` y `version`.
 */
export type MarcasDb = {
  marca: {
    id: Generated<string>;
    codigo: string;
    es_principal: Generated<boolean>;
    marca_padre_id: string | null;
    nivel: Generated<number>;
    estado: Generated<string>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  version_de_marca: {
    id: Generated<string>;
    marca_id: string;
    numero: Generated<number | null>;
    estado: Generated<string>;
    vigente_desde: Generated<Date | null>;
    nombre_visible: string | null;
    /** `jsonb`: se escribe como texto JSON. */
    tema: string;
    logo: string | null;
    /** `jsonb`: se escribe como texto JSON. */
    vocabulario: string;
    modulos_iniciales: string[] | null;
    plan_por_defecto_id: string | null;
    reemplaza_programada: Generated<boolean>;
    motivo: Generated<string | null>;
    confirmada_en: Generated<Date | null>;
    confirmada_por: Generated<string | null>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
    /** `jsonb` (0014): se escribe como texto JSON. */
    aspecto: string;
  };
};

type TablaDeMarcas<T extends keyof MarcasDb> = keyof MarcasDb[T];

/** Verificación en tiempo de compilación: las columnas de `MarcasDb` son exactamente las de las listas de `esquema.ts`. */
export type ColumnasDeMarcasCoinciden =
  Iguales<TablaDeMarcas<"marca">, (typeof COLUMNAS_DE_MARCA)[number]> extends true
    ? Iguales<
        TablaDeMarcas<"version_de_marca">,
        (typeof COLUMNAS_DE_VERSION_DE_MARCA)[number]
      > extends true
      ? true
      : never
    : never;
export const COLUMNAS_DE_MARCAS_COINCIDEN: ColumnasDeMarcasCoinciden = true;
