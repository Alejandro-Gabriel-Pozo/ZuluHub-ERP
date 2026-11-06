import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * El presupuesto de la deuda de campos sin dato SOLO BAJA contra la rama base (`arquitectura/deuda/campos-sin-dato.cjs`, que el CI
 * corre en el job del guardián con `--base=base`). Previene: subir la cuenta de un archivo ya listado (o sumar un archivo a la lista
 * con un control crudo nuevo) sin que nada falle, porque el guardián de deuda solo mira «tipo y archivo». Cada caso inyectado abajo
 * rompe el control; si se lo debilita, esta prueba se pone roja.
 */

const require = createRequire(import.meta.url);
const { ARCHIVO, ejecutar, problemasContraLaBase, problemasDeForma } =
  require("../../arquitectura/deuda/campos-sin-dato.cjs") as {
    ARCHIVO: string;
    ejecutar: (a: string[], raiz: string) => { codigo: number; lineas: string[] };
    problemasContraLaBase: (b: unknown, p: unknown) => string[];
    problemasDeForma: (p: unknown) => string[];
  };

const cuenta = (pendientes: number, crudos: number, dinamicos = 0) => ({
  pendientes,
  crudos,
  dinamicos,
});
const directorios: string[] = [];
afterEach(() => {
  for (const d of directorios.splice(0)) rmSync(d, { recursive: true, force: true });
});
function arbol(contenido: string | null): string {
  const raiz = mkdtempSync(join(tmpdir(), "pedernal-presupuesto-"));
  directorios.push(raiz);
  if (contenido !== null) {
    mkdirSync(dirname(join(raiz, ARCHIVO)), { recursive: true });
    writeFileSync(join(raiz, ARCHIVO), contenido);
  }
  return raiz;
}
const json = (o: unknown) => JSON.stringify(o);

describe("presupuesto de campos sin dato: la forma", () => {
  it("acepta { ruta: { pendientes, crudos, dinamicos } } con enteros", () => {
    expect(problemasDeForma({ "a.tsx": cuenta(1, 0), "b.tsx": cuenta(0, 2, 3) })).toEqual([]);
    expect(problemasDeForma({})).toEqual([]);
  });

  it("rechaza lo que no es un objeto, una cuenta mal formada, negativos, decimales, claves de más o un archivo en cero", () => {
    for (const malo of [null, [], "x", 3])
      expect(problemasDeForma(malo), String(malo)).toHaveLength(1);
    expect(problemasDeForma({ "a.tsx": 3 })).toHaveLength(1);
    expect(problemasDeForma({ "a.tsx": { pendientes: 1, crudos: 0 } })).toHaveLength(1);
    expect(problemasDeForma({ "a.tsx": { ...cuenta(1, 0), extra: 1 } })).toHaveLength(1);
    expect(problemasDeForma({ "a.tsx": cuenta(-1, 0) })).toHaveLength(1);
    expect(problemasDeForma({ "a.tsx": cuenta(1.5, 0) })).toHaveLength(1);
    expect(
      problemasDeForma({ "a.tsx": { pendientes: "1", crudos: 0, dinamicos: 0 } }),
    ).toHaveLength(1);
    expect(problemasDeForma({ "a.tsx": cuenta(0, 0, 0) })).toHaveLength(1);
  });
});

describe("presupuesto de campos sin dato: contra la base", () => {
  const base = { "a.tsx": cuenta(3, 1, 1), "b.tsx": cuenta(2, 0) };

  it("acepta lo igual, lo que baja y lo que sale del presupuesto", () => {
    expect(problemasContraLaBase(base, base)).toEqual([]);
    expect(problemasContraLaBase(base, { "a.tsx": cuenta(2, 0, 0) })).toEqual([]);
    expect(problemasContraLaBase(base, {})).toEqual([]);
  });

  it("rechaza cada cuenta que sube y un archivo que entra (aunque el total baje)", () => {
    expect(problemasContraLaBase(base, { ...base, "a.tsx": cuenta(4, 1, 1) })).toHaveLength(1);
    expect(problemasContraLaBase(base, { ...base, "a.tsx": cuenta(3, 2, 1) })).toHaveLength(1);
    expect(problemasContraLaBase(base, { ...base, "a.tsx": cuenta(3, 1, 2) })).toHaveLength(1);
    expect(
      problemasContraLaBase(base, { "a.tsx": cuenta(3, 1, 1), "nuevo.tsx": cuenta(0, 1) }),
    ).toHaveLength(1);
    // baja un archivo y sube otro: falla igual
    expect(
      problemasContraLaBase(base, { "a.tsx": cuenta(0, 0, 1), "b.tsx": cuenta(9, 0) }),
    ).toHaveLength(1);
    // un nombre heredado del prototipo no cuenta como archivo de la base
    expect(problemasContraLaBase(base, { constructor: cuenta(1, 0) })).toHaveLength(1);
  });
});

describe("presupuesto de campos sin dato: el control completo", () => {
  it("sin --base valida solo la forma; el archivo ausente o roto falla", () => {
    expect(ejecutar([], arbol(json({ "a.tsx": cuenta(1, 0) }))).codigo).toBe(0);
    expect(ejecutar([], arbol(null)).codigo).toBe(1);
    expect(ejecutar([], arbol("{ no es json")).codigo).toBe(1);
    expect(ejecutar([], arbol(json({ "a.tsx": cuenta(0, 0) }))).codigo).toBe(1);
  });

  it("con --base compara; si la base no trae el archivo avisa y sigue; si lo trae roto, falla", () => {
    const pr = arbol(json({ "a.tsx": cuenta(2, 0) }));
    const sube = arbol(json({ "a.tsx": cuenta(1, 0) }));
    const igual = arbol(json({ "a.tsx": cuenta(2, 0) }));
    expect(ejecutar([`--base=${igual}`], pr).codigo).toBe(0);
    expect(ejecutar([`--base=${sube}`], pr).codigo).toBe(1);
    const sinBase = ejecutar([`--base=${arbol(null)}`], pr);
    expect(sinBase.codigo).toBe(0);
    expect(sinBase.lineas.join("\n")).toContain("AVISO");
    expect(ejecutar([`--base=${arbol("{ roto")}`], pr).codigo).toBe(1);
    expect(ejecutar([`--base=${arbol(json({ "a.tsx": cuenta(0, 0) }))}`], pr).codigo).toBe(1);
  });

  it("un uso incorrecto sale con 2", () => {
    const pr = arbol(json({}));
    expect(ejecutar(["--otra"], pr).codigo).toBe(2);
    expect(ejecutar(["--base=a", "--base=b"], pr).codigo).toBe(2);
  });
});
