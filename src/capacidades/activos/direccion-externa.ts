import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import {
  PROVEEDORES_DE_IMAGEN,
  VARIANTES_DE_FOTO,
  type IdDeProveedor,
  type VarianteDeFoto,
} from "./proveedores-de-imagen";

/**
 * Leer lo que pega el comerciante y armar lo que pide el servidor (carta, §5.7.1 y S1). Dominio puro: ni
 * red, ni DNS, ni redirecciones. Dos ideas sostienen la seguridad:
 *  - LO PEGADO NUNCA SE REUTILIZA: se lo descompone en partes que pasan una lista de caracteres
 *    permitidos y se vuelve a armar desde la plantilla del proveedor. Lo que no se puede clasificar
 *    con certeza se rechaza (falla cerrado).
 *  - EL HOST ES UN LITERAL DEL CATÁLOGO: lo pegado se compara por IGUALDAD EXACTA con él (nada de
 *    «termina en», «contiene» ni resolver nombres), así que sufijos engañosos, puntos finales,
 *    IP literales, `localhost`, punycode o `%2e` no tienen por dónde pasar.
 * Sin expresiones regulares: recorridos lineales sobre un texto de a lo sumo 300 caracteres.
 */

/** Más largo que esto no es una dirección de foto (el patrón de Cloudinary da menos de 300). */
export const LARGO_MAXIMO_DE_DIRECCION = 300;

/** Por qué una dirección pegada no sirve. Códigos estables: la pantalla los traduce (`fotos.error.*`). */
export type ErrorDeDireccion =
  | "VACIA"
  | "DEMASIADO_LARGA"
  | "CARACTER_NO_PERMITIDO"
  | "ESQUEMA_NO_PERMITIDO"
  | "CREDENCIALES_NO_PERMITIDAS"
  | "PUERTO_NO_PERMITIDO"
  | "HOST_NO_PERMITIDO"
  | "CONSULTA_O_FRAGMENTO"
  | "RUTA_INVALIDA"
  | "CUENTA_INVALIDA"
  | "VIDEO_O_ARCHIVO"
  | "TIPO_NO_PERMITIDO"
  | "SIN_VERSION"
  | "ID_INVALIDO"
  | "EXTENSION_NO_PERMITIDA";

/** Por qué no se puede armar un destino con partes ya leídas (o leídas de la base). */
export type ErrorDeDestino = "PARTES_INVALIDAS" | "VARIANTE_INVALIDA" | "CUENTA_NO_DECLARADA";

/** Lo que se guarda por foto (§5.7.2): partes, nunca la dirección pegada. */
export interface PartesDeDireccion {
  readonly proveedor: IdDeProveedor;
  readonly cuenta: string;
  readonly idPublico: string;
  /** Solo los dígitos, sin la «v». */
  readonly version: string;
  readonly extension: string;
}

export interface DireccionLeida {
  readonly partes: PartesDeDireccion;
  /** `https://host/cuenta/image/upload/v<versión>/<id>.<ext>`, sin transformaciones. Leerla da las mismas partes. */
  readonly direccionNormalizada: string;
  /** Lo pegado era `http://`: se acepta como texto de entrada y se avisa; nunca se pide por `http`. */
  readonly eraHttp: boolean;
}

declare const marcaDeDestino: unique symbol;

/**
 * Lo único que el traedor acepta pedir (S1). Solo lo construye `armarDestino`, desde partes validadas y
 * la plantilla del proveedor: el tipo no se puede fabricar a mano sin un `as`.
 */
export interface DestinoValidado {
  readonly [marcaDeDestino]: true;
  readonly proveedor: IdDeProveedor;
  /** Literal del catálogo: el nombre para SNI y para verificar el certificado. */
  readonly host: string;
  /** Ruta con la transformación del proveedor, sin consulta ni fragmento. */
  readonly ruta: string;
  /** Siempre `https://` + host + ruta. */
  readonly url: string;
  readonly variante: VarianteDeFoto;
}

const CLOUDINARY = PROVEEDORES_DE_IMAGEN.CLOUDINARY;
const EXTENSIONES: readonly string[] = CLOUDINARY.extensiones;

