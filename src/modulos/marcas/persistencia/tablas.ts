import type { Generated } from "kysely";
import type { COLUMNAS_DE_DOMINIO } from "./esquema";

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
