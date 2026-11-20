import type { LibroRegistrado, MedidaDeLibro } from "../../src/primitivas/libro/publico";
import { FORMA_DE_CLAVE } from "../../src/primitivas/libro/publico";
import { ROL_DE_LA_APLICACION, type CodigoDeInvariante } from "./libros-conformidad-apoyo";

/**
 * Los libros EFÍMEROS de la prueba de conformidad: en un esquema aparte se arma un libro que cumple todo (la plantilla del §2.4 del diseño)
 * y, por cada invariante, una copia a la que se le quita justo esa. La conformidad tiene que detectar esa y solo esa: sin la violación
 * inyectada, la prueba no demuestra que detecta nada.
 */

export const ESQUEMA_EFIMERO = "libros_efimeros";

type Ddl = Readonly<{ tabla: string; sentencias: readonly string[] }>;

/**
 * Las sentencias de un libro efímero que rompe `rota` (o ninguna invariante si es `null`). `tabla` es el nombre sin esquema. La tabla
 * madre (`<tabla>_madre`) existe para tener una clave foránea compuesta que probar.
 */
export function ddlDeLibroEfimero(
  tabla: string,
  medida: MedidaDeLibro,
  rota: CodigoDeInvariante | null,
): Ddl {
  const e = ESQUEMA_EFIMERO;
  const t = `"${e}"."${tabla}"`;
  const madre = `"${e}"."${tabla}_madre"`;
  const sin = (codigo: CodigoDeInvariante): boolean => rota === codigo;
  const importe = medida === "IMPORTE";
  // Una columna menos y una restricción menos por cada invariante rota; el resto del libro queda intacto.
  const columnas = [
    `id uuid PRIMARY KEY`,
    `empresa_id uuid NOT NULL REFERENCES public.empresa (id)`,
    `madre_id uuid NOT NULL`,
    `clase text NOT NULL CHECK (clase IN ('ENTRADA', 'ANULACION'))`,
    importe ? `importe numeric(18,2) NOT NULL` : `cantidad numeric(18,4) NOT NULL`,
    ...(importe ? [`moneda char(3) NOT NULL CONSTRAINT moneda_ck CHECK (moneda = 'ARS')`] : []),
    ...(sin("MEDIDA_UNA_SOLA_FORMA")
      ? [importe ? `cantidad numeric(18,4)` : `moneda char(3)`]
      : []),
    `anula_a uuid`,
    `clave_idempotencia text ${sin("C3_CLAVE_NO_NULA") ? "" : "NOT NULL"}`,
    `huella text NOT NULL`,
    ...(sin("C4_MOMENTO") ? [] : [`registrado_en timestamptz NOT NULL`]),
    sin("C4_AUTOR")
      ? `registrado_por uuid`
      : `registrado_por uuid NOT NULL REFERENCES public.persona (id)`,
    sin("C4_FECHA_DE_NEGOCIO") ? `fecha_negocio date` : `fecha_negocio date NOT NULL`,
    `origen_tipo text NOT NULL`,
    `origen_id uuid`,
  ];
  const medidaColumna = importe ? "importe" : "cantidad";
  const restricciones = [
    sin("C2_UNICO_ID_Y_EMPRESA")
      ? null
      : `CONSTRAINT ${tabla}_id_empresa_uk UNIQUE (id, empresa_id)`,
    sin("C2_FK_CON_EMPRESA")
      ? `CONSTRAINT madre_fk FOREIGN KEY (madre_id) REFERENCES ${madre} (id)`
      : `CONSTRAINT madre_fk FOREIGN KEY (madre_id, empresa_id) REFERENCES ${madre} (id, empresa_id)`,
    // La anulación apunta al mismo libro por (id, empresa_id): sin esa clave única no puede existir.
    sin("C2_UNICO_ID_Y_EMPRESA")
      ? null
      : `CONSTRAINT anula_fk FOREIGN KEY (anula_a, empresa_id) REFERENCES ${t} (id, empresa_id)`,
    sin("C3_UNICO_DE_CLAVE")
      ? null
      : `CONSTRAINT ${tabla}_clave_uk UNIQUE (empresa_id, clave_idempotencia)`,
    sin("C3_FORMA_DE_CLAVE")
      ? null
      : `CONSTRAINT clave_ck CHECK (clave_idempotencia ~ '${FORMA_DE_CLAVE.source}')`,
    sin("C3_FORMA_DE_HUELLA") ? null : `CONSTRAINT huella_ck CHECK (huella ~ '^[0-9a-f]{64}$')`,
    sin("C5_UNICO_DE_ANULACION")
      ? null
      : `CONSTRAINT ${tabla}_anula_uk UNIQUE (empresa_id, anula_a)`,
    sin("C5_CHECK_DEL_ESPEJO")
      ? null
      : `CONSTRAINT espejo_ck CHECK ((clase = 'ANULACION') = (anula_a IS NOT NULL) AND anula_a IS DISTINCT FROM id)`,
    sin("C6_MAGNITUD_DISTINTA_DE_CERO")
      ? null
      : `CONSTRAINT magnitud_ck CHECK (${medidaColumna} <> 0)`,
  ].filter((x): x is string => x !== null);
  const sentencias = [
    `CREATE TABLE ${madre} (id uuid PRIMARY KEY, empresa_id uuid NOT NULL, CONSTRAINT ${tabla}_madre_uk UNIQUE (id, empresa_id))`,
    `CREATE TABLE ${t} (${[...columnas, ...restricciones].join(", ")})`,
    ...(sin("C3_IDENTIDAD_POR_ORIGEN")
      ? []
      : [
          `CREATE UNIQUE INDEX origen_${tabla}_uk ON ${t} (empresa_id, clase, origen_tipo, origen_id) WHERE origen_tipo <> 'MANUAL'`,
        ]),
    ...(sin("C1_SOLO_INSERCION_DE_FILA")
      ? []
      : [
          `CREATE TRIGGER ${tabla}_solo_insercion BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION public.solo_insercion()`,
        ]),
    ...(sin("C1_SOLO_INSERCION_DE_TRUNCATE")
      ? []
      : [
          `CREATE TRIGGER ${tabla}_sin_truncate BEFORE TRUNCATE ON ${t} FOR EACH STATEMENT EXECUTE FUNCTION public.solo_insercion()`,
        ]),
    ...(sin("C2_RLS_ACTIVA") ? [] : [`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`]),
    ...(sin("C2_RLS_FORZADA") ? [] : [`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`]),
    `CREATE POLICY leer ON ${t} FOR SELECT TO ${ROL_DE_LA_APLICACION} USING (${
      sin("C2_POLITICA_POR_EMPRESA") ? "true" : "empresa_id = (SELECT public.app_empresa_id())"
    })`,
    sin("C1_SIN_PRIVILEGIOS_DE_ESCRITURA")
      ? `GRANT SELECT, INSERT, UPDATE ON ${t} TO ${ROL_DE_LA_APLICACION}`
      : `GRANT SELECT, INSERT ON ${t} TO ${ROL_DE_LA_APLICACION}`,
  ];
  return { tabla, sentencias };
}

/** El libro registrado que describe a un libro efímero (la misma forma que un libro real). */
export function libroEfimero(tabla: string, medida: MedidaDeLibro): LibroRegistrado {
  return {
    nombre: tabla,
    tabla,
    medida,
    tablaDeMedida: tabla,
    columnaDeMedida: medida === "IMPORTE" ? "importe" : "cantidad",
    columnaDeClave: "clave_idempotencia",
    formaDeClave: FORMA_DE_CLAVE.source,
    columnaDeMomento: "registrado_en",
    columnaDeFecha: "fecha_negocio",
    identidadPorOrigen: ["empresa_id", "clase", "origen_tipo", "origen_id"],
    excepciones: [],
  };
}
