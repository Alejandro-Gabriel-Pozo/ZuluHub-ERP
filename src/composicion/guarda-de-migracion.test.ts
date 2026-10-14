import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ESPERA_ENTRE_VERIFICACIONES_EN_MS,
  MIGRACION_REQUERIDA,
  crearGuardaDeMigracion,
  migracionAlDia,
} from "./guarda-de-migracion";

describe("MIGRACION_REQUERIDA", () => {
  it("es el número de la última migración de migraciones/ (si se agrega una, se sube acá)", () => {
    const numeros = readdirSync(join(import.meta.dirname, "../../migraciones"))
      .map((nombre) => /^(\d{4})_[a-z0-9_]+\.sql$/.exec(nombre)?.[1])
      .filter((numero): numero is string => numero !== undefined)
      .sort();
    expect(numeros.length).toBeGreaterThan(0);
    expect(MIGRACION_REQUERIDA).toBe(numeros[numeros.length - 1]);
  });

  it("tiene la forma de un número de migración", () => {
    expect(MIGRACION_REQUERIDA).toMatch(/^\d{4}$/);
  });

  it("espera diez segundos antes de volver a mirar una base atrasada", () => {
    expect(ESPERA_ENTRE_VERIFICACIONES_EN_MS).toBe(10_000);
  });
});

describe("migracionAlDia", () => {
  it.each([
    ["0012_respaldo.sql", "0012", true],
    ["0013_nueva.sql", "0012", true],
    ["0100_mas_nueva.sql", "0012", true],
    ["0011_lectura_publica_de_marca.sql", "0012", false],
    ["0001_base.sql", "0012", false],
    ["0000_cero.sql", "0001", false],
    ["0001_base.sql", "0001", true],
    ["9999_x.sql", "0012", true],
    [null, "0012", false],
    [null, "0000", false],
  ])("última %j, requerida %s → %s", (ultima, requerida, esperado) => {
    expect(migracionAlDia(ultima, requerida)).toBe(esperado);
  });

  it.each([
    "",
    "respaldo",
    "0012",
    "0012.sql",
    "12_respaldo.sql",
    "00012_respaldo.sql",
    "0012_Respaldo.sql",
    "0012_respaldo.txt",
    "x0012_respaldo.sql",
    "0012_respaldo.sql\n",
    "9999",
  ])("un nombre que no es de una migración (%j) no cuenta como al día", (nombre) => {
    expect(migracionAlDia(nombre, "0001")).toBe(false);
  });

  it.each(["", "12", "00012", "abcd", "0012_x", " 0012", "0012\n", "-001"])(
    "una requerida mal formada (%j) es un defecto y lanza",
    (requerida) => {
      expect(() => migracionAlDia("0012_respaldo.sql", requerida)).toThrow(RangeError);
    },
  );
});

