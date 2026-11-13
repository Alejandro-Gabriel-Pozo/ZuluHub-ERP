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
import {
  type Arbol,
  arbolConRegistro,
  control,
  entrada,
  resumen,
  SENSIBLES,
  CUOTA,
} from "./decisiones-apoyo";

const require = createRequire(import.meta.url);

type Error = { archivo: string; motivo: string };
type Leido =
  { ausente: true } | { errores: Error[] } | { valor: { id: string }[]; enMonolito: boolean };
const cargador = require("../../arquitectura/registros/en-carpeta.cjs") as {
  leerRegistroEnCarpeta: (datos: {
    arbol: Arbol;
    carpeta: string;
    monolito: string;
    admiteMonolito: boolean;
  }) => Leido;
  arbolDelDisco: (raiz: string, carpeta: string, monolito: string) => Arbol;
};

/**
 * El cargador de un registro que es una CARPETA con un archivo por entrada (`arquitectura/registros/en-carpeta.cjs`).
 * Previene: el choque entre sesiones en paralelo que agregaban al final del mismo array (4 veces en un día, 13/11/2026) y el mismo `DEC-NNNN`
 * «siguiente» elegido por dos ramas. Cada caso de abajo es una violación inyectada: si se debilita el cargador, esta prueba se pone roja.
 */
const CARPETA = "registros/x";
const MONOLITO = "registros/x.json";
const arbol = (archivos: Record<string, string | null>): Arbol => ({
  rutas: Object.keys(archivos).sort(),
  leer: (ruta) => {
    const contenido = archivos[ruta];
    return contenido === undefined || contenido === null ? null : Buffer.from(contenido);
  },
});
const leer = (archivos: Record<string, string | null>, admiteMonolito = false) =>
  cargador.leerRegistroEnCarpeta({
    arbol: arbol(archivos),
    carpeta: CARPETA,
    monolito: MONOLITO,
    admiteMonolito,
  });
const errores = (r: Leido) => ("errores" in r ? r.errores : []);
const una = (id: string) => JSON.stringify({ id, dato: id });

