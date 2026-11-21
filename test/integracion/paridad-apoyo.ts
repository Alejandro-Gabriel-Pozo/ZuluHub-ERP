import { expect } from "vitest";

/**
 * Helpers comunes de la comprobación primitivas ↔ base (P2 de `auditoria-de-reglas/primitivas-y-base-comprobacion.md`, §4.3). Una regla que vive en el dominio y copiada en un CHECK de la
 * base se compara siempre con la MISMA extracción, que corrige las tres debilidades del patrón anterior: (1) busca la restricción por nombre Y por tabla (`conrelid`): dos tablas con el
 * mismo nombre de CHECK no se confunden; (2) de una lista toma SOLO los literales de la cláusula `IN` (`= ANY (ARRAY[...])` en la definición), no cualquier texto entre comillas; (3) un tope se
 * lee de la comparación de SU columna, no de la primera cifra con `<=`. Previene: que la copia de la base derive de la del dominio sin que nada falle (caso real D7: costo ≥ 0 en la base y > 0 en
 * TypeScript). No acepta literales escritos en la prueba: la lista y el tope salen del dominio, que es quien los pasa.
 */

/** Lo único que se necesita de una conexión: sirve `pg.Client`, `pg.Pool` o el `filas` de un montaje. */
export type Consulta = Readonly<{
  query: <R>(texto: string, parametros: unknown[]) => Promise<{ rows: R[] }>;
}>;

/** La definición del CHECK `nombre` de `tabla` (exactamente una), tal como la devuelve Postgres. */
export async function definicionDeCheck(
  c: Consulta,
  tabla: string,
  nombre: string,
): Promise<string> {
  const { rows } = await c.query<{ def: string }>(
    "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1 and conrelid = $2::regclass and contype = 'c'",
    [nombre, tabla],
  );
  expect(rows, `el CHECK ${nombre} de ${tabla} tiene que existir, una sola vez`).toHaveLength(1);
  return rows[0]?.def ?? "";
}

/** Los literales de la cláusula `IN (...)` de una definición (`= ANY (ARRAY['A'::text, 'B'::text])`), en el orden en que están. Sin cláusula, falla. */
export function literalesDeLaLista(definicion: string): readonly string[] {
  const sacar = (texto: string) =>
    [...texto.matchAll(/'((?:[^']|'')*)'(?:::[a-z ]+)?/g)].map((m) =>
      (m[1] ?? "").replaceAll("''", "'"),
    );
  const arreglos = [...definicion.matchAll(/ARRAY\[([^\]]*)\]/g)];
  // Con UN solo valor Postgres escribe `col = 'X'::text` en vez de `= ANY (ARRAY[...])`.
  const unico = [...definicion.matchAll(/\w+ = ('(?:[^']|'')*'::[a-z ]+)/g)];
  const literales =
    arreglos.length > 0
      ? arreglos.flatMap((a) => sacar(a[1] ?? ""))
      : unico.flatMap((u) => sacar(u[1] ?? ""));
  expect(literales.length, `la definición no tiene una cláusula IN: ${definicion}`).toBeGreaterThan(
    0,
  );
  return literales;
}

/** La lista del dominio es EXACTAMENTE la del CHECK (mismo conjunto, sin repetidos ni faltantes). */
export async function paridadDeLista(
  c: Consulta,
  tabla: string,
  nombre: string,
  lista: readonly string[],
): Promise<void> {
  const enLaBase = literalesDeLaLista(await definicionDeCheck(c, tabla, nombre));
  expect([...enLaBase].sort(), `${tabla}.${nombre}`).toEqual([...lista].sort());
}

/** El tope de una columna, tal como lo dice el CHECK: `columna <= N` (o `<`), con N como texto. `null` si el CHECK no tiene esa comparación. */
export function topeDe(
  definicion: string,
  columna: string,
  operador: "<=" | "<" | ">=" | ">",
): string | null {
  const escapado = columna.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const op = operador.replaceAll(/[<>=]/g, (x) => `\\${x}`);
  const m = new RegExp(`\\(?${escapado}\\)?(?:::[a-z]+)? ${op} \\(?(-?[0-9]+(?:\\.[0-9]+)?)`).exec(
    definicion,
  );
  return m?.[1] ?? null;
}

/** El tope del dominio es exactamente el del CHECK (se comparan como números exactos: `999999999.99` no es `999999999.990000`). */
export async function paridadDeTope(
  c: Consulta,
  tabla: string,
  nombre: string,
  columna: string,
  operador: "<=" | "<" | ">=" | ">",
  deDominio: string | number,
): Promise<void> {
  const def = await definicionDeCheck(c, tabla, nombre);
  const enLaBase = topeDe(def, columna, operador);
  expect(
    enLaBase,
    `${tabla}.${nombre}: no hay «${columna} ${operador} N» en ${def}`,
  ).not.toBeNull();
  expect(decimalNormalizado(enLaBase ?? ""), `${tabla}.${nombre}`).toBe(
    decimalNormalizado(String(deDominio)),
  );
}

function decimalNormalizado(t: string): string {
  const [entera = "0", fraccion = ""] = t.split(".");
  const f = fraccion.replace(/0+$/, "");
  return f === "" ? entera : `${entera}.${f}`;
}

/** Los números de la cláusula `IN (...)` de una definición numérica (`= ANY (ARRAY[20000, 10000])`), en el orden en que están. Sin cláusula, falla. */
export function numerosDeLaLista(definicion: string): readonly number[] {
  const numeros = [...definicion.matchAll(/ARRAY\[([^\]]*)\]/g)].flatMap((a) =>
    [...(a[1] ?? "").matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0])),
  );
  expect(
    numeros.length,
    `la definición no tiene una cláusula IN numérica: ${definicion}`,
  ).toBeGreaterThan(0);
  return numeros;
}

/** La lista numérica del dominio es EXACTAMENTE la del CHECK. */
export async function paridadDeListaNumerica(
  c: Consulta,
  tabla: string,
  nombre: string,
  lista: readonly number[],
): Promise<void> {
  const enLaBase = numerosDeLaLista(await definicionDeCheck(c, tabla, nombre));
  expect(
    [...enLaBase].sort((a, b) => a - b),
    `${tabla}.${nombre}`,
  ).toEqual([...lista].sort((a, b) => a - b));
}
