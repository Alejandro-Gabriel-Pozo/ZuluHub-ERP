import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

type Grupo = { id: string; grupo: string; archivos: string; minutos: number; pruebas?: string };
type Falla = { archivo: string; motivo: string };
type Arbol = { rutas: string[]; leer: (ruta: string) => Buffer | null };
const cargador = require("../../arquitectura/grupos-de-mutacion.cjs") as {
  CARPETA_DE_LOS_GRUPOS: string;
  EXCLUSION_DE_PRUEBAS: string;
  arbolDelDisco: (raiz: string) => Arbol;
  cargarLosGrupos: (raiz: string) => { grupos: Grupo[]; mutate: string[] };
  derivarMutate: (grupos: { archivos: string }[]) => string[];
  identificadorDe: (grupo: string) => string;
  leerLosGrupos: (arbol: Arbol) => { grupos: Grupo[]; errores: Falla[] };
};

/**
 * Los grupos de mutación: un archivo por grupo en `arquitectura/mutacion/` y `mutate` derivado de ellos (`arquitectura/grupos-de-mutacion.cjs`).
 * Previene: el choque entre sesiones en paralelo sobre `stryker.config.json` y `grupos-de-mutacion.json` (45 commits en una semana, 13/11/2026) y las dos listas
 * que una prueba obligaba a coincidir. Cada caso de abajo es una violación inyectada: si se debilita el cargador, esta prueba se pone roja.
 */
const RAIZ = join(import.meta.dirname, "../..");
const CARPETA = "arquitectura/mutacion";
const BUENO = {
  grupo: "Caja (dominio)",
  archivos: "src/a.ts,!src/a.test.ts",
  minutos: 2,
  pruebas: "src/a",
};
const arbol = (archivos: Record<string, string | null>): Arbol => ({
  rutas: Object.keys(archivos),
  leer: (ruta) => {
    const contenido = archivos[ruta];
    return contenido === undefined || contenido === null ? null : Buffer.from(contenido);
  },
});
const grupo = (id: string, valor: unknown): Record<string, string> => ({
  [`${CARPETA}/${id}.json`]: typeof valor === "string" ? valor : JSON.stringify(valor),
});
const leer = (archivos: Record<string, string | null>) => cargador.leerLosGrupos(arbol(archivos));
const motivos = (archivos: Record<string, string | null>) =>
  leer(archivos).errores.map((e) => e.motivo);

describe("el identificador de un grupo", () => {
  it("minúsculas, sin acentos y con guiones; sin guiones en las puntas", () => {
    expect(cargador.identificadorDe("Caja (dominio)")).toBe("caja-dominio");
    expect(cargador.identificadorDe("guardián (registro de decisiones)")).toBe(
      "guardian-registro-de-decisiones",
    );
    expect(cargador.identificadorDe("  ¡Años: 100%! ")).toBe("anos-100");
    expect(cargador.identificadorDe("web (lista de productos)")).toBe("web-lista-de-productos");
  });

  it("un nombre sin letras ni números da un identificador vacío (y el archivo no lo acepta)", () => {
    expect(cargador.identificadorDe("(((")).toBe("");
  });
});

