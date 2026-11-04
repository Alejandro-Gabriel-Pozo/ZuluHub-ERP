import type { ImporteJson } from "../../../primitivas/dinero/importe";
import type {
  VidrieraPublicada,
  FotoPublicada,
  ProductoPublicado,
} from "../../../puertos/vidriera-publica";
import { direccionesDeVidriera, slugDeNombre } from "./direccion";
import { unirConO } from "./unir-con-o";
import type { LetraBase } from "./letra";
import { listaDePreciosDelProducto, type GrupoDePrecios, type ListaDePrecios } from "./precios";

/**
 * Lo que la pantalla de la carta recibe, ya resuelto (C-2): precios en texto es-AR, direcciones sin ids
 * internos, la guarnición como una línea y la foto con su texto alternativo. Es JSON puro (viaja al navegador)
 * y no trae NINGÚN id de la base: ni de carta, ni de sección, ni de producto (C-12).
 */

export type VistaDeFoto = Readonly<{ direccion: string; alt: string; ancho: number; alto: number }>;

export type VistaDeOpcion = Readonly<{
  nombre: string;
  /** «+ $ 600»; `null` si no cobra (se muestra solo el nombre). */
  recargo: string | null;
}>;

export type VistaDeGrupo = Readonly<{ titulo: string; opciones: readonly VistaDeOpcion[] }>;

export type VistaDeTamano = Readonly<{ nombre: string; precio: string }>;

export type VistaDeProducto = Readonly<{
  /** `<slug>-<h8>`: la dirección del producto y también su identificador en la página. */
  segmento: string;
  /** Dónde está el producto (`…/<código>/<slug>-<h8>`). */
  href: string;
  /** Ancla de su sección dentro de la carta (para «Ver toda la carta»). */
  seccion: string;
  nombre: string;
  descripcion: string | null;
  agotado: boolean;
  /** «$ 3.300», o «desde $ 3.300» cuando hay más de un precio posible. Siempre está en la lista (D3). */
  precioEnLista: string;
  /** «Con papas fritas, puré o ensalada», o «Con guarnición a elección» si no entra (§3.1). */
  guarnicion: string | null;
  tamanos: readonly VistaDeTamano[];
  /** Los otros grupos obligatorios (la guarnición incluida), para la tarjeta. */
  obligatorios: readonly VistaDeGrupo[];
  adicionales: readonly VistaDeGrupo[];
  foto: VistaDeFoto | null;
}>;

export type VistaDeSeccion = Readonly<{
  /** El ancla: `…/<código>#<slug>` lleva a la sección (§3.3). */
  id: string;
  nombre: string;
  productos: readonly VistaDeProducto[];
}>;

export type VistaDeVidriera = Readonly<{
  nombre: string;
  rubro: string;
  lugar: string | null;
  letraBase: LetraBase;
  /** La dirección de la carta, para volver a ella desde un producto. */
  hrefDeLaVidriera: string;
  secciones: readonly VistaDeSeccion[];
  totalDeProductos: number;
}>;

/** Hasta dónde llega la línea de guarniciones antes de caer a «a elección» (§3.1). */
export const LARGO_MAXIMO_DE_LA_GUARNICION = 60;
export const GUARNICION_A_ELECCION = "Con guarnición a elección";

const PUNTO = ".";

/** Agrupa de a tres cifras con punto, de derecha a izquierda: «1234567» → «1.234.567». */
function agruparMiles(entero: string): string {
  return entero.length <= 3
    ? entero
    : `${agruparMiles(entero.slice(0, -3))}${PUNTO}${entero.slice(-3)}`;
}

/**
 * El importe como se lee en una carta argentina (D3): «$ 2.500», con coma y centavos solo si no son cero
 * («$ 2.500,50»). Trabaja sobre el TEXTO decimal, sin pasar por `number`: ni un importe toca coma flotante.
 */
export function formatearImporte(importe: ImporteJson): string {
  const [entero, fraccion] = importe.monto.split(PUNTO) as [string, string?];
  const centavos = fraccion ?? "";
  const simbolo = importe.moneda === "ARS" ? "$" : importe.moneda;
  return `${simbolo} ${agruparMiles(entero)}${/^0*$/.test(centavos) ? "" : `,${centavos}`}`;
}

function minusculaInicial(texto: string): string {
  return texto.charAt(0).toLowerCase() + texto.slice(1);
}

/** «Con papas fritas, puré o ensalada»; si no entra en 60 caracteres, «Con guarnición a elección». */
function lineaDeGuarnicion(nombres: readonly string[]): string {
  const opciones = nombres.map(minusculaInicial);
  const lista = unirConO(opciones);
  const linea = `Con ${lista}`;
  return linea.length <= LARGO_MAXIMO_DE_LA_GUARNICION ? linea : GUARNICION_A_ELECCION;
}

