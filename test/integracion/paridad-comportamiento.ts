import { expect } from "vitest";
import type { Consulta } from "./paridad-apoyo";
import { numeroUnico } from "./unicos";

/**
 * Paridad por COMPORTAMIENTO (PR2b de la comprobación primitivas ↔ base): en vez de leer con regex el texto de `pg_get_constraintdef` (cuyo formato puede moverse entre versiones de Postgres), se
 * le PREGUNTA a la base si acepta o rechaza un valor. La restricción se copia tal cual la devuelve Postgres (es SQL válido, no se interpreta) a una tabla temporal que solo tiene las columnas
 * que ella nombra (`conkey`), y se prueba un valor por vez en un savepoint. Previene: que un cambio de formato del texto (otra versión de Postgres) dé un falso verde o un falso rojo en la
 * paridad de topes. Límite: solo ve lo que se le sondea (el borde y el borde ± un paso); una restricción de varias columnas necesita los valores fijos de las otras (`fijos`).
 */

type Columna = Readonly<{ nombre: string; tipo: string; escala: number }>;

const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/;
/** Lo que la base responde al rechazar un valor: viola el CHECK, o no entra en el tipo de la columna (`numeric(p,s)` es también un tope de la base). */
const RECHAZOS = new Set(["23514", "22003"]);

function entre(nombre: string): string {
  if (!IDENTIFICADOR.test(nombre)) throw new Error(`identificador no permitido: ${nombre}`);
  return `"${nombre}"`;
}

/** Las columnas que nombra el CHECK (por `conkey`, no por texto) y su definición tal cual. */
async function columnasYDefinicion(
  c: Consulta,
  tabla: string,
  nombre: string,
): Promise<Readonly<{ columnas: readonly Columna[]; definicion: string }>> {
  const { rows } = await c.query<{
    definicion: string;
    nombre: string;
    tipo: string;
    escala: number;
  }>(
    `select pg_get_constraintdef(k.oid) as definicion, a.attname::text as nombre,
            format_type(a.atttypid, a.atttypmod) as tipo,
            case when a.atttypmod >= 4 and a.atttypid = 'numeric'::regtype then (a.atttypmod - 4) & 65535 else 0 end as escala
       from pg_constraint k
       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
      where k.conname = $1 and k.conrelid = $2::regclass and k.contype = 'c'
      order by a.attnum`,
    [nombre, tabla],
  );
  expect(
    rows.length,
    `el CHECK ${nombre} de ${tabla} tiene que existir y nombrar columnas`,
  ).toBeGreaterThan(0);
  const [primera] = rows;
  return {
    definicion: primera?.definicion ?? "",
    columnas: rows.map((r) => ({ nombre: r.nombre, tipo: r.tipo, escala: Number(r.escala) })),
  };
}

/**
 * ¿La restricción `nombre` de `tabla` acepta cada valor de `columna`? Devuelve, por valor, `true` si lo acepta. `fijos` da el valor (texto) de las otras columnas que el CHECK nombra; si falta
 * alguna, falla. Un error distinto de «viola el CHECK» o «fuera del rango del tipo» se propaga (nunca se toma por un rechazo).
 */
export async function aceptaLaBase(
  c: Consulta,
  tabla: string,
  nombre: string,
  columna: string,
  valores: readonly string[],
  fijos: Readonly<Record<string, string>> = {},
): Promise<readonly boolean[]> {
  const { columnas, definicion } = await columnasYDefinicion(c, tabla, nombre);
  expect(
    columnas.map((x) => x.nombre),
    `${tabla}.${nombre} no nombra la columna ${columna}`,
  ).toContain(columna);
  const otras = columnas.filter((x) => x.nombre !== columna);
  for (const o of otras)
    expect(
      fijos[o.nombre],
      `${tabla}.${nombre} nombra también «${o.nombre}»: pasá su valor en «fijos»`,
    ).toBeDefined();
  const temporal = `paridad_${numeroUnico()}`;
  const definiciones = columnas.map((x) => `${entre(x.nombre)} ${x.tipo}`).join(", ");
  const nombres = columnas.map((x) => entre(x.nombre)).join(", ");
  const resultados: boolean[] = [];
  await c.query("begin", []);
  try {
    await c.query(
      `create temp table ${temporal} (${definiciones}, constraint ${entre(nombre)} ${definicion}) on commit drop`,
      [],
    );
    for (const [i, valor] of valores.entries()) {
      const punto = `p${i}`;
      await c.query(`savepoint ${punto}`, []);
      const parametros = columnas.map((x) => (x.nombre === columna ? valor : fijos[x.nombre]));
      const marcas = columnas.map((x, j) => `$${j + 1}::${x.tipo}`).join(", ");
      try {
        await c.query(`insert into ${temporal} (${nombres}) values (${marcas})`, parametros);
        resultados.push(true);
      } catch (e) {
        if (!RECHAZOS.has((e as { code?: string }).code ?? "")) throw e;
        resultados.push(false);
      }
      await c.query(`rollback to savepoint ${punto}`, []);
    }
  } finally {
    await c.query("rollback", []);
  }
  return resultados;
}

