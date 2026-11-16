import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ESPERA_ENTRE_VERIFICACIONES_EN_MS,
  MIGRACION_REQUERIDA,
  crearGuardaDeMigracion,
  migracionesFaltantes,
} from "./guarda-de-migracion";
import { MIGRACIONES_ESPERADAS } from "./migraciones-esperadas";

const EN_CARPETA = readdirSync(join(import.meta.dirname, "../../migraciones"))
  .filter((nombre) => /^\d{4}_[a-z0-9_]+\.sql$/.test(nombre))
  .sort();

describe("MIGRACIONES_ESPERADAS y MIGRACION_REQUERIDA", () => {
  it("la lista es EXACTAMENTE la carpeta migraciones/ (si se agrega una, se agrega su nombre al final de la lista)", () => {
    expect(EN_CARPETA.length).toBeGreaterThan(0);
    // Si difiere, el mensaje muestra la lista esperada completa para pegarla.
    expect(MIGRACIONES_ESPERADAS, `la lista debe ser:\n${JSON.stringify(EN_CARPETA)}`).toEqual(
      EN_CARPETA,
    );
  });

  it("MIGRACION_REQUERIDA es el número de la última migración de la carpeta", () => {
    expect(MIGRACION_REQUERIDA).toBe(EN_CARPETA.at(-1)?.slice(0, 4));
    expect(MIGRACION_REQUERIDA).toMatch(/^\d{4}$/);
  });

  it("espera diez segundos antes de volver a mirar una base atrasada", () => {
    expect(ESPERA_ENTRE_VERIFICACIONES_EN_MS).toBe(10_000);
  });
});

describe("migracionesFaltantes", () => {
  const esperadas = ["0001_a.sql", "0002_b.sql", "0004_d.sql"];

  it("todas presentes → ninguna falta (los huecos de numeración no cuentan)", () => {
    expect(migracionesFaltantes(esperadas, esperadas)).toEqual([]);
  });

  it("falta la del medio aunque esté la última → la nombra", () => {
    expect(migracionesFaltantes(["0001_a.sql", "0004_d.sql"], esperadas)).toEqual(["0002_b.sql"]);
  });

  it("falta la última", () => {
    expect(migracionesFaltantes(["0001_a.sql", "0002_b.sql"], esperadas)).toEqual(["0004_d.sql"]);
  });

  it("sobra una (de un código más nuevo): no molesta, pero no tapa una que falta", () => {
    expect(migracionesFaltantes([...esperadas, "0005_e.sql"], esperadas)).toEqual([]);
    expect(migracionesFaltantes(["0001_a.sql", "0004_d.sql", "0005_e.sql"], esperadas)).toEqual([
      "0002_b.sql",
    ]);
  });

  it("base vacía → faltan todas, en orden", () => {
    expect(migracionesFaltantes([], esperadas)).toEqual(esperadas);
  });

  it("se compara el nombre completo: otro texto con el mismo número no cuenta", () => {
    expect(migracionesFaltantes(["0001_a.sql", "0002_x.sql", "0004_d.sql"], esperadas)).toEqual([
      "0002_b.sql",
    ]);
    expect(migracionesFaltantes(["0001_a.sql ", "0002_b.sql", "0004_d.sql"], esperadas)).toEqual([
      "0001_a.sql",
    ]);
  });
});

