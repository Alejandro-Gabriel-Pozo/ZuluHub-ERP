import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import {
  ARCHIVO_DE_LA_DECLARACION,
  aplicarMigraciones,
  ErrorDeMigracion,
} from "../../src/adaptadores/postgres/migraciones";
import { AUTOR_DE_LA_SINCRONIZACION } from "../../src/adaptadores/postgres/sincronizar-plantillas";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { crearBaseAparte } from "./entorno";

/**
 * Sincronizar plantillas (H4b §6.3, T8) contra una base real: después de aplicar las migraciones, las acciones nuevas que el código declara
 * entran a las plantillas y quedan marcadas; nunca se quita ni se repone lo que la plataforma cambió; repetir no cambia nada; dos
 * ejecutores a la vez dejan UNA sola versión nueva; y una falla no deja estado a medias.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const MIGRACIONES = join(import.meta.dirname, "../../migraciones");
const CON_SINCRONIZACION = { sincronizarPlantillas: true } as const;

const carpetas: string[] = [];
const aparte: Awaited<ReturnType<typeof crearBaseAparte>>[] = [];
const clientes: pg.Client[] = [];

afterEach(async () => {
  for (const c of clientes.splice(0)) await c.end().catch(() => undefined);
  for (const a of aparte.splice(0)) await a.destruir();
  for (const c of carpetas.splice(0)) await rm(c, { recursive: true, force: true });
});

type Declaracion = { formato: number; acciones: Record<string, string[]> };

/** Una carpeta con las migraciones reales y una declaración propia: la real más lo que se agregue. */
async function carpetaCon(extra: Record<string, string[]> = {}, texto?: string): Promise<string> {
  const carpeta = await mkdtemp(join(tmpdir(), "pedernal-sync-"));
  carpetas.push(carpeta);
  for (const nombre of await readdir(MIGRACIONES)) {
    if (/^\d{4}_.*\.sql$/.test(nombre))
      await copyFile(join(MIGRACIONES, nombre), join(carpeta, nombre));
  }
  const real = JSON.parse(
    await readFile(join(MIGRACIONES, ARCHIVO_DE_LA_DECLARACION), "utf8"),
  ) as Declaracion;
  await writeFile(
    join(carpeta, ARCHIVO_DE_LA_DECLARACION),
    texto ?? JSON.stringify({ ...real, acciones: { ...real.acciones, ...extra } }),
  );
  return carpeta;
}

async function baseVacia(): Promise<{ dueno: string; cliente: pg.Client }> {
  const propia = await crearBaseAparte(base as NonNullable<typeof base>, { migrar: false });
  aparte.push(propia);
  const cliente = new pg.Client({ connectionString: propia.base.dueno });
  await cliente.connect();
  clientes.push(cliente);
  return { dueno: propia.base.dueno, cliente };
}

type Version = { clave: string; numero: number; acciones: string[]; autor: string };
const versiones = async (c: pg.Client): Promise<Version[]> =>
  (
    await c.query<Version>(
      "select clave, numero, acciones, autor from version_de_plantilla order by clave, numero",
    )
  ).rows;
const introducidas = async (c: pg.Client): Promise<string[]> =>
  (
    await c.query<{ accion: string }>("select accion from accion_introducida order by accion")
  ).rows.map((f) => f.accion);
const ultima = (vs: Version[], clave: string): Version =>
  vs.filter((v) => v.clave === clave).at(-1) as Version;

const NUEVAS = {
  "prueba.para_todos": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "prueba.solo_admin": ["GERENTE", "ADMINISTRADOR"],
  "prueba.solo_gerente": ["GERENTE"],
};