/** Suma `unidades` (cada una, el menor paso de `escala`: 0.01 con escala 2) a un decimal en texto, sin flotantes. */
export function desplazado(valor: string, escala: number, unidades: bigint): string {
  const negativo = valor.startsWith("-");
  const [entera = "0", fraccion = ""] = valor.replace("-", "").split(".");
  const f = fraccion.padEnd(escala, "0").slice(0, escala);
  let total = BigInt(entera + f) * (negativo ? -1n : 1n) + unidades;
  const signo = total < 0n ? "-" : "";
  total = total < 0n ? -total : total;
  const t = total.toString().padStart(escala + 1, "0");
  return escala === 0 ? `${signo}${t}` : `${signo}${t.slice(0, -escala)}.${t.slice(-escala)}`;
}

/**
 * El CHECK acepta exactamente el rango del dominio en `columna`: acepta el máximo y el mínimo, y rechaza uno por encima del máximo y uno por debajo del mínimo (un paso de la escala de la
 * columna). Sin `minimo` o sin `maximo` no se comprueba ese lado.
 */
export async function paridadDeRango(
  c: Consulta,
  tabla: string,
  nombre: string,
  columna: string,
  rango: Readonly<{ minimo?: string; maximo?: string }>,
  fijos: Readonly<Record<string, string>> = {},
): Promise<void> {
  const { columnas } = await columnasYDefinicion(c, tabla, nombre);
  const escala = columnas.find((x) => x.nombre === columna)?.escala ?? 0;
  const sondas: { valor: string; debeAceptar: boolean; que: string }[] = [];
  if (rango.maximo !== undefined) {
    sondas.push({ valor: rango.maximo, debeAceptar: true, que: "el máximo" });
    sondas.push({
      valor: desplazado(rango.maximo, escala, 1n),
      debeAceptar: false,
      que: "el máximo + 1 paso",
    });
  }
  if (rango.minimo !== undefined) {
    sondas.push({ valor: rango.minimo, debeAceptar: true, que: "el mínimo" });
    sondas.push({
      valor: desplazado(rango.minimo, escala, -1n),
      debeAceptar: false,
      que: "el mínimo − 1 paso",
    });
  }
  expect(sondas.length, "paridadDeRango necesita un mínimo o un máximo").toBeGreaterThan(0);
  const r = await aceptaLaBase(
    c,
    tabla,
    nombre,
    columna,
    sondas.map((s) => s.valor),
    fijos,
  );
  const vistas = sondas.map(
    (s, i) => `${s.que} (${s.valor}): la base ${r[i] ? "acepta" : "rechaza"}`,
  );
  expect(r, `${tabla}.${nombre}.${columna}: ${vistas.join("; ")}`).toEqual(
    sondas.map((s) => s.debeAceptar),
  );
}

/** Las sondas de signo y cero de una columna: un paso por debajo de cero, cero y un paso por encima (el paso es el de la escala de la columna). */
export function sondasDeSigno(escala: number): readonly string[] {
  return [desplazado("0", escala, -1n), "0", desplazado("0", escala, 1n)];
}

/**
 * La base acepta y rechaza lo mismo que una función del DOMINIO (`aceptaElDominio`): para cada sonda, el CHECK acepta si y solo si el dominio acepta. Es la comparación de signo y cero (y de
 * cualquier borde que el dominio sepa decidir) sin escribir el valor en la prueba: lo decide el dominio. `sondas` puede depender de la escala de la columna. Si difieren, el mensaje dice
 * qué sondas difieren y de qué lado está cada una.
 */
export async function paridadDeAceptacion(
  c: Consulta,
  tabla: string,
  nombre: string,
  columna: string,
  sondas: readonly string[] | ((escala: number) => readonly string[]),
  aceptaElDominio: (sonda: string) => boolean,
  fijos: Readonly<Record<string, string>> = {},
): Promise<void> {
  const { columnas } = await columnasYDefinicion(c, tabla, nombre);
  const escala = columnas.find((x) => x.nombre === columna)?.escala ?? 0;
  const valores = typeof sondas === "function" ? sondas(escala) : sondas;
  const enLaBase = await aceptaLaBase(c, tabla, nombre, columna, valores, fijos);
  const delDominio = valores.map((v) => aceptaElDominio(v));
  const difieren = valores
    .map((v, i) => ({ v, base: enLaBase[i], dominio: delDominio[i] }))
    .filter((x) => x.base !== x.dominio)
    .map(
      (x) =>
        `${x.v}: base ${x.base ? "acepta" : "rechaza"}, dominio ${x.dominio ? "acepta" : "rechaza"}`,
    );
  expect(difieren, `${tabla}.${nombre}.${columna}`).toEqual([]);
}
