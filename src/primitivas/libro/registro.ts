import { FORMA_DE_CLAVE } from "./clave";

/**
 * El registro de los libros que la prueba de conformidad (`test/integracion/libros-conformidad.test.ts`) comprueba contra el catálogo de
 * la base (`primitiva-de-libro-diseno.md` §2.1 y §2.2). Son datos: no leen la base ni el reloj.
 *
 * Previene: un libro nuevo que se olvida del espejo único, del `TRUNCATE` o de la RLS. Un libro que no figura acá no se comprueba: cada
 * libro nuevo se suma en el PR de su migración (el de saldos, en LB-3), para que pase la conformidad desde el primer día.
 *
 * Stock y caja entran TAL COMO ESTÁN (no se migran: unificar claves rompería las ya guardadas, §2.5). Sus divergencias conocidas son
 * `excepciones` con motivo y vencimiento; la prueba falla si una excepción ya no hace falta, si se quita (el libro deja de pasar) o si
 * vence sin renovarse. No van en `arquitectura/deuda/registro.json`: el tope de excepciones está lleno (DEC-0824).
 */

export type MedidaDeLibro = "IMPORTE" | "CANTIDAD";

/** Cada excepción exime de UNA invariante de la prueba (el mapa está en `test/integracion/libros-conformidad-apoyo.ts`). */
export type CodigoDeExcepcion =
  | "CLAVE_DE_FORMA_DISTINTA"
  | "CLAVE_NULA_EN_FONDO_INICIAL"
  | "SIN_FECHA_DE_NEGOCIO"
  | "MAGNITUD_CERO_PERMITIDA";

export type ExcepcionDeLibro = Readonly<{
  codigo: CodigoDeExcepcion;
  motivo: string;
  /** `AAAA-MM-DD`: como máximo 60 días después de crearse (el mismo tope que las excepciones de `arquitectura/deuda`). */
  vence: string;
}>;

export type LibroRegistrado = Readonly<{
  nombre: string;
  /** La tabla del asiento (cabecera, si el libro tiene renglones). */
  tabla: string;
  medida: MedidaDeLibro;
  /** La tabla que lleva la medida (`importe` o `cantidad`): la misma `tabla`, o el renglón del libro de stock. */
  tablaDeMedida: string;
  columnaDeMedida: "importe" | "cantidad";
  columnaDeClave: string;
  /** El texto (`source`) de la expresión regular de la forma de la clave, tal como la copia el CHECK de la base. */
  formaDeClave: string;
  columnaDeMomento: string;
  columnaDeFecha: string;
  /** Las columnas de la identidad por origen (índice único), o `null` si el libro no la lleva en su propia tabla. */
  identidadPorOrigen: readonly string[] | null;
  excepciones: readonly ExcepcionDeLibro[];
}>;

/** 60 días después del 20/11/2026, el tope de las excepciones del registro de deuda. */
const VENCE = "2027-01-19";

export const LIBROS_REGISTRADOS: readonly LibroRegistrado[] = [
  {
    nombre: "stock",
    tabla: "movimiento_de_stock",
    medida: "CANTIDAD",
    // La cantidad con signo vive en el renglón del movimiento (`renglon_de_movimiento.cantidad`), no en la cabecera.
    tablaDeMedida: "renglon_de_movimiento",
    columnaDeMedida: "cantidad",
    columnaDeClave: "clave_idempotencia",
    // El literal es el CHECK de `0030_stock.sql` (`movimiento_de_stock_clave_ck`); ensancharlo o achicarlo rompería claves guardadas.
    formaDeClave: "^[A-Za-z0-9_-]{8,200}$",
    columnaDeMomento: "registrado_en",
    columnaDeFecha: "fecha_negocio",
    identidadPorOrigen: ["empresa_id", "clase", "origen_tipo", "origen_id"],
    excepciones: [
      {
        codigo: "CLAVE_DE_FORMA_DISTINTA",
        motivo:
          "La clave de stock admite de 8 a 200 caracteres y la de los libros nuevos de 16 a 128: igualarlas rompería claves ya guardadas.",
        vence: VENCE,
      },
    ],
  },
  {
    nombre: "caja",
    tabla: "movimiento_caja",
    medida: "IMPORTE",
    tablaDeMedida: "movimiento_caja",
    columnaDeMedida: "importe",
    columnaDeClave: "clave_idempotencia",
    formaDeClave: FORMA_DE_CLAVE.source,
    columnaDeMomento: "registrado_en",
    columnaDeFecha: "fecha_negocio",
    // El origen de un cobro está en la tabla `cobro` (`cobro_origen_uk`), no en el movimiento.
    identidadPorOrigen: null,
    excepciones: [
      {
        codigo: "CLAVE_NULA_EN_FONDO_INICIAL",
        motivo:
          "El fondo inicial de una sesión no lleva clave ni huella (movimiento_caja_idempotencia_ck): su identidad es una por sesión (movimiento_caja_fondo_uk).",
        vence: VENCE,
      },
      {
        codigo: "SIN_FECHA_DE_NEGOCIO",
        motivo:
          "El movimiento de caja no guarda la fecha de negocio: es la de su sesión (sesion_caja.fecha_negocio) y el movimiento se une a ella.",
        vence: VENCE,
      },
      {
        codigo: "MAGNITUD_CERO_PERMITIDA",
        motivo:
          "El fondo inicial puede ser cero (movimiento_caja_signo_ck exige importe mayor o igual a cero en esa clase); las demás clases lo excluyen por signo.",
        vence: VENCE,
      },
    ],
  },
  {
    nombre: "saldos",
    tabla: "asiento_de_saldo",
    medida: "IMPORTE",
    tablaDeMedida: "asiento_de_saldo",
    columnaDeMedida: "importe",
    columnaDeClave: "clave_idempotencia",
    formaDeClave: FORMA_DE_CLAVE.source,
    columnaDeMomento: "registrado_en",
    columnaDeFecha: "fecha_negocio",
    // El espejo comparte origen con su original: por eso la identidad es un índice parcial (`WHERE anula_a IS NULL`).
    identidadPorOrigen: ["empresa_id", "origen_tipo", "origen_id", "origen_orden"],
    excepciones: [],
  },
];
