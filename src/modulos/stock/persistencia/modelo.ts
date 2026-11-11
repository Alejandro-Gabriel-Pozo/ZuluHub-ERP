import type { EmpresaId, PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { esClaseDeMovimiento, type ClaseDeMovimiento } from "../dominio/movimiento";

/**
 * Lo que devuelven los repositorios de stock: filas ya convertidas (los decimales siguen siendo TEXTO exacto; las fechas de negocio, texto
 * `YYYY-MM-DD`). Los ids son texto: el dominio de stock los trata así y los de este módulo no se mezclan con los de otros por tipo sino por
 * los nombres de los campos. Solo tipos y las listas cerradas que la base también declara; ninguna regla.
 */

/** Los usos de un depósito (CHECK `deposito_uso_ck`; una prueba de integración compara las dos listas). */
export const USOS_DE_DEPOSITO = ["NORMAL", "CUARENTENA", "RECHAZO"] as const;
export type UsoDeDeposito = (typeof USOS_DE_DEPOSITO)[number];

export const esUsoDeDeposito = (texto: string): texto is UsoDeDeposito =>
  (USOS_DE_DEPOSITO as readonly string[]).includes(texto);

export type Deposito = Readonly<{
  id: string;
  empresaId: EmpresaId;
  sucursalId: SucursalId;
  nombre: string;
  nombreClave: string;
  uso: UsoDeDeposito;
  deVenta: boolean;
  activo: boolean;
  version: number;
}>;

export type Articulo = Readonly<{
  id: string;
  productoId: string;
  /** La unidad base del producto (inmutable): en ella está todo el libro. */
  unidadDeStockId: string;
  dimension: string;
  activo: boolean;
  version: number;
}>;

export const ESTADOS_DE_CONTEO = ["ABIERTO", "APLICADO", "CANCELADO"] as const;
export type EstadoDeConteo = (typeof ESTADOS_DE_CONTEO)[number];

export type Conteo = Readonly<{
  id: string;
  depositoId: string;
  estado: EstadoDeConteo;
  abiertoPor: PersonaId;
  abiertoEn: Date;
  resueltoPor: PersonaId | null;
  resueltoEn: Date | null;
  /** Solo el de la cancelación. */
  motivo: string | null;
  version: number;
}>;

/** Un registro del conteo (solo inserción). De varios del mismo artículo vale el de mayor `orden`. */
export type RegistroGuardado = Readonly<{
  id: string;
  conteoId: string;
  articuloId: string;
  /** Texto decimal exacto, en la unidad de stock. */
  cantidadContada: string;
  /** La existencia del depósito al registrar (la fija la base). */
  existenciaAlRegistrar: string;
  registradoPor: PersonaId;
  registradoEn: Date;
  orden: number;
}>;

export type Movimiento = Readonly<{
  id: string;
  clase: ClaseDeMovimiento;
  motivo: string;
  detalle: string | null;
  origenTipo: string;
  origenId: string | null;
  /** El depósito del acto (el de origen en una transferencia). */
  depositoId: string;
  /** La autorización que lo causó (`stock.registrar_entrada`...). */
  accion: string;
  anulaA: string | null;
  conteoId: string | null;
  clave: string;
  huella: string;
  hechoEn: Date;
  registradoEn: Date;
  /** `YYYY-MM-DD`: la jornada de negocio que fijó la base. */
  fechaDeNegocio: string;
  registradoPor: PersonaId;
}>;

export type RenglonGuardado = Readonly<{
  numero: number;
  depositoId: string;
  articuloId: string;
  /** Con signo, texto decimal exacto, en la unidad de stock. */
  cantidad: string;
  composicionId: string | null;
  confirmoNegativo: boolean;
}>;

export type ComponenteGuardado = Readonly<{
  numero: number;
  articuloId: string;
  /** Texto decimal exacto, en `unidadId`. */
  cantidad: string;
  unidadId: string;
  dimension: string;
  /** En puntos porcentuales; 0 mientras no exista la perilla de pérdida. */
  perdida: string;
}>;

/** Una versión de composición con sus componentes (ordenados por `numero`). Una versión SIN componentes retira la receta. */
export type ComposicionGuardada = Readonly<{
  id: string;
  empresaId: EmpresaId;
  productoId: string;
  numero: number;
  rinde: string;
  creadaPor: PersonaId;
  creadaEn: Date;
  componentes: readonly ComponenteGuardado[];
}>;

/** Un motivo sembrado, tal como lo guarda la tabla global. */
export type MotivoGuardado = Readonly<{
  clase: ClaseDeMovimiento;
  codigo: string;
  entraConCosto: boolean;
  entregaMercaderia: boolean;
}>;

/** Un texto de la base que no es una clase conocida es una falla (nunca se autoriza a ciegas). */
export function claseDeMovimientoGuardada(texto: string): ClaseDeMovimiento {
  if (esClaseDeMovimiento(texto)) return texto;
  throw new RangeError(`clase de movimiento inválida en la base: ${texto}`);
}

export function usoDeDepositoGuardado(texto: string): UsoDeDeposito {
  if (esUsoDeDeposito(texto)) return texto;
  throw new RangeError(`uso de depósito inválido en la base: ${texto}`);
}

export function estadoDeConteoGuardado(texto: string): EstadoDeConteo {
  const estado = ESTADOS_DE_CONTEO.find((e) => e === texto);
  if (estado === undefined) throw new RangeError(`estado de conteo inválido en la base: ${texto}`);
  return estado;
}