describe("leer los grupos", () => {
  it("un grupo bien formado se lee con su identificador, y los demás archivos del repositorio no cuentan", () => {
    const r = leer({ ...grupo("caja-dominio", BUENO), "src/otro.ts": "x" });
    expect(r.errores).toEqual([]);
    expect(r.grupos).toEqual([{ id: "caja-dominio", ...BUENO }]);
  });

  it("`pruebas` es opcional (sin ella el grupo corre con todas las pruebas: deuda que cuenta el guardián)", () => {
    const sin = { grupo: "Sin filtro", archivos: "src/a.ts", minutos: 1 };
    expect(leer(grupo("sin-filtro", sin)).errores).toEqual([]);
  });

  it("devuelve los grupos ordenados por identificador, byte a byte, sin depender del orden de los archivos", () => {
    const hacer = (nombre: string) => ({ grupo: nombre, archivos: "src/a.ts", minutos: 1 });
    const r = leer({
      ...grupo("b", hacer("B")),
      ...grupo("a-b", hacer("A B")),
      ...grupo("a", hacer("A")),
    });
    expect(r.grupos.map((g) => g.id)).toEqual(["a", "a-b", "b"]);
  });

  it("un archivo que no es `<identificador>.json`, una subcarpeta o un nombre demasiado largo falla (nunca se ignora)", () => {
    for (const ruta of [
      `${CARPETA}/LEEME.md`,
      `${CARPETA}/sub/caja-dominio.json`,
      `${CARPETA}/.json`,
    ]) {
      const r = leer({ [ruta]: "{}" });
      expect(r.errores, ruta).toHaveLength(1);
      expect(r.errores[0]?.archivo, ruta).toBe(ruta);
      expect(r.errores[0]?.motivo, ruta).toContain("no es un archivo de grupo");
    }
    const largo = "a".repeat(101);
    expect(leer(grupo(largo, { ...BUENO, grupo: largo })).errores).toHaveLength(1);
    expect(leer(grupo("a".repeat(100), { ...BUENO, grupo: "a".repeat(100) })).errores).toEqual([]);
  });

  it("un JSON roto, un archivo que desaparece o que no es un objeto falla con el archivo", () => {
    const roto = leer(grupo("caja-dominio", "{roto"));
    expect(roto.errores[0]?.archivo).toBe(`${CARPETA}/caja-dominio.json`);
    expect(roto.errores[0]?.motivo).toMatch(/^no se puede leer \(/);
    const fantasma = leer({ [`${CARPETA}/caja-dominio.json`]: null });
    expect(fantasma.errores).toEqual([
      {
        archivo: `${CARPETA}/caja-dominio.json`,
        motivo: "no se puede leer (el archivo no existe).",
      },
    ]);
    for (const contenido of ["[]", "null", '"texto"', "7"]) {
      expect(motivos(grupo("caja-dominio", contenido)), contenido).toEqual([
        "tiene que ser un objeto { grupo, archivos, minutos, pruebas }.",
      ]);
    }
  });

  it("falta un campo, sobra un campo o el nombre del archivo no es el identificador del grupo", () => {
    const sinMinutos = { grupo: BUENO.grupo, archivos: BUENO.archivos };
    expect(motivos(grupo("caja-dominio", sinMinutos))).toEqual(["falta «minutos»."]);
    expect(motivos(grupo("caja-dominio", { archivos: "a", minutos: 1 }))).toEqual([
      "falta «grupo».",
    ]);
    expect(motivos(grupo("caja-dominio", { grupo: "x", minutos: 1 }))).toContain(
      "falta «archivos».",
    );
    expect(motivos(grupo("caja-dominio", { ...BUENO, extra: 1 }))).toEqual([
      "«extra» no es un campo permitido.",
    ]);
    expect(motivos(grupo("otro-nombre", BUENO))).toEqual([
      "el nombre del archivo tiene que ser el identificador del grupo («caja-dominio.json» para «Caja (dominio)»).",
    ]);
  });

  it("`grupo`, `archivos`, `minutos` y `pruebas` con un tipo que no es el suyo fallan, con su motivo", () => {
    expect(motivos(grupo("a", { ...BUENO, grupo: 5 }))).toEqual([
      "«grupo» tiene que ser un texto.",
    ]);
    expect(motivos(grupo("a", { ...BUENO, grupo: "  " }))).toEqual([
      "«grupo» tiene que ser un texto.",
    ]);
    expect(motivos(grupo("caja-dominio", { ...BUENO, archivos: 5 }))).toEqual([
      "«archivos» tiene que ser un texto.",
    ]);
    expect(motivos(grupo("caja-dominio", { ...BUENO, archivos: "" }))).toEqual([
      "«archivos» tiene que ser un texto.",
    ]);
    for (const minutos of [0, -1, "2", null]) {
      expect(motivos(grupo("caja-dominio", { ...BUENO, minutos })), String(minutos)).toEqual([
        "«minutos» tiene que ser un número mayor que cero.",
      ]);
    }
    expect(motivos(grupo("caja-dominio", { ...BUENO, pruebas: 5 }))).toEqual([
      "«pruebas» tiene que ser un texto.",
    ]);
  });

  it("cada patrón de `archivos` tiene que ser de la forma permitida (lista de permitidos)", () => {
    const con = (archivos: string) => motivos(grupo("caja-dominio", { ...BUENO, archivos }));
    for (const bueno of [
      "src/a.ts",
      "!src/a.ts",
      "src/**/*.ts",
      "src/{a-b}.ts",
      "arquitectura/contratos/no-debilitar.cjs:1-597",
      "src/a_b.c-d.ts",
    ]) {
      expect(con(bueno), bueno).toEqual([]);
    }
    for (const malo of [
      "src/a.ts,",
      ",src/a.ts",
      "src/a b.ts",
      "src/a;ls",
      "src/a.ts:1",
      "src/a.ts:1-",
      "src/a.ts:a-b",
      "!",
      "src/a.ts:1-2:3-4",
      "src/á.ts",
      "src/a.ts\n",
    ]) {
      expect(con(malo).length, malo).toBeGreaterThan(0);
    }
  });

  it("junta todas las fallas, no se detiene en la primera", () => {
    const r = leer({
      ...grupo("caja-dominio", "{roto"),
      ...grupo("otro", { ...BUENO, grupo: "Otro", minutos: 0 }),
      [`${CARPETA}/suelto.txt`]: "x",
    });
    expect(r.errores.map((e) => e.archivo)).toEqual([
      `${CARPETA}/caja-dominio.json`,
      `${CARPETA}/otro.json`,
      `${CARPETA}/suelto.txt`,
    ]);
  });
});

describe("derivar `mutate`", () => {
  const g = (archivos: string) => ({ archivos });

  it("junta los patrones de los grupos en su orden, sin repetir, y cierra con la exclusión de las pruebas", () => {
    expect(cargador.derivarMutate([g("src/a.ts,src/b.ts"), g("src/b.ts,src/c.ts")])).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "!src/**/*.test.ts",
    ]);
    expect(cargador.EXCLUSION_DE_PRUEBAS).toBe("!src/**/*.test.ts");
  });

  it("las exclusiones de un grupo valen solo en ese grupo: no se juntan (excluir en uno no saca el archivo de otro)", () => {
    expect(cargador.derivarMutate([g("src/d/**/*.ts,!src/d/x.ts"), g("src/d/x.ts")])).toEqual([
      "src/d/**/*.ts",
      "src/d/x.ts",
      "!src/**/*.test.ts",
    ]);
  });

  it("un archivo repartido por rangos entre grupos entra una sola vez y sin rango", () => {
    expect(cargador.derivarMutate([g("src/g.cjs:1-100"), g("src/g.cjs:101-200")])).toEqual([
      "src/g.cjs",
      "!src/**/*.test.ts",
    ]);
  });

  it("sin grupos queda solo la exclusión (y el cargador del disco no lo acepta: ver abajo)", () => {
    expect(cargador.derivarMutate([])).toEqual(["!src/**/*.test.ts"]);
  });
});

