import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Los presupuestos de deuda por archivo (campos sin dato y validación de datos) SOLO BAJAN contra la rama base
 * (`arquitectura/deuda/campos-sin-dato.cjs`, que el CI corre en el job del guardián con `--base=base`). Previene: subir la cuenta de un
 * archivo ya listado (o sumar un archivo a la lista con un control crudo nuevo) sin que nada falle, porque el guardián de deuda solo
 * mira «tipo y archivo». Cada caso inyectado abajo rompe el control; si se lo debilita, esta prueba se pone roja.
 */

const require = createRequire(import.meta.url);
type Presupuesto = { archivo: string; claves: string[]; deQue: string };
const { PRESUPUESTOS, ejecutar, problemasContraLaBase, problemasDeForma } =
  require("../../arquitectura/deuda/campos-sin-dato.cjs") as {
    PRESUPUESTOS: Presupuesto[];
    ejecutar: (a: string[], raiz: string) => { codigo: number; lineas: string[] };
    problemasContraLaBase: (b: unknown, p: unknown, pr: Presupuesto) => string[];
    problemasDeForma: (p: unknown, pr: Presupuesto) => string[];
  };
const CAMPOS = PRESUPUESTOS[0] as Presupuesto;
const VALIDACION = PRESUPUESTOS[1] as Presupuesto;
const ARCHIVO = CAMPOS.archivo;
const forma = (p: unknown) => problemasDeForma(p, CAMPOS);
const contraBase = (b: unknown, p: unknown) => problemasContraLaBase(b, p, CAMPOS);
const FIN_OK = "Presupuestos de deuda por archivo: 0 fallas.";
const fin = (n: number) => `Presupuestos de deuda por archivo: ${n} fallas.`;

const cuenta = (pendientes: number, crudos: number, dinamicos = 0) => ({
  pendientes,
  crudos,
  dinamicos,
});
const directorios: string[] = [];
afterEach(() => {
  for (const d of directorios.splice(0)) rmSync(d, { recursive: true, force: true });
});
/** Un árbol con los dos presupuestos: `null` = ausente; el de validación, por defecto, vacío. */
function arbol(campos: string | null, validacion: string | null = "{}"): string {
  const raiz = mkdtempSync(join(tmpdir(), "pedernal-presupuesto-"));
  directorios.push(raiz);
  for (const [presupuesto, contenido] of [
    [CAMPOS, campos],
    [VALIDACION, validacion],
  ] as const) {
    if (contenido === null) continue;
    mkdirSync(dirname(join(raiz, presupuesto.archivo)), { recursive: true });
    writeFileSync(join(raiz, presupuesto.archivo), contenido);
  }
  return raiz;
}
const json = (o: unknown) => JSON.stringify(o);

