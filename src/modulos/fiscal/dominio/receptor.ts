import { cuitDesdeTexto, type Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { LetraDeComprobante } from "./comprobante-emitido";
import { condicionAdmiteLetra, type CondicionIvaReceptor } from "./condicion-iva-receptor";

/**
 * Receptor de un comprobante (spec H7 facturación §B.3.2): a quién se le factura. Se congela en el
 * comprobante al nacer y no cambia. La condición frente al IVA es OBLIGATORIA siempre (RG 5616,
 * WSFE v4.8 l. 90): se pide y se envía aunque ARCA todavía la aceptaría vacía.
 *
 * Las validaciones de forma viven acá y no en `CHECK`, para poder aflojarlas sin migración.
 *
 * Valores configurables, todos ASUMIDOS (el manual no fija el largo de estos textos; tienen el mismo
 * orden que la razón social de los datos fiscales): `LIMITES_DE_RECEPTOR`.
 */
export const LIMITES_DE_RECEPTOR = { nombre: 200, domicilio: 300 } as const;

export const TIPOS_DE_DOCUMENTO = ["CUIT", "CUIL", "CDI", "DNI", "PASAPORTE"] as const;

export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number];

/** `SIN_IDENTIFICAR` es el consumidor final sin datos: DocTipo 99 y DocNro 0 (error 10015). */
export type DocumentoDelReceptor =
  Readonly<{ tipo: TipoDeDocumento; numero: string }> | Readonly<{ tipo: "SIN_IDENTIFICAR" }>;

export type Receptor = Readonly<{
  /** `null` solo con el documento `SIN_IDENTIFICAR`. */
  nombre: string | null;
  documento: DocumentoDelReceptor;
  condicionIva: CondicionIvaReceptor;
  /** Texto libre y opcional. */
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

/** DNI: sin ceros a la izquierda, de 6 a 9 dígitos (como `parte_documento_ck` de clientes). */
const FORMATO_DE_DNI = /^[1-9][0-9]{5,8}$/;
/**
 * Pasaporte: `DocNro` es un `Long (11)` en WSFE v4.8 (l. 577), así que solo cabe un número de hasta
 * 11 dígitos. NO VERIFICADO que ARCA acepte el tipo 94 con ese formato (lo confirma el espía).
 */
const FORMATO_DE_PASAPORTE = /^[0-9]{1,11}$/;

function recortarOpcional(texto: string | null): string | null {
  const limpio = texto?.trim() ?? "";
  return limpio === "" ? null : limpio;
}

function documentoValido(documento: DocumentoDelReceptor): DocumentoDelReceptor | null {
  switch (documento.tipo) {
    case "SIN_IDENTIFICAR":
      return { tipo: "SIN_IDENTIFICAR" };
    case "CUIT":
    case "CUIL":
    case "CDI": {
      const cuit = cuitDesdeTexto(documento.numero);
      return cuit.ok ? { tipo: documento.tipo, numero: cuit.valor } : null;
    }
    case "DNI":
      return FORMATO_DE_DNI.test(documento.numero) ? documento : null;
    case "PASAPORTE":
      return FORMATO_DE_PASAPORTE.test(documento.numero) ? documento : null;
  }
}

/**
 * El número de documento como lo manda ARCA (`DocNro`, un entero): el del documento, o cero para el
 * consumidor final sin identificar. Nunca pasa por `number`.
 */
export function numeroDeDocumentoParaArca(documento: DocumentoDelReceptor): bigint {
  return documento.tipo === "SIN_IDENTIFICAR" ? 0n : BigInt(documento.numero);
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
  const nombre = recortarOpcional(entrada.nombre);
  const domicilio = recortarOpcional(entrada.domicilio);
  const documento = documentoValido(entrada.documento);
  if (documento === null) return err({ codigo: "RECEPTOR_INVALIDO", campo: "documento" });
  if (
    (nombre === null && documento.tipo !== "SIN_IDENTIFICAR") ||
    (nombre !== null && nombre.length > LIMITES_DE_RECEPTOR.nombre)
  ) {
    return err({ codigo: "RECEPTOR_INVALIDO", campo: "nombre" });
  }
  if (domicilio !== null && domicilio.length > LIMITES_DE_RECEPTOR.domicilio) {
    return err({ codigo: "RECEPTOR_INVALIDO", campo: "domicilio" });
  }
  if (!condicionAdmiteLetra(entrada.condicionIva, contexto.letra)) {
    return err({ codigo: "RECEPTOR_INVALIDO", campo: "condicionIva" });
  }
  if (contexto.letra === "A" && documento.tipo !== "CUIT") {
    return err({ codigo: "RECEPTOR_INVALIDO_PARA_A" });
  }
  if (documento.tipo !== "SIN_IDENTIFICAR" && documento.numero === contexto.cuitDelEmisor) {
    return err({ codigo: "RECEPTOR_IGUAL_AL_EMISOR" });
  }
  if (contexto.letra === "B" && entrada.condicionIva === "NO_CATEGORIZADO") {
    return err({ codigo: "RECEPTOR_NO_CATEGORIZADO_NO_SOPORTADO" });
  }
  return ok({ nombre, documento, condicionIva: entrada.condicionIva, domicilio });
}
