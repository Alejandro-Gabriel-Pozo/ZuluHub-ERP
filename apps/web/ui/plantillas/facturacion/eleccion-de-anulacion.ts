import {
  importeATexto,
  importeCero,
  importeDesdeTexto,
  restar,
  sumar,
  type Importe,
} from "../../../../../src/primitivas/dinero/importe";
import { ARS } from "../../../../../src/primitivas/dinero/moneda";
import type { DetalleParaMostrar } from "./modelo-del-detalle";

/**
 * La elección de la pantalla de anular por importe (opción 12A, aprobada por el dueño el 2026-10-29; D-69): el total de la factura
 * (por defecto) o, en «Anular solo una parte», cuánto anular con IVA incluido en cada alícuota de la factura (en la letra C, un solo
 * importe). Puro: sin React ni servidor. Todo el dinero es TEXTO decimal y se opera con las primitivas (ADR-006), nunca con `number`.
 * Previene: mostrar una suma distinta de la que se manda, y mandar un importe que no es dinero. Chequeo:
 * `test/web/anular-calculo.test.ts`. El servidor valida el resto (permiso, estado, alícuotas, sucursales) y no hay tope (D-11).
 */

/** Lo que la pantalla necesita de la factura: una lista blanca (la factura entera, con CAE y emisor, no viaja al navegador). */
export type FacturaParaAnular = Readonly<{
  id: string;
  tipo: DetalleParaMostrar["tipo"];
  estado: DetalleParaMostrar["estado"];
  numero: string | null;
  /** Lo hereda la nota (período de un servicio incluido): el servidor lo valida. */
  concepto: string;
  servicio: Readonly<{ desde: string; hasta: string; vencimientoDePago: string }> | null;
  importes: Readonly<{ total: string }>;
  /** Lo facturado en cada alícuota (vacío en la letra C, que no informa alícuotas a ARCA). */
  alicuotas: readonly Readonly<{ alicuota: string; total: string }>[];
  receptor: DetalleParaMostrar["receptor"];
  notasQueLoCitan: DetalleParaMostrar["notasQueLoCitan"];
  acreditado: string | null;
}>;

