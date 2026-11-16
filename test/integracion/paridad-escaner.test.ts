import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";

/**
 * C2 de la comprobación primitivas ↔ base (`auditoria-de-reglas/primitivas-y-base-comprobacion.md`, §4.2): el ESCÁNER VIVO. Recorre la base real (tras todas las migraciones) y toda
 * restricción CHECK de forma lista cerrada (`IN (...)`), numérica (comparación con una cifra) o de texto (regex) debe tener UNA prueba de paridad o estar en la deuda declarada
 * (`arquitectura/paridad/sin-prueba.json`, con vencimiento y una cantidad que solo baja). Previene: una migración que copia una regla del dominio en un CHECK y nadie compara (caso real D7:
 * costo ≥ 0 en la base y > 0 en TypeScript). Sin esto, la copia nueva deriva sin que nada falle.
 *
 * «Tiene prueba» = su nombre figura como texto en una prueba que consulta la definición de las restricciones (`pg_get_constraintdef`) o usa los helpers de `paridad-apoyo.ts`. Es una
 * aproximación (puede dar por cubierta una restricción que esa prueba nombra sin comparar): la corrige quien migre la prueba a los helpers. Las de forma «otra» (relaciones entre columnas,
 * nulos) no copian una regla del dominio y no entran. Las restricciones que NO tienen copia en TypeScript (solo la base) se irán marcando aparte; mientras tanto están en la deuda.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const RAIZ = join(__dirname, "../..");
/** La cantidad de restricciones en deuda: solo baja. */
const MAXIMO_EN_DEUDA = 366;

export type Restriccion = Readonly<{ tabla: string; nombre: string; definicion: string }>;
type Deuda = Readonly<{ vence: string; restricciones: readonly string[] }>;

