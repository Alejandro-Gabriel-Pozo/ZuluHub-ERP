import { createHash } from "node:crypto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * La dirección de un producto de la carta (§3.3): `<slug>-<h8>`. El `slug` sale del nombre (legible en un
 * mensaje); el `h8` sale de un hash de los ids y es lo que identifica de verdad al producto. Nunca viaja un
 * id interno: un UUID v4 tiene 122 bits al azar y el hash no permite recuperarlo.
 */

/** Largo máximo del slug, en caracteres. */
export const LARGO_MAXIMO_DEL_SLUG = 60;
/** Slug de un nombre que no deja ninguna letra ni número. */
export const SLUG_POR_DEFECTO = "producto";
/** Hexadecimales del sufijo corriente, y del alargado cuando dos productos de una carta chocan. */
export const LARGO_DEL_SUFIJO = 8;
export const LARGO_DEL_SUFIJO_ALARGADO = 12;

const PREFIJO_DEL_HASH = "producto-de-vidriera:";
/** `<slug>-<8 o 12 hexadecimales>`: el sufijo es lo último, así que un slug con guiones no lo confunde. */
const SEGMENTO = /^.*-([0-9a-f]{8}|[0-9a-f]{12})$/;

/**
 * Del nombre al slug: NFKD, sin tildes, minúsculas, lo que no sea `[a-z0-9]` pasa a guion, guiones
 * repetidos colapsados y sin guiones en los extremos, hasta 60 caracteres. Vacío → `producto`.
 * Es idempotente: el slug de un slug es el mismo.
 */
export function slugDeNombre(nombre: string): string {
  const slug = nombre
    .normalize("NFKD")
    .toLowerCase()
    // Las marcas combinantes (tildes) se quitan DESPUÉS de pasar a minúsculas: `İ` suelta una al bajar.
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-/, "")
    .slice(0, LARGO_MAXIMO_DEL_SLUG)
    .replace(/-$/, "");
  return slug === "" ? SLUG_POR_DEFECTO : slug;
}

/**
 * Los primeros `largo` hexadecimales de `SHA-256("producto-de-vidriera:" ‖ vidrieraId ‖ productoId)`. Los ids son
 * UUID (largo fijo), así que la concatenación sin separador no es ambigua. Determinista: la misma carta y el
 * mismo producto dan siempre el mismo sufijo, aunque cambie el nombre.
 */
export function huellaDeProducto(
  vidrieraId: string,
  productoId: string,
  largo: typeof LARGO_DEL_SUFIJO | typeof LARGO_DEL_SUFIJO_ALARGADO = LARGO_DEL_SUFIJO,
): string {
  return createHash("sha256")
    .update(`${PREFIJO_DEL_HASH}${vidrieraId}${productoId}`)
    .digest("hex")
    .slice(0, largo);
}

export type ProductoParaDireccion = Readonly<{ productoId: string; nombre: string }>;

export type DireccionDeProducto = Readonly<{
  slug: string;
  h8: string;
  /** Lo que va en la dirección: `<slug>-<h8>`. */
  segmento: string;
}>;

/** La dirección de UN producto con el sufijo corriente. Para una carta entera, `direccionesDeVidriera`. */
export function direccionDeProducto(
  vidrieraId: string,
  producto: ProductoParaDireccion,
): DireccionDeProducto {
  return armar(slugDeNombre(producto.nombre), huellaDeProducto(vidrieraId, producto.productoId));
}

/**
 * Las direcciones de todos los productos de una carta, en el mismo orden. Si dos productos de la misma
 * carta comparten sufijo corriente (choque de 32 bits), a los dos se les alarga a 12: ninguna dirección
 * se repite aunque dos productos se llamen igual.
 */
export function direccionesDeVidriera(
  vidrieraId: string,
  productos: readonly ProductoParaDireccion[],
): readonly DireccionDeProducto[] {
  const cortos = productos.map((p) => huellaDeProducto(vidrieraId, p.productoId));
  return productos.map((p, i) => {
    const corto = cortos[i] as string;
    const choca = cortos.indexOf(corto) !== cortos.lastIndexOf(corto);
    const huella = choca
      ? huellaDeProducto(vidrieraId, p.productoId, LARGO_DEL_SUFIJO_ALARGADO)
      : corto;
    return armar(slugDeNombre(p.nombre), huella);
  });
}

function armar(slug: string, h8: string): DireccionDeProducto {
  return { slug, h8, segmento: `${slug}-${h8}` };
}

export type ErrorDeDireccion = "SEGMENTO_INVALIDO" | "PRODUCTO_NO_ENCONTRADO";

export type ProductoResuelto = Readonly<{
  productoId: string;
  direccion: DireccionDeProducto;
  /** El slug del pedido ya no es el del nombre actual: responder 307 a `direccion.segmento`. */
  redirigir: boolean;
}>;

/**
 * Busca el producto de un segmento por el SUFIJO, no por el slug: un enlace viejo sigue andando después de
 * un renombre (con `redirigir` para llevarlo a la dirección actual). Un sufijo que no es de ninguno, o que
 * es de más de uno (un corto de dos productos que chocan), no resuelve: no se adivina.
 */
export function resolverProductoPorSegmento(
  vidrieraId: string,
  productos: readonly ProductoParaDireccion[],
  segmento: string,
): Resultado<ProductoResuelto, ErrorDeDireccion> {
  const coincidencia = SEGMENTO.exec(segmento);
  if (coincidencia === null) return err("SEGMENTO_INVALIDO");
  const huella = coincidencia[1] as string;
  const direcciones = direccionesDeVidriera(vidrieraId, productos);
  const coincidencias = productos.flatMap((p, i) =>
    huellaDeProducto(vidrieraId, p.productoId, LARGO_DEL_SUFIJO_ALARGADO).startsWith(huella)
      ? [{ productoId: p.productoId, direccion: direcciones[i] as DireccionDeProducto }]
      : [],
  );
  const unica = coincidencias.length === 1 ? coincidencias[0] : undefined;
  if (unica === undefined) return err("PRODUCTO_NO_ENCONTRADO");
  return ok({ ...unica, redirigir: unica.direccion.segmento !== segmento });
}