describe("crearGuardaDeMigracion", () => {
  function armar(lecturas: (string | null | Error)[], requerida = "0012") {
    let reloj = 0;
    const informes: string[] = [];
    const estado = { lecturas: 0 };
    const guarda = crearGuardaDeMigracion({
      leerUltima: () => {
        estado.lecturas += 1;
        const r = lecturas.shift();
        if (r instanceof Error) return Promise.reject(r);
        return Promise.resolve(r ?? null);
      },
      ahora: () => reloj,
      alNoEstarAlDia: (detalle) => informes.push(detalle),
      requerida,
    });
    return {
      guarda,
      informes,
      estado,
      avanzar: (ms: number) => {
        reloj += ms;
      },
    };
  }

  it("P-15: una base con una migración menos que la requerida → no está al día (mantenimiento)", async () => {
    const g = armar(["0011_lectura_publica_de_marca.sql"]);
    expect(await g.guarda()).toBe(false);
    expect(g.informes).toEqual([
      "la base está en 0011_lectura_publica_de_marca.sql y el código necesita la 0012",
    ]);
  });

  it("sin ninguna migración: no está al día y lo dice", async () => {
    const g = armar([null]);
    expect(await g.guarda()).toBe(false);
    expect(g.informes).toEqual(["la base está en ninguna migración y el código necesita la 0012"]);
  });

  it("con la requerida: al día, sin informes, y no se vuelve a leer nunca más", async () => {
    const g = armar(["0012_respaldo.sql", new Error("no debería leerse")]);
    expect(await g.guarda()).toBe(true);
    g.avanzar(10 ** 12);
    expect(await g.guarda()).toBe(true);
    expect(g.estado.lecturas).toBe(1);
    expect(g.informes).toEqual([]);
  });

  it("usa la requerida que se le pasa y, por defecto, MIGRACION_REQUERIDA", async () => {
    const con = armar(["0003_x.sql"], "0003");
    expect(await con.guarda()).toBe(true);
    const por = crearGuardaDeMigracion({
      leerUltima: () => Promise.resolve(`${MIGRACION_REQUERIDA}_x.sql`),
      ahora: () => 0,
      alNoEstarAlDia: () => undefined,
    });
    expect(await por()).toBe(true);
    const menos = crearGuardaDeMigracion({
      leerUltima: () => Promise.resolve("0001_base.sql"),
      ahora: () => 0,
      alNoEstarAlDia: () => undefined,
    });
    expect(await menos()).toBe(false);
  });

  it("un «no» se vuelve a mirar pasada la espera, y apenas se migra la app vuelve sola", async () => {
    const g = armar(["0011_a.sql", "0011_a.sql", "0012_respaldo.sql"]);
    expect(await g.guarda()).toBe(false);
    g.avanzar(ESPERA_ENTRE_VERIFICACIONES_EN_MS - 1);
    expect(await g.guarda()).toBe(false);
    expect(g.estado.lecturas).toBe(1);
    g.avanzar(1);
    expect(await g.guarda()).toBe(false);
    expect(g.estado.lecturas).toBe(2);
    g.avanzar(ESPERA_ENTRE_VERIFICACIONES_EN_MS);
    expect(await g.guarda()).toBe(true);
    expect(g.estado.lecturas).toBe(3);
  });

  it("la espera es la que se configura", async () => {
    let reloj = 0;
    let lecturas = 0;
    const guarda = crearGuardaDeMigracion({
      leerUltima: () => {
        lecturas += 1;
        return Promise.resolve("0001_base.sql");
      },
      ahora: () => reloj,
      alNoEstarAlDia: () => undefined,
      esperaEnMs: 500,
    });
    await guarda();
    reloj = 499;
    await guarda();
    expect(lecturas).toBe(1);
    reloj = 500;
    await guarda();
    expect(lecturas).toBe(2);
  });

  it("falla cerrado si no puede leer, e informa solo el tipo de la falla y el código de Postgres", async () => {
    const sinPermiso = Object.assign(
      new Error("permission denied for table migracion; clave=secreta"),
      {
        name: "error",
        code: "42501",
      },
    );
    const g = armar([sinPermiso]);
    expect(await g.guarda()).toBe(false);
    expect(g.informes).toEqual(["no se pudo leer la última migración aplicada: error 42501"]);
    expect(g.informes.join()).not.toMatch(/secreta|permission/);
  });

  it("de una falla sin código de Postgres informa solo su nombre; de algo que no es un Error, un texto fijo", async () => {
    const sinCodigo = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    const a = armar([sinCodigo]);
    await a.guarda();
    expect(a.informes).toEqual(["no se pudo leer la última migración aplicada: Error"]);
    const b = crearGuardaDeMigracion({
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- justamente se prueba lo que no es un Error
      leerUltima: () => Promise.reject("texto crudo con clave"),
      ahora: () => 0,
      alNoEstarAlDia: (d) => informes.push(d),
    });
    const informes: string[] = [];
    await b();
    expect(informes).toEqual([
      "no se pudo leer la última migración aplicada: falla que no es un Error",
    ]);
    const c = armar([Object.assign(new Error("x"), { code: 42501 })]);
    await c.guarda();
    expect(c.informes).toEqual(["no se pudo leer la última migración aplicada: Error"]);
  });

  it("después de una falla de lectura, vuelve a intentar pasada la espera", async () => {
    const g = armar([new Error("caída"), "0012_respaldo.sql"]);
    expect(await g.guarda()).toBe(false);
    g.avanzar(ESPERA_ENTRE_VERIFICACIONES_EN_MS);
    expect(await g.guarda()).toBe(true);
  });

  it("los pedidos simultáneos del primer momento hacen una sola lectura", async () => {
    const g = armar(["0012_respaldo.sql"]);
    expect(await Promise.all([g.guarda(), g.guarda(), g.guarda()])).toEqual([true, true, true]);
    expect(g.estado.lecturas).toBe(1);
  });
});