describe("cargar los grupos del disco", () => {
  const carpetas: string[] = [];
  afterEach(() => {
    for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
  });
  const disco = (archivos: Record<string, string>): string => {
    const raiz = mkdtempSync(join(tmpdir(), "grupos-"));
    carpetas.push(raiz);
    for (const [ruta, contenido] of Object.entries(archivos)) {
      mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
      writeFileSync(join(raiz, ruta), contenido);
    }
    return raiz;
  };

  it("lee los grupos y arma `mutate` con ellos", () => {
    const raiz = disco({
      ...grupo("caja-dominio", BUENO),
      ...grupo("otro", { grupo: "Otro", archivos: "src/o.ts", minutos: 1 }),
    });
    const r = cargador.cargarLosGrupos(raiz);
    expect(r.grupos.map((x) => x.id)).toEqual(["caja-dominio", "otro"]);
    expect(r.mutate).toEqual(["src/a.ts", "src/o.ts", "!src/**/*.test.ts"]);
  });

  it("sin carpeta o sin ningún grupo lanza: una lista vacía haría que la mutación «pase» sin mirar nada", () => {
    expect(() => cargador.cargarLosGrupos(disco({ "otro.txt": "x" }))).toThrow(
      /no hay ningún grupo de mutación/,
    );
    expect(() => cargador.cargarLosGrupos(disco({}))).toThrow(
      /arquitectura\/mutacion: no hay ningún grupo/,
    );
  });

  it("con grupos rotos lanza con TODAS las fallas, una por línea y con su archivo", () => {
    const raiz = disco({
      ...grupo("caja-dominio", BUENO),
      ...grupo("roto", "{roto"),
      [`${CARPETA}/suelto.txt`]: "x",
    });
    let mensaje = "";
    try {
      cargador.cargarLosGrupos(raiz);
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje).toMatch(
      /^Grupos de mutación inválidos:\n {2}arquitectura\/mutacion\/roto\.json: no se puede leer/,
    );
    expect(mensaje).toContain("\n  arquitectura/mutacion/suelto.txt: no es un archivo de grupo");
    expect(mensaje.split("\n")).toHaveLength(3);
  });

  it("el árbol del disco lista con barras, incluidas las subcarpetas, y lee null lo que no existe", () => {
    const raiz = disco({
      ...grupo("a", BUENO),
      [`${CARPETA}/sub/b.json`]: "{}",
      "otro/c.json": "{}",
    });
    const a = cargador.arbolDelDisco(raiz);
    expect([...a.rutas].sort()).toEqual([`${CARPETA}/a.json`, `${CARPETA}/sub/b.json`]);
    expect(a.leer(`${CARPETA}/a.json`)?.toString()).toBe(JSON.stringify(BUENO));
    expect(a.leer(`${CARPETA}/no-existe.json`)).toBeNull();
    expect(cargador.arbolDelDisco(disco({ "x.txt": "x" })).rutas).toEqual([]);
  });
});

