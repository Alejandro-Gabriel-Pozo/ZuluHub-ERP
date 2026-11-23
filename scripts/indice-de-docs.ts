import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * El índice versionado de lo que vive en el repositorio de documentos y el código no puede importar (SUPUESTO (DEC-0835) del grafo, etapa 0;
 * orden del dueño del 23/11/2026): maquetas y briefs. `arquitectura/grafo/indice-de-docs.json` es una FOTO de esos documentos a un
 * commit de docs; el grafo la lee como un registro más. Se regenera a mano con `npm run grafo:indice -- <carpeta de docs> [--rama=<nombre>@<commit>=<carpeta>…]` y se commitea; cada rama es un árbol de docs con el commit del que sale.
 * Costo de revertirlo: borrar el archivo y su lector; el grafo mide igual sin briefs ni maquetas (esas categorías quedan en cero).
 *
 * Qué extrae de cada brief: lo que NOMBRA entre comillas invertidas (acciones, rutas, funciones, tablas) y los `*.html` que cita.
 * Es una heurística por nombre, no un enlace declarado: un brief que no escribe el nombre entre comillas queda «sin enlace».
 * Previene: auditar briefs contra el código a mano (la auditoría del 21/11 tardó una sesión entera y no se puede repetir en el CI).
 * Chequeo: `test/arquitectura/grafo-indice-de-docs.test.ts` (forma, orden, sin repetidos, extracción con un brief de ejemplo).
 */

export const VERSION_DEL_INDICE = 2;
/** El enlace al repositorio de documentos, con el nombre que hoy tiene en GitHub (la única forma permitida de nombrarlo). */
export const REPOSITORIO_DE_DOCS = "github.com/Alejandro-Gabriel-Pozo/ZuluHub-docs";
export const ARCHIVO_DEL_INDICE = "arquitectura/grafo/indice-de-docs.json";

export type TipoDeDocumento = "brief" | "maqueta" | "otro";

export type Procedencia = "main" | "rama";

export type BriefDelIndice = Readonly<{
  id: string;
  pack: string;
  archivo: string;
  tipo: TipoDeDocumento;
  /** `main`: está en `main` de docs. `rama`: solo vive en rama(s) sin integrar (ver `ramas`). */
  procedencia: Procedencia;
  /** Ramas de docs donde se lo encontró, solo si la procedencia es `rama`. */
  ramas: readonly string[];
  titulo: string;
  acciones: readonly string[];
  rutas: readonly string[];
  maquetas: readonly string[];
  funciones: readonly string[];
  tablas: readonly string[];
}>;

export type MaquetaDelIndice = Readonly<{ id: string; nombre: string; carpeta: string }>;

export type IndiceDeDocs = Readonly<{
  version: number;
  docs: Readonly<{
    repositorio: string;
    commit: string;
    /** Las ramas de docs que se sumaron al árbol de `main`, cada una con el commit del que sale. */
    ramas: readonly Readonly<{ nombre: string; commit: string }>[];
  }>;
  maquetas: readonly MaquetaDelIndice[];
  briefs: readonly BriefDelIndice[];
}>;

const EXTENSIONES_DE_ARCHIVO = new Set([
  "ts",
  "tsx",
  "js",
  "cjs",
  "mjs",
  "json",
  "md",
  "html",
  "sql",
  "css",
  "yml",
  "yaml",
  "txt",
]);
const porTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const unicos = (xs: Iterable<string>): string[] => [...new Set(xs)].sort(porTexto);

export function tipoDeDocumento(nombreDeArchivo: string): TipoDeDocumento {
  if (/^MAQUETA-/.test(nombreDeArchivo)) return "maqueta";
  if (
    /^(00-|DISENO|PREGUNTAS|COMBOS|comparacion|ENMIENDA|LEEME|README|indice|estado)/i.test(
      nombreDeArchivo,
    )
  )
    return "otro";
  return "brief";
}