/** Copia SOLO lo que la pantalla usa: lo que se agregue a la consulta no llega al navegador sin decidirlo acá. */
export function aFacturaParaAnular(f: FacturaParaAnular): FacturaParaAnular {
  return {
    id: f.id,
    tipo: f.tipo,
    estado: f.estado,
    numero: f.numero,
    concepto: f.concepto,
    servicio:
      f.servicio === null
        ? null
        : {
            desde: f.servicio.desde,
            hasta: f.servicio.hasta,
            vencimientoDePago: f.servicio.vencimientoDePago,
          },
    importes: { total: f.importes.total },
    alicuotas: f.alicuotas.map((a) => ({ alicuota: a.alicuota, total: a.total })),
    receptor: {
      nombre: f.receptor.nombre,
      documento:
        f.receptor.documento.tipo === "SIN_IDENTIFICAR"
          ? { tipo: "SIN_IDENTIFICAR" }
          : { tipo: f.receptor.documento.tipo, numero: f.receptor.documento.numero },
    },
    notasQueLoCitan: f.notasQueLoCitan.map((n) => ({
      id: n.id,
      tipo: n.tipo,
      numero: n.numero,
      total: n.total,
      estado: n.estado,
    })),
    acreditado: f.acreditado,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Las filas: una por alícuota (letra C: una sola, sin alícuota)
// ---------------------------------------------------------------------------------------------------------------------

/** Una fila de «Anular solo una parte»: lo facturado en esa alícuota y dónde se escribe cuánto anular. */
export type FilaDeAlicuota = Readonly<{
  /** Identifica la fila en la elección: el código de la alícuota, o `"C"` en la letra C. */
  clave: string;
  /** El código para la nota (`"21"`, `"10.5"`, `"EXENTO"`…), o `null` en la letra C (ARCA no recibe alícuotas en la C, D-71). */
  alicuota: string | null;
  /** Texto decimal exacto. */
  facturado: string;
}>;

/** La letra C no informa IVA ni alícuotas a ARCA (D-71): se pide un solo importe. */
const esLetraC = (f: Pick<FacturaParaAnular, "tipo">): boolean => f.tipo.endsWith("C");

export function filasDeLaFactura(f: FacturaParaAnular): readonly FilaDeAlicuota[] {
  return esLetraC(f)
    ? [{ clave: "C", alicuota: null, facturado: f.importes.total }]
    : f.alicuotas.map((a) => ({ clave: a.alicuota, alicuota: a.alicuota, facturado: a.total }));
}

// ---------------------------------------------------------------------------------------------------------------------
// La elección
// ---------------------------------------------------------------------------------------------------------------------

export type EleccionDeAnulacion = Readonly<{
  parcial: boolean;
  /**
   * Lo escrito en cada fila, por su clave: texto decimal canónico (`"20000.50"`) tal como lo entrega `CampoImporte`, o `""`.
   * Solo cuenta en «Anular solo una parte»; se conserva si la persona vuelve al total y otra vez a la parte.
   */
  importes: Readonly<Record<string, string>>;
}>;

/** El total: todo lo facturado (lo que se ofrece primero). */
export const anulacionTotal: EleccionDeAnulacion = { parcial: false, importes: {} };

export const pasarAUnaParte = (e: EleccionDeAnulacion): EleccionDeAnulacion => ({
  ...e,
  parcial: true,
});

export const volverAlTotal = (e: EleccionDeAnulacion): EleccionDeAnulacion => ({
  ...e,
  parcial: false,
});

export const escribirImporte = (
  e: EleccionDeAnulacion,
  clave: string,
  canonico: string,
): EleccionDeAnulacion => ({ ...e, importes: { ...e.importes, [clave]: canonico } });

// ---------------------------------------------------------------------------------------------------------------------
// El cálculo
// ---------------------------------------------------------------------------------------------------------------------

/** El importe de un texto decimal: `null` si no es dinero (vacío, texto, negativo, más de 2 decimales). Lo estricto lo dice la primitiva. */
export function leerImporte(texto: string): Importe | null {
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(texto)) return null;
  try {
    return importeDesdeTexto(ARS, texto);
  } catch {
    return null;
  }
}

const esMayorQueCero = (i: Importe): boolean => i.unidades > 0n;

/** Lo que se anula en una alícuota: solo las de importe mayor que cero entran a la nota. */
export type ParteAAnular = Readonly<{
  fila: FilaDeAlicuota;
  importe: Importe;
  /** D-72: aviso sin bloqueo cuando lo escrito supera lo facturado en esa alícuota. */
  superaLoFacturado: boolean;
}>;

export type CalculoDeAnulacion = Readonly<{
  partes: readonly ParteAAnular[];
  /** La suma exacta de las partes, como texto decimal («A anular»). */
  aAnular: string;
  /** Hay algo escrito que no es un importe (con la pantalla actual no pasa: `CampoImporte` limpia lo tipeado). */
  hayInvalidos: boolean;
  /** «Siguiente» anda: hay al menos un importe mayor que cero y ninguno inválido (SUPUESTO: no hay texto aprobado para un error). */
  sePuedeSeguir: boolean;
}>;

export function calcularLaAnulacion(
  f: FacturaParaAnular,
  e: EleccionDeAnulacion,
): CalculoDeAnulacion {
  const partes: ParteAAnular[] = [];
  let hayInvalidos = false;
  for (const fila of filasDeLaFactura(f)) {
    const facturado = leerImporte(fila.facturado);
    if (facturado === null) continue;
    if (!e.parcial) {
      if (esMayorQueCero(facturado))
        partes.push({ fila, importe: facturado, superaLoFacturado: false });
      continue;
    }
    const escrito = e.importes[fila.clave] ?? "";
    if (escrito === "") continue;
    const importe = leerImporte(escrito);
    if (importe === null) {
      hayInvalidos = true;
      continue;
    }
    if (esMayorQueCero(importe)) {
      partes.push({
        fila,
        importe,
        superaLoFacturado: esMayorQueCero(restar(importe, facturado)),
      });
    }
  }
  const suma = partes.reduce((acumulado, p) => sumar(acumulado, p.importe), importeCero(ARS));
  return {
    partes,
    aAnular: importeATexto(suma),
    hayInvalidos,
    sePuedeSeguir: partes.length > 0 && !hayInvalidos,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// El motivo
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Lo que dice el servidor del motivo (D-9, D-17): sin los espacios de los bordes, obligatorio y de hasta `limite` caracteres.
 * El límite lo trae la página desde el dominio (`LIMITES_DE_COMPROBANTE.motivo`): no se escribe acá.
 */
export function problemaDelMotivo(motivo: string, limite: number): "VACIO" | "LARGO" | null {
  const largo = motivo.trim().length;
  if (largo === 0) return "VACIO";
  return largo > limite ? "LARGO" : null;
}
