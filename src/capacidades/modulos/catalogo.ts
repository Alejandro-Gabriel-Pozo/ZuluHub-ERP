/**
 * ARCHIVO CENTRAL
 * QUÉ ES: la lista de los módulos comerciales (ADR-003); de acá salen los tipos cerrados `ClaveModulo`, `ClaveAccion` y `ClaveCapacidad`,
 * así que una acción sin módulo, o un permiso para una acción que no existe, no compila. Es código, no base de datos.
 * QUÉ NO ES: el lugar donde se escriben las acciones de un módulo.
 * EXPORTA: EstadoDeConstruccion, EfectoDeAccion, EFECTOS_DE_ACCION, DefinicionDeAccion, DefinicionDeModulo, CatalogoComercial, CATALOGO_DE_MODULOS, ClaveModulo, ClaveAccion, ClaveCapacidad
 * IMPORTA: src/capacidades/modulos/catalogo-*.
 * PARTE DEDICADA: src/capacidades/modulos/catalogo-<módulo>.ts (lo de cada módulo va ahí).
 */
import { MODULO_DE_ADMINISTRACION } from "./catalogo-administracion";
import { MODULO_DE_CAJA } from "./catalogo-caja";
import { MODULO_DE_CATALOGO } from "./catalogo-catalogo";
import { MODULO_DE_CIERRE } from "./catalogo-cierre";
import { MODULO_DE_CLIENTES } from "./catalogo-clientes";
import { MODULO_DE_COMPRAS } from "./catalogo-compras";
import { MODULO_DE_FACTURACION } from "./catalogo-facturacion";
import { MODULO_DE_PRODUCCION } from "./catalogo-lotes-y-produccion";
import { MODULOS_DE_SALON_Y_COMANDAS } from "./catalogo-salon-y-comandas";
import { MODULO_DE_STOCK } from "./catalogo-stock";
import { MODULO_DE_VENTAS } from "./catalogo-ventas";
import { MODULO_DE_VIDRIERA } from "./catalogo-vidriera";

export type EstadoDeConstruccion = "disponible" | "en_desarrollo";
/**
 * Qué hace una acción con lo que la empresa ya tiene (reglas transversales §7.9). Decide qué pasa
 * cuando un módulo queda en SOLO LECTURA (una baja de plan lo dejó fuera del techo):
 *  - `LECTURA`: solo mira. Se permite.
 *  - `COMPLETA_CIERRA`: escritura que completa, cierra, cancela o reduce lo ya iniciado (cerrar una
 *    cuenta, cancelar, anular, apagar, desactivar, responder una propuesta). Se permite: una baja de
 *    plan no deja obligaciones existentes bloqueadas sin salida.
 *  - `CREA_AMPLIA`: escritura que crea algo nuevo o amplía lo que hay (alta, cambio de configuración,
 *    reactivar, ampliar un alcance). Se rechaza con `MODULO_EN_SOLO_LECTURA`.
 * Ante la duda entre las dos escrituras, la acción es `CREA_AMPLIA`: bloquear de más es visible y se
 * corrige reclasificando; permitir de más deja crecer un módulo que el plan ya no incluye.
 */
export type EfectoDeAccion = "LECTURA" | "CREA_AMPLIA" | "COMPLETA_CIERRA";

/** Los tres efectos, en una lista que las pruebas recorren (el tipo `EfectoDeAccion` es la fuente). */
export const EFECTOS_DE_ACCION = [
  "LECTURA",
  "CREA_AMPLIA",
  "COMPLETA_CIERRA",
] as const satisfies readonly EfectoDeAccion[];

/**
 * Una acción del módulo. `capacidad`: la capacidad de sucursal que exige, o `null` si no exige ninguna.
 * `efecto`: obligatorio en TODA acción (una acción sin clasificar no compila): ver `EfectoDeAccion`.
 */
export type DefinicionDeAccion<C extends string = string> = Readonly<{
  capacidad: C | null;
  efecto: EfectoDeAccion;
}>;

export type DefinicionDeModulo = Readonly<{
  estado: EstadoDeConstruccion;
  /** Siempre activo para toda empresa; no se guarda por empresa. */
  obligatorio: boolean;
  /** Módulos que tienen que estar activos para activar este (sin ciclos: cruce X3). */
  requiere: readonly string[];
  usaSiExiste: readonly string[];
  /** Vacío hasta H7 (`capacidades/habilitacion`). */
  datosRequeridos: readonly string[];
  /** Carpetas de `src/` que implementan el módulo, p. ej. `modulos/identidad` (cruces X1 y X4). */
  implementadoPor: readonly string[];
  acciones: Readonly<Record<string, DefinicionDeAccion>>;
}>;

export type CatalogoComercial = Readonly<Record<string, DefinicionDeModulo>>;

export const CATALOGO_DE_MODULOS = {
  administracion: MODULO_DE_ADMINISTRACION,
  facturacion: MODULO_DE_FACTURACION,
  catalogo: MODULO_DE_CATALOGO,
  vidriera: MODULO_DE_VIDRIERA,
  stock: MODULO_DE_STOCK,
  caja: MODULO_DE_CAJA,
  cierre: MODULO_DE_CIERRE,
  ventas: MODULO_DE_VENTAS,
  ...MODULOS_DE_SALON_Y_COMANDAS,
  clientes: MODULO_DE_CLIENTES,
  compras: MODULO_DE_COMPRAS,
  produccion: MODULO_DE_PRODUCCION,
} as const satisfies CatalogoComercial;

type Catalogo = typeof CATALOGO_DE_MODULOS;

export type ClaveModulo = keyof Catalogo;
export type ClaveAccion = { [M in ClaveModulo]: keyof Catalogo[M]["acciones"] }[ClaveModulo];

type CapacidadDe<D> = D extends { capacidad: infer C } ? C : never;

/** Las capacidades de sucursal que exige alguna acción. Hoy ninguna: es `never`. */
export type ClaveCapacidad = Exclude<
  {
    [M in ClaveModulo]: CapacidadDe<Catalogo[M]["acciones"][keyof Catalogo[M]["acciones"]]>;
  }[ClaveModulo],
  null
>;