/** Lo que un brief nombra entre comillas invertidas, más los `*.html` que cita en cualquier parte del texto. */
export function extraerDelBrief(
  texto: string,
): Pick<BriefDelIndice, "titulo" | "acciones" | "rutas" | "maquetas" | "funciones" | "tablas"> {
  const titulo = /^#\s+(.+)$/m.exec(texto)?.[1]?.trim() ?? "";
  // Lo que va entre comillas invertidas: los tramos impares al partir por la comilla, de una sola línea.
  const citados = texto
    .split("`")
    .filter((tramo, i) => i % 2 === 1 && tramo.split("\n").length === 1)
    .map((tramo) => tramo.trim().replace(/\(\)$/, ""));
  const acciones: string[] = [];
  const rutas: string[] = [];
  const funciones: string[] = [];
  const tablas: string[] = [];
  for (const t of citados) {
    if (/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(t)) {
      if (!EXTENSIONES_DE_ARCHIVO.has(t.slice(t.indexOf(".") + 1))) acciones.push(t);
    } else if (
      /^\/[a-z0-9][a-z0-9\-_/[\]:{}]*$/.test(t) &&
      !t.startsWith("/api") &&
      !t.startsWith("/home")
    )
      rutas.push(t.replace(/\/+$/, ""));
    else if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(t)) funciones.push(t);
    else if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(t)) tablas.push(t);
  }
  const maquetas = [...texto.matchAll(/\b([a-z0-9][a-z0-9-]*\.html)\b/g)].map((m) => m[1] ?? "");
  return {
    titulo,
    acciones: unicos(acciones),
    rutas: unicos(rutas),
    maquetas: unicos(maquetas),
    funciones: unicos(funciones),
    tablas: unicos(tablas),
  };
}

function archivosDe(carpeta: string, filtro: (ruta: string) => boolean): string[] {
  try {
    return readdirSync(carpeta, { recursive: true, encoding: "utf8" })
      .filter(filtro)
      .sort(porTexto);
  } catch {
    return [];
  }
}

/** Arma el índice desde una carpeta con el repositorio de documentos (cualquier árbol con la misma disposición). */
export type RamaDeDocs = Readonly<{ nombre: string; commit: string; carpeta: string }>;

export function construirIndiceDeDocs(
  carpetaDeDocs: string,
  commit: string,
  ramas: readonly RamaDeDocs[] = [],
): IndiceDeDocs {
  const maquetas: MaquetaDelIndice[] = [];
  const carpetaDeUx = join(carpetaDeDocs, "10-ux-ui");
  for (const r of archivosDe(
    carpetaDeUx,
    (x) => x.endsWith(".html") && !x.includes("capturas/") && !x.includes("_fuentes"),
  )) {
    const partes = r.split("/");
    const nombre = partes.at(-1) ?? r;
    if (!/^prototipos-/.test(partes[0] ?? "")) continue;
    maquetas.push({ id: r, nombre, carpeta: partes.slice(0, -1).join("/") });
  }
  // Los briefs de `main` y, aparte, los que solo viven en una rama: el mismo id en `main` y en una rama cuenta una vez, como de `main`.
  const porId = new Map<string, BriefDelIndice>();
  const leerBriefs = (raiz: string, procedencia: Procedencia, rama: string): void => {
    const raizDeBriefs = join(raiz, "11-especificaciones", "briefs");
    for (const r of archivosDe(raizDeBriefs, (x) => x.endsWith(".md"))) {
      const partes = r.split("/");
      const nombre = (partes.at(-1) ?? r).replace(/\.md$/, "");
      const id = r.replace(/\.md$/, "");
      const previo = porId.get(id);
      if (previo !== undefined) {
        if (previo.procedencia === "rama" && procedencia === "rama" && !previo.ramas.includes(rama))
          porId.set(id, { ...previo, ramas: [...previo.ramas, rama].sort(porTexto) });
        continue;
      }
      porId.set(id, {
        id,
        pack: partes.length > 1 ? (partes[0] ?? "") : "",
        archivo: `11-especificaciones/briefs/${r}`,
        tipo: tipoDeDocumento(nombre),
        procedencia,
        ramas: procedencia === "rama" ? [rama] : [],
        ...extraerDelBrief(readFileSync(join(raizDeBriefs, r), "utf8")),
      });
    }
  };
  leerBriefs(carpetaDeDocs, "main", "");
  for (const rama of [...ramas].sort((x, y) => porTexto(x.nombre, y.nombre)))
    leerBriefs(rama.carpeta, "rama", rama.nombre);
  return {
    version: VERSION_DEL_INDICE,
    docs: {
      repositorio: REPOSITORIO_DE_DOCS,
      commit,
      ramas: [...ramas]
        .sort((x, y) => porTexto(x.nombre, y.nombre))
        .map((r) => ({ nombre: r.nombre, commit: r.commit })),
    },
    maquetas: maquetas.sort((a, b) => porTexto(a.id, b.id)),
    briefs: [...porId.values()].sort((a, b) => porTexto(a.id, b.id)),
  };
}
