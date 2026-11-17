import {
  escribirNumero,
  interpretarNumeroPegado,
  type MotivoDePegadoRechazado as MotivoNumero,
  type ReglaDeNumero,
} from "./numero-argentino";
import { importeATexto, importeDesdeTexto } from "../../primitivas/dinero/importe";
import { ARS, decimalesDe } from "../../primitivas/dinero/moneda";

/**
 * El importe que se tipea en la web (es-AR) y su forma en la frontera. El campo del formulario muestra
 * `1.234,50`; lo que el formulario entrega y lo que viaja al servidor es SIEMPRE texto decimal
 * canónico (`1234.50`), nunca un `number` (ADR-006, [A006]). Acá no hay aritmética: solo se limpia lo
 * tipeado y se arma el texto, y quien valida el rango y la escala es la primitiva de dinero.
 *
 * v1 es solo pesos (`ARS`, 2 decimales). El importe tipeado no es negativo: un descuento o una
 * devolución son otra acción, no un signo en el campo.
 */

/** Lo que muestra el campo mientras se tipea y el texto decimal canónico que entrega. */
export type ImporteTipeado = Readonly<{
  /** Para el campo: dígitos con coma decimal, sin separador de miles. Vacío si no hay nada. */
  texto: string;
  /** Texto decimal canónico (`1234.50`, con todos los decimales de la moneda). Vacío si no hay nada. */
  canonico: string;
}>;

const DECIMALES = decimalesDe(ARS);
/** Un `numeric(18, s)` admite 18 dígitos en total: lo que sobra de los decimales es la parte entera. */
const DIGITOS_ENTEROS_MAXIMOS = 18 - DECIMALES;

/** `1.234`, `12.345.678` (nunca `0.123`): puntos que agrupan de a tres son separador de miles (es-AR), no decimales. */
const MILES_CON_PUNTO = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
const CANONICO = new RegExp(
  `^(?:0|[1-9]\\d{0,${DIGITOS_ENTEROS_MAXIMOS - 1}})(?:\\.\\d{1,${DECIMALES}})?$`,
);

/** Separa lo tipeado en parte entera y parte decimal. `decimal` es `null` si no se tipeó separador. También la usa la cantidad de Emitir (una regla, un lugar). */
export function partirTipeado(crudo: string): { entera: string; decimal: string | null } {
  const limpio = crudo.replace(/[^\d.,]/g, "");
  // La coma es el decimal de es-AR; con coma, los puntos son miles. Una segunda coma se descarta.
  const coma = limpio.indexOf(",");
  if (coma !== -1) {
    return {
      entera: limpio.slice(0, coma).replace(/\D/g, ""),
      decimal: limpio.slice(coma + 1).replace(/\D/g, ""),
    };
  }
  // Sin coma: puntos agrupados de a tres son miles; si no, el último punto es el decimal (teclados
  // que solo traen punto).
  const punto = limpio.lastIndexOf(".");
  if (punto === -1 || MILES_CON_PUNTO.test(limpio)) {
    return { entera: limpio.replace(/\D/g, ""), decimal: null };
  }
  return {
    entera: limpio.slice(0, punto).replace(/\D/g, ""),
    decimal: limpio.slice(punto + 1),
  };
}

/** Interpreta lo que hay en el campo: limpia, acota a lo que la moneda admite y arma el texto canónico. */
export function interpretarImporteTipeado(crudo: string): ImporteTipeado {
  const { entera: cruda, decimal } = partirTipeado(crudo);
  if (cruda === "" && decimal === null) return { texto: "", canonico: "" };
  return armarTipeado(cruda, decimal);
}

/** Acota la parte entera y los decimales a lo que admite la moneda y arma el texto del campo y el canónico. Una regla, un lugar. */
function armarTipeado(cruda: string, decimal: string | null): ImporteTipeado {
  const entera = cruda.replace(/^0+(?=\d)/, "").slice(0, DIGITOS_ENTEROS_MAXIMOS) || "0";
  const fraccion = (decimal ?? "").slice(0, DECIMALES);
  const canonico = importeATexto(
    importeDesdeTexto(ARS, `${entera}.${fraccion.padEnd(DECIMALES, "0")}`),
  );
  return { texto: decimal === null ? entera : `${entera},${fraccion}`, canonico };
}

/** La regla del importe en pesos para el campo numérico: los decimales y los enteros que admite `numeric(18, 2)`; con ceros de relleno. */
export const REGLA_DE_IMPORTE: ReglaDeNumero = {
  decimales: DECIMALES,
  enterosMaximos: DIGITOS_ENTEROS_MAXIMOS,
  completarDecimales: true,
};

/**
 * Lo que queda en el campo al ESCRIBIR (decisión 153): solo dígitos y una coma con hasta dos decimales, sin puntos de miles (el campo
 * los muestra con `numero-argentino.ts`). Una regla, un lugar: la política vive en `escribirNumero`.
 */
export function filtrarImporteEscrito(crudo: string): ImporteTipeado {
  const r = escribirNumero(crudo, crudo.length, REGLA_DE_IMPORTE);
  return { texto: r.texto.replaceAll(".", ""), canonico: r.canonico };
}

/** Por qué se rechaza un pegado (decisión 153; supuesto S-6: más de dos decimales se rechaza, no se recorta). */
export type MotivoDePegadoRechazado = MotivoNumero;

export type ImportePegado =
  | Readonly<{ ok: true; texto: string; canonico: string }>
  | Readonly<{ ok: false; motivo: MotivoDePegadoRechazado }>;

/** Interpreta lo PEGADO con la regla del campo (decisión 153). Una regla, un lugar: la política vive en `interpretarNumeroPegado`. */
export function interpretarImportePegado(crudo: string): ImportePegado {
  const r = interpretarNumeroPegado(crudo, REGLA_DE_IMPORTE);
  return r.ok
    ? { ok: true, texto: r.texto.replaceAll(".", ""), canonico: r.canonico }
    : { ok: false, motivo: r.motivo };
}

/** El texto canónico con puntos de miles y coma decimal (`1234.5` → `1.234,50`). Vacío si no es un importe. */
export function mostrarImporte(canonico: string): string {
  if (!CANONICO.test(canonico)) return "";
  const texto = importeATexto(importeDesdeTexto(ARS, canonico));
  const punto = texto.indexOf(".");
  const entera = texto.slice(0, punto);
  const fraccion = texto.slice(punto + 1);
  return `${entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraccion}`;
}
