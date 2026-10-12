import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { EmisorId, PuntoDeVentaId, VersionId } from "./identificadores";
import {
  confirmarVersion,
  versionVigente,
  type DatosDeConfirmacion,
  type ErrorDeConfirmacion,
  type VersionConfirmada,
} from "./vigencia";

/**
 * Regla de resolución del emisor (spec H7 §B.6, nivel 4): el emisor de cada línea a facturar se
 * resuelve en UN solo lugar, con una regla enchufable, versionada y confirmada por el gerente.
 *
 * Cascada (`funciones-de-pago.md`):
 * 1. producto o depósito EXCLUSIVO de un emisor: ese emisor. Si el producto y el depósito dicen
 *    emisores distintos es `EMISOR_EN_CONFLICTO` (no se descuenta stock de un depósito ajeno a su
 *    emisor). Lo exclusivo es una invariante, no una preferencia: ninguna regla lo pisa;
 * 2. el punto de venta elegido para lo que se factura: su emisor;
 * 3. la elección manual, solo si la regla la permite.
 *
 * «Enchufable» es un parámetro de tipo cerrado (`ReglaDeEmisor`): un paso nuevo (por ejemplo la
 * caja) es un campo y un caso más en este tipo, no un motor genérico. Función pura: sin reloj, sin
 * azar y sin I/O; los datos los aportan el catálogo, el stock y quien factura.
 */
export type ReglaDeEmisor = Readonly<{ permitirEleccionManual: boolean }>;

/** Sin versiones confirmadas rige la cascada con la elección manual PERMITIDA (supuesto, ADR-008). */
export const REGLA_DE_EMISOR_POR_DEFECTO: ReglaDeEmisor = { permitirEleccionManual: true };

/** Una versión confirmada de la regla (su vigencia es la misma que la de los datos fiscales). */
export type VersionDeReglaDeEmisor = VersionConfirmada & ReglaDeEmisor;

/** La regla que rige en `ahora`, o la de por defecto si todavía no se confirmó ninguna versión. */
export function reglaDeEmisorVigente(
  versiones: readonly VersionDeReglaDeEmisor[],
  ahora: Date,
): ReglaDeEmisor {
  const vigente = versionVigente(versiones, ahora);
  return vigente === null
    ? REGLA_DE_EMISOR_POR_DEFECTO
    : { permitirEleccionManual: vigente.permitirEleccionManual };
}

/** La versión confirmada tal como se guarda: con quién la confirmó, cuándo y por qué. */
export type VersionGuardadaDeReglaDeEmisor = VersionDeReglaDeEmisor &
  Readonly<{
    id: VersionId;
    empresaId: EmpresaId;
    confirmadaEn: Date;
    confirmadaPor: PersonaId;
    motivo: string;
  }>;

/**
 * Confirma una versión nueva de la regla (la confirma el gerente). Hoy la regla tiene un solo campo,
 * así que el borrador y la confirmación son un solo paso. Errores: los de `confirmarVersion`
 * (motivo obligatorio, vigencia retroactiva).
 */
export function confirmarReglaDeEmisor(
  regla: ReglaDeEmisor,
  existentes: readonly VersionDeReglaDeEmisor[],
  datos: DatosDeConfirmacion &
    Readonly<{ id: VersionId; empresaId: EmpresaId; confirmadaPor: PersonaId }>,
): Resultado<VersionGuardadaDeReglaDeEmisor, ErrorDeConfirmacion> {
  const confirmacion = confirmarVersion(existentes, datos);
  if (!confirmacion.ok) return confirmacion;
  return ok({
    id: datos.id,
    empresaId: datos.empresaId,
    permitirEleccionManual: regla.permitirEleccionManual,
    confirmadaPor: datos.confirmadaPor,
    ...confirmacion.valor,
  });
}

export type DatosDeLinea = Readonly<{
  /** El emisor exclusivo del producto, o `null` si el producto es común. */
  emisorDelProducto: EmisorId | null;
  /** El emisor propietario del depósito, o `null` si el depósito no tiene uno. */
  emisorDelDeposito: EmisorId | null;
}>;

export type DatosAFacturar = Readonly<{
  puntoDeVentaElegido: Readonly<{ id: PuntoDeVentaId; emisorId: EmisorId }> | null;
  eleccionManual: EmisorId | null;
  /** Los emisores que hoy pueden emitir. Resolver a uno que no está acá es un error. */
  emisoresActivos: ReadonlySet<EmisorId>;
}>;

export type MotivoDeEmisor = "EXCLUSIVO" | "PUNTO_DE_VENTA" | "MANUAL";

export type ErrorDeResolucion =
  "EMISOR_EN_CONFLICTO" | "EMISOR_INACTIVO" | "ELECCION_MANUAL_NO_PERMITIDA" | "EMISOR_NO_RESUELTO";

export type EmisorResuelto = Readonly<{ emisorId: EmisorId; motivo: MotivoDeEmisor }>;

/** Orden de los errores: conflicto exclusivo, y recién después que el emisor elegido esté activo. */
export function resolverEmisor(
  regla: ReglaDeEmisor,
  datos: DatosAFacturar,
  linea: DatosDeLinea,
): Resultado<EmisorResuelto, ErrorDeResolucion> {
  const { emisorDelProducto, emisorDelDeposito } = linea;
  if (
    emisorDelProducto !== null &&
    emisorDelDeposito !== null &&
    emisorDelProducto !== emisorDelDeposito
  ) {
    return err("EMISOR_EN_CONFLICTO");
  }
  const exclusivo = emisorDelProducto ?? emisorDelDeposito;
  if (exclusivo !== null) return conActivo(datos, exclusivo, "EXCLUSIVO");
  if (datos.puntoDeVentaElegido !== null) {
    return conActivo(datos, datos.puntoDeVentaElegido.emisorId, "PUNTO_DE_VENTA");
  }
  if (datos.eleccionManual === null) return err("EMISOR_NO_RESUELTO");
  if (!regla.permitirEleccionManual) return err("ELECCION_MANUAL_NO_PERMITIDA");
  return conActivo(datos, datos.eleccionManual, "MANUAL");
}

function conActivo(
  datos: DatosAFacturar,
  emisorId: EmisorId,
  motivo: MotivoDeEmisor,
): Resultado<EmisorResuelto, ErrorDeResolucion> {
  return datos.emisoresActivos.has(emisorId) ? ok({ emisorId, motivo }) : err("EMISOR_INACTIVO");
}

export type LineaParaResolver = DatosDeLinea & Readonly<{ posicion: number }>;

export type LineaConEmisor = Readonly<{
  posicion: number;
  emisorId: EmisorId;
  motivo: MotivoDeEmisor;
}>;

export type ErrorDeResolucionDeLinea = Readonly<{ posicion: number; error: ErrorDeResolucion }>;

/** Resuelve el emisor de cada línea a facturar; el primer error (en orden de líneas) corta y dice cuál línea. */
export function resolverEmisoresDeLineas(
  regla: ReglaDeEmisor,
  datos: DatosAFacturar,
  lineas: readonly LineaParaResolver[],
): Resultado<readonly LineaConEmisor[], ErrorDeResolucionDeLinea> {
  const resueltas: LineaConEmisor[] = [];
  for (const linea of lineas) {
    const r = resolverEmisor(regla, datos, linea);
    if (!r.ok) return err({ posicion: linea.posicion, error: r.error });
    resueltas.push({ posicion: linea.posicion, ...r.valor });
  }
  return ok(resueltas);
}