describe("un archivo por entrada, nombre = id", () => {
  it("junta las entradas de la carpeta ordenadas por id, sin depender del orden en que llegan los archivos", () => {
    const archivos = {
      [`${CARPETA}/B.json`]: una("B"),
      [`${CARPETA}/A.json`]: una("A"),
      [`${CARPETA}/A-B.json`]: una("A-B"),
    };
    // Al revés del orden de los ids, y con «A-B.json» antes que «A.json» por nombre: el orden sale del id, no de la lista de archivos.
    const r = cargador.leerRegistroEnCarpeta({
      arbol: {
        ...arbol(archivos),
        rutas: [`${CARPETA}/B.json`, `${CARPETA}/A.json`, `${CARPETA}/A-B.json`],
      },
      carpeta: CARPETA,
      monolito: MONOLITO,
      admiteMonolito: false,
    });
    expect(r).toEqual({
      valor: [
        { id: "A", dato: "A" },
        { id: "A-B", dato: "A-B" },
        { id: "B", dato: "B" },
      ],
      enMonolito: false,
    });
  });

  it("sin carpeta ni array viejo está ausente, y lo que cuelga de otra carpeta de nombre parecido no cuenta", () => {
    expect(leer({})).toEqual({ ausente: true });
    expect(
      leer({ "registros/xy/DEC-0001.json": una("DEC-0001"), "registros/x-DEC-0001.json": "[]" }),
    ).toEqual({ ausente: true });
  });

  it("un archivo ajeno o una subcarpeta en la carpeta falla (nunca se ignora)", () => {
    const ajeno = leer({
      [`${CARPETA}/DEC-0001.json`]: una("DEC-0001"),
      [`${CARPETA}/LEEME.md`]: "x",
    });
    expect(errores(ajeno)).toEqual([
      expect.objectContaining({
        archivo: `${CARPETA}/LEEME.md`,
        motivo: expect.stringContaining("no es un archivo de entrada"),
      }),
    ]);
    const anidado = leer({ [`${CARPETA}/sub/DEC-0001.json`]: una("DEC-0001") });
    expect(errores(anidado)).toEqual([
      expect.objectContaining({ archivo: `${CARPETA}/sub/DEC-0001.json` }),
    ]);
    expect(errores(leer({ [`${CARPETA}/.json`]: "{}" }))).toHaveLength(1);
    // Solo «<id>.json» exacto: una copia «.json.bak» o «.jsonx» no es una entrada.
    for (const nombre of ["DEC-0001.json.bak", "DEC-0001.jsonx"]) {
      const copia = leer({ [`${CARPETA}/${nombre}`]: una("DEC-0001") });
      expect(errores(copia), nombre).toEqual([
        expect.objectContaining({ archivo: `${CARPETA}/${nombre}` }),
      ]);
    }
  });

  it("un JSON roto, o que no es un objeto, falla con el archivo", () => {
    const roto = leer({ [`${CARPETA}/DEC-0001.json`]: "{roto" });
    expect(errores(roto)[0]?.archivo).toBe(`${CARPETA}/DEC-0001.json`);
    expect(errores(roto)[0]?.motivo).toMatch(/^no se puede leer \(/);
    for (const contenido of ["[]", "null", '"texto"', "7"]) {
      const r = leer({ [`${CARPETA}/DEC-0001.json`]: contenido });
      expect(errores(r)[0]?.motivo, contenido).toContain("tiene que ser un objeto");
    }
  });

  it("un nombre que no coincide con el id de adentro falla (y dice los dos)", () => {
    const distinto = leer({ [`${CARPETA}/DEC-0001.json`]: una("DEC-0009") });
    expect(errores(distinto)[0]?.motivo).toBe(
      'el nombre del archivo tiene que ser el id de la entrada («DEC-0001.json» trae id "DEC-0009").',
    );
    const sinId = leer({ [`${CARPETA}/DEC-0001.json`]: JSON.stringify({ dato: 1 }) });
    expect(errores(sinId)).toHaveLength(1);
    const numerico = leer({ [`${CARPETA}/7.json`]: JSON.stringify({ id: 7 }) });
    expect(errores(numerico)).toHaveLength(1);
  });

  it("un archivo listado que desaparece antes de leerse falla con su motivo", () => {
    const r = leer({ [`${CARPETA}/DEC-0001.json`]: null });
    expect(errores(r)).toEqual([
      { archivo: `${CARPETA}/DEC-0001.json`, motivo: "no se puede leer (el archivo no existe)." },
    ]);
  });

  it("junta todas las fallas, no se detiene en la primera", () => {
    const r = leer({
      [`${CARPETA}/DEC-0001.json`]: "{roto",
      [`${CARPETA}/DEC-0002.json`]: una("DEC-0003"),
      [`${CARPETA}/otro.txt`]: "x",
    });
    expect(errores(r).map((e) => e.archivo)).toEqual([
      `${CARPETA}/DEC-0001.json`,
      `${CARPETA}/DEC-0002.json`,
      `${CARPETA}/otro.txt`,
    ]);
  });
});

describe("el array viejo (registro.json): solo la base, solo en la transición", () => {
  it("en el cambio, un array suelto falla aunque no haya carpeta", () => {
    const r = leer({ [MONOLITO]: "[]" });
    expect(errores(r)).toEqual([
      { archivo: MONOLITO, motivo: expect.stringContaining("no puede estar suelto") },
    ]);
  });

  it("al lado de la carpeta falla siempre, también en la base", () => {
    for (const admite of [false, true]) {
      const r = leer({ [MONOLITO]: "[]", [`${CARPETA}/DEC-0001.json`]: una("DEC-0001") }, admite);
      expect(errores(r)[0]).toEqual({
        archivo: MONOLITO,
        motivo: expect.stringContaining("no puede estar al lado de ella"),
      });
    }
  });

  it("la base sin carpeta lee el array viejo y lo marca como tal", () => {
    expect(leer({ [MONOLITO]: JSON.stringify([{ id: "DEC-0001" }]) }, true)).toEqual({
      valor: [{ id: "DEC-0001" }],
      enMonolito: true,
    });
  });

  it("un array viejo roto, que no es lista o que no se puede leer falla", () => {
    expect(errores(leer({ [MONOLITO]: "{roto" }, true))[0]?.motivo).toMatch(/^no se puede leer \(/);
    expect(errores(leer({ [MONOLITO]: "{}" }, true))[0]?.motivo).toBe(
      "tiene que ser una lista de entradas.",
    );
    const fantasma = cargador.leerRegistroEnCarpeta({
      arbol: { rutas: [MONOLITO], leer: () => null },
      carpeta: CARPETA,
      monolito: MONOLITO,
      admiteMonolito: true,
    });
    expect(errores(fantasma)).toEqual([
      { archivo: MONOLITO, motivo: "no se puede leer (el archivo no existe)." },
    ]);
  });
});

describe("leer del disco", () => {
  const carpetas: string[] = [];
  afterEach(() => {
    for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
  });
  const disco = (archivos: Record<string, string>): string => {
    const raiz = mkdtempSync(join(tmpdir(), "en-carpeta-"));
    carpetas.push(raiz);
    for (const [ruta, contenido] of Object.entries(archivos)) {
      mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
      writeFileSync(join(raiz, ruta), contenido);
    }
    return raiz;
  };

  it("lista lo de la carpeta con barras, incluidas las subcarpetas, más el array viejo si existe", () => {
    const raiz = disco({
      [`${CARPETA}/DEC-0001.json`]: una("DEC-0001"),
      [`${CARPETA}/sub/DEC-0002.json`]: una("DEC-0002"),
      [MONOLITO]: "[]",
    });
    const a = cargador.arbolDelDisco(raiz, CARPETA, MONOLITO);
    expect([...a.rutas].sort()).toEqual([
      MONOLITO,
      `${CARPETA}/DEC-0001.json`,
      `${CARPETA}/sub/DEC-0002.json`,
    ]);
    expect(a.leer(`${CARPETA}/DEC-0001.json`)?.toString()).toBe(una("DEC-0001"));
    expect(a.leer("no/existe.json")).toBeNull();
  });

  it("sin carpeta ni array viejo no lista nada", () => {
    expect(cargador.arbolDelDisco(disco({ "otro.txt": "x" }), CARPETA, MONOLITO).rutas).toEqual([]);
  });
});

describe("el registro de decisiones sobre este cargador", () => {
  const REG = [entrada({ id: "DEC-0001" }), entrada({ id: "DEC-0002" })];
  const evaluar = (pr: Arbol, base: Arbol | null = null) => control.evaluar({ pr, base });
  /** La base de antes de partir el registro: un solo `registro.json`. */
  const baseConArrayViejo = (registro: unknown[], otros: Record<string, string> = {}): Arbol => {
    const hijos = arbolConRegistro([]);
    const archivos: Record<string, string> = {
      [control.MONOLITO_DEL_REGISTRO]: JSON.stringify(registro),
      [control.ARCHIVO_DE_LOS_SENSIBLES]: JSON.stringify(SENSIBLES),
      [control.ARCHIVO_DE_LA_CUOTA]: JSON.stringify(CUOTA),
      ...otros,
    };
    expect(hijos.rutas).not.toContain(control.MONOLITO_DEL_REGISTRO);
    return arbol(archivos);
  };

  it("partir el registro no es borrarlo: la misma lista en carpeta contra la base con el array viejo pasa", () => {
    expect(evaluar(arbolConRegistro(REG), baseConArrayViejo(REG))).toEqual({
      fallas: [],
      avisos: [],
    });
  });

  it("quitar una entrada al partir sigue fallando como borrado", () => {
    const { fallas } = evaluar(arbolConRegistro([REG[0]!]), baseConArrayViejo(REG));
    expect(fallas.map((f) => f.motivo)).toEqual([
      expect.stringContaining("DEC-0002 estaba en la base"),
    ]);
    expect(fallas[0]?.archivo).toBe(`${control.CARPETA_DEL_REGISTRO}/DEC-0002.json`);
  });

  it("tocar un archivo sensible sin entrada nueva sigue fallando contra la base con el array viejo", () => {
    const base = baseConArrayViejo(REG, { "src/primitivas/dinero/a.ts": "x" });
    const pr = arbolConRegistro(REG, { "src/primitivas/dinero/a.ts": "y" });
    expect(evaluar(pr, base).fallas[0]?.motivo).toContain(
      "no trae ninguna entrada nueva ni cambiada",
    );
    const conEntrada = arbolConRegistro([...REG, entrada({ id: "DEC-0003" })], {
      "src/primitivas/dinero/a.ts": "y",
    });
    expect(evaluar(conEntrada, base).fallas).toEqual([]);
  });

  it("un registro.json solo, sin carpeta, en el cambio falla: el array viejo es solo de la base", () => {
    const soloArray = baseConArrayViejo(REG);
    const { fallas } = evaluar(soloArray);
    expect(fallas.map((f) => f.motivo)).toEqual([expect.stringContaining("no puede estar suelto")]);
    expect(fallas[0]?.archivo).toBe(control.MONOLITO_DEL_REGISTRO);
  });

  it("un registro.json suelto en el cambio falla, y la base con carpeta y array a la vez también", () => {
    const suelto = arbolConRegistro(REG, { [control.MONOLITO_DEL_REGISTRO]: "[]" });
    expect(evaluar(suelto).fallas[0]?.archivo).toBe(control.MONOLITO_DEL_REGISTRO);
    const base = arbolConRegistro(REG, { [control.MONOLITO_DEL_REGISTRO]: "[]" });
    expect(evaluar(arbolConRegistro(REG), base).fallas[0]?.motivo).toMatch(/^Base: /);
  });

  it("un id repetido (dos archivos que dicen ser la misma decisión) falla por el nombre", () => {
    const pr = arbolConRegistro(REG, {
      [`${control.CARPETA_DEL_REGISTRO}/DEC-0099.json`]: JSON.stringify(
        entrada({ id: "DEC-0001" }),
      ),
    });
    expect(evaluar(pr).fallas.map((f) => f.motivo)).toEqual([
      expect.stringContaining("el nombre del archivo tiene que ser el id"),
    ]);
  });

  it("una entrada con forma inválida falla con el archivo de esa entrada", () => {
    const pr = arbolConRegistro([...REG, entrada({ id: "DEC-0003", tipo: "OTRO" })]);
    expect(evaluar(pr).fallas).toEqual([
      expect.objectContaining({ archivo: `${control.CARPETA_DEL_REGISTRO}/DEC-0003.json` }),
    ]);
  });
});

describe("el resumen para el dueño sobre este cargador", () => {
  const carpetas: string[] = [];
  afterEach(() => {
    for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
  });
  const disco = (archivos: Record<string, string>): string => {
    const raiz = mkdtempSync(join(tmpdir(), "resumen-"));
    carpetas.push(raiz);
    for (const [ruta, contenido] of Object.entries(archivos)) {
      mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
      writeFileSync(join(raiz, ruta), contenido);
    }
    return raiz;
  };

  it("sin registro dice que no existe (código 1, nada que imprimir)", () => {
    expect(resumen.ejecutar(disco({}))).toEqual({
      codigo: 1,
      salida: "",
      errores: [`${control.CARPETA_DEL_REGISTRO}: no existe.`],
    });
  });

  it("con el array viejo suelto falla: el resumen lee solo la carpeta", () => {
    const r = resumen.ejecutar(
      disco({ [control.MONOLITO_DEL_REGISTRO]: JSON.stringify([entrada()]) }),
    );
    expect(r.codigo).toBe(1);
    expect(r.errores).toEqual([expect.stringContaining("no puede estar suelto")]);
  });
});

describe("una regla, un lugar: solo el control de decisiones conoce dónde está el registro", () => {
  /** Los archivos `.cjs` de `arquitectura/` (menos el cargador y este control) que escriben la ruta del registro a mano. */
  const RUTA = /decisiones\/registro(?:\.json|\/)/;
  const recorrer = (carpeta: string): string[] =>
    readdirSync(carpeta).flatMap((nombre) => {
      const ruta = join(carpeta, nombre);
      if (statSync(ruta).isDirectory()) return nombre === "registro" ? [] : recorrer(ruta);
      return ruta.endsWith(".cjs") ? [ruta] : [];
    });
  const quienes = (archivos: Record<string, string>): string[] =>
    Object.entries(archivos)
      .filter(([nombre, texto]) => RUTA.test(texto) && !/decisiones\/decisiones\.cjs$/.test(nombre))
      .map(([nombre]) => nombre);

  it("el detector marca un archivo que repite la ruta", () => {
    expect(
      quienes({ "arquitectura/otro.cjs": 'const r = "arquitectura/decisiones/registro/";' }),
    ).toEqual(["arquitectura/otro.cjs"]);
    expect(
      quienes({
        "arquitectura/decisiones/decisiones.cjs": 'const r = "arquitectura/decisiones/registro";',
      }),
    ).toEqual([]);
  });

  it("ningún otro archivo de arquitectura/ la escribe: importan la constante de decisiones.cjs", () => {
    const raiz = join(import.meta.dirname, "../../arquitectura");
    const archivos = Object.fromEntries(recorrer(raiz).map((r) => [r, readFileSync(r, "utf8")]));
    expect(quienes(archivos)).toEqual([]);
  });
});
