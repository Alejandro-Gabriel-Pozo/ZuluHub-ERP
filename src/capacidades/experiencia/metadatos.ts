/**
 * Metadatos de una página pública de la carta (SEO y metadatos, §2 de `11-especificaciones/seo-y-metadatos-especificacion.md`, aprobada por el
 * dueño el 12/11/2026): título, descripción, imagen para compartir, dirección canónica e «indexable». Función pura: NO recibe id de empresa, plan ni datos de otra
 * empresa, solo lo que la página puede mostrar, así que por su firma no puede filtrar datos ajenos. Sin datos estructurados (la carta no los lleva en v1, §5).
 * No publica domicilio, horario, teléfono, correo ni web (decisión del dueño, 12/11/2026). Los textos salen del dato (nombre, rubro, lugar), nunca de un campo propio.
 *
 * «Indexable» NO se decide acá: llega de `esIndexable` (`cabeceras.ts`), la única regla; acá solo se le suma que un producto nunca se indexa.
 */

/** Cuánto muestra Google del título y de la descripción (§2.1; el 60 y el 155 viven SOLO acá). */
export const LARGO_DEL_TITULO_DE_PAGINA = 60;
export const LARGO_DE_LA_DESCRIPCION_DE_PAGINA = 155;

/** Meta pide al menos 300 px de ancho para la tarjeta (§9.2). Un logo más angosto no se usa: la vista previa sale sin imagen. */
export const ANCHO_MINIMO_DE_IMAGEN_PARA_COMPARTIR = 300;

const SEPARADOR_DE_TITULO = " · ";
const PUNTOS_SUSPENSIVOS = "…";
const IDIOMA_DE_LA_PAGINA = "es_AR";

/** Una imagen candidata para la tarjeta: dirección absoluta `https` y su ancho en píxeles. */
export type ImagenParaCompartir = Readonly<{ url: string; ancho: number }>;

export type PaginaDeCarta =
  | Readonly<{ tipo: "CARTA"; nombre: string; rubro: string | null; lugar: string | null }>
  | Readonly<{ tipo: "PRODUCTO"; nombreDelProducto: string; nombreDeLaCarta: string }>;

export type EntradaDeMetadatos = Readonly<{
  pagina: PaginaDeCarta;
  /** El nombre visible de la marca del host (`{sitio}`). */
  sitio: string;
  /** El host que resolvió el pedido, ya normalizado contra el registro (nunca el encabezado crudo). */
  host: string;
  /** El camino de la página en ese host, con `/` inicial y sin consulta. */
  ruta: string;
  /** El resultado de `esIndexable` para la superficie (la única regla). */
  superficieIndexable: boolean;
  /** El logo de la marca, si se tiene; `null` si no hay dato. */
  imagen: ImagenParaCompartir | null;
}>;

export type MetadatosDePagina = Readonly<{
  titulo: string;
  /** `null` si la página no tiene una descripción aprobada (el producto). */
  descripcion: string | null;
  /** `null` si no hay imagen que llegue al tamaño mínimo: no se emite `og:image`. */
  imagen: ImagenParaCompartir | null;
  canonica: string;
  nombreDelSitio: string;
  idioma: typeof IDIOMA_DE_LA_PAGINA;
  indexable: boolean;
}>;

/** Corta en `maximo` caracteres (puntos de código, no unidades UTF-16) y cierra con «…» si cortó. */
export function acortar(texto: string, maximo: number): string {
  const letras = [...texto];
  if (letras.length <= maximo) return texto;
  return `${letras
    .slice(0, maximo - 1)
    .join("")
    .trimEnd()}${PUNTOS_SUSPENSIVOS}`;
}

/** «Carta de {nombre}», más «, {rubro} en {lugar}» según lo que exista (maqueta `seo-y-metadatos.html`, función `descripcion`). */
function descripcionDeLaCarta(nombre: string, rubro: string | null, lugar: string | null): string {
  const r = rubro?.trim() ?? "";
  const l = lugar?.trim() ?? "";
  const detalle =
    r !== "" && l !== "" ? `, ${r} en ${l}` : r !== "" ? `, ${r}` : l !== "" ? ` en ${l}` : "";
  return `Carta de ${nombre.trim()}${detalle}.`;
}

/** Solo una dirección `https` absoluta de un host, sin consulta ni ancla, y de al menos el ancho mínimo. */
function imagenUsable(imagen: ImagenParaCompartir | null): ImagenParaCompartir | null {
  if (imagen === null) return null;
  if (!Number.isInteger(imagen.ancho) || imagen.ancho < ANCHO_MINIMO_DE_IMAGEN_PARA_COMPARTIR)
    return null;
  let direccion: URL;
  try {
    direccion = new URL(imagen.url);
  } catch {
    return null;
  }
  return direccion.protocol === "https:" && direccion.search === "" && direccion.hash === ""
    ? imagen
    : null;
}

export function metadatosDePagina(entrada: EntradaDeMetadatos): MetadatosDePagina {
  const { pagina, sitio } = entrada;
  const esCarta = pagina.tipo === "CARTA";
  const titulo =
    pagina.tipo === "CARTA"
      ? `${pagina.nombre.trim()}${SEPARADOR_DE_TITULO}${sitio}`
      : `${pagina.nombreDelProducto.trim()}${SEPARADOR_DE_TITULO}${pagina.nombreDeLaCarta.trim()}`;
  return {
    titulo: acortar(titulo, LARGO_DEL_TITULO_DE_PAGINA),
    descripcion:
      pagina.tipo === "CARTA"
        ? acortar(
            descripcionDeLaCarta(pagina.nombre, pagina.rubro, pagina.lugar),
            LARGO_DE_LA_DESCRIPCION_DE_PAGINA,
          )
        : null,
    imagen: imagenUsable(entrada.imagen),
    canonica: `https://${entrada.host}${entrada.ruta}`,
    nombreDelSitio: sitio,
    idioma: IDIOMA_DE_LA_PAGINA,
    // Un producto nunca se indexa (§2.3): decenas de páginas casi iguales a la carta.
    indexable: esCarta && entrada.superficieIndexable,
  };
}
