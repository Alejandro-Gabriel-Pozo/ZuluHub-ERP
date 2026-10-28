/**
 * Formato de lo que muestra el detalle de un comprobante, SOLO con funciones de cadena. Previene: perder centavos o
 * dígitos al pasar un importe por `Number` (ADR-006: el servidor manda texto decimal y la pantalla solo lo formatea), y
 * correr un día una fecha civil al pasarla por `Date` y su zona horaria. Chequeo: `test/web/detalle-de-comprobante.test.ts`
 * (importes enormes sin pérdida y ausencia de `Number`/`Date` en el código).
 */

const DECIMAL = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;
const FECHA_CIVIL = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/** Separa los miles con punto: «1234567» pasa a «1.234.567». */
function conMiles(enteros: string): string {
  let salida = "";
  for (let i = 0; i < enteros.length; i += 1) {
    if (i > 0 && (enteros.length - i) % 3 === 0) salida += ".";
    salida += enteros.charAt(i);
  }
  return salida;
}

/** Los decimales sin ceros de más, pero nunca menos de `minimo`. */
function decimalesDe(fraccion: string, minimo: number): string {
  let corta = fraccion;
  while (corta.length > minimo && corta.endsWith("0")) corta = corta.slice(0, -1);
  return corta.padEnd(minimo, "0");
}

/**
 * Un texto decimal («4500.000000») con punto de miles y coma decimal («4.500,00»). Un texto que no es un decimal
 * se devuelve tal cual: nunca se inventa una cifra.
 */
function formatearDecimal(texto: string, minimoDeDecimales: number): string {
  const partes = DECIMAL.exec(texto);
  if (partes === null) return texto;
  const [, signo = "", enteros = "", fraccion = ""] = partes;
  const decimales = decimalesDe(fraccion, minimoDeDecimales);
  return `${signo}${conMiles(enteros)}${decimales === "" ? "" : `,${decimales}`}`;
}

/** «9000.00» pasa a «$ 9.000,00» (siempre con centavos; «4500.000000» también; los decimales de más que no son cero se conservan). */
export function formatearImporte(texto: string): string {
  const formateado = formatearDecimal(texto, 2);
  return formateado.startsWith("-") ? `-$ ${formateado.slice(1)}` : `$ ${formateado}`;
}

/** «2.0000» pasa a «2»; «1.5000», a «1,5». */
export function formatearCantidad(texto: string): string {
  return formatearDecimal(texto, 0);
}

/** «2026-10-14» pasa a «14/10/2026», sin pasar por `Date`. */
export function formatearFecha(texto: string): string {
  const partes = FECHA_CIVIL.exec(texto);
  return partes === null ? texto : `${partes[3]}/${partes[2]}/${partes[1]}`;
}

/** El CUIT, CUIL o CDI con guiones («20-12345678-9») y el DNI con puntos («12.345.678»); el resto, tal cual. */
export function formatearNumeroDeDocumento(tipo: string, numero: string): string {
  if (!/^[0-9]+$/.test(numero)) return numero;
  if (tipo === "DNI") return conMiles(numero);
  if ((tipo === "CUIT" || tipo === "CUIL" || tipo === "CDI") && numero.length === 11) {
    return `${numero.slice(0, 2)}-${numero.slice(2, 10)}-${numero.slice(10)}`;
  }
  return numero;
}

/**
 * El punto de venta en cinco dígitos («1» pasa a «00001»), como el prefijo de `numeroImpreso` del backend (PPPPP-NNNNNNNN).
 * SUPUESTO: el backend no exporta este formato por separado; hay que pedirle que lo exponga.
 */
export function formatearPuntoDeVenta(numero: number): string {
  return String(numero).padStart(5, "0");
}

/** La alícuota («10.5») con coma («10,5»); `null` si no lleva IVA (exento, no gravado). */
export function formatearAlicuota(codigo: string): string | null {
  return /^[0-9]+(\.[0-9]+)?$/.test(codigo) ? codigo.replace(".", ",") : null;
}