describe("presupuesto de campos sin dato: la forma", () => {
  it("acepta { ruta: { pendientes, crudos, dinamicos } } con enteros", () => {
    expect(forma({ "a.tsx": cuenta(1, 0), "b.tsx": cuenta(0, 2, 3) })).toEqual([]);
    expect(forma({})).toEqual([]);
  });

  it("rechaza lo que no es un objeto, con el texto exacto", () => {
    const texto = `${ARCHIVO} tiene que ser un objeto { ruta: { pendientes, crudos, dinamicos } }.`;
    for (const malo of [null, [], "x", 3]) expect(forma(malo), String(malo)).toEqual([texto]);
  });

  it("rechaza una cuenta mal formada, con claves de más o de menos, con el texto exacto", () => {
    expect(forma({ "a.tsx": 3 })).toEqual([
      "«a.tsx»: tiene que ser { pendientes, crudos, dinamicos }.",
    ]);
    expect(forma({ "a.tsx": null })).toEqual([
      "«a.tsx»: tiene que ser { pendientes, crudos, dinamicos }.",
    ]);
    expect(forma({ "a.tsx": [1, 2, 3] })).toEqual([
      "«a.tsx»: tiene que ser { pendientes, crudos, dinamicos }.",
    ]);
    const claves = "«a.tsx»: lleva exactamente pendientes, crudos, dinamicos.";
    expect(forma({ "a.tsx": { pendientes: 1, crudos: 0 } })).toEqual([claves]);
    expect(forma({ "a.tsx": { ...cuenta(1, 0), extra: 1 } })).toEqual([claves]);
    // tres claves, pero una no es de las tres: no alcanza con que alguna esté
    expect(forma({ "a.tsx": { pendientes: 1, crudos: 0, otra: 0 } })).toEqual([claves]);
  });

  it("rechaza negativos, decimales y no enteros, y un archivo en cero, con el texto exacto", () => {
    const enteros = "«a.tsx»: pendientes, crudos, dinamicos son enteros desde 0.";
    expect(forma({ "a.tsx": cuenta(-1, 0) })).toEqual([enteros]);
    expect(forma({ "a.tsx": cuenta(1.5, 0) })).toEqual([enteros]);
    expect(forma({ "a.tsx": cuenta(1, -1) })).toEqual([enteros]);
    expect(forma({ "a.tsx": cuenta(1, 0, 0.5) })).toEqual([enteros]);
    expect(forma({ "a.tsx": { pendientes: "1", crudos: 0, dinamicos: 0 } })).toEqual([enteros]);
    expect(forma({ "a.tsx": cuenta(0, 0, 0) })).toEqual([
      "«a.tsx»: no tiene deuda; sacalo del presupuesto.",
    ]);
    // un cero en alguna clave está bien si otra tiene deuda
    expect(forma({ "a.tsx": cuenta(0, 0, 1) })).toEqual([]);
  });

  it("informa cada archivo con problema, en orden", () => {
    expect(forma({ "a.tsx": 3, "b.tsx": cuenta(0, 0, 0), "c.tsx": cuenta(1, 0) })).toEqual([
      "«a.tsx»: tiene que ser { pendientes, crudos, dinamicos }.",
      "«b.tsx»: no tiene deuda; sacalo del presupuesto.",
    ]);
  });
});

describe("presupuesto de campos sin dato: contra la base", () => {
  const base = { "a.tsx": cuenta(3, 1, 1), "b.tsx": cuenta(2, 0) };

  it("acepta lo igual, lo que baja y lo que sale del presupuesto", () => {
    expect(contraBase(base, base)).toEqual([]);
    expect(contraBase(base, { "a.tsx": cuenta(2, 0, 0) })).toEqual([]);
    expect(contraBase(base, {})).toEqual([]);
  });

  it("rechaza cada cuenta que sube, con el texto exacto", () => {
    expect(contraBase(base, { ...base, "a.tsx": cuenta(4, 1, 1) })).toEqual([
      "«a.tsx»: pendientes sube de 3 a 4; el presupuesto solo baja.",
    ]);
    expect(contraBase(base, { ...base, "a.tsx": cuenta(3, 2, 1) })).toEqual([
      "«a.tsx»: crudos sube de 1 a 2; el presupuesto solo baja.",
    ]);
    expect(contraBase(base, { ...base, "a.tsx": cuenta(3, 1, 2) })).toEqual([
      "«a.tsx»: dinamicos sube de 1 a 2; el presupuesto solo baja.",
    ]);
    expect(contraBase(base, { ...base, "a.tsx": cuenta(4, 2, 2) })).toHaveLength(3);
  });

  it("rechaza un archivo que entra (aunque el total baje) y lo informa una sola vez", () => {
    expect(contraBase(base, { "a.tsx": cuenta(3, 1, 1), "nuevo.tsx": cuenta(0, 1) })).toEqual([
      "«nuevo.tsx» entra a la deuda de campos sin dato: la base no lo tenía y el presupuesto solo baja.",
    ]);
    // baja un archivo y sube otro: falla igual
    expect(contraBase(base, { "a.tsx": cuenta(0, 0, 1), "b.tsx": cuenta(9, 0) })).toEqual([
      "«b.tsx»: pendientes sube de 2 a 9; el presupuesto solo baja.",
    ]);
    // un nombre heredado del prototipo no cuenta como archivo de la base
    expect(contraBase(base, { constructor: cuenta(1, 0) })).toEqual([
      "«constructor» entra a la deuda de campos sin dato: la base no lo tenía y el presupuesto solo baja.",
    ]);
  });
});

