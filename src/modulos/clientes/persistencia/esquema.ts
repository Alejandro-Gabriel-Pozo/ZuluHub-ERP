import type { ColumnType, Generated } from "kysely";

/** Una columna que la base calcula: se lee, nunca se escribe. */
type Calculada<T> = ColumnType<T, never, never>;

/**
 * Las tablas del directorio (0034). Las fechas de auditoría las completa la base (`Generated`). Las columnas generadas (`nombre_busqueda`,
 * `documento_normalizado`, `telefono_digitos`) solo se leen: la base las calcula y el código no las puede falsear. Un test compara estas columnas con
 * el catálogo de la base (`clientes-persistencia.test.ts`).
 */
export type ClientesDb = {
  rol_de_parte: { codigo: string; descripcion: string };
  tipo_de_vinculo: {
    codigo: string;
    descripcion: string;
    contacto_humana: boolean;
    de_parte_juridica: boolean;
  };
  parte: {
    /** Lo genera la base (la idempotencia del alta es `idempotencia_alta`). */
    id: Generated<string>;
    empresa_id: string;
    /** La manda la pantalla; única por empresa. */
    idempotencia_alta: string;
    naturaleza: string;
    nombre: string | null;
    apellido: string | null;
    alias: string | null;
    documento_tipo: string | null;
    documento_pais: string | null;
    documento_numero: string | null;
    condicion_iva: string | null;
    email: string | null;
    telefono: string | null;
    dom_pais: string | null;
    dom_calle: string | null;
    dom_numero: string | null;
    dom_piso: string | null;
    dom_departamento: string | null;
    dom_localidad: string | null;
    dom_provincia: string | null;
    dom_codigo_postal: string | null;
    dom_texto: string | null;
    nota: string | null;
    estado: Generated<string>;
    anonimizada_en: Date | null;
    es_atajo: Generated<boolean>;
    creado_por: string | null;
    /** Columnas generadas: solo lectura. */
    nombre_busqueda: Calculada<string>;
    documento_normalizado: Calculada<string | null>;
    telefono_digitos: Calculada<string | null>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  parte_rol: {
    empresa_id: string;
    parte_id: string;
    rol: string;
    activo: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  parte_vinculo: {
    empresa_id: string;
    parte_id: string;
    de_parte_id: string;
    tipo: string;
    cargo: string | null;
    activo: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
};
