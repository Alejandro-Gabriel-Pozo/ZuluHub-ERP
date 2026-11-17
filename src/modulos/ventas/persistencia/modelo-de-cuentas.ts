import type { PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { Ancla } from "../dominio/ancla";
import type { EstadoDeCuenta, EstadoDeLinea } from "../dominio/estados";
import type { CuentaId, LineaId } from "../dominio/identificadores";

/** Una cuenta tal como está guardada. Los importes y la cantidad son TEXTO decimal exacto (ADR-006). */
export type Cuenta = Readonly<{
  id: CuentaId;
  sucursalId: SucursalId;
  /** El departamento con el que se abrió (no cambia); `null` = sin departamento (cuentas anteriores a 0048 o empresa sin departamentos). */
  departamentoId: string | null;
  ancla: Ancla | null;
  etiqueta: string | null;
  estado: EstadoDeCuenta;
  totalProvisorio: string;
  ultimaPosicion: number;
  abiertaPor: PersonaId;
  abiertaEn: Date;
  resueltaPor: PersonaId | null;
  resueltaEn: Date | null;
  motivo: string | null;
  version: number;
}>;

export type OpcionDeLinea = Readonly<{
  orden: number;
  opcionId: string;
  versionDeOpcionId: string;
  grupoId: string;
  nombreDeGrupo: string;
  nombre: string;
  clase: "INCLUIDA" | "ADICIONAL";
  recargo: string;
  origenDelRecargo: "SUCURSAL" | "EMPRESA";
}>;

export type Linea = Readonly<{
  id: LineaId;
  cuentaId: CuentaId;
  posicion: number;
  productoId: string;
  descripcion: string;
  /** El nombre de cocina del producto al agregar la línea (0055); `null` si no tenía: la cocina usa entonces `descripcion` (CYN 72). */
  nombreDeCocina: string | null;
  varianteOpcionId: string | null;
  varianteNombre: string | null;
  /** La versión de la opción de la variante que se vendió (0036); `null` en una línea sin variante o anterior a 0036. */
  varianteVersionDeOpcionId: string | null;
  precioId: string | null;
  origenDelPrecio: "SUCURSAL" | "EMPRESA" | "ABIERTO";
  precioBase: string;
  precioUnitario: string;
  cantidad: string;
  unidadDeVenta: string;
  pasoDeCantidad: string;
  alicuota: string;
  controlaStock: boolean;
  /** El importe exacto de una línea compartida (0038, E7); `null` en toda otra: ahí vale `precio × cantidad`. */
  importeFijo: string | null;
  /** El camino de clasificación del producto AL VENDER (0047); `null` = «Sin elegir» o una línea anterior a 0047. No cambia nunca. */
  clasificacion: ClasificacionDeLinea | null;
  estado: EstadoDeLinea;
  anuladaPor: PersonaId | null;
  anuladaEn: Date | null;
  motivoDeAnulacion: string | null;
  creadaPor: PersonaId;
  creadaEn: Date;
  opciones: readonly OpcionDeLinea[];
}>;

export type AltaDeCuenta = Readonly<{
  id: CuentaId;
  sucursalId: SucursalId;
  departamentoId: string | null;
  ancla: Ancla | null;
  etiqueta: string | null;
  abiertaPor: PersonaId;
  abiertaEn: Date;
}>;

export type AltaDeLinea = Readonly<{
  id: LineaId;
  cuentaId: CuentaId;
  posicion: number;
  productoId: string;
  descripcion: string;
  /** El nombre de cocina del producto al agregar la línea (0055); `null` si no tenía: la cocina usa entonces `descripcion` (CYN 72). */
  nombreDeCocina: string | null;
  varianteOpcionId: string | null;
  varianteNombre: string | null;
  /** La versión de la opción de la variante que se vendió (0036); `null` en una línea sin variante o anterior a 0036. */
  varianteVersionDeOpcionId: string | null;
  precioId: string | null;
  origenDelPrecio: "SUCURSAL" | "EMPRESA" | "ABIERTO";
  precioBase: string;
  precioUnitario: string;
  cantidad: string;
  unidadDeVenta: string;
  pasoDeCantidad: string;
  alicuota: string;
  controlaStock: boolean;
  /** Solo lo escribe la copia COMPARTIDA de una línea (0038, E7). */
  importeFijo?: string | null | undefined;
  /** El camino de clasificación del producto al vender (0047); sin dato, «Sin elegir». */
  clasificacion?: ClasificacionDeLinea | null | undefined;
  creadaPor: PersonaId;
  creadaEn: Date;
  opciones: readonly OpcionDeLinea[];
}>;

/** El camino de clasificación comercial congelado en el renglón: del departamento al nodo del producto, con los nombres de ese momento (0047). */
export type ClasificacionDeLinea = Readonly<{
  departamentoId: string;
  camino: readonly Readonly<{ id: string; nombre: string }>[];
}>;

/** Cómo se copió una línea (`linea_copiada`, 0038). */
export type ModoDeCopia = "COMPLETA" | "POR_UNIDADES" | "COMPARTIDA" | "RESTO";

export type CopiaDeLinea = Readonly<{
  lineaNuevaId: LineaId;
  lineaOrigenId: LineaId;
  modo: ModoDeCopia;
}>;
