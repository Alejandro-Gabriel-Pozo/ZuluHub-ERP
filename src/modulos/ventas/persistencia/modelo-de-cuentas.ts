import type { PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { Ancla } from "../dominio/ancla";
import type { EstadoDeCuenta, EstadoDeLinea } from "../dominio/estados";
import type { CuentaId, LineaId } from "../dominio/identificadores";

/** Una cuenta tal como está guardada. Los importes y la cantidad son TEXTO decimal exacto (ADR-006). */
export type Cuenta = Readonly<{
  id: CuentaId;
  sucursalId: SucursalId;
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
  creadaPor: PersonaId;
  creadaEn: Date;
  opciones: readonly OpcionDeLinea[];
}>;

/** Cómo se copió una línea (`linea_copiada`, 0038). */
export type ModoDeCopia = "COMPLETA" | "POR_UNIDADES" | "COMPARTIDA" | "RESTO";

export type CopiaDeLinea = Readonly<{
  lineaNuevaId: LineaId;
  lineaOrigenId: LineaId;
  modo: ModoDeCopia;
}>;