describe.skipIf(base === null)("sincronizar plantillas (base real)", () => {
  it("con el catálogo de hoy no hay nada que sincronizar: queda la semilla tal cual, y repetir no cambia nada", async () => {
    const { dueno, cliente } = await baseVacia();
    const carpeta = await carpetaCon();
    const primera = await aplicarMigraciones(dueno, carpeta, CON_SINCRONIZACION);
    expect(primera.plantillas).toEqual({
      introducidas: 0,
      accionesIntroducidas: [],
      sinSincronizar: [],
      versiones: [],
    });
    const antes = await versiones(cliente);
    expect(antes.map((v) => [v.clave, v.numero, v.autor])).toEqual([
      ["ADMINISTRADOR", 1, "migracion:0094"],
      ["OPERADOR", 1, "migracion:0094"],
    ]);
    expect(await introducidas(cliente)).toEqual(Object.keys(PERMISOS_DE_EMPRESA).sort());

    const segunda = await aplicarMigraciones(dueno, carpeta, CON_SINCRONIZACION);
    expect(segunda.aplicadas).toEqual([]);
    expect(segunda.plantillas).toEqual({
      introducidas: 0,
      accionesIntroducidas: [],
      sinSincronizar: [],
      versiones: [],
    });
    expect(await versiones(cliente)).toEqual(antes);
  });

  it("una acción nueva entra a las plantillas que el código dice, queda marcada, y la segunda corrida no hace nada", async () => {
    const { dueno, cliente } = await baseVacia();
    await aplicarMigraciones(dueno, await carpetaCon(), CON_SINCRONIZACION);
    const antes = await versiones(cliente);
    const carpeta = await carpetaCon(NUEVAS);

    const r = await aplicarMigraciones(dueno, carpeta, CON_SINCRONIZACION);
    expect(r.plantillas).toEqual({
      introducidas: 2,
      accionesIntroducidas: ["prueba.para_todos", "prueba.solo_admin"],
      // Solo-gerente y sin piso: no se marca (sería delegable por un rol propio); se avisa.
      sinSincronizar: ["prueba.solo_gerente"],
      versiones: [
        {
          clave: "ADMINISTRADOR",
          numero: 2,
          agregadas: ["prueba.para_todos", "prueba.solo_admin"],
        },
        { clave: "OPERADOR", numero: 2, agregadas: ["prueba.para_todos"] },
      ],
    });
    const despues = await versiones(cliente);
    expect(despues).toHaveLength(4);
    const admin = ultima(despues, "ADMINISTRADOR");
    const operador = ultima(despues, "OPERADOR");
    expect(admin.autor).toBe(AUTOR_DE_LA_SINCRONIZACION);
    expect(admin.acciones).toEqual(
      [...ultima(antes, "ADMINISTRADOR").acciones, "prueba.para_todos", "prueba.solo_admin"].sort(),
    );
    expect(operador.acciones).toEqual(
      [...ultima(antes, "OPERADOR").acciones, "prueba.para_todos"].sort(),
    );
    const marcadas = await introducidas(cliente);
    expect(marcadas).toEqual(expect.arrayContaining(["prueba.para_todos", "prueba.solo_admin"]));
    expect(marcadas).not.toContain("prueba.solo_gerente");

    // Repetida: no cambia nada y la solo-gerente sin piso se sigue avisando (hasta que exista su piso).
    const otra = await aplicarMigraciones(dueno, carpeta, CON_SINCRONIZACION);
    expect(otra.plantillas).toEqual({
      introducidas: 0,
      accionesIntroducidas: [],
      sinSincronizar: ["prueba.solo_gerente"],
      versiones: [],
    });
    expect(await versiones(cliente)).toEqual(despues);

    // Con su piso SOLO_GERENTE ya en la base, la acción se marca y deja de avisarse.
    await cliente.query(
      "insert into piso_de_plataforma (accion, tipo, autor) values ('prueba.solo_gerente', 'SOLO_GERENTE', 'plataforma:prueba')",
    );
    const conPiso = await aplicarMigraciones(dueno, carpeta, CON_SINCRONIZACION);
    expect(conPiso.plantillas).toEqual({
      introducidas: 1,
      accionesIntroducidas: ["prueba.solo_gerente"],
      sinSincronizar: [],
      versiones: [],
    });
    expect(await versiones(cliente)).toEqual(despues);
  });

  it("una plantilla editada por la plataforma no se pisa: se le suma lo nuevo y no se le repone lo que se sacó", async () => {
    const { dueno, cliente } = await baseVacia();
    await aplicarMigraciones(dueno, await carpetaCon(), CON_SINCRONIZACION);
    const v1 = ultima(await versiones(cliente), "OPERADOR");
    const sacada = v1.acciones.find(
      (a) => !a.startsWith("permisos.") && !a.startsWith("gerencia."),
    );
    expect(sacada).toBeDefined();
    await cliente.query(
      "insert into version_de_plantilla (clave, numero, acciones, autor) values ('OPERADOR', 2, $1::text[], 'plataforma:prueba')",
      [v1.acciones.filter((a) => a !== sacada)],
    );

    await aplicarMigraciones(dueno, await carpetaCon(NUEVAS), CON_SINCRONIZACION);
    const operador = ultima(await versiones(cliente), "OPERADOR");
    expect(operador.numero).toBe(3);
    expect(operador.acciones).not.toContain(sacada);
    expect(operador.acciones).toContain("prueba.para_todos");
    expect(operador.acciones).toHaveLength(v1.acciones.length - 1 + 1);
  });

  it("el piso gana: una acción reservada al gerente no entra a ninguna plantilla, pero queda marcada", async () => {
    const { dueno, cliente } = await baseVacia();
    await aplicarMigraciones(dueno, await carpetaCon(), CON_SINCRONIZACION);
    await cliente.query(
      "insert into piso_de_plataforma (accion, tipo, autor) values ('prueba.para_todos', 'SOLO_GERENTE', 'plataforma:prueba')",
    );
    const r = await aplicarMigraciones(dueno, await carpetaCon(NUEVAS), CON_SINCRONIZACION);
    expect(r.plantillas?.versiones).toEqual([
      { clave: "ADMINISTRADOR", numero: 2, agregadas: ["prueba.solo_admin"] },
    ]);
    for (const v of await versiones(cliente)) expect(v.acciones).not.toContain("prueba.para_todos");
    expect(await introducidas(cliente)).toContain("prueba.para_todos");
  });

  it("dos ejecutores a la vez dejan UNA sola versión nueva por plantilla", async () => {
    const { dueno, cliente } = await baseVacia();
    await aplicarMigraciones(dueno, await carpetaCon(), CON_SINCRONIZACION);
    const carpeta = await carpetaCon(NUEVAS);
    const corridas = await Promise.all([
      aplicarMigraciones(dueno, carpeta, CON_SINCRONIZACION),
      aplicarMigraciones(dueno, carpeta, CON_SINCRONIZACION),
    ]);
    const conCambios = corridas.filter((c) => (c.plantillas?.versiones.length ?? 0) > 0);
    expect(conCambios).toHaveLength(1);
    expect(corridas.filter((c) => c.plantillas?.introducidas === 0)).toHaveLength(1);
    const vs = await versiones(cliente);
    expect(vs.map((v) => [v.clave, v.numero])).toEqual([
      ["ADMINISTRADOR", 1],
      ["ADMINISTRADOR", 2],
      ["OPERADOR", 1],
      ["OPERADOR", 2],
    ]);
  });

  it("si la base no deja guardar la versión, el migrar falla y no queda nada a medias (ni versión ni marca)", async () => {
    const { dueno, cliente } = await baseVacia();
    await aplicarMigraciones(dueno, await carpetaCon(), CON_SINCRONIZACION);
    const antes = await versiones(cliente);
    const marcasAntes = await introducidas(cliente);
    // Un piso «todos los roles» que ninguna plantilla cumple: el disparador rechaza cualquier versión nueva.
    await cliente.query(
      "insert into piso_de_plataforma (accion, tipo, autor) values ('prueba.exigida', 'TODOS_LOS_ROLES', 'plataforma:prueba')",
    );
    await expect(
      aplicarMigraciones(dueno, await carpetaCon(NUEVAS), CON_SINCRONIZACION),
    ).rejects.toMatchObject({ code: "23514", constraint: "version_de_plantilla_pisos" });
    expect(await versiones(cliente)).toEqual(antes);
    expect(await introducidas(cliente)).toEqual(marcasAntes);
  });

  it("sin pedirla, no sincroniza (el ejecutor de siempre no cambia)", async () => {
    const { dueno, cliente } = await baseVacia();
    await aplicarMigraciones(dueno, await carpetaCon());
    const r = await aplicarMigraciones(dueno, await carpetaCon(NUEVAS));
    expect(r.plantillas).toBeUndefined();
    expect(await versiones(cliente)).toHaveLength(2);
  });

  it("una declaración que falta o no sirve se rechaza con un error claro, sin tocar las plantillas", async () => {
    const { dueno, cliente } = await baseVacia();
    await aplicarMigraciones(dueno, await carpetaCon(), CON_SINCRONIZACION);
    const antes = await versiones(cliente);

    const sin = await carpetaCon();
    await rm(join(sin, ARCHIVO_DE_LA_DECLARACION));
    await expect(aplicarMigraciones(dueno, sin, CON_SINCRONIZACION)).rejects.toThrow(
      new ErrorDeMigracion(`falta ${ARCHIVO_DE_LA_DECLARACION} en la carpeta de migraciones`),
    );
    await expect(
      aplicarMigraciones(dueno, await carpetaCon({}, "{ no es json"), CON_SINCRONIZACION),
    ).rejects.toThrow(`${ARCHIVO_DE_LA_DECLARACION} no sirve: no es JSON`);
    await expect(
      aplicarMigraciones(
        dueno,
        await carpetaCon(
          {},
          JSON.stringify({ formato: 1, acciones: { "MAL.CLAVE": ["GERENTE"] } }),
        ),
        CON_SINCRONIZACION,
      ),
    ).rejects.toThrow("clave inválida: MAL.CLAVE");
    expect(await versiones(cliente)).toEqual(antes);
  });

  it("si las migraciones fallan, la sincronización no corre", async () => {
    const { dueno } = await baseVacia();
    const carpeta = await carpetaCon(NUEVAS);
    await writeFile(join(carpeta, "9999_rota.sql"), "select esto_no_existe();\n");
    await expect(aplicarMigraciones(dueno, carpeta, CON_SINCRONIZACION)).rejects.toThrow();
    const c = new pg.Client({ connectionString: dueno });
    await c.connect();
    clientes.push(c);
    expect(await introducidas(c)).not.toContain("prueba.para_todos");
  });
});
