import type { ReglaDeNumero } from "../../../../../src/capacidades/experiencia/numero-argentino";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import {
  importeATexto,
  importeDesdeTexto,
  sumar,
  type ImporteJson,
} from "../../../../../src/primitivas/dinero/importe";
import { ARS } from "../../../../../src/primitivas/dinero/moneda";
import { formatearCantidad, formatearImporte } from "../../patrones/formato-fiscal";
import {
  diferenciaDe,
  sumaDeImportes,
  importeParaMostrar,
  rotuloDeLaCuenta,
  rotuloDelMedio,
  tonoDeLaDiferencia,
} from "./modelo-de-la-caja";

/**
 * El modelo de vista de «Contar» (maqueta aprobada `caja.html`, `vCierre`): de lo que hay que contar (`ConteoParaLaPantalla`), las filas que se dibujan, el total contado del efectivo y la
 * diferencia de cada medio. Puro: sin React ni servidor. El efectivo se cuenta por billetes y monedas; los demás medios se declaran con su total o se aceptan «conforme». La pantalla solo
 * PREVISUALIZA el total contado (suma exacta, con las primitivas de dinero y enteros de BigInt); el esperado viene del servidor y la cuenta definitiva la hace el servidor al cerrar.
 */

type LineaDelConteo = Readonly<{
  medioDePagoId: string;
  medioTipo: string;
  medioNombre: string | null;
  cuentaDeCobroId: string | null;
  cuentaNombre: string | null;
  esperado: ImporteJson;
  /** El efectivo (`true`) se cuenta SIEMPRE por billetes y monedas y no admite «conforme». */
  contarConBilletes: boolean;
}>;

export type ConteoDeLaCaja = Readonly<{
  sesionId: string;
  lineas: readonly LineaDelConteo[];
  /** Los billetes que se cuentan, de mayor a menor. */
  denominaciones: readonly number[];
  cantidadMaximaDeBilletes: number;
}>;

/** Una línea de un medio que no es el efectivo (con su cuenta, si la tiene). */
export type FilaDeMedio = Readonly<{
  /** Identifica la línea (medio y cuenta) en lo que se escribe y en lo que se marca «conforme». */
  clave: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  titulo: string;
  cuenta: string | null;
  esperado: string;
  esperadoParaMostrar: string;
}>;

export type VistaDelConteo = Readonly<{
  efectivo: Readonly<{ esperado: string; esperadoParaMostrar: string }>;
  billetes: readonly Readonly<{ denominacion: number; etiqueta: string }>[];
  /** La regla de la cantidad de billetes: entera, hasta el tope del dominio. */
  reglaDeBilletes: ReglaDeNumero;
  otros: readonly FilaDeMedio[];
}>;

/** Lo que se escribió y se marcó: billetes por denominación (cantidad entera como texto), monedas, el total declarado y el «conforme» de cada línea. */
export type EstadoDelConteo = Readonly<{
  billetes: Readonly<Record<string, string>>;
  monedas: string;
  contados: Readonly<Record<string, string>>;
  conformes: Readonly<Record<string, boolean>>;
}>;

/** El estado de un conteo recién abierto: nada escrito, nada «conforme». */
export const CONTEO_EN_BLANCO: EstadoDelConteo = {
  billetes: {},
  monedas: "",
  contados: {},
  conformes: {},
};

export const claveDeLinea = (medioDePagoId: string, cuentaDeCobroId: string | null): string =>
  `${medioDePagoId}|${cuentaDeCobroId ?? ""}`;

/** «$ 20.000»: el billete sin centavos. */
export const etiquetaDeBillete = (denominacion: number): string =>
  `$ ${formatearCantidad(String(denominacion))}`;

/** La regla del campo de cantidad: entero, con los dígitos del tope que dice el dominio. */
export const reglaDeBilletes = (cantidadMaxima: number): ReglaDeNumero => ({
  decimales: 0,
  enterosMaximos: String(cantidadMaxima).length,
});

export function vistaDelConteo(c: ConteoDeLaCaja): VistaDelConteo {
  const esperadoDelEfectivo = sumaDeImportes(
    c.lineas.filter((l) => l.contarConBilletes).map((l) => l.esperado),
  );
  return {
    efectivo: {
      esperado: esperadoDelEfectivo,
      esperadoParaMostrar: formatearImporte(esperadoDelEfectivo),
    },
    billetes: c.denominaciones.map((d) => ({ denominacion: d, etiqueta: etiquetaDeBillete(d) })),
    reglaDeBilletes: reglaDeBilletes(c.cantidadMaximaDeBilletes),
    otros: c.lineas
      .filter((l) => !l.contarConBilletes)
      .map((l) => ({
        clave: claveDeLinea(l.medioDePagoId, l.cuentaDeCobroId),
        medioDePagoId: l.medioDePagoId,
        cuentaDeCobroId: l.cuentaDeCobroId,
        titulo: rotuloDelMedio(l.medioTipo, l.medioNombre),
        cuenta: rotuloDeLaCuenta(l.medioTipo, l.cuentaNombre),
        esperado: l.esperado.monto,
        esperadoParaMostrar: importeParaMostrar(l.esperado),
      })),
  };
}

