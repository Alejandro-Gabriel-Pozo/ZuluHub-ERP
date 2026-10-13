import type { Generated } from "kysely";
import type { COLUMNAS_DE_FISCAL } from "./esquema";

/**
 * Tablas fiscales tal como las ve Kysely (migración 0006). Las columnas son las de
 * `COLUMNAS_DE_FISCAL`, que un test compara con el catálogo de la base real; el tipo del final hace
 * que el compilador exija que ambas listas digan lo mismo.
 *
 * Tres cosas a tener en cuenta al leer o escribir:
 *  - `ultimo_numero` y `numero_en_curso` son `bigint` en la base y `pg` los devuelve como TEXTO: el
 *    repositorio los convierte (el dominio usa `bigint`) y los escribe como texto.
 *  - `inicio_actividades` es `date`: `pg` lo devolvería como un `Date` a la medianoche local, que
 *    corre un día según el huso. Se lee siempre con `to_char(..., 'YYYY-MM-DD')`.
 *  - No hay tabla `comprobante` ni `certificado_arca`: son de la facturación.
 */
export type FiscalDb = {
  /**
   * Solo lectura y solo tres columnas: el CUIT del emisor principal ES `empresa.cuit` (spec §B.2) y
   * el repositorio de emisores lo une. Esta tabla es del módulo de empresas; acá no se escribe.
   */
  empresa: {
    id: string;
    cuit: string;
    estado: string;
  };
  provincia: {
    codigo: string;
    nombre: string;
    codigo_arca: number | null;
  };
  emisor: {
    id: Generated<string>;
    empresa_id: string;
    es_principal: boolean;
    activo: Generated<boolean>;
    cuit: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  domicilio: {
    id: Generated<string>;
    empresa_id: string;
    calle: string;
    numero: string;
    piso: string | null;
    departamento: string | null;
    localidad: string;
    provincia: string;
    codigo_postal: string | null;
    creado_en: Generated<Date>;
  };
  datos_fiscales: {
    id: Generated<string>;
    empresa_id: string;
    emisor_id: string;
    estado: Generated<string>;
    numero: number | null;
    razon_social: string | null;
    condicion_iva: string | null;
    domicilio_fiscal_id: string | null;
    inicio_actividades: string | null;
    iibb_numero: string | null;
    iibb_condicion: string | null;
    vigente_desde: Date | null;
    confirmada_en: Date | null;
    confirmada_por: string | null;
    motivo: string | null;
    creado_por: string;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  regla_emisor: {
    id: Generated<string>;
    empresa_id: string;
    estado: Generated<string>;
    numero: number | null;
    permitir_eleccion_manual: Generated<boolean>;
    vigente_desde: Date | null;
    confirmada_en: Date | null;
    confirmada_por: string | null;
    motivo: string | null;
    creado_por: string;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  punto_de_venta: {
    id: Generated<string>;
    empresa_id: string;
    emisor_id: string;
    sucursal_id: string;
    domicilio_id: string | null;
    numero: number;
    estado: Generated<string>;
    verificacion_arca: Generated<string>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
    /** 0009: HOMOLOGACION o PRODUCCION. Lo lee la facturación (F3); T4 no lo usa. */
    ambiente: Generated<string>;
  };
  serie_comprobante: {
    empresa_id: string;
    punto_de_venta_id: string;
    emisor_id: string;
    tipo_comprobante: string;
    ultimo_numero: string;
    estado: Generated<string>;
    numero_en_curso: string | null;
    solicitud_en_curso: string | null;
    en_curso_hasta: Date | null;
    motivo_bloqueo: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
    /** 0009: parte de la clave de la serie. Sin valor por defecto: se dice siempre. */
    ambiente: string;
  };
};

type Tabla = keyof typeof COLUMNAS_DE_FISCAL;
type Iguales<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Verificación en tiempo de compilación: para cada tabla fiscal, las columnas de `FiscalDb` son
 * exactamente las de `COLUMNAS_DE_FISCAL`. Si una lista cambia sin la otra, esto no compila.
 */
export type ColumnasCoinciden = {
  [T in Tabla]: Iguales<keyof FiscalDb[T], (typeof COLUMNAS_DE_FISCAL)[T][number]>;
}[Tabla] extends true
  ? true
  : never;
export const COLUMNAS_COINCIDEN: ColumnasCoinciden = true;
