import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAMINOS, FRAGMENTOS_DE_CAMINOS } from "../../src/capacidades/datos/caminos";
import { FRAGMENTOS_DEL_REGISTRO, REGISTRO_DE_DATOS } from "../../src/capacidades/datos/registro";

/**
 * El registro de datos y los caminos viven en UN archivo por módulo (`registro-de-<módulo>.ts`, `caminos-de-<módulo>.ts`) y `registro.ts` / `caminos.ts` los juntan.
 *
 * Previene dos fallos que el compilador no ve: (1) un mismo id en dos fragmentos: al juntarlos con `...` gana el último y el otro dato desaparece en silencio (dos
 * ramas que suman «importe» en módulos distintos); (2) un archivo `registro-de-<módulo>.ts` que nadie suma al ensamblador: sus datos no existen y las pantallas que
 * los piden fallan recién en el chequeo de campos. Cada chequeo trae su violación inyectada abajo.
 */

type Fragmentos = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** Los ids que aparecen en más de un fragmento. */
function idsRepetidos(fragmentos: Fragmentos): string[] {
  const vistos = new Set<string>();
  const repetidos = new Set<string>();
  for (const fragmento of Object.values(fragmentos)) {
    for (const id of Object.keys(fragmento)) {
      if (vistos.has(id)) repetidos.add(id);
      vistos.add(id);
    }
  }
  return [...repetidos].sort();
}

/** Los módulos con archivo `<prefijo>-de-<módulo>.ts` que el ensamblador no incluye, y los que incluye sin archivo. */
function desajusteDeFragmentos(
  archivos: readonly string[],
  prefijo: string,
  fragmentos: Fragmentos,
): { sinRegistrar: string[]; sinArchivo: string[] } {
  const patron = new RegExp(`^${prefijo}-de-([a-z-]+)\\.ts$`);
  const delDisco = archivos.flatMap((nombre) => patron.exec(nombre)?.[1] ?? []);
  const incluidos = Object.keys(fragmentos);
  return {
    sinRegistrar: delDisco.filter((m) => !incluidos.includes(m)).sort(),
    sinArchivo: incluidos.filter((m) => !delDisco.includes(m)).sort(),
  };
}

const CARPETA = join(import.meta.dirname, "../../src/capacidades/datos");
const archivosDelDisco = readdirSync(CARPETA);

describe("ids repetidos entre fragmentos (violación inyectada)", () => {
  it("detecta el id que está en dos fragmentos y ninguno si no hay", () => {
    expect(
      idsRepetidos({ caja: { importe: 1, cantidad: 2 }, facturacion: { importe: 3 } }),
    ).toEqual(["importe"]);
    expect(idsRepetidos({ caja: { a: 1 }, facturacion: { b: 2 }, productos: {} })).toEqual([]);
    expect(idsRepetidos({})).toEqual([]);
  });

  it("cuenta cada id repetido una sola vez aunque esté en tres fragmentos", () => {
    expect(idsRepetidos({ a: { x: 1 }, b: { x: 1 }, c: { x: 1 } })).toEqual(["x"]);
  });
});

describe("fragmentos sin registrar (violación inyectada)", () => {
  it("detecta el archivo que el ensamblador no incluye y el módulo incluido sin archivo", () => {
    expect(
      desajusteDeFragmentos(
        ["registro-de-caja.ts", "registro-de-stock.ts", "registro.ts", "tipos-de-datos.ts"],
        "registro",
        { caja: {}, compras: {} },
      ),
    ).toEqual({ sinRegistrar: ["stock"], sinArchivo: ["compras"] });
  });

  it("no confunde el ensamblador, los tipos ni los fragmentos del otro prefijo", () => {
    expect(
      desajusteDeFragmentos(
        ["registro.ts", "caminos.ts", "caminos-de-caja.ts", "tipos-de-caminos.ts"],
        "registro",
        {},
      ),
    ).toEqual({ sinRegistrar: [], sinArchivo: [] });
  });
});

describe("el registro y los caminos reales", () => {
  it("ningún id de dato está en dos fragmentos, y el registro tiene todos", () => {
    expect(idsRepetidos(FRAGMENTOS_DEL_REGISTRO)).toEqual([]);
    const suma = Object.values(FRAGMENTOS_DEL_REGISTRO).reduce(
      (total, fragmento) => total + Object.keys(fragmento).length,
      0,
    );
    expect(Object.keys(REGISTRO_DE_DATOS)).toHaveLength(suma);
  });

  it("ningún id de camino está en dos fragmentos, y los caminos tienen todos", () => {
    expect(idsRepetidos(FRAGMENTOS_DE_CAMINOS)).toEqual([]);
    const suma = Object.values(FRAGMENTOS_DE_CAMINOS).reduce(
      (total, fragmento) => total + Object.keys(fragmento).length,
      0,
    );
    expect(Object.keys(CAMINOS)).toHaveLength(suma);
  });

  it("todo archivo registro-de-<módulo>.ts y caminos-de-<módulo>.ts está en su ensamblador, y al revés", () => {
    expect(desajusteDeFragmentos(archivosDelDisco, "registro", FRAGMENTOS_DEL_REGISTRO)).toEqual({
      sinRegistrar: [],
      sinArchivo: [],
    });
    expect(desajusteDeFragmentos(archivosDelDisco, "caminos", FRAGMENTOS_DE_CAMINOS)).toEqual({
      sinRegistrar: [],
      sinArchivo: [],
    });
  });
});