export function forma(definicion: string): "lista" | "numerica" | "regex" | "otra" {
  if (/ARRAY\[/.test(definicion) || /\w+ = '[^']*'::/.test(definicion)) return "lista";
  if (/ ~ /.test(definicion)) return "regex";
  if (/[<>]=? \(?-?\d/.test(definicion)) return "numerica";
  return "otra";
}

/** Los hallazgos del escáner; vacío si todo está cubierto o declarado. */
export function evaluar(
  restricciones: readonly Restriccion[],
  deuda: Deuda,
  tienePrueba: (nombre: string) => boolean,
  hoy: string,
  maximo: number,
): readonly string[] {
  const fallas: string[] = [];
  const alcanzan = restricciones.filter((r) => forma(r.definicion) !== "otra");
  const clave = (r: Restriccion) => `${r.tabla}.${r.nombre}`;
  const enDeuda = new Set(deuda.restricciones);
  for (const r of alcanzan) {
    if (!tienePrueba(r.nombre) && !enDeuda.has(clave(r)))
      fallas.push(
        `${clave(r)}: restricción nueva (${forma(r.definicion)}) sin prueba de paridad ni deuda declarada`,
      );
  }
  const existentes = new Map(alcanzan.map((r) => [clave(r), r]));
  for (const d of deuda.restricciones) {
    const r = existentes.get(d);
    if (r === undefined)
      fallas.push(`${d}: está en la deuda pero ya no existe (sacala de la lista)`);
    else if (tienePrueba(r.nombre))
      fallas.push(`${d}: ya tiene prueba de paridad (sacala de la deuda)`);
  }
  if (new Set(deuda.restricciones).size !== deuda.restricciones.length)
    fallas.push("la deuda tiene restricciones repetidas");
  if (deuda.restricciones.length > maximo)
    fallas.push(
      `la deuda tiene ${deuda.restricciones.length} restricciones y el máximo es ${maximo}`,
    );
  if (hoy > deuda.vence) fallas.push(`la deuda venció el ${deuda.vence}`);
  return fallas;
}

function archivos(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules") continue;
    const ruta = join(dir, n);
    if (statSync(ruta).isDirectory()) archivos(ruta, salida);
    else if (/\.test\.ts$/.test(n)) salida.push(ruta);
  }
  return salida;
}

/** El texto de las pruebas que comparan definiciones de restricciones. */
function textoDePruebasDeParidad(): string {
  return archivos(join(RAIZ, "test"))
    .concat(archivos(join(RAIZ, "src")))
    .map((f) => readFileSync(f, "utf8"))
    .filter((t) => t.includes("pg_get_constraintdef") || t.includes("paridad-apoyo"))
    .join("\n");
}

describe("escáner de restricciones (C2): la lógica, con violaciones inyectadas", () => {
  const r = (nombre: string, definicion: string): Restriccion => ({
    tabla: "t",
    nombre,
    definicion,
  });
  const lista = r("t_estado_ck", "CHECK ((estado = ANY (ARRAY['A'::text, 'B'::text])))");
  const tope = r("t_tope_ck", "CHECK ((importe <= 999.99))");
  const otra = r("t_rel_ck", "CHECK ((a IS NULL) = (b IS NULL))");
  const deuda = (restricciones: string[], vence = "2027-01-04"): Deuda => ({
    vence,
    restricciones,
  });
  const corre = (rs: Restriccion[], d: Deuda, con: string[] = [], hoy = "2026-11-15", max = 10) =>
    evaluar(rs, d, (n) => con.includes(n), hoy, max);

  it("la línea base: cubierta por prueba, en deuda o de forma «otra» no da hallazgos", () => {
    expect(corre([lista, tope, otra], deuda(["t.t_tope_ck"]), ["t_estado_ck"])).toEqual([]);
  });
  it("una restricción nueva de lista, numérica o de texto sin prueba ni deuda se detecta; una «otra» no", () => {
    expect(corre([lista], deuda([]))).toHaveLength(1);
    expect(corre([tope], deuda([]))).toHaveLength(1);
    expect(corre([r("t_re_ck", "CHECK ((x ~ '^[A-Z]+$'::text))")], deuda([]))).toHaveLength(1);
    expect(corre([otra], deuda([]))).toEqual([]);
  });
  it("la deuda no acumula: una restricción que ya no existe o que ya tiene prueba hay que sacarla", () => {
    expect(corre([], deuda(["t.t_viejo_ck"]))).toHaveLength(1);
    expect(corre([lista], deuda(["t.t_estado_ck"]), ["t_estado_ck"])).toHaveLength(1);
  });
  it("una deuda vencida, repetida o más grande que el máximo se detecta", () => {
    expect(corre([lista], deuda(["t.t_estado_ck"], "2026-01-01"))).toHaveLength(1);
    expect(corre([lista], deuda(["t.t_estado_ck", "t.t_estado_ck"]))).toContain(
      "la deuda tiene restricciones repetidas",
    );
    expect(
      corre([lista, tope], deuda(["t.t_estado_ck", "t.t_tope_ck"]), [], "2026-11-15", 1),
    ).toHaveLength(1);
  });
  it("la forma: un único valor (`= 'X'::text`) cuenta como lista", () => {
    expect(forma("CHECK ((moneda = 'ARS'::text))")).toBe("lista");
    expect(forma("CHECK ((cuotas >= 1) AND (cuotas <= 36))")).toBe("numerica");
  });
});

describe.skipIf(base === null)("escáner de restricciones (C2): la base real", () => {
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let c: pg.Client;
  beforeAll(async () => {
    aparte = await crearBaseAparte(base as BaseDePruebas);
    c = new pg.Client({ connectionString: aparte.base.dueno });
    await c.connect();
  });
  afterAll(async () => {
    await c.end();
    await aparte.destruir();
  });

  it("toda restricción de lista, numérica o de texto tiene prueba de paridad o está en la deuda declarada", async () => {
    const { rows } = await c.query<{ tabla: string; nombre: string; definicion: string }>(
      "select conrelid::regclass::text as tabla, conname as nombre, pg_get_constraintdef(oid) as definicion from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace order by 1, 2",
    );
    expect(rows.length).toBeGreaterThan(600);
    const ruta = join(RAIZ, "arquitectura/paridad/sin-prueba.json");
    expect(existsSync(ruta)).toBe(true);
    const deuda = JSON.parse(readFileSync(ruta, "utf8")) as Deuda;
    const texto = textoDePruebasDeParidad();
    const tiene = (n: string) => texto.includes(`"${n}"`) || texto.includes(`'${n}'`);
    const hoy = new Date().toISOString().slice(0, 10);
    expect(evaluar(rows, deuda, tiene, hoy, MAXIMO_EN_DEUDA)).toEqual([]);
  });
});
