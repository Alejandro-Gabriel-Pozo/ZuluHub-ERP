import {
  LARGO_MAXIMO_DEL_DOMICILIO_LIBRE,
  domicilioLibreDesdeTexto,
} from "../../../primitivas/domicilio/domicilio-libre";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import {
  TIPOS_DE_DOCUMENTO_DE_IDENTIDAD,
  numeroDeDocumentoDesdeTexto,
} from "../../../primitivas/identificacion-fiscal/documento";
import {
  numeroDeDocumentoGuardado,
  numeroDeDocumentoInformadoAArca,
} from "../../../primitivas/identificacion-fiscal/numero-de-documento-para-arca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  LARGO_MAXIMO_DEL_NOMBRE_O_RAZON_SOCIAL,
  nombreODenominacionDesdeTexto,
} from "../../../primitivas/texto/nombre-o-razon-social";
import type { LetraDeComprobante } from "./comprobante-emitido";
import { condicionAdmiteLetra, type CondicionIvaReceptor } from "./condicion-iva-receptor";

/**
 * Receptor de un comprobante (spec H7 facturación §B.3.2): a quién se le factura. Se congela en el
 * comprobante al nacer y no cambia. La condición frente al IVA es OBLIGATORIA siempre (RG 5616,
 * WSFE v4.8 l. 90): se pide y se envía aunque ARCA todavía la aceptaría vacía.
 *
 * Las validaciones de forma viven acá y no en `CHECK`, para poder aflojarlas sin migración. Las reglas de cada dato
 * NO se escriben acá: son las primitivas de nombre (`texto/nombre-o-razon-social`), documento
 * (`identificacion-fiscal/documento`) y domicilio libre (`domicilio/domicilio-libre`), cada una con su ficha.
 *
 * Los límites de largo son ASUMIDOS (el manual no fija el largo de estos textos) y los fijan esas primitivas:
 * `LIMITES_DE_RECEPTOR` solo los nombra.
 */
export const LIMITES_DE_RECEPTOR = {
  nombre: LARGO_MAXIMO_DEL_NOMBRE_O_RAZON_SOCIAL,
  domicilio: LARGO_MAXIMO_DEL_DOMICILIO_LIBRE,
} as const;

export const TIPOS_DE_DOCUMENTO = TIPOS_DE_DOCUMENTO_DE_IDENTIDAD;

export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number];

/** `SIN_IDENTIFICAR` es el consumidor final sin datos: DocTipo 99 y DocNro 0 (error 10015). */
export type DocumentoDelReceptor =
  Readonly<{ tipo: TipoDeDocumento; numero: string }> | Readonly<{ tipo: "SIN_IDENTIFICAR" }>;

export type Receptor = Readonly<{
  /** `null` solo con el documento `SIN_IDENTIFICAR`. */
  nombre: string | null;
  documento: DocumentoDelReceptor;
  condicionIva: CondicionIvaReceptor;
  /** Texto libre: obligatorio salvo con el consumidor final, donde puede faltar. */
  domicilio: string | null;
}>;

export type CampoDeReceptor = "nombre" | "documento" | "condicionIva" | "domicilio";

export type ErrorDeReceptor =
  | Readonly<{ codigo: "RECEPTOR_INVALIDO"; campo: CampoDeReceptor }>
  /** La clase A exige documento CUIT (error excluyente 10013). */
  | Readonly<{ codigo: "RECEPTOR_INVALIDO_PARA_A" }>
  /** El documento del receptor no puede ser el CUIT del emisor (error 10069). */
  | Readonly<{ codigo: "RECEPTOR_IGUAL_AL_EMISOR" }>
  /** Sujeto no categorizado en la clase B: ARCA exige informar la percepción de IVA (error 10067). */
  | Readonly<{ codigo: "RECEPTOR_NO_CATEGORIZADO_NO_SOPORTADO" }>;

function recortarOpcional(texto: string | null): string | null {
  const limpio = texto?.trim() ?? "";
  return limpio === "" ? null : limpio;
}

function documentoValido(documento: DocumentoDelReceptor): DocumentoDelReceptor | null {
  switch (documento.tipo) {
    case "SIN_IDENTIFICAR":
      return { tipo: "SIN_IDENTIFICAR" };
    default: {
      const numero = numeroDeDocumentoDesdeTexto(documento.tipo, documento.numero);
      return numero.ok ? { tipo: documento.tipo, numero: numero.valor } : null;
    }
  }
}

/**
 * El número de documento como lo manda ARCA (`DocNro`, un entero): la parte numérica del documento (ficha en
 * `numero-de-documento-para-arca.ts`; para un documento de solo dígitos, él mismo), o cero para el consumidor final sin identificar.
 * Nunca pasa por `number`. Es la ÚNICA fuente: el pedido a ARCA, la reconciliación y el QR la usan.
 */