function grupoParaLaVista(grupo: GrupoDePrecios): VistaDeGrupo {
  return {
    titulo: grupo.titulo,
    opciones: grupo.opciones.map((o) => ({
      nombre: o.nombre,
      recargo: o.recargo === null ? null : `+ ${formatearImporte(o.recargo)}`,
    })),
  };
}

/** La guarnición es el primer grupo obligatorio donde ninguna opción cobra de más (§3.1). */
function guarnicionDe(lista: ListaDePrecios): string | null {
  const grupo = lista.obligatorios.find((g) => g.opciones.every((o) => o.recargo === null));
  return grupo === undefined ? null : lineaDeGuarnicion(grupo.opciones.map((o) => o.nombre));
}

function fotoParaLaVista(foto: FotoPublicada | null, nombre: string): VistaDeFoto | null {
  if (foto === null || foto.estado !== "VISIBLE") return null;
  return {
    direccion: foto.direccion,
    alt: foto.alt ?? `Foto de ${nombre}`,
    ancho: foto.ancho,
    alto: foto.alto,
  };
}

/** Un slug por sección, sin repetirse: si dos secciones chocan, la segunda lleva `-2`, la tercera `-3`… */
function anclasDeSecciones(nombres: readonly string[]): readonly string[] {
  const usadas = new Set<string>();
  return nombres.map((nombre) => {
    const base = slugDeNombre(nombre);
    let ancla = base;
    for (let n = 2; usadas.has(ancla); n++) ancla = `${base}-${n}`;
    usadas.add(ancla);
    return ancla;
  });
}

function productoParaLaVista(
  producto: ProductoPublicado,
  lista: ListaDePrecios,
  segmento: string,
  rutaPublica: string,
  seccion: string,
): VistaDeProducto {
  const desde = lista.desde ? "desde " : "";
  return {
    segmento,
    href: `${rutaPublica}/${segmento}`,
    seccion,
    nombre: producto.nombre,
    descripcion: producto.descripcion,
    agotado: producto.agotado,
    precioEnLista: `${desde}${formatearImporte(lista.precioDeLista)}`,
    guarnicion: guarnicionDe(lista),
    tamanos: lista.tamanos.map((t) => ({ nombre: t.nombre, precio: formatearImporte(t.precio) })),
    obligatorios: lista.obligatorios.map(grupoParaLaVista),
    adicionales: lista.adicionales.map(grupoParaLaVista),
    foto: fotoParaLaVista(producto.foto, producto.nombre),
  };
}

/**
 * Arma la vista de una carta. `rutaPublica` es el camino de la carta en la dirección pública: `/<código>` en
 * el host compartido y `""` en el host dedicado (§3.3); de ella salen todos los enlaces.
 *
 * Un producto cuyo precio no se puede calcular (un dato malo) no se muestra: sin precio, el ítem no es
 * visible ([CAT]); una sección que se queda sin productos tampoco. Las direcciones se arman sobre la carta
 * entera para que dos productos que chocan se alarguen a 12 (§3.3).
 */
export function armarVistaDeVidriera(
  vidriera: VidrieraPublicada,
  rutaPublica: string,
): VistaDeVidriera {
  const todos = vidriera.secciones.flatMap((s) => s.productos);
  const direcciones = direccionesDeVidriera(
    vidriera.id,
    todos.map((p) => ({ productoId: p.id, nombre: p.nombre })),
  );
  const anclas = anclasDeSecciones(vidriera.secciones.map((s) => s.nombre));
  let indice = 0;
  const secciones = vidriera.secciones.flatMap((seccion, i): VistaDeSeccion[] => {
    const ancla = anclas[i] as string;
    const productos = seccion.productos.flatMap((producto): VistaDeProducto[] => {
      const direccion = direcciones[indice++] as { segmento: string };
      const lista = listaDePreciosDelProducto(producto);
      if (!lista.ok) return [];
      return [productoParaLaVista(producto, lista.valor, direccion.segmento, rutaPublica, ancla)];
    });
    return productos.length === 0 ? [] : [{ id: ancla, nombre: seccion.nombre, productos }];
  });
  return {
    nombre: vidriera.nombre,
    rubro: vidriera.rubro,
    lugar: vidriera.lugar,
    letraBase: vidriera.letraBase,
    hrefDeLaVidriera: rutaPublica === "" ? "/" : rutaPublica,
    secciones,
    totalDeProductos: secciones.reduce((n, s) => n + s.productos.length, 0),
  };
}