/** Lo que valen `cantidad` billetes de `denominacion`, exacto, como texto decimal; `null` si no se escribió cantidad. */
export function subtotalDeBilletes(denominacion: number, cantidad: string): string | null {
  if (cantidad === "") return null;
  try {
    return importeATexto(importeDesdeTexto(ARS, `${BigInt(cantidad) * BigInt(denominacion)}.00`));
  } catch {
    return null;
  }
}

/**
 * El total contado del efectivo: billetes más monedas, exacto. `null` si no se declaró nada (ni un billete ni las monedas): lo no escrito de una parte se suma como cero, pero sin
 * nada escrito no hay total. Un total que ninguna cifra permitida podría alcanzar tampoco se calcula (la pantalla no cae por una vista previa).
 */
export function totalContadoDelEfectivo(
  denominaciones: readonly number[],
  billetes: Readonly<Record<string, string>>,
  monedas: string,
): string | null {
  const escritos = denominaciones.flatMap((d) => {
    const cantidad = billetes[String(d)] ?? "";
    return cantidad === "" ? [] : [{ denominacion: d, cantidad }];
  });
  if (escritos.length === 0 && monedas === "") return null;
  try {
    let total = importeDesdeTexto(ARS, monedas === "" ? "0.00" : monedas);
    for (const { denominacion, cantidad } of escritos) {
      const subtotal = subtotalDeBilletes(denominacion, cantidad);
      if (subtotal !== null) total = sumar(total, importeDesdeTexto(ARS, subtotal));
    }
    return importeATexto(total);
  } catch {
    return null;
  }
}

export type DiferenciaParaMostrar = Readonly<{
  texto: string;
  tono: "peligro" | "aviso" | null;
}>;

/** La diferencia del efectivo contra lo esperado (vacía mientras no se contó). */
export function diferenciaDelEfectivo(
  total: string | null,
  esperado: string,
): DiferenciaParaMostrar {
  const dif = diferenciaDe(total, esperado);
  return dif === null
    ? { texto: "", tono: null }
    : { texto: formatearImporte(dif), tono: tonoDeLaDiferencia(dif) };
}

/** La diferencia de un medio que no es el efectivo: «Conforme», «Sin declarar» o contado menos esperado. */
export function diferenciaDeUnMedio(
  fila: FilaDeMedio,
  contado: string,
  conforme: boolean,
): DiferenciaParaMostrar {
  if (conforme) return { texto: texto({}, "caja.conforme"), tono: null };
  const dif = contado === "" ? null : diferenciaDe(contado, fila.esperado);
  return dif === null
    ? { texto: texto({}, "caja.sin_declarar"), tono: null }
    : { texto: formatearImporte(dif), tono: tonoDeLaDiferencia(dif) };
}

/** Escribir el total contado de una línea la saca de «conforme» (maqueta: declarar un total anula el «conforme»). */
export function conContado(
  estado: EstadoDelConteo,
  clave: string,
  contado: string,
): EstadoDelConteo {
  return {
    ...estado,
    contados: { ...estado.contados, [clave]: contado },
    conformes: contado === "" ? estado.conformes : { ...estado.conformes, [clave]: false },
  };
}

/** Marcar «conforme» una línea la deja sin total declarado; volver a tocarlo la desmarca (maqueta: el botón alterna). */
export function conConformeAlternado(estado: EstadoDelConteo, clave: string): EstadoDelConteo {
  const sera = estado.conformes[clave] !== true;
  return {
    ...estado,
    conformes: { ...estado.conformes, [clave]: sera },
    contados: sera ? { ...estado.contados, [clave]: "" } : estado.contados,
  };
}

/** «Conforme general»: marca conforme toda línea que no tiene total declarado (las que sí lo tienen quedan como están; el efectivo no es una de estas filas). */
export function conConformeGeneral(
  estado: EstadoDelConteo,
  filas: readonly FilaDeMedio[],
): EstadoDelConteo {
  const conformes = { ...estado.conformes };
  for (const f of filas) {
    if ((estado.contados[f.clave] ?? "") === "") conformes[f.clave] = true;
  }
  return { ...estado, conformes };
}

/** Escribir la cantidad de billetes de una denominación. */
export const conBilletes = (
  estado: EstadoDelConteo,
  denominacion: number,
  cantidad: string,
): EstadoDelConteo => ({
  ...estado,
  billetes: { ...estado.billetes, [String(denominacion)]: cantidad },
});

/** Escribir el total de las monedas. */
export const conMonedas = (estado: EstadoDelConteo, monedas: string): EstadoDelConteo => ({
  ...estado,
  monedas,
});
