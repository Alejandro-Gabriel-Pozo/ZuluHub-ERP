import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Registro de copias entre el dominio y la base (`arquitectura/paridad/copias.json`), paso P0 de la comprobación primitivas ↔ base
 * (`auditoria-de-reglas/primitivas-y-base-comprobacion.md`, §4.2 C1, §5). Una regla que vive dos veces (la tabla de transiciones en TypeScript y el disparador de la base)
 * se desalinea sin que nada falle: caso real, D10 (la base admitía `ABIERTA>ABIERTA` en la sesión de caja y la tabla del dominio no, y la prueba lo escondía con un literal).
 * Este chequeo (estático, sin Postgres) exige que TODA constante `TRANSICIONES_DE_*` esté registrada una vez, que cada entrada apunte a una constante que existe en su archivo
 * y a una prueba de paridad que existe y NOMBRA esa constante; lo que todavía no tiene prueba se declara con el paso que la trae y su cantidad solo baja (`MAXIMO_SIN_PRUEBA`).
 * Fuera de alcance de P0 (siguen en el diseño): C2 (escáner vivo de la base), C3 (correr las pruebas por registro) y los helpers.
 */

const RAIZ = join(__dirname, "../..");
/** Las constantes sin prueba de paridad hoy (ninguna desde P3b: cuenta y ticket). Solo baja. */
const MAXIMO_SIN_PRUEBA = 0;
const PASOS_QUE_LAS_TRAEN = ["P3b"] as const;

type Entrada = Readonly<{
  id: string;
  forma: string;
  constante: string;
  archivo: string;
  prueba?: string;
  mencion?: string;
  sinPrueba?: string;
}>;

const CONSTANTE = /export\s+const\s+(TRANSICIONES_DE_[A-Z0-9_]+)\b/g;

/** Todos los hallazgos de una corrida; vacío si el registro y el código coinciden. */
export function evaluar(
  enElCodigo: readonly Readonly<{ constante: string; archivo: string }>[],
  registro: readonly Entrada[],
  existe: (ruta: string) => boolean,
  contiene: (ruta: string, texto: string) => boolean,
  maximo: number = MAXIMO_SIN_PRUEBA,
): readonly string[] {
  const fallas: string[] = [];
  for (const c of enElCodigo) {
    const veces = registro.filter((e) => e.constante === c.constante).length;
    if (veces === 0) fallas.push(`${c.constante} (${c.archivo}) no está en el registro`);
    if (veces > 1) fallas.push(`${c.constante} está ${veces} veces en el registro`);
  }
  const ids = new Set<string>();
  for (const e of registro) {
    if (ids.has(e.id)) fallas.push(`id repetido: ${e.id}`);
    ids.add(e.id);
    const real = enElCodigo.find((c) => c.constante === e.constante);
    if (real === undefined) fallas.push(`${e.id}: la constante ${e.constante} ya no existe`);
    else if (real.archivo !== e.archivo)
      fallas.push(`${e.id}: ${e.constante} está en ${real.archivo}, no en ${e.archivo}`);
    const tienePrueba = e.prueba !== undefined;
    const tieneDeuda = e.sinPrueba !== undefined;
    if (tienePrueba === tieneDeuda)
      fallas.push(`${e.id}: debe tener o «prueba» o «sinPrueba», no ambas ni ninguna`);
    if (e.prueba !== undefined) {
      if (!existe(e.prueba)) fallas.push(`${e.id}: la prueba ${e.prueba} no existe`);
      else if (!contiene(e.prueba, e.mencion ?? e.constante))
        fallas.push(`${e.id}: ${e.prueba} no nombra «${e.mencion ?? e.constante}»`);
    }
    if (
      e.sinPrueba !== undefined &&
      !(PASOS_QUE_LAS_TRAEN as readonly string[]).includes(e.sinPrueba)
    )
      fallas.push(
        `${e.id}: «sinPrueba» debe ser un paso del plan (${PASOS_QUE_LAS_TRAEN.join(", ")})`,
      );
  }
  const sinPrueba = registro.filter((e) => e.sinPrueba !== undefined).length;
  if (sinPrueba > maximo)
    fallas.push(`hay ${sinPrueba} entradas sin prueba y el máximo es ${maximo}`);
  return fallas;
}

function archivosTs(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === ".next" || nombre.startsWith(".")) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosTs(ruta, salida);
    else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

const registroReal = JSON.parse(
  readFileSync(join(RAIZ, "arquitectura/paridad/copias.json"), "utf8"),
) as Entrada[];
const enElCodigoReal = [join(RAIZ, "src"), join(RAIZ, "apps")]
  .filter((d) => existsSync(d))
  .flatMap((d) => archivosTs(d))
  .flatMap((ruta) =>
    [...readFileSync(ruta, "utf8").matchAll(CONSTANTE)].map((m) => ({
      constante: m[1] as string,
      archivo: relative(RAIZ, ruta).split("\\").join("/"),
    })),
  );

