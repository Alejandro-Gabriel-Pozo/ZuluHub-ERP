import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La carta de un host COMPARTIDO nunca se indexa (dueño, 16/11/2026), y la regla vive en UN lugar: `esIndexable` de
 * `src/capacidades/experiencia/cabeceras.ts` (la tabla `CARTA_INDEXABLE_SEGUN_DUENIO`). Previene: una página de la carta que escribe su propio `robots`
 * (hoy lo hacían cinco por su cuenta) o una tabla abierta por descuido, y la carta de un cliente aparece en Google con un código que no se puede adivinar.
 * Límite que NO ve: un `robots` armado por una función ajena a estos archivos; lo cubre la prueba de comportamiento de `cabeceras.test.ts`.
 */
const CABECERAS = "src/capacidades/experiencia/cabeceras.ts";
const CARPETA_DE_LA_CARTA = "apps/web/app/s/carta";

const sinComentarios = (fuente: string): string =>
  fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Lo que está mal en la tabla de cabeceras: `MARCA` (host compartido) debe estar en `false`, y la tabla debe existir. */
export function problemasDeLaTabla(fuente: string): string[] {
  const codigo = sinComentarios(fuente);
  const tabla = /CARTA_INDEXABLE_SEGUN_DUENIO[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/.exec(
    codigo,
  );
  if (tabla === null) return ["no se encuentra la tabla CARTA_INDEXABLE_SEGUN_DUENIO"];
  const marca = /\bMARCA\s*:\s*(\w+)/.exec(tabla[1] ?? "");
  return marca?.[1] === "false" ? [] : ["el host compartido (MARCA) no está en false"];
}

/** Lo que está mal en una ruta de la carta: escribe su propio `robots` o `index:` (debe salir de `metadatosDeLaCarta`). */
export function problemasDeUnaPaginaDeLaCarta(fuente: string): string[] {
  const codigo = sinComentarios(fuente);
  const problemas: string[] = [];
  if (/\brobots\b/.test(codigo)) problemas.push("escribe `robots` por su cuenta");
  if (/\bindex\s*:/.test(codigo)) problemas.push("escribe `index:` por su cuenta");
  return problemas;
}

function paginas(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(carpeta, e.name);
    if (e.isDirectory()) return paginas(ruta);
    return /^(page|layout)\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}

describe("la carta del host compartido nunca se indexa", () => {
  it("la tabla real de `cabeceras.ts` tiene el host compartido cerrado", () => {
    expect(problemasDeLaTabla(readFileSync(CABECERAS, "utf8"))).toEqual([]);
  });

  it("ninguna página ni layout de la carta escribe su propio `robots`", () => {
    const lista = paginas(CARPETA_DE_LA_CARTA);
    expect(lista.length).toBeGreaterThan(0);
    for (const archivo of lista) {
      expect(problemasDeUnaPaginaDeLaCarta(readFileSync(archivo, "utf8")), archivo).toEqual([]);
    }
  });

  describe("violaciones inyectadas", () => {
    const TABLA = (marca: string) =>
      `const CARTA_INDEXABLE_SEGUN_DUENIO: Readonly<Record<string, boolean>> = Object.freeze({ MARCA: ${marca}, EMPRESA: false });`;

    it("el host compartido abierto", () => {
      expect(problemasDeLaTabla(TABLA("true"))).toHaveLength(1);
      expect(problemasDeLaTabla(TABLA("!false"))).toHaveLength(1);
      expect(problemasDeLaTabla(TABLA("false"))).toEqual([]);
    });

    it("la tabla borrada o renombrada (no se puede analizar: se cuenta como falla)", () => {
      expect(problemasDeLaTabla("export const otra = 1;")).toHaveLength(1);
    });

    it("una página que pone su `robots` o su `index:`", () => {
      expect(problemasDeUnaPaginaDeLaCarta("return { robots: { index: true } };")).toHaveLength(2);
      expect(problemasDeUnaPaginaDeLaCarta("const x = { index : true };")).toHaveLength(1);
      expect(problemasDeUnaPaginaDeLaCarta("// robots: index: true\nreturn m;")).toEqual([]);
    });
  });
});