const DIGITOS = "0123456789";
const MINUSCULAS_Y_DIGITOS = "abcdefghijklmnopqrstuvwxyz0123456789_-";
const ALFANUMERICOS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
/** Lo que puede tener un tramo de transformación (se descarta, pero igual se mira). Sin `%` ni `/`. */
const DE_TRANSFORMACION = `${ALFANUMERICOS},.:`;

/** Pares de comillas que un comerciante arrastra al copiar: se pelan, de a un par. */
const CIERRE_DE_COMILLA = new Map([
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
]);

function formadoPor(texto: string, alfabeto: string): boolean {
  for (const c of texto) {
    if (!alfabeto.includes(c)) return false;
  }
  return true;
}

/** Visibles de ASCII (0x21 a 0x7E) menos la barra invertida: fuera quedan controles, blancos, NUL, Unicode. */
function soloAsciiVisible(texto: string): boolean {
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c < 0x21 || c > 0x7e || c === 0x5c) return false;
  }
  return true;
}

function esCuenta(cuenta: unknown): cuenta is string {
  return (
    typeof cuenta === "string" &&
    cuenta.length >= 1 &&
    cuenta.length <= CLOUDINARY.largoMaximoDeCuenta &&
    formadoPor(cuenta, MINUSCULAS_Y_DIGITOS)
  );
}

function esVersion(version: unknown): boolean {
  return (
    typeof version === "string" &&
    version.length >= 1 &&
    version.length <= 12 &&
    !version.startsWith("0") &&
    formadoPor(version, DIGITOS)
  );
}

/** Tramos separados por `/`, cada uno no vacío y de `[A-Za-z0-9_-]`: sin `..`, sin `%`, sin `.`. */
function esIdPublico(id: unknown): boolean {
  return (
    typeof id === "string" &&
    id.length >= 1 &&
    id.length <= CLOUDINARY.largoMaximoDelId &&
    id.split("/").every((tramo) => tramo.length >= 1 && formadoPor(tramo, ALFANUMERICOS))
  );
}

function esExtension(extension: unknown): boolean {
  return typeof extension === "string" && EXTENSIONES.includes(extension);
}

function sinComillas(texto: string): string {
  const cierre = CIERRE_DE_COMILLA.get(texto.charAt(0));
  return cierre !== undefined && texto.endsWith(cierre) ? texto.slice(1, -1).trim() : texto;
}

/** Posición del primer `/`, `?` o `#` (donde termina el «quién»), o el largo si no hay. */
function finDeAutoridad(texto: string): number {
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charAt(i);
    if (c === "/" || c === "?" || c === "#") return i;
  }
  return texto.length;
}

function direccionCanonica(p: PartesDeDireccion): string {
  return `https://${CLOUDINARY.host}/${p.cuenta}/${CLOUDINARY.recurso}/${CLOUDINARY.entrega}/v${p.version}/${p.idPublico}.${p.extension}`;
}

/**
 * Lee la dirección que pegó una persona. Tolera blancos y saltos de línea en las puntas, un par de
 * comillas alrededor, mayúsculas en el esquema y el host, `http://` (con aviso) y las transformaciones
 * del proveedor (se descartan). Todo lo demás se rechaza con un código: otro host, hosts parecidos,
 * usuario, puerto, IP literal, `?`, `#`, `..`, `%`, tipos que no son `image/upload`, falta de versión,
 * caracteres de control o fuera de ASCII. No admite fragmentos de HTML (`<img src="…">`): el spec no los
 * pide y aceptarlos agrandaría lo que hay que clasificar (supuesto: falla cerrado). Nunca lanza.
 */
