import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import { aceptaLaBase, desplazado } from "./paridad-comportamiento";

/**
 * Los topes de la base que el dominio no tiene como constante (`arquitectura/paridad/sin-constante-en-el-dominio.json`). Para esos topes NO hay con qué comparar, y la prueba no los pega como literal
 * del dominio: los declara con la columna y el valor que hoy impone la base, y esta prueba comprueba POR COMPORTAMIENTO que la base sigue haciendo exactamente eso (acepta un paso por debajo, rechaza
 * el valor). Previene que la declaración se pudra: si la base cambia el tope, falla. La salida es que Código exporte la constante; ahí la entrada se borra y el tope pasa a `paridadDeRango`.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

type Tope = Readonly<{
  tabla: string;
  restriccion: string;
  columna: string;
  rechazaDesde: string;
  nota: string;
}>;
const declarados = JSON.parse(
  readFileSync(
    join(__dirname, "../../arquitectura/paridad/sin-constante-en-el-dominio.json"),
    "utf8",
  ),
) as Readonly<{ vence: string; topes: readonly Tope[] }>;

describe("topes sin constante en el dominio: la declaración", () => {
  it("no está vencida y no repite una restricción", () => {
    expect(new Date().toISOString().slice(0, 10) <= declarados.vence).toBe(true);
    const claves = declarados.topes.map((t) => `${t.tabla}.${t.restriccion}.${t.columna}`);
    expect(new Set(claves).size).toBe(claves.length);
    for (const t of declarados.topes) expect(t.nota.length, t.restriccion).toBeGreaterThan(0);
  });
});

describe.skipIf(base === null)("topes sin constante en el dominio: la base real", () => {
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

  it("la base acepta un paso por debajo de cada tope declarado y lo rechaza en el valor", async () => {
    for (const t of declarados.topes) {
      const debajo = desplazado(t.rechazaDesde, 2, -1n);
      const r = await aceptaLaBase(c, t.tabla, t.restriccion, t.columna, [debajo, t.rechazaDesde]);
      expect(r, `${t.tabla}.${t.restriccion}: debajo ${debajo}, tope ${t.rechazaDesde}`).toEqual([
        true,
        false,
      ]);
    }
  });
});
