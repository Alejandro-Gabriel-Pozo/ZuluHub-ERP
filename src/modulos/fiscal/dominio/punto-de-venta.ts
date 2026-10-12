import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Emisor } from "./emisor";
import type { DomicilioId, EmisorId, PuntoDeVentaId } from "./identificadores";

/**
 * Punto de venta (spec H7 §B.5): pertenece a UN emisor y a UNA sucursal de la misma empresa (una
 * sucursal puede tener varios; H7 no limita la cantidad). El número es único por emisor: dos CUIT
 * pueden tener cada uno su punto de venta 1. Nace `INACTIVO`; no se activa sin domicilio ni con el
 * emisor inactivo; el emisor no cambia nunca; con números usados no cambia de número; no se borra,
 * se desactiva. Su verificación contra ARCA queda vacía y explícita (`NO_VERIFICADO`).
 *
 * NO VERIFICADO: el rango del número (1 a 99999). Es configurable (`RangoDeNumero`).
 */
export type RangoDeNumero = Readonly<{ minimo: number; maximo: number }>;

export const RANGO_DE_NUMERO_DE_PUNTO_DE_VENTA: RangoDeNumero = { minimo: 1, maximo: 99999 };

export type EstadoDePuntoDeVenta = "INACTIVO" | "ACTIVO";

export type PuntoDeVenta = Readonly<{
  id: PuntoDeVentaId;
  empresaId: EmpresaId;
  emisorId: EmisorId;
  sucursalId: SucursalId;
  domicilioId: DomicilioId | null;
  numero: number;
  estado: EstadoDePuntoDeVenta;
  /** Único valor en H7: nada se verifica contra ARCA todavía, y no se muestra como «listo para facturar». */
  verificacionArca: "NO_VERIFICADO";
  version: number;
}>;

/** Lo mínimo que se necesita saber de una sucursal. */
export type SucursalDeReferencia = Readonly<{ id: SucursalId; empresaId: EmpresaId }>;

export type ErrorDePuntoDeVenta =
  | "PUNTO_DE_VENTA_NUMERO_INVALIDO"
  | "PUNTO_DE_VENTA_DUPLICADO"
  | "PUNTO_DE_VENTA_NUMERO_INMUTABLE"
  | "PUNTO_DE_VENTA_SIN_DOMICILIO"
  | "SUCURSAL_DE_OTRA_EMPRESA"
  | "EMISOR_INACTIVO";

/** `cambio` es `false` cuando repetir la operación no cambia nada (sin escritura ni auditoría). */
export type CambioDePuntoDeVenta = Readonly<{ puntoDeVenta: PuntoDeVenta; cambio: boolean }>;

function numeroValido(numero: number, rango: RangoDeNumero): boolean {
  return Number.isInteger(numero) && numero >= rango.minimo && numero <= rango.maximo;
}

/**
 * ¿Algún punto de venta de ese emisor ya tiene ese número? Al editar, el propio punto de venta
 * no molesta: solo se pregunta cuando el número cambia, y entonces el suyo es el viejo.
 */
function numeroOcupado(existentes: readonly PuntoDeVenta[], emisorId: EmisorId, numero: number) {
  return existentes.some((p) => p.emisorId === emisorId && p.numero === numero);
}

export type DatosDePuntoDeVenta = Readonly<{
  id: PuntoDeVentaId;
  numero: number;
  domicilioId: DomicilioId | null;
}>;

/**
 * Arma un punto de venta nuevo, siempre `INACTIVO`, de la empresa del emisor. Orden de los errores:
 * sucursal de otra empresa, número fuera de rango y número ya usado por ese emisor (`existentes`
 * son los puntos de venta del emisor; la base repite la regla con una única).
 */
export function nuevoPuntoDeVenta(
  datos: DatosDePuntoDeVenta,
  emisor: Emisor,
  sucursal: SucursalDeReferencia,
  existentes: readonly PuntoDeVenta[],
  rango: RangoDeNumero = RANGO_DE_NUMERO_DE_PUNTO_DE_VENTA,
): Resultado<PuntoDeVenta, ErrorDePuntoDeVenta> {
  if (sucursal.empresaId !== emisor.empresaId) return err("SUCURSAL_DE_OTRA_EMPRESA");
  if (!numeroValido(datos.numero, rango)) return err("PUNTO_DE_VENTA_NUMERO_INVALIDO");
  if (numeroOcupado(existentes, emisor.id, datos.numero)) {
    return err("PUNTO_DE_VENTA_DUPLICADO");
  }
  return ok({
    id: datos.id,
    empresaId: emisor.empresaId,
    emisorId: emisor.id,
    sucursalId: sucursal.id,
    domicilioId: datos.domicilioId,
    numero: datos.numero,
    estado: "INACTIVO",
    verificacionArca: "NO_VERIFICADO",
    version: 1,
  });
}

function exigirDelEmisor(puntoDeVenta: PuntoDeVenta, emisor: Emisor): void {
  if (puntoDeVenta.emisorId !== emisor.id) {
    throw new RangeError("el punto de venta es de otro emisor");
  }
}

