import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { numeroDeSerieDeCuit } from "./certificado-pedido";

/**
 * Cargar el certificado que ARCA devolvió (spec H7 facturación §B.4 y §B.6.2, tramo F7): qué texto se acepta como
 * certificado y si el certificado leído sirve para ese emisor. Leerlo (X.509) y compararlo con la clave son del
 * adaptador; acá se decide con lo que ese adaptador midió.
 */

export type ErrorAlCargarCertificado =
  | "CERTIFICADO_ILEGIBLE"
  | "NO_CORRESPONDE_A_LA_CLAVE"
  | "TITULAR_DISTINTO"
  | "CADENA_NO_CONFIABLE"
  | "CERTIFICADO_VENCIDO";

const ENCABEZADO = "-----BEGIN CERTIFICATE-----";
const PIE = "-----END CERTIFICATE-----";
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const COLUMNAS_DEL_PEM = 64;
/**
 * Tope del base64 (un certificado real tiene unos 2.000 caracteres): con las líneas y el marco, el PEM canónico
 * queda por debajo de los 16.384 bytes que admite la base (`certificado_pem_ck`).
 */
const MAXIMO_DE_BASE64 = 16_000;

/**
 * El certificado pegado, en su forma canónica: un solo bloque `CERTIFICATE`, base64 en líneas de 64 y un salto
 * final. Acepta cualquier salto de línea (también `\r` solo, el de los archivos de ARCA) y blancos dentro y
 * alrededor. Todo lo demás es ilegible: otro tipo de bloque (en particular una CLAVE PRIVADA pegada por
 * error, que así nunca se guarda ni se repite en un mensaje), dos certificados, texto de más, base64 inválido.
 */
export function extraerCertificadoPem(texto: string): Resultado<string, "CERTIFICADO_ILEGIBLE"> {
  const normal = texto.trim();
  if (!normal.startsWith(ENCABEZADO) || !normal.endsWith(PIE)) return err("CERTIFICADO_ILEGIBLE");
  // Sin guiones: un segundo bloque, o una clave privada, deja de ser base64.
  const base64 = normal.slice(ENCABEZADO.length, normal.length - PIE.length).replace(/\s/g, "");
  if (!BASE64.test(base64) || base64.length % 4 !== 0 || base64.length > MAXIMO_DE_BASE64) {
    return err("CERTIFICADO_ILEGIBLE");
  }
  const lineas: string[] = [];
  for (let i = 0; i < base64.length; i += COLUMNAS_DEL_PEM) {
    lineas.push(base64.slice(i, i + COLUMNAS_DEL_PEM));
  }
  return ok(`${ENCABEZADO}\n${lineas.join("\n")}\n${PIE}\n`);
}

/** Lo que el adaptador midió del certificado leído. */
export type HallazgosDelCertificado = Readonly<{
  /** La clave pública del certificado es la derivada de la clave que generó Pedernal. */
  correspondeALaClave: boolean;
  /** El `serialNumber` del sujeto; `null` si no tiene. */
  numeroDeSerieDelSujeto: string | null;
  /** La cadena cierra contra la de ARCA del mismo ambiente. */
  cadenaCierra: boolean;
  noDespues: Date;
}>;

/**
 * Si el certificado sirve para el emisor. Orden de los errores (el de §B.6.2): corresponde a la clave guardada,
 * el titular es el CUIT del emisor (cada cliente es dueño de su propio certificado: decisión del dueño
 * 2026-10-14), la cadena cierra y no está vencido. Un certificado rige hasta su `noDespues` exclusive: en ese
 * instante ya venció (como el resto del código: `venceEn <= ahora`).
 */
export function evaluarCertificado(
  cuitDelEmisor: Cuit,
  hallazgos: HallazgosDelCertificado,
  ahora: Date,
): Resultado<Readonly<{ vence: Date }>, ErrorAlCargarCertificado> {
  if (!hallazgos.correspondeALaClave) return err("NO_CORRESPONDE_A_LA_CLAVE");
  if (hallazgos.numeroDeSerieDelSujeto !== numeroDeSerieDeCuit(cuitDelEmisor)) {
    return err("TITULAR_DISTINTO");
  }
  if (!hallazgos.cadenaCierra) return err("CADENA_NO_CONFIABLE");
  if (hallazgos.noDespues.getTime() <= ahora.getTime()) return err("CERTIFICADO_VENCIDO");
  return ok({ vence: hallazgos.noDespues });
}
