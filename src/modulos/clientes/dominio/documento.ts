import { documentoExtranjeroDesdeTexto } from "../../../primitivas/identificacion-fiscal/documento-extranjero";
import { numeroDeDocumentoDesdeTexto } from "../../../primitivas/identificacion-fiscal/documento";
import { paisDesdeTexto } from "../../../primitivas/identificacion-fiscal/pais";
import { pasaporteDesdeTexto } from "../../../primitivas/identificacion-fiscal/pasaporte";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { NaturalezaDeParte } from "./estados";

/**
 * El documento de una parte del directorio (E9 §3.1; D126 de `catalogo-y-niveles-maqueta.md`). Seis tipos: `CUIT`, `CUIL` y `CDI` (el mismo número de once
 * dígitos con dígito verificador), `DNI`, `PASAPORTE` (con país) y `ID_EXTRANJERO` (con país). Una persona puede tener cualquiera; una EMPRESA solo
 * `CUIT` o `ID_EXTRANJERO` («Una empresa solo admite CUIT o documento extranjero», `directorio.html`). Es opcional: lo decide quien lo usa.
 *
 * Un documento, una parte por empresa, también entre las desactivadas: `documentoNormalizado` es la MISMA clave que la columna generada
 * `parte.documento_normalizado` de la base (con su único), así que un CUIT y un CUIL con el mismo número son el mismo documento. Una prueba de
 * integración compara las dos. Cada número lo valida su primitiva (`cuit.ts`, `documento.ts`, `pasaporte.ts`, `documento-extranjero.ts`): acá no se
 * repite ninguna regla de forma ni de largo.
 */
export const TIPOS_DE_DOCUMENTO_DE_PARTE = [
  "CUIT",
  "CUIL",
  "CDI",
  "DNI",
  "PASAPORTE",
  "ID_EXTRANJERO",
] as const;
export type TipoDeDocumentoDeParte = (typeof TIPOS_DE_DOCUMENTO_DE_PARTE)[number];

/** Los únicos tipos que admite una empresa (persona jurídica). */
export const TIPOS_DE_DOCUMENTO_DE_EMPRESA = [
  "CUIT",
  "ID_EXTRANJERO",
] as const satisfies readonly TipoDeDocumentoDeParte[];

export type DocumentoDeParte =
  | Readonly<{ tipo: "CUIT" | "CUIL" | "CDI" | "DNI"; pais: null; numero: string }>
  | Readonly<{ tipo: "PASAPORTE" | "ID_EXTRANJERO"; pais: string; numero: string }>;

export type DatosDeDocumento = Readonly<{
  tipo: string;
  pais?: string | null;
  numero: string;
}>;

export type ErrorDeDocumentoDeParte =
  | "TIPO_DE_DOCUMENTO_INVALIDO"
  | "DOCUMENTO_NO_ADMITIDO_PARA_EMPRESA"
  | "CUIT_INVALIDO"
  | "DNI_INVALIDO"
  | "PAIS_REQUERIDO"
  | "PAIS_INVALIDO"
  | "PAIS_NO_CORRESPONDE"
  | "PASAPORTE_INVALIDO"
  | "DOCUMENTO_EXTRANJERO_INVALIDO";

export function esTipoDeDocumentoDeParte(texto: string): texto is TipoDeDocumentoDeParte {
  return (TIPOS_DE_DOCUMENTO_DE_PARTE as readonly string[]).includes(texto);
}

/**
 * Valida y deja en su forma canónica el documento de una parte. El primer error, en el orden: tipo, naturaleza, y después el país y el número según el
 * tipo. Los documentos argentinos no llevan país (`PAIS_NO_CORRESPONDE` si llega uno); los dos extranjeros lo exigen (`PAIS_REQUERIDO` si falta, `PAIS_INVALIDO` si no tiene la forma).
 */
export function documentoDeParteDesdeDatos(
  naturaleza: NaturalezaDeParte,
  datos: DatosDeDocumento,
): Resultado<DocumentoDeParte, ErrorDeDocumentoDeParte> {
  const tipo = datos.tipo;
  if (!esTipoDeDocumentoDeParte(tipo)) return err("TIPO_DE_DOCUMENTO_INVALIDO");
  if (
    naturaleza === "JURIDICA" &&
    !(TIPOS_DE_DOCUMENTO_DE_EMPRESA as readonly string[]).includes(tipo)
  ) {
    return err("DOCUMENTO_NO_ADMITIDO_PARA_EMPRESA");
  }
  const pais = datos.pais ?? null;

  if (tipo === "PASAPORTE" || tipo === "ID_EXTRANJERO") {
    if (pais === null) return err("PAIS_REQUERIDO");
    const codigo = paisDesdeTexto(pais);
    if (!codigo.ok) return err("PAIS_INVALIDO");
    if (tipo === "PASAPORTE") {
      const pasaporte = pasaporteDesdeTexto(datos.numero);
      return pasaporte.ok
        ? ok({ tipo, pais: codigo.valor, numero: pasaporte.valor })
        : err("PASAPORTE_INVALIDO");
    }
    const extranjero = documentoExtranjeroDesdeTexto(datos.numero);
    return extranjero.ok
      ? ok({ tipo, pais: codigo.valor, numero: extranjero.valor })
      : err("DOCUMENTO_EXTRANJERO_INVALIDO");
  }

  if (pais !== null) return err("PAIS_NO_CORRESPONDE");
  const numero = numeroDeDocumentoDesdeTexto(tipo, datos.numero);
  if (numero.ok) return ok({ tipo, pais: null, numero: numero.valor });
  return err(tipo === "DNI" ? "DNI_INVALIDO" : "CUIT_INVALIDO");
}

/**
 * La clave única del documento dentro de una empresa: `T` + número para CUIT, CUIL y CDI (el mismo número es el mismo documento), `D` + número para el
 * DNI, y la inicial del tipo + país + `:` + número para el pasaporte y el documento extranjero. Idéntica a la columna generada de la base.
 */
export function documentoNormalizado(documento: DocumentoDeParte): string {
  switch (documento.tipo) {
    case "CUIT":
    case "CUIL":
    case "CDI":
      return `T${documento.numero}`;
    case "DNI":
      return `D${documento.numero}`;
    case "PASAPORTE":
    case "ID_EXTRANJERO":
      return `${documento.tipo.charAt(0)}${documento.pais}:${documento.numero}`;
  }
}