describe("crearGuardaDeMigracion", () => {
  const ESPERADAS = ["0001_base.sql", "0003_otra.sql", "0012_respaldo.sql"];

  function armar(lecturas: (readonly string[] | Error)[], esperadas = ESPERADAS) {
    let reloj = 0;
    const informes: string[] = [];
    const estado = { lecturas: 0 };
    const guarda = crearGuardaDeMigracion({
      leerAplicadas: () => {
        estado.lecturas += 1;
        const r = lecturas.shift();
        if (r instanceof Error) return Promise.reject(r);
        return Promise.resolve(r ?? []);
      },
      ahora: () => reloj,
      alNoEstarAlDia: (detalle) => informes.push(detalle),
      esperadas,
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

  it("P-15: una base sin la última migración → no está al día (mantenimiento)", async () => {
    const g = armar([["0001_base.sql", "0003_otra.sql"]]);
    expect(await g.guarda()).toBe(false);
    expect(g.informes).toEqual([
      "a la base le faltan migraciones (el código necesita hasta la 0012): 0012_respaldo.sql",
    ]);
  });

  it("falta una del medio pero la última está: NO está al día (antes pasaba)", async () => {
    const g = armar([["0001_base.sql", "0012_respaldo.sql"]]);
    expect(await g.guarda()).toBe(false);
    expect(g.informes).toEqual([
      "a la base le faltan migraciones (el código necesita hasta la 0012): 0003_otra.sql",
    ]);
  });

  it("sobra una: con todas las esperadas más una nueva está al día; con una de menos y una de más, no", async () => {
    expect(await armar([[...ESPERADAS, "0013_nueva.sql"]]).guarda()).toBe(true);
    const g = armar([["0001_base.sql", "0012_respaldo.sql", "0013_nueva.sql"]]);
    expect(await g.guarda()).toBe(false);
    expect(g.informes).toHaveLength(1);
  });

  it("sin ninguna migración (base vacía): no está al día y nombra las que faltan", async () => {
    const g = armar([[]]);
    expect(await g.guarda()).toBe(false);
    expect(g.informes).toEqual([
      "a la base le faltan migraciones (el código necesita hasta la 0012): 0001_base.sql, 0003_otra.sql, 0012_respaldo.sql",
    ]);
  });

  it("de muchas faltantes nombra cinco y cuenta el resto", async () => {
    const muchas = Array.from({ length: 8 }, (_, i) => `000${String(i + 1)}_m.sql`);
    const g = armar([[]], muchas);
    expect(await g.guarda()).toBe(false);
    expect(g.informes).toEqual([
      "a la base le faltan migraciones (el código necesita hasta la 0008): 0001_m.sql, 0002_m.sql, 0003_m.sql, 0004_m.sql, 0005_m.sql y 3 más",
    ]);
    const justas = armar([[]], muchas.slice(0, 5));
    await justas.guarda();
    expect(justas.informes[0]).not.toMatch(/ más$/);
  });

  it("con todas las esperadas: al día, sin informes, y no se vuelve a leer nunca más", async () => {
    const g = armar([ESPERADAS, new Error("no debería leerse")]);
    expect(await g.guarda()).toBe(true);
    g.avanzar(10 ** 12);
    expect(await g.guarda()).toBe(true);
    expect(g.estado.lecturas).toBe(1);
    expect(g.informes).toEqual([]);
  });

  it("por defecto usa MIGRACIONES_ESPERADAS", async () => {
    const informes: string[] = [];
    const config = { ahora: () => 0, alNoEstarAlDia: (d: string) => informes.push(d) };
    const todas = crearGuardaDeMigracion({
      ...config,
      leerAplicadas: () => Promise.resolve(MIGRACIONES_ESPERADAS),
    });
    expect(await todas()).toBe(true);
    const sinLaUltima = crearGuardaDeMigracion({
      ...config,
      leerAplicadas: () => Promise.resolve(MIGRACIONES_ESPERADAS.slice(0, -1)),
    });
    expect(await sinLaUltima()).toBe(false);
    expect(informes).toEqual([
      `a la base le faltan migraciones (el código necesita hasta la ${MIGRACION_REQUERIDA}): ${MIGRACIONES_ESPERADAS.at(-1) ?? ""}`,
    ]);
  });

  it.each([
    ["vacía", [], /está vacía/],
    ["con un nombre que no es de migración", ["0001_base.sql", "respaldo"], /no es de migración/],
    ["con un prefijo antes del número", ["x0001_base.sql"], /no es de migración/],
    ["con un nombre con salto de línea", ["0001_base.sql\n"], /no es de migración/],
    ["con repetidas", ["0001_base.sql", "0001_base.sql"], /repetidas o está desordenada/],
    ["desordenada", ["0002_b.sql", "0001_a.sql"], /repetidas o está desordenada/],
    ["desordenada con otra en el medio", ["0001_a.sql", "0003_c.sql", "0002_b.sql"], /desordenada/],
  ])(
    "una lista esperada %s es un defecto del código y lanza al crear la guarda",
    (_, esperadas, mensaje) => {
      expect(() => armar([[]], esperadas)).toThrow(RangeError);
      expect(() => armar([[]], esperadas)).toThrow(mensaje);
    },
  );

  it("una lista esperada válida con un solo nombre sirve", async () => {
    expect(await armar([["0001_a.sql"]], ["0001_a.sql"]).guarda()).toBe(true);
  });

  it("un «no» se vuelve a mirar pasada la espera, y apenas se migra la app vuelve sola", async () => {
    const atrasada = ["0001_base.sql", "0003_otra.sql"];
    const g = armar([atrasada, atrasada, ESPERADAS]);
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
      leerAplicadas: () => {
        lecturas += 1;
        return Promise.resolve(["0001_base.sql"]);
      },
      ahora: () => reloj,
      alNoEstarAlDia: () => undefined,
      esperadas: ESPERADAS,
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
    expect(g.informes).toEqual(["no se pudieron leer las migraciones aplicadas: error 42501"]);
    expect(g.informes.join()).not.toMatch(/secreta|permission/);
  });

  it("de una falla sin código de Postgres informa solo su nombre; de algo que no es un Error, un texto fijo", async () => {
    const sinCodigo = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    const a = armar([sinCodigo]);
    await a.guarda();
    expect(a.informes).toEqual(["no se pudieron leer las migraciones aplicadas: Error"]);
    const b = crearGuardaDeMigracion({
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- justamente se prueba lo que no es un Error
      leerAplicadas: () => Promise.reject("texto crudo con clave"),
      esperadas: ESPERADAS,
      ahora: () => 0,
      alNoEstarAlDia: (d) => informes.push(d),
    });
    const informes: string[] = [];
    await b();
    expect(informes).toEqual([
      "no se pudieron leer las migraciones aplicadas: falla que no es un Error",
    ]);
    const c = armar([Object.assign(new Error("x"), { code: 42501 })]);
    await c.guarda();
    expect(c.informes).toEqual(["no se pudieron leer las migraciones aplicadas: Error"]);
  });

  it("falla cerrado aunque la lectura LANCE de inmediato (sin devolver una promesa) o venga vacía", async () => {
    const informes: string[] = [];
    const lanza = crearGuardaDeMigracion({
      leerAplicadas: () => {
        throw Object.assign(new Error("permission denied for table migracion"), { code: "42501" });
      },
      esperadas: ESPERADAS,
      ahora: () => 0,
      alNoEstarAlDia: (d) => informes.push(d),
    });
    expect(await lanza()).toBe(false);
    expect(informes).toEqual(["no se pudieron leer las migraciones aplicadas: Error 42501"]);
    // Sin ninguna fila de migración (tabla vacía) tampoco es «al día».
    expect(await armar([[]]).guarda()).toBe(false);
  });

  it("sin permiso de lectura no se memoriza ningún «sí»: apenas se otorga, la próxima mirada lo nota", async () => {
    const sinPermiso = Object.assign(new Error("permission denied"), { code: "42501" });
    const g = armar([sinPermiso, sinPermiso, ESPERADAS]);
    expect(await g.guarda()).toBe(false);
    expect(await g.guarda()).toBe(false);
    g.avanzar(ESPERA_ENTRE_VERIFICACIONES_EN_MS);
    expect(await g.guarda()).toBe(false);
    g.avanzar(ESPERA_ENTRE_VERIFICACIONES_EN_MS);
    expect(await g.guarda()).toBe(true);
  });

  it("después de una falla de lectura, vuelve a intentar pasada la espera", async () => {
    const g = armar([new Error("caída"), ESPERADAS]);
    expect(await g.guarda()).toBe(false);
    g.avanzar(ESPERA_ENTRE_VERIFICACIONES_EN_MS);
    expect(await g.guarda()).toBe(true);
  });

  it("los pedidos simultáneos del primer momento hacen una sola lectura", async () => {
    const g = armar([ESPERADAS]);
    expect(await Promise.all([g.guarda(), g.guarda(), g.guarda()])).toEqual([true, true, true]);
    expect(g.estado.lecturas).toBe(1);
  });
});
