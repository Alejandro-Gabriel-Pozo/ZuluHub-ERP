import type { Generated } from "kysely";
import type { COLUMNAS_DE_IDENTIDAD } from "./esquema";

/**
 * Tablas de identidad tal como las ve Kysely (migraciones 0001, 0002 y 0005). Las columnas son las de
 * `COLUMNAS_DE_IDENTIDAD`, que un test compara con el catálogo de la base real; los tipos de más
 * abajo hacen que el compilador exija que ambas listas digan lo mismo.
 */
export type IdentidadDb = {
  persona: {
    id: Generated<string>;
    email: string;
    activo_global: Generated<boolean>;
    creado_en: Generated<Date>;
    /** 0010: el usuario autenticado vinculado (nulo hasta aceptar una invitación). */
    usuario_auth_id: Generated<string | null>;
  };
  membresia: {
    empresa_id: string;
    persona_id: string;
    rol: string;
    activo: Generated<boolean>;
    invitacion_id: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  asignacion_sucursal: {
    empresa_id: string;
    persona_id: string;
    sucursal_id: string;
    activa: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  invitacion: {
    id: string;
    tenant_id: string;
    tipo: string;
    email: string;
    token_hash: string;
    estado: Generated<string>;
    emitida_en: Date;
    vence_en: Date;
    emitida_por: string | null;
    aceptada_por: string | null;
    aceptada_en: Date | null;
    revocada_en: Date | null;
    motivo_revocacion: string | null;
    reemplazada_por: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  invitacion_empresa: {
    invitacion_id: string;
    empresa_id: string;
    tenant_id: string;
    rol: string;
    email: string;
    token_hash: string;
    estado: Generated<string>;
    tipo: string;
  };
  invitacion_sucursal: {
    invitacion_id: string;
    empresa_id: string;
    sucursal_id: string;
  };
  traspaso_gerencia: {
    id: Generated<string>;
    empresa_id: string;
    origen: string;
    propuesto_por: string | null;
    saliente_persona_id: string | null;
    entrante_persona_id: string;
    estado: Generated<string>;
    propuesto_en: Date;
    vence_en: Date;
    resuelto_en: Date | null;
    motivo: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
};

type Tabla = keyof typeof COLUMNAS_DE_IDENTIDAD;
type Iguales<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Verificación en tiempo de compilación: para cada tabla, las columnas de `IdentidadDb` son
 * exactamente las de `COLUMNAS_DE_IDENTIDAD`. Si una lista cambia sin la otra, esto no compila.
 */
export type ColumnasCoinciden = {
  [T in Tabla]: Iguales<keyof IdentidadDb[T], (typeof COLUMNAS_DE_IDENTIDAD)[T][number]>;
}[Tabla] extends true
  ? true
  : never;
export const COLUMNAS_COINCIDEN: ColumnasCoinciden = true;
