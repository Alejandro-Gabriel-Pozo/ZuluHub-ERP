import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import {
  definicionDeCheck,
  literalesDeLaLista,
  paridadDeLista,
  paridadDeTope,
  topeDe,
} from "./paridad-apoyo";

/**
 * Los helpers de paridad (P2), contra una base real con tablas de ensayo: lo que aceptan y, sobre todo, lo que rechazan (la lista que difiere, el tope que difiere, dos tablas con el mismo
 * nombre de CHECK, texto entre comillas que no es de la lista).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("helpers de paridad con la base", () => {
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let c: pg.Client;
  beforeAll(async () => {
    aparte = await crearBaseAparte(base as BaseDePruebas, { migrar: false });
    c = new pg.Client({ connectionString: aparte.base.dueno });
    await c.connect();
    await c.query(`
      create table uno (estado text, nota text, importe numeric(18,2),
        constraint x_ck check (estado in ('ABIERTA', 'EN_CIERRE', 'D''ARTAGNAN') and nota <> 'no vale'),
        constraint tope_ck check (importe <= 999999999.99 and importe >= 0));
      create table dos (estado text, constraint x_ck check (estado in ('OTRO')));
    `);
  });
  afterAll(async () => {
    await c.end();
    await aparte.destruir();
  });

  it("la lista del dominio es la del CHECK: acepta la igual (en cualquier orden) y rechaza la que sobra, la que falta o la que cambia", async () => {
    await paridadDeLista(c, "uno", "x_ck", ["D'ARTAGNAN", "ABIERTA", "EN_CIERRE"]);
    await expect(paridadDeLista(c, "uno", "x_ck", ["ABIERTA", "EN_CIERRE"])).rejects.toThrow();
    await expect(
      paridadDeLista(c, "uno", "x_ck", ["ABIERTA", "EN_CIERRE", "D'ARTAGNAN", "CERRADA"]),
    ).rejects.toThrow();
    await expect(
      paridadDeLista(c, "uno", "x_ck", ["ABIERTA", "EN_CIERRE", "D'ARTAGNAN "]),
    ).rejects.toThrow();
  });

  it("toma solo los literales de la cláusula IN: el texto entre comillas de otra comparación («no vale») no cuenta", async () => {
    expect(literalesDeLaLista(await definicionDeCheck(c, "uno", "x_ck"))).toEqual([
      "ABIERTA",
      "EN_CIERRE",
      "D'ARTAGNAN",
    ]);
  });

  it("busca por nombre Y por tabla: dos tablas con el mismo nombre de CHECK no se confunden", async () => {
    await paridadDeLista(c, "dos", "x_ck", ["OTRO"]);
    await expect(paridadDeLista(c, "dos", "x_ck", ["ABIERTA"])).rejects.toThrow();
  });

  it("un CHECK que no existe, o una definición sin lista, es un fallo (no un «sin diferencias»)", async () => {
    await expect(definicionDeCheck(c, "uno", "no_existe_ck")).rejects.toThrow();
    await expect(paridadDeLista(c, "uno", "tope_ck", [])).rejects.toThrow();
  });

  it("el tope de una columna se compara como número exacto: igual con 999999999.99 (aunque se escriba 999999999.990), distinto con otro", async () => {
    await paridadDeTope(c, "uno", "tope_ck", "importe", "<=", "999999999.99");
    await paridadDeTope(c, "uno", "tope_ck", "importe", "<=", "999999999.990");
    await paridadDeTope(c, "uno", "tope_ck", "importe", ">=", 0);
    await expect(
      paridadDeTope(c, "uno", "tope_ck", "importe", "<=", "99999999.99"),
    ).rejects.toThrow();
    await expect(paridadDeTope(c, "uno", "tope_ck", "importe", ">", 0)).rejects.toThrow();
    await expect(paridadDeTope(c, "uno", "tope_ck", "otra_columna", "<=", 1)).rejects.toThrow();
  });

  it("topeDe lee la comparación de SU columna, no la primera cifra", () => {
    expect(topeDe("CHECK (((a >= 1) AND (b <= 5) AND (a <= 9)))", "a", "<=")).toBe("9");
    expect(topeDe("CHECK ((((precio)::numeric > (0)::numeric)))", "precio", ">")).toBe("0");
    expect(topeDe("CHECK ((a >= 1))", "b", ">=")).toBeNull();
  });
});
