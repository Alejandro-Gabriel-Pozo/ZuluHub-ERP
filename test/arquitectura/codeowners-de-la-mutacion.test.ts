import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La maquinaria de la mutación (los grupos, su cargador, la configuración de Stryker) tiene dueño en `.github/CODEOWNERS`, y no hay otra configuración de Stryker que
 * pise a la que corresponde.
 * Previene dos fallos: (1) mover los grupos y `stryker.config.json` a archivos nuevos (13/11/2026) y que las rutas nuevas queden sin dueño, o con uno distinto, sin que nada lo
 * avise (las protegía el CODEOWNERS por su nombre viejo); (2) que Stryker, que usa la PRIMERA configuración que encuentra en un orden fijo (`stryker.config.json` antes que
 * `stryker.config.mjs`), tome una `stryker.config.json` repuesta con `mutate: []`: la mutación pasaría sin mirar nada y ninguna prueba lo vería. Cada caso inyectado rompe el chequeo.
 */
const RAIZ = join(import.meta.dirname, "../..");
const DUENO = "@Alejandro-Gabriel-Pozo";

/** Los dueños de una ruta según un CODEOWNERS: la ÚLTIMA línea que la alcanza gana (como en GitHub). `[]` si ninguna. */
function duenosDe(texto: string, ruta: string): string[] {
  let duenos: string[] = [];
  for (const linea of texto.split("\n")) {
    const limpia = linea.trim();
    if (limpia === "" || limpia.startsWith("#")) continue;
    const [patron, ...resto] = limpia.split(/\s+/);
    if (patron === undefined || !patron.startsWith("/")) continue;
    const base = patron
      .slice(1)
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*");
    const alcanza = patron.endsWith("/")
      ? new RegExp(`^${base}`).test(ruta)
      : new RegExp(`^${base}(/.*)?$`).test(ruta);
    if (alcanza) duenos = resto;
  }
  return duenos;
}

/** Los nombres con que Stryker busca su configuración (el mismo producto cartesiano que usa en `config-file-formats.js`). */
const NOMBRES_DE_CONFIGURACION = ["", "."].flatMap((prefijo) =>
  [".conf", ".config"].flatMap((sufijo) =>
    ["json", "js", "mjs", "cjs"].map((extension) => `${prefijo}stryker${sufijo}.${extension}`),
  ),
);
const LA_CONFIGURACION = "stryker.config.mjs";
const PROTEGIDAS = [
  ...NOMBRES_DE_CONFIGURACION,
  "arquitectura/grupos-de-mutacion.cjs",
  "arquitectura/grupos-de-mutacion.json",
  "arquitectura/mutacion/un-grupo.json",
  "arquitectura/mutacion/sub/otro.json",
  "arquitectura/mutate-sin-mutar.json",
  "test/arquitectura/mutate-hermanos.test.ts",
  "test/arquitectura/grupos-de-mutacion.test.ts",
  "test/arquitectura/codeowners-de-la-mutacion.test.ts",
];

/** Las rutas protegidas que el CODEOWNERS dado no deja a nombre del dueño. */
const sinDueno = (texto: string): string[] =>
  PROTEGIDAS.filter((ruta) => duenosDe(texto, ruta).join(",") !== DUENO);

/** Las configuraciones de Stryker que existen de más (cualquiera que no sea la correcta pisaría o competiría con ella). */
const configuracionesDeMas = (existe: (ruta: string) => boolean): string[] =>
  NOMBRES_DE_CONFIGURACION.filter((n) => n !== LA_CONFIGURACION && existe(n));