export function leerDireccionPegada(texto: string): Resultado<DireccionLeida, ErrorDeDireccion> {
  if (typeof texto !== "string") return err("VACIA");
  const limpio = sinComillas(texto.trim());
  if (limpio === "") return err("VACIA");
  if (limpio.length > LARGO_MAXIMO_DE_DIRECCION) return err("DEMASIADO_LARGA");
  if (!soloAsciiVisible(limpio)) return err("CARACTER_NO_PERMITIDO");

  const minusculas = limpio.toLowerCase();
  const eraHttp = minusculas.startsWith("http://");
  if (!eraHttp && !minusculas.startsWith("https://")) return err("ESQUEMA_NO_PERMITIDO");
  const resto = limpio.slice(eraHttp ? "http://".length : "https://".length);

  const fin = finDeAutoridad(resto);
  const autoridad = resto.slice(0, fin);
  if (autoridad.includes("@")) return err("CREDENCIALES_NO_PERMITIDAS");
  if (autoridad.includes(":")) {
    return err(autoridad.startsWith("[") ? "HOST_NO_PERMITIDO" : "PUERTO_NO_PERMITIDO");
  }
  // Igualdad exacta con el literal del catálogo. Con más proveedores se despacha acá por host.
  if (autoridad.toLowerCase() !== CLOUDINARY.host) return err("HOST_NO_PERMITIDO");

  const ruta = resto.slice(fin);
  if (ruta.includes("?") || ruta.includes("#")) return err("CONSULTA_O_FRAGMENTO");
  const tramos = ruta.slice(1).split("/");
  if (tramos.length < 3) return err("RUTA_INVALIDA");
  const [cuenta, recurso, entrega] = tramos;
  if (!esCuenta(cuenta)) return err("CUENTA_INVALIDA");
  if (recurso === "video" || recurso === "raw") return err("VIDEO_O_ARCHIVO");
  if (recurso !== CLOUDINARY.recurso) return err("RUTA_INVALIDA");
  if (entrega !== CLOUDINARY.entrega) return err("TIPO_NO_PERMITIDO");

  // Lo que sigue a `upload/`: transformaciones (se descartan), la versión `v<dígitos>` y el id con extensión.
  const cola = tramos.slice(3);
  if (cola.some((t) => t === "" || t === "." || t.includes("..") || t.includes("%"))) {
    return err("RUTA_INVALIDA");
  }
  const tramoDeVersion = cola.find((t) => t.startsWith("v") && esVersion(t.slice(1)));
  if (tramoDeVersion === undefined) return err("SIN_VERSION");
  const posicionDeVersion = cola.indexOf(tramoDeVersion);
  if (!cola.slice(0, posicionDeVersion).every((t) => formadoPor(t, DE_TRANSFORMACION))) {
    return err("RUTA_INVALIDA");
  }
  const version = tramoDeVersion.slice(1);
  const tramosDelId = cola.slice(posicionDeVersion + 1);
  const ultimo = tramosDelId.pop();
  if (ultimo === undefined) return err("ID_INVALIDO");
  const punto = ultimo.lastIndexOf(".");
  const extension = punto === -1 ? "" : ultimo.slice(punto + 1).toLowerCase();
  if (!esExtension(extension)) return err("EXTENSION_NO_PERMITIDA");
  const idPublico = [...tramosDelId, ultimo.slice(0, punto)].join("/");
  if (!esIdPublico(idPublico)) return err("ID_INVALIDO");

  const partes: PartesDeDireccion = {
    proveedor: "CLOUDINARY",
    cuenta,
    idPublico,
    version,
    extension,
  };
  return ok({ partes, direccionNormalizada: direccionCanonica(partes), eraHttp });
}

/**
 * Arma el destino a pedir (S1) desde partes y la plantilla del proveedor, SIN seguir redirecciones ni
 * resolver nombres. Vuelve a validar las partes (también cuando salen de la base: defensa en
 * profundidad) y exige que la cuenta esté entre las declaradas por la empresa (§5.7.2).
 */
export function armarDestino(
  partes: PartesDeDireccion,
  variante: VarianteDeFoto,
  cuentasDeclaradas: readonly string[],
): Resultado<DestinoValidado, ErrorDeDestino> {
  if (
    partes.proveedor !== "CLOUDINARY" ||
    !esCuenta(partes.cuenta) ||
    !esVersion(partes.version) ||
    !esIdPublico(partes.idPublico) ||
    !esExtension(partes.extension)
  ) {
    return err("PARTES_INVALIDAS");
  }
  if (!VARIANTES_DE_FOTO.includes(variante)) return err("VARIANTE_INVALIDA");
  if (!cuentasDeclaradas.includes(partes.cuenta)) return err("CUENTA_NO_DECLARADA");
  const ruta = `/${partes.cuenta}/${CLOUDINARY.recurso}/${CLOUDINARY.entrega}/${CLOUDINARY.transformacion(variante)}/v${partes.version}/${partes.idPublico}.${partes.extension}`;
  const destino = {
    proveedor: partes.proveedor,
    host: CLOUDINARY.host,
    ruta,
    url: `https://${CLOUDINARY.host}${ruta}`,
    variante,
  };
  return ok(destino as DestinoValidado);
}