describe("el repositorio real", () => {
  it("todos los grupos reales se leen sin fallas, con minutos y con el cargador del disco", () => {
    const r = cargador.cargarLosGrupos(RAIZ);
    expect(r.grupos.length).toBeGreaterThan(90);
    expect(r.mutate.at(-1)).toBe("!src/**/*.test.ts");
    expect(r.mutate.length).toBeGreaterThan(100);
  });

  it("la configuración de Stryker deriva `mutate` de los grupos y el JSON viejo ya no existe", async () => {
    const config = (await import(join(RAIZ, "stryker.config.mjs"))) as {
      default: { mutate: string[] };
    };
    expect(config.default.mutate).toEqual(cargador.cargarLosGrupos(RAIZ).mutate);
    for (const viejo of ["stryker.config.json", "arquitectura/grupos-de-mutacion.json"]) {
      expect(() => statSync(join(RAIZ, viejo)), viejo).toThrow();
    }
  });

  /** Los `.cjs` de `arquitectura/` que nombran la carpeta de los grupos o el archivo viejo, menos los dos que la conocen por diseño. */
  const MENCIONA = /arquitectura\/mutacion\b|grupos-de-mutacion\.json/;
  const DUENOS = [
    /arquitectura\/grupos-de-mutacion\.cjs$/,
    /arquitectura\/deuda\/archivos-de-datos\.cjs$/,
  ];
  const recorrer = (carpeta: string): string[] =>
    readdirSync(carpeta).flatMap((nombre) => {
      const ruta = join(carpeta, nombre);
      if (statSync(ruta).isDirectory()) return nombre === "mutacion" ? [] : recorrer(ruta);
      return ruta.endsWith(".cjs") ? [ruta] : [];
    });
  const quienes = (archivos: Record<string, string>): string[] =>
    Object.entries(archivos)
      .filter(([nombre, texto]) => MENCIONA.test(texto) && !DUENOS.some((d) => d.test(nombre)))
      .map(([nombre]) => nombre);

  it("el detector marca un archivo que lee los grupos a mano", () => {
    expect(quienes({ "arquitectura/otro.cjs": 'fs.readdirSync("arquitectura/mutacion")' })).toEqual(
      ["arquitectura/otro.cjs"],
    );
    expect(quienes({ "arquitectura/otro.cjs": 'require("./grupos-de-mutacion.json")' })).toEqual([
      "arquitectura/otro.cjs",
    ]);
    expect(quienes({ "arquitectura/grupos-de-mutacion.cjs": "arquitectura/mutacion" })).toEqual([]);
  });

  it("ningún otro `.cjs` de arquitectura/ lee los grupos a mano: todos pasan por el cargador (una regla, un lugar)", () => {
    const base = join(RAIZ, "arquitectura");
    const archivos = Object.fromEntries(recorrer(base).map((r) => [r, readFileSync(r, "utf8")]));
    expect(quienes(archivos)).toEqual([]);
  });
});