describe("el CODEOWNERS de la mutación", () => {
  const real = readFileSync(join(RAIZ, ".github/CODEOWNERS"), "utf8");

  it("todas las rutas de la maquinaria de la mutación tienen al dueño, incluidos los nombres viejos y los que Stryker descubre", () => {
    expect(sinDueno(real)).toEqual([]);
    expect(NOMBRES_DE_CONFIGURACION).toHaveLength(16);
  });

  it("sin la línea de los grupos, de la configuración o del cargador, la ruta queda sin dueño (violación inyectada)", () => {
    const sin = (fragmento: string) =>
      real
        .split("\n")
        .filter((linea) => !linea.startsWith(fragmento))
        .join("\n");
    expect(sinDueno(sin("/arquitectura/mutacion/"))).toEqual([
      "arquitectura/mutacion/un-grupo.json",
      "arquitectura/mutacion/sub/otro.json",
    ]);
    expect(sinDueno(sin("/stryker.conf*"))).toEqual(
      NOMBRES_DE_CONFIGURACION.filter((n) => !n.startsWith(".")),
    );
    expect(sinDueno(sin("/.stryker.conf*"))).toEqual(
      NOMBRES_DE_CONFIGURACION.filter((n) => n.startsWith(".")),
    );
    expect(sinDueno(sin("/arquitectura/grupos-de-mutacion.cjs"))).toEqual([
      "arquitectura/grupos-de-mutacion.cjs",
    ]);
    expect(sinDueno(sin("/test/arquitectura/grupos-de-mutacion.test.ts"))).toEqual([
      "test/arquitectura/grupos-de-mutacion.test.ts",
    ]);
    expect(sinDueno("")).toEqual(PROTEGIDAS);
  });

  it("otro dueño, una línea posterior que lo cambia o una ruta que no alcanza también se detectan", () => {
    expect(sinDueno(real.replace(/(\/arquitectura\/mutacion\/ +)@\S+/, "$1@otra-persona"))).toEqual(
      ["arquitectura/mutacion/un-grupo.json", "arquitectura/mutacion/sub/otro.json"],
    );
    expect(sinDueno(`${real}\n/arquitectura/mutacion/ @otra-persona\n`)).toEqual([
      "arquitectura/mutacion/un-grupo.json",
      "arquitectura/mutacion/sub/otro.json",
    ]);
    // un comodín que no alcanza al archivo, o un directorio que no es el de los grupos
    expect(duenosDe("/arquitectura/mutacion-vieja/ @x", "arquitectura/mutacion/a.json")).toEqual(
      [],
    );
    expect(duenosDe("/stryker.conf* @x", "otro/stryker.config.mjs")).toEqual([]);
  });

  it("un dueño de dos nombres cuenta como distinto (el dueño tiene que ser exactamente el pedido)", () => {
    expect(sinDueno(`${real}\n/arquitectura/mutacion/ ${DUENO} @otra\n`)).toEqual([
      "arquitectura/mutacion/un-grupo.json",
      "arquitectura/mutacion/sub/otro.json",
    ]);
  });

  it("las líneas de comentario y las vacías no cuentan, y una línea sin barra inicial tampoco", () => {
    expect(
      duenosDe("# /stryker.config.mjs @x\n\n/stryker.config.mjs @y\n", "stryker.config.mjs"),
    ).toEqual(["@y"]);
    expect(duenosDe("stryker.config.mjs @x\n", "stryker.config.mjs")).toEqual([]);
  });

  it("un patrón sin barra final alcanza al archivo y a lo que cuelga de él (un directorio con ese nombre)", () => {
    expect(duenosDe("/a/b @x\n", "a/b")).toEqual(["@x"]);
    expect(duenosDe("/a/b @x\n", "a/b/c.json")).toEqual(["@x"]);
    expect(duenosDe("/a/b @x\n", "a/bc")).toEqual([]);
    expect(duenosDe("/a/b/ @x\n", "a/b")).toEqual([]);
  });
});

describe("la configuración de Stryker", () => {
  it("la única que existe es `stryker.config.mjs`: ninguna otra la pisa en el orden de búsqueda", () => {
    expect(existsSync(join(RAIZ, LA_CONFIGURACION))).toBe(true);
    expect(configuracionesDeMas((nombre) => existsSync(join(RAIZ, nombre)))).toEqual([]);
  });

  it("repuesta una `stryker.config.json` (la que Stryker prefiere), el chequeo la marca (violación inyectada)", () => {
    const existentes = new Set([LA_CONFIGURACION, "stryker.config.json", ".stryker.conf.cjs"]);
    expect(configuracionesDeMas((nombre) => existentes.has(nombre))).toEqual([
      "stryker.config.json",
      ".stryker.conf.cjs",
    ]);
    expect(configuracionesDeMas((nombre) => nombre === LA_CONFIGURACION)).toEqual([]);
  });
});
