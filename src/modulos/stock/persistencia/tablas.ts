/**
 * Lo que stock LEE de las tablas del catálogo (0025). Es la única lectura de tablas de otro módulo y se permite porque `stock` requiere
 * `catalogo` (E5 §3.3): acá se declaran, una por una, las columnas que lee (nada más), con el tipo con que llegan (los decimales, como
 * TEXTO: ADR-006). Stock no escribe estas tablas. Una prueba (`stock-persistencia.test.ts`) compara cada columna con `COLUMNAS_DE_CATALOGO`
 * (lo que el catálogo declara de sí) y con el catálogo real de la base: si el catálogo cambia o quita una de estas columnas, falla ahí y no
 * en producción. Previene: que un cambio del catálogo rompa en silencio una lectura de stock.
 */
export type TablasDeCatalogoQueLeeStock = {
  producto: {
    id: string;
    empresa_id: string;
    nombre: string;
    nombre_clave: string;
    clase_de_uso: string;
    unidad_base_id: string;
    dimension: string;
    activo: boolean;
  };
  version_de_opcion: {
    id: string;
    empresa_id: string;
    factor_de_tamano: string;
  };
  consumo_de_opcion: {
    empresa_id: string;
    version_de_opcion_id: string;
    numero: number;
    insumo_id: string;
    cantidad: string;
    escala_con_tamano: boolean;
  };
};

/** Las columnas leídas, por tabla, tal cual se declaran arriba (la prueba exige que coincidan con el tipo: el compilador lo impone al revés). */
export const COLUMNAS_DE_CATALOGO_QUE_LEE_STOCK = {
  producto: [
    "id",
    "empresa_id",
    "nombre",
    "nombre_clave",
    "clase_de_uso",
    "unidad_base_id",
    "dimension",
    "activo",
  ],
  version_de_opcion: ["id", "empresa_id", "factor_de_tamano"],
  consumo_de_opcion: [
    "empresa_id",
    "version_de_opcion_id",
    "numero",
    "insumo_id",
    "cantidad",
    "escala_con_tamano",
  ],
} as const satisfies {
  [
    Tabla in keyof TablasDeCatalogoQueLeeStock
  ]: readonly (keyof TablasDeCatalogoQueLeeStock[Tabla])[];
};

/** Las columnas de arriba que son decimales (`numeric` en la base): llegan y se comparan como texto. La prueba exige que sigan siéndolo. */
export const DECIMALES_DE_CATALOGO_QUE_LEE_STOCK = [
  ["version_de_opcion", "factor_de_tamano"],
  ["consumo_de_opcion", "cantidad"],
] as const;
