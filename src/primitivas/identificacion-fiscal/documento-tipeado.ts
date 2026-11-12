import { cuitMientrasSeEscribe, LARGO_DE_CUIT } from "./cuit";
import { LARGO_MAXIMO_DE_DNI, type TipoDeDocumentoDeIdentidad } from "./documento";
import { pasaporteMientrasSeEscribe } from "./pasaporte";

/**
 * El número de documento tal como se ESCRIBE en pantalla (pedido del dueño, 2026-11-12: el sistema pone los guiones del CUIT y los
 * puntos del DNI; quien escribe tipea solo dígitos). El largo y el conjunto permitido salen de la ficha de cada tipo (`cuit.ts`,
 * `documento.ts`, `pasaporte.ts`): acá no se repite ningún número. El formato de pantalla vive acá y solo acá; la UI lo importa.
 *
 *  - CUIT, CUIL y CDI: solo dígitos, hasta el largo del CUIT; se ven `XX-XXXXXXXX-X`.
 *  - DNI: solo dígitos, hasta el largo máximo del DNI; un cero inicial se ignora (el DNI no empieza con cero); se ve con puntos de miles.
 *  - PASAPORTE: letras A-Z (las minúsculas pasan a mayúsculas) y dígitos; sin formato.
 * Lo que escribe quien tipea y no pertenece al conjunto (guiones, puntos, espacios, letras en un CUIT) no entra: los separadores los pone
 * el sistema. El valor que viaja es siempre el canónico (`canonico`); el servidor lo vuelve a validar con `numeroDeDocumentoDesdeTexto`.
 *
 * Previene: el fallo real de «Emitir»: un CUIT escrito a mano con o sin guiones que llegaba distinto al servidor. Chequeo:
 * `documento-tipeado.test.ts`.
 */
export type DocumentoEscrito = Readonly<{
  /** Lo que muestra el campo (con guiones o puntos). Vacío si no hay nada. */
  texto: string;
  /** Lo que viaja: solo dígitos, o el pasaporte en mayúsculas. */
  canonico: string;
  /** Dónde queda el cursor dentro de `texto`. */
  cursor: number;
}>;

export type DocumentoPegado =
  Readonly<{ ok: true; texto: string; canonico: string }> | Readonly<{ ok: false }>;

/** Lo que queda de lo escrito: solo lo que pertenece al tipo, en su forma canónica y cortado en su largo máximo. */
function canonicoEscrito(tipo: TipoDeDocumentoDeIdentidad, crudo: string): string {
  const digitos = crudo.replace(/[^0-9]/g, "");
  switch (tipo) {
    case "CUIT":
    case "CUIL":
    case "CDI":
      return digitos.slice(0, LARGO_DE_CUIT);
    case "DNI":
      return digitos.replace(/^0+/, "").slice(0, LARGO_MAXIMO_DE_DNI);
    case "PASAPORTE":
      return pasaporteMientrasSeEscribe(crudo);
  }
}

/** El canónico con el formato de pantalla de su tipo (guiones, puntos o nada). Es lo que se muestra al leer y mientras se escribe. */
export function documentoMientrasSeEscribe(
  tipo: TipoDeDocumentoDeIdentidad,
  canonico: string,
): string {
  switch (tipo) {
    case "CUIT":
    case "CUIL":
    case "CDI":
      return cuitMientrasSeEscribe(canonico);
    case "DNI":
      return canonico.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    case "PASAPORTE":
      return canonico;
  }
}

/** El separador que el sistema pone en el tipo, o `null` si no pone ninguno. */
function separadorDe(tipo: TipoDeDocumentoDeIdentidad): string | null {
  switch (tipo) {
    case "CUIT":
    case "CUIL":
    case "CDI":
      return "-";
    case "DNI":
      return ".";
    case "PASAPORTE":
      return null;
  }
}

/** La posición en `texto` que deja delante `significativos` caracteres que no son separador (0 si no hay ninguno). */
function posicionTras(texto: string, separador: string | null, significativos: number): number {
  let vistos = 0;
  let posicion = 0;
  while (vistos < significativos) {
    if (texto[posicion] !== separador) vistos++;
    posicion++;
  }
  return posicion;
}

/**
 * Lo que queda en el campo cuando la persona escribe o borra. `crudo` es el valor que dejó el navegador (con los separadores que el
 * sistema puso antes) y `cursorCrudo` dónde estaba el cursor. El cursor queda detrás de lo último escrito aunque se agreguen o
 * quiten separadores; borrar un guion o un punto no cambia el valor (el sistema lo vuelve a poner).
 */
export function escribirDocumento(
  tipo: TipoDeDocumentoDeIdentidad,
  crudo: string,
  cursorCrudo: number,
): DocumentoEscrito {
  const canonico = canonicoEscrito(tipo, crudo);
  const texto = documentoMientrasSeEscribe(tipo, canonico);
  const delanteDelCursor = canonicoEscrito(tipo, crudo.slice(0, cursorCrudo)).length;
  return { texto, canonico, cursor: posicionTras(texto, separadorDe(tipo), delanteDelCursor) };
}

/**
 * Interpreta lo PEGADO sin adivinar: se acepta si es del tipo y entra entero (con o sin los separadores de su tipo, bien puestos);
 * si trae algo que no es del tipo, de más, un cero inicial de DNI o un separador mal puesto, se rechaza y el campo no cambia. Los
 * espacios de los extremos se ignoran (lo copiado suele traerlos).
 */
export function interpretarDocumentoPegado(
  tipo: TipoDeDocumentoDeIdentidad,
  crudo: string,
): DocumentoPegado {
  const pegado = crudo.trim();
  const separador = separadorDe(tipo);
  const sinSeparadores = separador === null ? pegado : pegado.replaceAll(separador, "");
  const canonico = canonicoEscrito(tipo, sinSeparadores);
  // Si al limpiarlo se perdió algo (otro carácter, un cero inicial, lo que excede el largo), no era un documento de este tipo.
  if (sinSeparadores === "" || canonico.length !== sinSeparadores.length) return { ok: false };
  const texto = documentoMientrasSeEscribe(tipo, canonico);
  // Con separadores, tienen que estar donde el sistema los pondría.
  if (pegado !== sinSeparadores && pegado !== texto) return { ok: false };
  return { ok: true, texto, canonico };
}
