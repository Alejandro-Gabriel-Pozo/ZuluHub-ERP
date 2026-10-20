import { importeATexto, type Importe } from "../../../primitivas/dinero/importe";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import {
  CODIGO_DE_MONEDA,
  CODIGO_DE_TIPO_DE_COMPROBANTE,
  CODIGO_DE_TIPO_DE_DOCUMENTO,
} from "./codigos-de-arca";
import type { TipoDeComprobante } from "./comprobante-emitido";
import { numeroDeDocumentoParaArca, type DocumentoDelReceptor } from "./receptor";

/**
 * URL del QR de ARCA (spec H7 facturación §B.7): `{URL}?p={JSON en base64}`, con el JSON de la
 * versión 1 de la especificación del QR, los campos en este orden fijo: `ver`, `fecha`, `cuit`,
 * `ptoVta`, `tipoCmp`, `nroCmp`, `importe`, `moneda`, `ctz`, `tipoDocRec`, `nroDocRec`,
 * `tipoCodAut` y `codAut`.
 *
 * El JSON se arma a mano y no con `JSON.stringify` para que los importes y los números largos
 * salgan como texto exacto en el JSON (nunca por `number`): `importe` sin ceros de más (`12100`,
 * `12100.5`, `12100.55`), `cuit`, `nroDocRec` y `codAut` como enteros.
 *
 * NO VERIFICADO (el spec lo deja abierto; se sigue la especificación del QR):
 * - la URL base: la especificación dice `www.arca.gob.ar` en el texto y `www.afip.gob.ar` en su
 *   ejemplo; se usa la del ejemplo, que es la que usan los SDK y la que resuelve hoy. Es un
 *   parámetro para cambiarla sin tocar el armado;
 * - `importe` va en decimal (no multiplicado por 100) y `ctz` en 1 para pesos.
 */
export const URL_BASE_DEL_QR = "https://www.afip.gob.ar/fe/qr/";

/** Versión del JSON del QR. */
const VERSION_DEL_QR = 1;

/** `tipoCodAut`: «E» es CAE (el único que Pedernal pide; «A» sería CAEA). */
const TIPO_DE_CODIGO_DE_AUTORIZACION = "E";

/** El CAE tiene 14 dígitos (campo `codAut` de la especificación del QR). */
const FORMATO_DE_CAE = /^[0-9]{14}$/;

export type DatosParaQr = Readonly<{
  fecha: FechaCivil;
  cuit: Cuit;
  puntoDeVenta: number;
  tipo: TipoDeComprobante;
  numero: bigint;
  total: Importe;
  documento: DocumentoDelReceptor;
  cae: string;
}>;

export type ErrorDeQr = "CAE_INVALIDO";

/** `12100.00` → `12100`; `12100.50` → `12100.5`: decimal mínimo, desde centavos. */
function importeDecimalMinimo(importe: Importe): string {
  return importeATexto(importe).replace(/\.?0+$/, "");
}

/** El JSON del QR (versión 1), como texto. `CAE_INVALIDO` si el CAE no son 14 dígitos. */
export function jsonDelQr(datos: DatosParaQr): Resultado<string, ErrorDeQr> {
  if (!FORMATO_DE_CAE.test(datos.cae)) return err("CAE_INVALIDO");
  // `BigInt` normaliza los ceros a la izquierda: un número con ceros no es JSON válido.
  const campos = [
    `"ver":${VERSION_DEL_QR}`,
    `"fecha":"${datos.fecha}"`,
    `"cuit":${BigInt(datos.cuit)}`,
    `"ptoVta":${datos.puntoDeVenta}`,
    `"tipoCmp":${CODIGO_DE_TIPO_DE_COMPROBANTE[datos.tipo]}`,
    `"nroCmp":${datos.numero}`,
    `"importe":${importeDecimalMinimo(datos.total)}`,
    `"moneda":"${CODIGO_DE_MONEDA[datos.total.moneda]}"`,
    `"ctz":1`,
    `"tipoDocRec":${CODIGO_DE_TIPO_DE_DOCUMENTO[datos.documento.tipo]}`,
    `"nroDocRec":${numeroDeDocumentoParaArca(datos.documento)}`,
    `"tipoCodAut":"${TIPO_DE_CODIGO_DE_AUTORIZACION}"`,
    `"codAut":${BigInt(datos.cae)}`,
  ];
  return ok(`{${campos.join(",")}}`);
}

/** La URL completa del QR. El JSON es ASCII puro, así que `btoa` alcanza (base64 estándar, con relleno). */
export function urlDelQr(
  datos: DatosParaQr,
  urlBase: string = URL_BASE_DEL_QR,
): Resultado<string, ErrorDeQr> {
  const json = jsonDelQr(datos);
  return json.ok ? ok(`${urlBase}?p=${btoa(json.valor)}`) : json;
}