describe("presupuesto de validación de datos: su propia forma y su propia base", () => {
  const val = (p: unknown) => problemasDeForma(p, VALIDACION);
  const cuentaV = (prohibidos: number, duplicados: number) => ({ prohibidos, duplicados });

  it("lleva exactamente prohibidos y duplicados, con el texto exacto", () => {
    expect(val({ "a.ts": cuentaV(1, 0), "b.ts": cuentaV(0, 2) })).toEqual([]);
    expect(val({ "a.ts": cuenta(1, 0) })).toEqual([
      "«a.ts»: lleva exactamente prohibidos, duplicados.",
    ]);
    expect(val({ "a.ts": cuentaV(0, 0) })).toEqual([
      "«a.ts»: no tiene deuda; sacalo del presupuesto.",
    ]);
    expect(val({ "a.ts": cuentaV(-1, 0) })).toEqual([
      "«a.ts»: prohibidos, duplicados son enteros desde 0.",
    ]);
    expect(val([])).toEqual([
      `${VALIDACION.archivo} tiene que ser un objeto { ruta: { prohibidos, duplicados } }.`,
    ]);
  });

  it("solo baja contra la base y lo dice con la validación de datos", () => {
    const base = { "a.ts": cuentaV(2, 1) };
    expect(problemasContraLaBase(base, { "a.ts": cuentaV(1, 1) }, VALIDACION)).toEqual([]);
    expect(problemasContraLaBase(base, { "a.ts": cuentaV(2, 2) }, VALIDACION)).toEqual([
      "«a.ts»: duplicados sube de 1 a 2; el presupuesto solo baja.",
    ]);
    expect(problemasContraLaBase(base, { ...base, "b.ts": cuentaV(1, 0) }, VALIDACION)).toEqual([
      "«b.ts» entra a la deuda de validación de datos: la base no lo tenía y el presupuesto solo baja.",
    ]);
  });

  it("el control completo lo compara contra la base, aparte del de campos", () => {
    const pr = arbol("{}", json({ "a.ts": cuentaV(3, 0) }));
    const base = arbol("{}", json({ "a.ts": cuentaV(2, 0) }));
    expect(ejecutar([`--base=${base}`], pr)).toEqual({
      codigo: 1,
      lineas: ["FALLA «a.ts»: prohibidos sube de 2 a 3; el presupuesto solo baja.", fin(1)],
    });
    expect(ejecutar([`--base=${arbol("{}", null)}`], pr)).toEqual({
      codigo: 0,
      lineas: [
        `AVISO la rama base no trae ${VALIDACION.archivo}: no hay presupuesto anterior contra el que comparar.`,
        FIN_OK,
      ],
    });
  });
});