/**
 * Activa un punto de venta: necesita domicilio y un emisor activo. Si ya estaba activo no cambia
 * nada. Orden de los errores: sin domicilio y emisor inactivo.
 */
export function activarPuntoDeVenta(
  puntoDeVenta: PuntoDeVenta,
  emisor: Emisor,
): Resultado<CambioDePuntoDeVenta, ErrorDePuntoDeVenta> {
  exigirDelEmisor(puntoDeVenta, emisor);
  if (puntoDeVenta.estado === "ACTIVO") return ok({ puntoDeVenta, cambio: false });
  if (puntoDeVenta.domicilioId === null) return err("PUNTO_DE_VENTA_SIN_DOMICILIO");
  if (!emisor.activo) return err("EMISOR_INACTIVO");
  return ok({ puntoDeVenta: { ...puntoDeVenta, estado: "ACTIVO" }, cambio: true });
}

/** Desactiva un punto de venta. Si ya estaba inactivo no cambia nada. */
export function desactivarPuntoDeVenta(puntoDeVenta: PuntoDeVenta): CambioDePuntoDeVenta {
  if (puntoDeVenta.estado === "INACTIVO") return { puntoDeVenta, cambio: false };
  return { puntoDeVenta: { ...puntoDeVenta, estado: "INACTIVO" }, cambio: true };
}

/** El emisor NO se puede cambiar: no hay campo para eso. */
export type CambiosDePuntoDeVenta = Readonly<{
  numero?: number;
  sucursal?: SucursalDeReferencia;
  domicilioId?: DomicilioId;
}>;

export type ContextoDeEdicion = Readonly<{
  /** Alguna serie del punto de venta tiene `ultimo_numero > 0` o no está `LIBRE` (`hayNumerosUsados`). */
  tieneNumerosUsados: boolean;
  /** Los puntos de venta del emisor (para el número único). */
  delEmisor: readonly PuntoDeVenta[];
}>;

/**
 * Edita número, sucursal y domicilio. El número solo cambia si ninguna serie se usó
 * (`PUNTO_DE_VENTA_NUMERO_INMUTABLE`), está en rango y no lo tiene otro punto de venta del emisor.
 * La sucursal tiene que ser de la misma empresa. Un valor igual al actual no cuenta como cambio.
 * Orden de los errores: sucursal, número inválido, número inmutable y número duplicado.
 */
export function editarPuntoDeVenta(
  puntoDeVenta: PuntoDeVenta,
  cambios: CambiosDePuntoDeVenta,
  contexto: ContextoDeEdicion,
  rango: RangoDeNumero = RANGO_DE_NUMERO_DE_PUNTO_DE_VENTA,
): Resultado<CambioDePuntoDeVenta, ErrorDePuntoDeVenta> {
  const { sucursal } = cambios;
  if (sucursal !== undefined && sucursal.empresaId !== puntoDeVenta.empresaId) {
    return err("SUCURSAL_DE_OTRA_EMPRESA");
  }
  const numero = cambios.numero ?? puntoDeVenta.numero;
  if (numero !== puntoDeVenta.numero) {
    if (!numeroValido(numero, rango)) return err("PUNTO_DE_VENTA_NUMERO_INVALIDO");
    if (contexto.tieneNumerosUsados) return err("PUNTO_DE_VENTA_NUMERO_INMUTABLE");
    if (numeroOcupado(contexto.delEmisor, puntoDeVenta.emisorId, numero)) {
      return err("PUNTO_DE_VENTA_DUPLICADO");
    }
  }
  const editado: PuntoDeVenta = {
    ...puntoDeVenta,
    numero,
    sucursalId: sucursal?.id ?? puntoDeVenta.sucursalId,
    domicilioId: cambios.domicilioId ?? puntoDeVenta.domicilioId,
  };
  const cambio =
    editado.numero !== puntoDeVenta.numero ||
    editado.sucursalId !== puntoDeVenta.sucursalId ||
    editado.domicilioId !== puntoDeVenta.domicilioId;
  return ok({ puntoDeVenta: cambio ? editado : puntoDeVenta, cambio });
}

/**
 * Los puntos de venta habilitados de una sucursal: los `ACTIVO` de esa sucursal, con el emisor
 * activo y la sucursal activa. Se calcula, no se guarda. Si hay uno solo, la venta lo usa sin
 * preguntar; si hay más de uno, la pantalla obliga a elegir. Conserva el orden de entrada.
 */
export function puntosDeVentaHabilitados(
  puntos: readonly PuntoDeVenta[],
  sucursal: Readonly<{ id: SucursalId; activa: boolean }>,
  emisoresActivos: ReadonlySet<EmisorId>,
): readonly PuntoDeVenta[] {
  if (!sucursal.activa) return [];
  return puntos.filter(
    (p) => p.estado === "ACTIVO" && p.sucursalId === sucursal.id && emisoresActivos.has(p.emisorId),
  );
}