export function numeroDeDocumentoParaArca(documento: DocumentoDelReceptor): bigint {
  switch (documento.tipo) {
    case "SIN_IDENTIFICAR":
      return 0n;
    // Solo el pasaporte puede traer letras: se extraen sus cifras. Los demás se leen enteros y un texto que no es un número LANZA
    // (como antes): extraer cifras de un DNI o un CUIT corrupto mandaría a ARCA un documento que nadie escribió.
    case "PASAPORTE":
      return numeroDeDocumentoInformadoAArca(documento.numero);
    default:
      return BigInt(documento.numero);
  }
}

/**
 * El número de documento de un comprobante YA EMITIDO, para imprimir (el `nroDocRec` del QR de la hoja y el PDF). NUNCA
 * lanza: un comprobante emitido está congelado e imprimir no valida ni pide nada a ARCA (dueño, 2026-11-07). Para un documento de solo
 * dígitos da lo mismo que `numeroDeDocumentoParaArca`; la diferencia es solo ante un dato raro (sin cifras o en cero: 0, lo que se
 * envió en su momento). Quien arma lo que se ENVÍA a ARCA usa `numeroDeDocumentoParaArca`.
 */
export function numeroDeDocumentoParaImprimir(documento: DocumentoDelReceptor): bigint {
  return documento.tipo === "SIN_IDENTIFICAR" ? 0n : numeroDeDocumentoGuardado(documento.numero);
}

export type ContextoDeReceptor = Readonly<{
  /** La letra del comprobante que se va a emitir (sale de `letraParaFactura` o del asociado). */
  letra: LetraDeComprobante;
  cuitDelEmisor: Cuit;
}>;

/**
 * Valida y normaliza el receptor para un comprobante de `contexto.letra`. Devuelve el PRIMER error,
 * en este orden: forma (nombre, documento, domicilio), condición admitida por la letra, la clase A
 * exige CUIT, receptor distinto del emisor y sujeto no categorizado en B. Normaliza: recorta
 * blancos, deja el CUIT en su forma canónica y vuelve `null` los textos vacíos.
 */
export function validarReceptor(
  entrada: Receptor,
  contexto: ContextoDeReceptor,
): Resultado<Receptor, ErrorDeReceptor> {
  const documento = documentoValido(entrada.documento);
  if (documento === null) return err({ codigo: "RECEPTOR_INVALIDO", campo: "documento" });
  // Un nombre ausente o en blanco es «sin nombre»; uno escrito tiene que pasar la regla del dato (al menos una letra, sin invisibles…).
  const escrito = recortarOpcional(entrada.nombre);
  const nombreValido = escrito === null ? null : nombreODenominacionDesdeTexto(escrito);
  if (
    (escrito === null && documento.tipo !== "SIN_IDENTIFICAR") ||
    (nombreValido !== null && !nombreValido.ok)
  ) {
    return err({ codigo: "RECEPTOR_INVALIDO", campo: "nombre" });
  }
  const nombre = nombreValido?.ok === true ? nombreValido.valor : null;
  const domicilioValido = domicilioLibreDesdeTexto(entrada.domicilio);
  if (!domicilioValido.ok) return err({ codigo: "RECEPTOR_INVALIDO", campo: "domicilio" });
  const domicilio = domicilioValido.valor;
  // La norma pide el domicilio comercial de todo receptor que no sea consumidor final (RG 1415 Anexo II A.II a, c, e, f, g;
  // dueño, 2026-11-06, Q24). Previene una factura A o B a un cliente identificado que sale sin domicilio.
  if (domicilio === null && entrada.condicionIva !== "CONSUMIDOR_FINAL") {
    return err({ codigo: "RECEPTOR_INVALIDO", campo: "domicilio" });
  }
  if (!condicionAdmiteLetra(entrada.condicionIva, contexto.letra)) {
    return err({ codigo: "RECEPTOR_INVALIDO", campo: "condicionIva" });
  }
  if (contexto.letra === "A" && documento.tipo !== "CUIT") {
    return err({ codigo: "RECEPTOR_INVALIDO_PARA_A" });
  }
  // ARCA compara el `DocNro` como número (error 10069): sin identificar es cero y nunca es un CUIT.
  if (numeroDeDocumentoParaArca(documento) === BigInt(contexto.cuitDelEmisor)) {
    return err({ codigo: "RECEPTOR_IGUAL_AL_EMISOR" });
  }
  if (contexto.letra === "B" && entrada.condicionIva === "NO_CATEGORIZADO") {
    return err({ codigo: "RECEPTOR_NO_CATEGORIZADO_NO_SOPORTADO" });
  }
  return ok({ nombre, documento, condicionIva: entrada.condicionIva, domicilio });
}