describe("registro de copias dominio ↔ base (P0)", () => {
  it("el registro real coincide con el código: toda tabla de transiciones está registrada, con su prueba o su paso pendiente", () => {
    expect(enElCodigoReal.length).toBeGreaterThanOrEqual(12);
    expect(
      evaluar(
        enElCodigoReal,
        registroReal,
        (r) => existsSync(join(RAIZ, r)),
        (r, t) => readFileSync(join(RAIZ, r), "utf8").includes(t),
      ),
    ).toEqual([]);
  });

  describe("violaciones inyectadas: cada una la detecta el chequeo", () => {
    const uno = { constante: "TRANSICIONES_DE_X", archivo: "src/x.ts" };
    const ok: Entrada = {
      id: "transiciones-de-x",
      forma: "transiciones",
      constante: "TRANSICIONES_DE_X",
      archivo: "src/x.ts",
      prueba: "test/x.test.ts",
    };
    const sinLaPrueba = (e: Entrada): Entrada => ({
      id: e.id,
      forma: e.forma,
      constante: e.constante,
      archivo: e.archivo,
    });
    const corre = (
      codigo: (typeof uno)[],
      registro: Entrada[],
      existe = () => true,
      contiene = () => true,
    ) => evaluar(codigo, registro, existe, contiene, 5);

    it("la línea base no tiene hallazgos", () => {
      expect(corre([uno], [ok])).toEqual([]);
    });
    it("una constante TRANSICIONES_DE_* nueva sin entrada", () => {
      expect(corre([uno], [])).toEqual(["TRANSICIONES_DE_X (src/x.ts) no está en el registro"]);
    });
    it("una entrada cuya prueba no existe", () => {
      expect(corre([uno], [ok], () => false)).toEqual([
        "transiciones-de-x: la prueba test/x.test.ts no existe",
      ]);
    });
    it("una prueba que no nombra la constante (un literal escrito en el test, como D10)", () => {
      expect(
        corre(
          [uno],
          [ok],
          () => true,
          () => false,
        ),
      ).toEqual(["transiciones-de-x: test/x.test.ts no nombra «TRANSICIONES_DE_X»"]);
    });
    it("una entrada de una constante que ya no existe, o que cambió de archivo", () => {
      expect(corre([], [ok])).toEqual([
        "transiciones-de-x: la constante TRANSICIONES_DE_X ya no existe",
      ]);
      expect(corre([{ ...uno, archivo: "src/y.ts" }], [ok])).toEqual([
        "transiciones-de-x: TRANSICIONES_DE_X está en src/y.ts, no en src/x.ts",
      ]);
    });
    it("una entrada sin prueba ni paso, con las dos cosas, o con un paso que no existe", () => {
      const sinNada = sinLaPrueba(ok);
      expect(corre([uno], [sinNada])).toHaveLength(1);
      expect(corre([uno], [{ ...ok, sinPrueba: "P3b" }])).toHaveLength(1);
      expect(corre([uno], [{ ...sinNada, sinPrueba: "P9" }])).toHaveLength(1);
    });
    it("más entradas sin prueba que el máximo, o una repetida", () => {
      const sin = (n: number): Entrada => {
        const r = sinLaPrueba(ok);
        return {
          ...r,
          id: `transiciones-de-${n}`,
          constante: `TRANSICIONES_DE_${n}`,
          archivo: "src/x.ts",
          sinPrueba: "P3b",
        };
      };
      const codigo = [1, 2, 3].map((n) => ({
        constante: `TRANSICIONES_DE_${n}`,
        archivo: "src/x.ts",
      }));
      expect(
        evaluar(
          codigo,
          [1, 2, 3].map(sin),
          () => true,
          () => true,
          2,
        ),
      ).toEqual(["hay 3 entradas sin prueba y el máximo es 2"]);
      // Con el máximo real (cero), una sola entrada sin prueba ya falla.
      expect(
        evaluar(
          [uno],
          [{ ...sin(1), constante: "TRANSICIONES_DE_X", id: "transiciones-de-x" }],
          () => true,
          () => true,
        ),
      ).toEqual([`hay 1 entradas sin prueba y el máximo es ${MAXIMO_SIN_PRUEBA}`]);
      expect(corre([uno], [ok, ok])).toEqual([
        "TRANSICIONES_DE_X está 2 veces en el registro",
        "id repetido: transiciones-de-x",
      ]);
    });
  });
});