describe("presupuesto de campos sin dato: el control completo", () => {
  const uso = "Uso: node arquitectura/deuda/campos-sin-dato.cjs [--base=<carpeta de la base>]";

  it("sin --base valida solo la forma", () => {
    expect(ejecutar([], arbol(json({ "a.tsx": cuenta(1, 0) })))).toEqual({
      codigo: 0,
      lineas: [FIN_OK],
    });
    expect(ejecutar([], arbol(json({ "a.tsx": cuenta(0, 0) })))).toEqual({
      codigo: 1,
      lineas: ["FALLA «a.tsx»: no tiene deuda; sacalo del presupuesto.", fin(1)],
    });
  });

  it("el archivo ausente o roto falla con el texto exacto", () => {
    expect(ejecutar([], arbol(null))).toEqual({
      codigo: 1,
      lineas: [`FALLA ${ARCHIVO} no existe.`, fin(1)],
    });
    expect(ejecutar([], arbol("{}", null))).toEqual({
      codigo: 1,
      lineas: [`FALLA ${VALIDACION.archivo} no existe.`, fin(1)],
    });
    const raiz = arbol("{ no es json");
    const resultado = ejecutar([], raiz);
    expect(resultado.codigo).toBe(1);
    expect(resultado.lineas).toHaveLength(2);
    expect(resultado.lineas[1]).toBe(fin(1));
    expect(resultado.lineas[0]).toMatch(
      new RegExp(
        `^FALLA ${raiz.replaceAll("/", "\\/")}\\/${ARCHIVO.replaceAll("/", "\\/")}: no se puede leer \\(.+\\)\\.$`,
      ),
    );
  });

  it("con --base compara y cuenta las fallas de la comparación", () => {
    const pr = arbol(json({ "a.tsx": cuenta(2, 0) }));
    const igual = arbol(json({ "a.tsx": cuenta(2, 0) }));
    const sube = arbol(json({ "a.tsx": cuenta(1, 0) }));
    expect(ejecutar([`--base=${igual}`], pr)).toEqual({
      codigo: 0,
      lineas: [FIN_OK],
    });
    expect(ejecutar([`--base=${sube}`], pr)).toEqual({
      codigo: 1,
      lineas: ["FALLA «a.tsx»: pendientes sube de 1 a 2; el presupuesto solo baja.", fin(1)],
    });
  });

  it("si la base no trae el archivo avisa y sigue", () => {
    const pr = arbol(json({ "a.tsx": cuenta(2, 0) }));
    expect(ejecutar([`--base=${arbol(null)}`], pr)).toEqual({
      codigo: 0,
      lineas: [
        `AVISO la rama base no trae ${ARCHIVO}: no hay presupuesto anterior contra el que comparar.`,
        FIN_OK,
      ],
    });
  });

  it("si la base lo trae roto o con mala forma, falla (nunca pasa porque no se pudo mirar)", () => {
    const pr = arbol(json({ "a.tsx": cuenta(2, 0) }));
    const rota = ejecutar([`--base=${arbol("{ roto")}`], pr);
    expect(rota.codigo).toBe(1);
    expect(rota.lineas).toHaveLength(2);
    expect(rota.lineas[0]).toMatch(/^FALLA .+: no se puede leer \(.+\)\.$/);
    expect(rota.lineas[1]).toBe(fin(1));
    expect(ejecutar([`--base=${arbol(json({ "a.tsx": cuenta(0, 0) }))}`], pr)).toEqual({
      codigo: 1,
      lineas: ["FALLA Base: «a.tsx»: no tiene deuda; sacalo del presupuesto.", fin(1)],
    });
  });

  it("si el cambio tiene mala forma no compara contra la base (solo informa la forma)", () => {
    const base = arbol(json({ "a.tsx": cuenta(1, 0) }));
    const pr = arbol(json({ "a.tsx": cuenta(5, 0), "b.tsx": 3 }));
    expect(ejecutar([`--base=${base}`], pr)).toEqual({
      codigo: 1,
      lineas: ["FALLA «b.tsx»: tiene que ser { pendientes, crudos, dinamicos }.", fin(1)],
    });
  });

  it("un uso incorrecto sale con 2 y dice cómo se usa", () => {
    const pr = arbol(json({}));
    expect(ejecutar(["--otra"], pr)).toEqual({ codigo: 2, lineas: [uso] });
    expect(ejecutar(["--base=a", "--base=b"], pr)).toEqual({ codigo: 2, lineas: [uso] });
    expect(ejecutar(["--base=a", "--otra"], pr)).toEqual({ codigo: 2, lineas: [uso] });
    expect(ejecutar(["x"], pr)).toEqual({ codigo: 2, lineas: [uso] });
  });
});

describe("presupuesto de campos sin dato: el script de línea de comandos", () => {
  const SCRIPT = join(import.meta.dirname, "../../arquitectura/deuda/campos-sin-dato.cjs");
  const correr = (raiz: string, ...argumentos: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...argumentos], { cwd: raiz, encoding: "utf8" });

  it("imprime el resultado línea por línea y sale con su código", () => {
    const ok = correr(arbol(json({ "a.tsx": cuenta(1, 0) })));
    expect([ok.status, ok.stdout]).toEqual([0, `${FIN_OK}\n`]);
    const mal = correr(arbol(json({ "a.tsx": cuenta(0, 0) })));
    expect([mal.status, mal.stdout]).toEqual([
      1,
      `FALLA «a.tsx»: no tiene deuda; sacalo del presupuesto.\n${fin(1)}\n`,
    ]);
  });

  it("pasa sus argumentos (sin node ni el script) y trabaja sobre la carpeta actual", () => {
    const pr = arbol(json({ "a.tsx": cuenta(2, 0) }));
    const sube = arbol(json({ "a.tsx": cuenta(1, 0) }));
    expect(correr(pr, `--base=${sube}`).status).toBe(1);
    expect(correr(pr, `--base=${pr}`).status).toBe(0);
    expect(correr(pr, "--otra").status).toBe(2);
  });

  it("al importarlo como módulo no corre nada (ni imprime ni cambia el código de salida)", () => {
    const hijo = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(SCRIPT)});`], {
      cwd: arbol(null),
      encoding: "utf8",
    });
    expect([hijo.status, hijo.stdout, hijo.stderr]).toEqual([0, "", ""]);
  });
});
