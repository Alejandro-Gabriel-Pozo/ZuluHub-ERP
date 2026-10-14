import { randomBytes } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";
import type { RolPorPreparar } from "../../src/adaptadores/postgres/roles-de-la-aplicacion";
import { ejecutarMigracion, VARIABLE_DE_LA_CADENA } from "../../scripts/ejecutar-migracion";
import { crearBaseAparte } from "./entorno";
import {
  crearVercelFalso,
  PROYECTO,
  TOKEN_FALSO,
  type Interceptor,
  type VariableFalsa,
} from "./vercel-falso";

/**
 * `--preparar-roles --vercel <destino>`: el mismo recorrido que `--preparar-roles`, pero las contraseñas
 * se ESCRIBEN en Vercel (un Vercel falso con estado, sin red) en vez de imprimirse. Los roles son
 * propios de cada prueba, como en `migrar-base-roles.test.ts` (los `zuluhub_*` reales son del servidor).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const CARPETA_REAL = join(import.meta.dirname, "../../migraciones");
const entreComillas = (rol: string) => `"${rol.replaceAll('"', '""')}"`;
const VARIABLES = ["ZULUHUB_DB_APP", "ZULUHUB_DB_TRABAJOS", "ZULUHUB_DB_PUBLICO"];

type Salida = { codigo: number; info: string; error: string; secreto: string; todo: string };

type Opciones = {
  falso?: ReturnType<typeof crearVercelFalso>;
  /** Un `fetch` propio en lugar del del Vercel falso (para provocar una excepción que nadie previó). */
  fetch?: typeof fetch;
  entorno?: Record<string, string | undefined>;
  generarClave?: () => string;
  bytesAlAzar?: (cuantos: number) => Uint8Array;
};

describe.skipIf(base === null)("migrar-base --vercel", () => {
  let admin: pg.Client;
  const bases: (() => Promise<void>)[] = [];
  let ROLES: readonly RolPorPreparar[] = [];
  let AUTENTICACION: readonly RolPorPreparar[] = [];

  const nuevaBase = async () => {
    if (base === null) throw new Error("sin base");
    const aparte = await crearBaseAparte(base, { migrar: false });
    bases.push(aparte.destruir);
    return aparte.base.dueno;
  };

  async function correr(cadena: string, argumentos: string[], o: Opciones = {}): Promise<Salida> {
    const falso = o.falso ?? crearVercelFalso();
    const info: string[] = [];
    const error: string[] = [];
    const secreto: string[] = [];
    const codigo = await ejecutarMigracion({
      argumentos: ["--preparar-roles", ...argumentos],
      entorno: {
        [VARIABLE_DE_LA_CADENA]: cadena,
        ZULUHUB_VERCEL_TOKEN: TOKEN_FALSO,
        ...o.entorno,
      },
      carpeta: CARPETA_REAL,
      info: (l) => info.push(l),
      error: (l) => error.push(l),
      secreto: (l) => secreto.push(l),
      roles: (conAutenticacion) => (conAutenticacion ? [...ROLES, ...AUTENTICACION] : ROLES),
      fetch: o.fetch ?? falso.fetch,
      esperarEntreLecturas: () => Promise.resolve(),
      ...(o.generarClave === undefined ? {} : { generarClave: o.generarClave }),
      ...(o.bytesAlAzar === undefined ? {} : { bytesAlAzar: o.bytesAlAzar }),
    });
    return {
      codigo,
      info: info.join("\n"),
      error: error.join("\n"),
      secreto: secreto.join("\n"),
      todo: [...info, ...error, ...secreto].join("\n"),
    };
  }

  const puedeEntrar = async (rol: string) =>
    (
      await admin.query<{ c: boolean }>(
        "SELECT rolcanlogin AS c FROM pg_roles WHERE rolname = $1",
        [rol],
      )
    ).rows[0]?.c === true;

  /** Con esa cadena se entra a la base, y como el rol esperado. */
  async function entraComo(cadena: string, rol: string): Promise<boolean> {
    const cliente = new pg.Client({ connectionString: cadena });
    await cliente.connect();
    try {
      return (await cliente.query<{ u: string }>("SELECT current_user AS u")).rows[0]?.u === rol;
    } finally {
      await cliente.end();
    }
  }

  const valorDe = (falso: ReturnType<typeof crearVercelFalso>, key: string): string =>
    falso.de(key)[0]?.valor ?? "";
  const claveDe = (cadena: string) => decodeURIComponent(new URL(cadena).password);

  beforeAll(async () => {
    if (base === null) return;
    admin = new pg.Client({ connectionString: base.admin });
    await admin.connect();
  });

  beforeEach(async () => {
    if (base === null) return;
    const sufijo = randomBytes(4).toString("hex");
    ROLES = [
      { rol: `zz_${sufijo}_app`, variable: "ZULUHUB_DB_APP" },
      { rol: `zz_${sufijo}_trabajos`, variable: "ZULUHUB_DB_TRABAJOS" },
      { rol: `zz_${sufijo}_publico`, variable: "ZULUHUB_DB_PUBLICO" },
    ];
    AUTENTICACION = [{ rol: `zz_${sufijo}_autenticacion`, variable: "ZULUHUB_DB_AUTENTICACION" }];
    for (const { rol } of [...ROLES, ...AUTENTICACION]) {
      await admin.query(`CREATE ROLE ${entreComillas(rol)} NOLOGIN`);
    }
  });

  afterEach(async () => {
    if (base === null) return;
    for (const destruir of bases.splice(0)) await destruir();
    for (const { rol } of [...ROLES, ...AUTENTICACION]) {
      await admin.query(`DROP ROLE IF EXISTS ${entreComillas(rol)}`);
    }
  });

  afterAll(async () => {
    if (base === null) return;
    await admin.end();
  });

  it("preview: escribe las tres variables sensibles solo en preview, no imprime ninguna contraseña, y con cada una se entra como su rol", async () => {
    const url = await nuevaBase();
    const enProduccion = {
      key: "ZULUHUB_DB_APP",
      type: "sensitive",
      target: ["production"],
      valor: "valor-de-produccion",
    };
    const falso = crearVercelFalso([enProduccion]);
    const salida = await correr(url, ["--vercel", "preview"], { falso });
    expect(salida.error).toBe("");
    expect(salida.codigo).toBe(0);
    expect(salida.secreto).toBe("");
    expect(salida.info).toContain(
      "Se cargará en Vercel: PREVIEW (proyecto zuluhub-erp, equipo alepozod).",
    );
    expect(salida.info).toContain("Hecho (Vercel: PREVIEW):");
    expect(salida.info).toContain(
      "Cargadas en Vercel (PREVIEW, tipo sensible): ZULUHUB_DB_APP, ZULUHUB_DB_TRABAJOS, ZULUHUB_DB_PUBLICO.",
    );
    expect(salida.info).toContain("RESULTADO: OK, la base y Vercel (PREVIEW) quedaron listos.");

    // Pedidos exactos: leer, leer de nuevo ya con el bloqueo, tres escrituras, releer para verificar.
    const ruta = `/v10/projects/${PROYECTO}/env`;
    expect(falso.pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toEqual([
      `GET ${ruta}`,
      `GET ${ruta}`,
      `POST ${ruta}`,
      `POST ${ruta}`,
      `POST ${ruta}`,
      `GET ${ruta}`,
    ]);
    for (const [i, { rol, variable }] of ROLES.entries()) {
      const p = falso.pedidos[2 + i];
      expect(p?.consulta).toEqual({ upsert: "true", slug: "alepozod" });
      expect(p?.encabezados).toEqual({
        Authorization: `Bearer ${TOKEN_FALSO}`,
        "Content-Type": "application/json",
      });
      expect(p?.cuerpo).toMatchObject({ key: variable, type: "sensitive", target: ["preview"] });
      const guardada = falso.de(variable).find((v) => v.target.includes("preview"));
      expect(guardada?.type).toBe("sensitive");
      expect(guardada?.target).toEqual(["preview"]);
      expect(await puedeEntrar(rol)).toBe(true);
      expect(await entraComo(guardada?.valor ?? "", rol)).toBe(true);
      // Ni la cadena ni la contraseña salieron por ningún canal.
      expect(salida.todo).not.toContain(claveDe(guardada?.valor ?? ""));
      expect(salida.todo).not.toContain(guardada?.valor ?? "");
    }
    // El token solo viaja en el encabezado.
    expect(salida.todo).not.toContain(TOKEN_FALSO);
    for (const p of falso.pedidos) {
      expect(JSON.stringify(p.cuerpo ?? "")).not.toContain(TOKEN_FALSO);
      expect(JSON.stringify(p.consulta)).not.toContain(TOKEN_FALSO);
    }
    // Producción no se tocó.
    const prod = falso.de("ZULUHUB_DB_APP").find((v) => v.target.includes("production"));
    expect(prod).toMatchObject({ valor: "valor-de-produccion", target: ["production"] });
  });

  it("production: sin --confirmo production se niega antes de tocar nada; con él, escribe solo en production y lo repite", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso();
    const sin = await correr(url, ["--vercel", "production"], { falso });
    expect(sin.codigo).toBe(2);
    expect(sin.error).toContain("--confirmo production");
    expect(falso.pedidos).toEqual([]);
    expect(await puedeEntrar(ROLES[0]?.rol as string)).toBe(false);

    const con = await correr(url, ["--vercel", "production", "--confirmo", "production"], {
      falso,
    });
    expect(con.error).toBe("");
    expect(con.codigo).toBe(0);
    expect(con.info).toContain("Se cargará en Vercel: PRODUCTION");
    expect(con.info).toContain("Hecho (Vercel: PRODUCTION):");
    for (const key of VARIABLES) {
      expect(falso.de(key)).toHaveLength(1);
      expect(falso.de(key)[0]?.target).toEqual(["production"]);
    }
    for (const p of falso.escrituras()) {
      expect(p.cuerpo).toMatchObject({ target: ["production"] });
    }
  });

  it.each([
    ["una confirmación de otro destino", ["--vercel", "production", "--confirmo", "preview"]],
    ["una confirmación sobrante en preview", ["--vercel", "preview", "--confirmo", "production"]],
    [
      "una confirmación sobrante en preview, igual",
      ["--vercel", "preview", "--confirmo", "preview"],
    ],
    ["--confirmo sin --vercel", ["--confirmo", "production"]],
    ["--secretos sin --vercel", ["--secretos"]],
    ["--vercel sin valor", ["--vercel"]],
    ["--vercel con otra bandera como valor", ["--vercel", "--rotar"]],
    ["un destino que no existe", ["--vercel", "development"]],
    ["un destino en mayúscula", ["--vercel", "PRODUCTION", "--confirmo", "PRODUCTION"]],
    ["--vercel repetido", ["--vercel", "preview", "--vercel", "preview"]],
    ["--confirmo sin valor", ["--vercel", "production", "--confirmo"]],
  ])(
    "banderas mal combinadas (%s): uso incorrecto, sin tocar la base ni Vercel",
    async (_n, args) => {
      const url = await nuevaBase();
      const falso = crearVercelFalso();
      const salida = await correr(url, args, { falso });
      expect(salida.codigo).toBe(2);
      expect(falso.pedidos).toEqual([]);
      expect(await puedeEntrar(ROLES[0]?.rol as string)).toBe(false);
    },
  );

  it("--vercel solo vale con --preparar-roles", async () => {
    const falso = crearVercelFalso();
    const codigo = await ejecutarMigracion({
      argumentos: ["--aplicar", "--vercel", "preview"],
      entorno: {
        [VARIABLE_DE_LA_CADENA]: "postgresql://u:c@h/b",
        ZULUHUB_VERCEL_TOKEN: TOKEN_FALSO,
      },
      carpeta: CARPETA_REAL,
      info: () => undefined,
      error: () => undefined,
      secreto: () => undefined,
      fetch: falso.fetch,
    });
    expect(codigo).toBe(2);
    expect(falso.pedidos).toEqual([]);
  });

  it("se niega a correr en GitHub Actions aunque se pida Vercel, y no hace ningún pedido", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso();
    const salida = await correr(url, ["--vercel", "preview"], {
      falso,
      entorno: { GITHUB_ACTIONS: "true" },
    });
    expect(salida.codigo).toBe(2);
    expect(salida.error).toContain("no se corre en GitHub Actions");
    expect(falso.pedidos).toEqual([]);
    expect(await puedeEntrar(ROLES[0]?.rol as string)).toBe(false);
  });

  it("sin token explica cómo crearlo y no toca la base ni Vercel", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso();
    const salida = await correr(url, ["--vercel", "preview"], {
      falso,
      entorno: { ZULUHUB_VERCEL_TOKEN: undefined },
    });
    expect(salida.codigo).toBe(1);
    expect(salida.error).toContain("falta la variable ZULUHUB_VERCEL_TOKEN");
    expect(salida.error).toContain("vercel.com");
    expect(salida.error).toContain("Settings");
    expect(salida.error).toContain("Tokens");
    expect(salida.error).toContain("alepozod");
    expect(salida.error).toContain("vencimiento corto");
    expect(falso.pedidos).toEqual([]);
    expect(await puedeEntrar(ROLES[0]?.rol as string)).toBe(false);
    const vacio = await correr(url, ["--vercel", "preview"], {
      falso,
      entorno: { ZULUHUB_VERCEL_TOKEN: "  " },
    });
    expect(vacio.codigo).toBe(1);
    expect(falso.pedidos).toEqual([]);
  });

  it("un token con espacios o saltos de línea se rechaza sin repetirlo", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso();
    const salida = await correr(url, ["--vercel", "preview"], {
      falso,
      entorno: { ZULUHUB_VERCEL_TOKEN: "vcp_parte1 parte2" },
    });
    expect(salida.codigo).toBe(1);
    expect(salida.error).toContain("ZULUHUB_VERCEL_TOKEN tiene espacios");
    expect(salida.todo).not.toContain("parte1");
    expect(falso.pedidos).toEqual([]);
  });

  it("un token que Vercel rechaza corta ANTES de migrar o cambiar contraseñas, y no se repite en pantalla", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso();
    const salida = await correr(url, ["--vercel", "preview"], {
      falso,
      entorno: { ZULUHUB_VERCEL_TOKEN: "vcp_TokenQueNoSirve999" },
    });
    expect(salida.codigo).toBe(1);
    expect(salida.error).toContain("no se pudo leer el proyecto de Vercel");
    expect(salida.error).toContain("el token no sirve o no tiene permiso");
    expect(salida.error).toContain("no se cambió nada");
    expect(salida.todo).not.toContain("vcp_TokenQueNoSirve999");
    expect(falso.pedidos).toHaveLength(1);
    expect(salida.info).not.toContain("Aplicadas ahora");
    for (const { rol } of ROLES) expect(await puedeEntrar(rol)).toBe(false);
  });

  it("borra de preview lo prohibido y la cadena de dueño, dice solo sus nombres, y no toca production", async () => {
    const url = await nuevaBase();
    const plena = (
      key: string,
      target: string[],
      type = "encrypted",
    ): Omit<VariableFalsa, "id"> => ({
      key,
      type,
      target,
      valor: `secreto-de-${key}`,
    });
    const falso = crearVercelFalso([
      plena("DATABASE_URL", ["preview"]),
      plena("DATABASE_URL", ["production"]),
      plena("DATABASE_URL_UNPOOLED", ["preview"]),
      plena("BETTER_AUTH_SECRET", ["preview"]),
      plena("BETTER_AUTH_URL", ["preview"]),
      plena("BETTER_AUTH_TELEMETRY", ["preview"]),
      plena("POSTGRES_URL", ["preview"]),
      plena("POSTGRES_PRISMA_URL", ["preview"]),
      plena("POSTGRES_USER", ["preview", "production"]),
      plena("ZULUHUB_DB_MIGRACIONES", ["preview"], "plain"),
      plena("ZULUHUB_DB_MIGRACIONES", ["production"], "plain"),
      plena("OTRA_QUE_SE_QUEDA", ["preview"], "plain"),
    ]);
    const salida = await correr(url, ["--vercel", "preview"], { falso });
    expect(salida.error).toBe("");
    expect(salida.codigo).toBe(0);
    expect(salida.info).toContain(
      "Borradas de Vercel (PREVIEW) por estar prohibidas: DATABASE_URL, DATABASE_URL_UNPOOLED, BETTER_AUTH_SECRET, BETTER_AUTH_URL, BETTER_AUTH_TELEMETRY, POSTGRES_URL, POSTGRES_PRISMA_URL, ZULUHUB_DB_MIGRACIONES.",
    );
    expect(salida.info).toContain("se les quitó PREVIEW");
    expect(salida.info).toContain("POSTGRES_USER");
    expect(salida.todo).not.toContain("secreto-de-");
    const enPreview = [...falso.variables.values()].filter((v) => v.target.includes("preview"));
    expect(enPreview.map((v) => v.key).sort()).toEqual([...VARIABLES, "OTRA_QUE_SE_QUEDA"].sort());
    // Production, intacta: las prohibidas de production siguen ahí (otro comando las limpia).
    expect(falso.de("DATABASE_URL").map((v) => v.target)).toEqual([["production"]]);
    expect(falso.de("ZULUHUB_DB_MIGRACIONES").map((v) => v.target)).toEqual([["production"]]);
    expect(falso.de("POSTGRES_USER").map((v) => v.target)).toEqual([["production"]]);
    expect(falso.de("OTRA_QUE_SE_QUEDA")).toHaveLength(1);
  });

  it("production: borra lo prohibido (incluida ZULUHUB_DB_MIGRACIONES) de production y deja preview como estaba", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso([
      {
        key: "ZULUHUB_DB_MIGRACIONES",
        type: "encrypted",
        target: ["production"],
        valor: "dueno-prod",
      },
      {
        key: "ZULUHUB_DB_MIGRACIONES",
        type: "encrypted",
        target: ["preview"],
        valor: "dueno-prev",
      },
      { key: "DATABASE_URL", type: "plain", target: ["preview"], valor: "x" },
    ]);
    const salida = await correr(url, ["--vercel", "production", "--confirmo", "production"], {
      falso,
    });
    expect(salida.codigo).toBe(0);
    expect(salida.info).toContain(
      "Borradas de Vercel (PRODUCTION) por estar prohibidas: ZULUHUB_DB_MIGRACIONES.",
    );
    expect(falso.de("ZULUHUB_DB_MIGRACIONES").map((v) => v.valor)).toEqual(["dueno-prev"]);
    expect(falso.de("DATABASE_URL")).toHaveLength(1);
  });

  it("libera una variable compartida o no sensible antes de escribir: queda una sola, sensible, solo para el destino", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso([
      {
        key: "ZULUHUB_DB_APP",
        type: "encrypted",
        target: ["production", "preview"],
        valor: "vieja",
      },
      { key: "ZULUHUB_DB_TRABAJOS", type: "plain", target: ["preview"], valor: "vieja" },
    ]);
    const salida = await correr(url, ["--vercel", "preview"], { falso });
    expect(salida.error).toBe("");
    expect(salida.codigo).toBe(0);
    const app = falso.de("ZULUHUB_DB_APP");
    expect(app.map((v) => [v.type, v.target])).toEqual([
      ["encrypted", ["production"]],
      ["sensitive", ["preview"]],
    ]);
    expect(app[0]?.valor).toBe("vieja");
    expect(falso.de("ZULUHUB_DB_TRABAJOS").map((v) => [v.type, v.target])).toEqual([
      ["sensitive", ["preview"]],
    ]);
  });

  it("repetir no duplica nada ni cambia contraseñas: la segunda corrida solo informa", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso();
    await correr(url, ["--vercel", "preview"], { falso });
    const antes = falso.foto();
    const escriturasAntes = falso.escrituras().length;
    const segunda = await correr(url, ["--vercel", "preview"], { falso });
    expect(segunda.error).toBe("");
    expect(segunda.codigo).toBe(0);
    expect(segunda.secreto).toBe("");
    expect(segunda.info).toContain(
      "Ya estaban cargadas en Vercel (PREVIEW): ZULUHUB_DB_APP, ZULUHUB_DB_TRABAJOS, ZULUHUB_DB_PUBLICO.",
    );
    expect(falso.escrituras()).toHaveLength(escriturasAntes);
    expect(falso.foto()).toBe(antes);
    for (const key of VARIABLES) expect(falso.de(key)).toHaveLength(1);
  });

  it("con --rotar y repetido, cada variable sigue siendo una sola y con la contraseña vigente", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso();
    await correr(url, ["--vercel", "preview"], { falso });
    const vieja = valorDe(falso, "ZULUHUB_DB_APP");
    for (let i = 0; i < 2; i++) {
      const r = await correr(url, ["--vercel", "preview", "--rotar"], { falso });
      expect(r.codigo).toBe(0);
      expect(r.secreto).toBe("");
    }
    for (const { rol, variable } of ROLES) {
      expect(falso.de(variable)).toHaveLength(1);
      expect(await entraComo(valorDe(falso, variable), rol)).toBe(true);
    }
    expect(valorDe(falso, "ZULUHUB_DB_APP")).not.toBe(vieja);
    // La contraseña anterior deja de servir. Se comprueba solo si el servidor exige contraseña: el CI levanta
    // Postgres con `trust` (acepta cualquiera) y ahí no se puede distinguir una clave buena de una mala.
    const exigeClave = await entraComo(
      valorDe(falso, "ZULUHUB_DB_APP").replace(/:[^:@]*@/, ":clave-equivocada@"),
      ROLES[0]?.rol as string,
    ).then(
      () => false,
      () => true,
    );
    if (exigeClave) await expect(entraComo(vieja, ROLES[0]?.rol as string)).rejects.toThrow();
  });

  it("un rol que ya tenía LOGIN y cuya variable no está en Vercel pide --rotar y no inventa nada", async () => {
    const url = await nuevaBase();
    await correr(url, ["--vercel", "preview"], { falso: crearVercelFalso() });
    const vacio = crearVercelFalso();
    const salida = await correr(url, ["--vercel", "preview"], { falso: vacio });
    expect(salida.codigo).toBe(1);
    expect(salida.error).toContain("No hecho:");
    expect(salida.error).toContain("ZULUHUB_DB_APP: el rol ya tenía contraseña");
    expect(salida.error).toContain("--rotar");
    expect(salida.error).toContain("RESULTADO: FALLA");
    expect(salida.secreto).toBe("");
    expect(vacio.escrituras()).toEqual([]);
    // Con --rotar queda resuelto.
    const resuelto = await correr(url, ["--vercel", "preview", "--rotar"], { falso: vacio });
    expect(resuelto.codigo).toBe(0);
    expect(vacio.variables.size).toBe(3);
  });

  it("--secretos genera y carga los dos secretos (con la forma que exige la aplicación), y avisa que invalidan lo anterior", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso();
    const salida = await correr(url, ["--vercel", "preview", "--secretos"], { falso });
    expect(salida.error).toBe("");
    expect(salida.codigo).toBe(0);
    const clave = falso.de("ZULUHUB_CLAVE_CONTEXTO").map((v) => ({ ...v }));
    const secreto = falso.de("ZULUHUB_SECRETO_INVITACIONES").map((v) => ({ ...v }));
    expect(clave).toHaveLength(1);
    expect(secreto).toHaveLength(1);
    expect(clave[0]?.valor).toMatch(/^1:[0-9a-f]{64}$/);
    expect(secreto[0]?.valor).toMatch(/^[0-9a-f]{64}$/);
    expect(clave[0]).toMatchObject({ type: "sensitive", target: ["preview"] });
    expect(secreto[0]).toMatchObject({ type: "sensitive", target: ["preview"] });
    expect(salida.info).toContain(
      "Secretos nuevos generados y cargados en Vercel (PREVIEW): ZULUHUB_CLAVE_CONTEXTO, ZULUHUB_SECRETO_INVITACIONES.",
    );
    expect(salida.info).toContain("las sesiones y las invitaciones emitidas antes dejan de valer");
    expect(salida.todo).not.toContain(clave[0]?.valor.slice(2));
    expect(salida.todo).not.toContain(secreto[0]?.valor);
    // Sin la bandera, los secretos no se tocan; con ella otra vez, se reemplazan (siguen siendo uno solo).
    const sinBandera = await correr(url, ["--vercel", "preview"], { falso });
    expect(sinBandera.codigo).toBe(0);
    expect(falso.de("ZULUHUB_CLAVE_CONTEXTO")[0]?.valor).toBe(clave[0]?.valor);
    const otra = await correr(url, ["--vercel", "preview", "--secretos"], { falso });
    expect(otra.codigo).toBe(0);
    expect(falso.de("ZULUHUB_CLAVE_CONTEXTO")).toHaveLength(1);
    expect(falso.de("ZULUHUB_CLAVE_CONTEXTO")[0]?.valor).not.toBe(clave[0]?.valor);
    expect(falso.de("ZULUHUB_SECRETO_INVITACIONES")[0]?.valor).not.toBe(secreto[0]?.valor);
  });

  it("--secretos usa los bytes que se le den (32 por secreto)", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso();
    const pedidos: number[] = [];
    await correr(url, ["--vercel", "preview", "--secretos"], {
      falso,
      bytesAlAzar: (cuantos) => {
        pedidos.push(cuantos);
        return new Uint8Array(cuantos).fill(0x5a);
      },
    });
    expect(pedidos).toEqual([32, 32]);
    expect(valorDe(falso, "ZULUHUB_CLAVE_CONTEXTO")).toBe(`1:${"5a".repeat(32)}`);
  });

  it("--con-autenticacion también carga esos roles y avisa que el nombre es provisorio", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso();
    const salida = await correr(url, ["--vercel", "preview", "--con-autenticacion"], { falso });
    expect(salida.codigo).toBe(0);
    expect(falso.de("ZULUHUB_DB_AUTENTICACION")).toHaveLength(1);
    expect(salida.info).toContain("Aviso: ZULUHUB_DB_AUTENTICACION es un nombre provisorio");
    expect(salida.info).not.toContain("Aviso: ZULUHUB_DB_APP");
  });

  it("si Vercel falla a la mitad, las contraseñas que no llegaron se imprimen igual, las que sí llegaron no, y el token no aparece", async () => {
    const url = await nuevaBase();
    let enviado = "";
    let caido = true;
    const interceptor: Interceptor = (p) => {
      if (
        caido &&
        p.metodo === "POST" &&
        (p.cuerpo as { key: string }).key === "ZULUHUB_DB_TRABAJOS"
      ) {
        enviado = (p.cuerpo as { value: string }).value;
        return new Response(
          JSON.stringify({
            error: { code: "internal", message: `caída. Bearer ${TOKEN_FALSO} valor ${enviado}` },
          }),
          { status: 500 },
        );
      }
      return undefined;
    };
    const falso = crearVercelFalso([], interceptor);
    const salida = await correr(url, ["--vercel", "preview"], { falso });
    expect(salida.codigo).toBe(1);
    expect(falso.de("ZULUHUB_DB_APP")).toHaveLength(1);
    expect(falso.de("ZULUHUB_DB_TRABAJOS")).toHaveLength(0);
    // El bloque trae exactamente las dos que no se cargaron; con esas contraseñas se entra.
    const lineas = salida.secreto.split("\n").filter((l) => /^ZULUHUB_DB_[A-Z]+=/.test(l));
    expect(lineas.map((l) => l.split("=")[0])).toEqual([
      "ZULUHUB_DB_TRABAJOS",
      "ZULUHUB_DB_PUBLICO",
    ]);
    expect(lineas[0]?.slice("ZULUHUB_DB_TRABAJOS=".length)).toBe(enviado);
    for (const [linea, { rol }] of [
      [lineas[0], ROLES[1] as RolPorPreparar],
      [lineas[1], ROLES[2] as RolPorPreparar],
    ] as const) {
      expect(await entraComo((linea as string).split("=").slice(1).join("="), rol)).toBe(true);
    }
    expect(salida.error).toContain("No hecho:");
    expect(salida.error).toContain("No se pudo escribir ZULUHUB_DB_TRABAJOS en Vercel");
    expect(salida.error).toContain("Vercel respondió 500");
    expect(salida.error).toContain("Lo que seguía no se intentó");
    expect(salida.error).toContain("YA están cambiadas en la base");
    expect(salida.error).toContain("--rotar");
    expect(salida.error).toContain(
      "Sin cargar en Vercel: ZULUHUB_DB_TRABAJOS, ZULUHUB_DB_PUBLICO.",
    );
    expect(salida.error).toContain("RESULTADO: FALLA");
    // Ni el token ni las contraseñas, fuera del bloque.
    const fuera = salida.info + salida.error;
    expect(fuera).not.toContain(TOKEN_FALSO);
    expect(fuera).not.toContain(claveDe(enviado));
    expect(fuera).not.toContain(enviado);
    expect(salida.secreto).not.toContain(TOKEN_FALSO);
    // Se hizo un solo intento por escritura (no se reintenta sola).
    expect(
      falso.escrituras().filter((p) => (p.cuerpo as { key: string }).key === "ZULUHUB_DB_TRABAJOS"),
    ).toHaveLength(1);
    // Repetir con --rotar, ya sin la caída, completa lo que faltó sin duplicar nada.
    caido = false;
    const resuelto = await correr(url, ["--vercel", "preview", "--rotar"], { falso });
    for (const { variable } of ROLES) expect(falso.de(variable)).toHaveLength(1);
    expect(resuelto.codigo).toBe(0);
  });

  it("si Vercel rechaza la primera escritura, las tres contraseñas se imprimen", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso([], (p) =>
      p.metodo === "POST"
        ? new Response(JSON.stringify({ error: { code: "forbidden", message: "sin permiso" } }), {
            status: 403,
          })
        : undefined,
    );
    const salida = await correr(url, ["--vercel", "preview"], { falso });
    expect(salida.codigo).toBe(1);
    const lineas = salida.secreto.split("\n").filter((l) => /^ZULUHUB_DB_[A-Z]+=/.test(l));
    expect(lineas.map((l) => l.split("=")[0])).toEqual(VARIABLES);
    expect(salida.error).toContain("el token no sirve o no tiene permiso");
    expect(salida.error).not.toContain("No se sabe si Vercel llegó a aplicar");
    expect(salida.todo.replace(salida.secreto, "")).not.toContain(TOKEN_FALSO);
  });

  it("una escritura cuyo resultado no se conoce (la red se corta) no se da por hecha: se imprime la contraseña y se avisa", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso([], (p) =>
      p.metodo === "POST" ? new Error(`socket cortado, Bearer ${TOKEN_FALSO}`) : undefined,
    );
    const salida = await correr(url, ["--vercel", "preview"], { falso });
    expect(salida.codigo).toBe(1);
    expect(salida.error).toContain("no se pudo hablar con Vercel (falla de red)");
    expect(salida.error).toContain(
      "No se sabe si Vercel llegó a aplicar ese paso: repetir es seguro.",
    );
    expect(salida.secreto.split("\n").filter((l) => /^ZULUHUB_DB_[A-Z]+=/.test(l))).toHaveLength(3);
    expect(salida.info + salida.error).not.toContain(TOKEN_FALSO);
    expect(falso.escrituras()).toHaveLength(1);
  });

  it("una excepción que nadie previó en la carga no pierde las contraseñas: se imprimen y el error no trae el token", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso();
    const salida = await correr(url, ["--vercel", "preview"], {
      falso,
      // Un `fetch` que contesta algo que no es una respuesta: el cliente no lo espera y la excepción se escapa.
      fetch: ((direccion: string, init?: RequestInit) =>
        init?.method === "POST"
          ? Promise.resolve(undefined)
          : falso.fetch(direccion, init)) as unknown as typeof fetch,
    });
    expect(salida.codigo).toBe(1);
    expect(salida.error).toContain("Se cortó la carga en Vercel antes de terminar");
    expect(salida.error).toContain("RESULTADO: FALLA");
    expect(salida.secreto.split("\n").filter((l) => /^ZULUHUB_DB_[A-Z]+=/.test(l))).toHaveLength(3);
    for (const [i, { rol }] of ROLES.entries()) {
      const linea = salida.secreto.split("\n").filter((l) => /^ZULUHUB_DB_[A-Z]+=/.test(l))[i];
      expect(await entraComo((linea as string).split("=").slice(1).join("="), rol)).toBe(true);
    }
    expect(salida.info + salida.error).not.toContain(TOKEN_FALSO);
  });

  it("si Vercel no deja releer lo cargado, lo dice y no imprime contraseñas (las escrituras sí se confirmaron)", async () => {
    const url = await nuevaBase();
    let lecturas = 0;
    const falso = crearVercelFalso([], (p) => {
      if (p.metodo !== "GET") return undefined;
      lecturas += 1;
      return lecturas >= 3 ? new Response("{}", { status: 503 }) : undefined;
    });
    const salida = await correr(url, ["--vercel", "preview"], { falso });
    expect(salida.codigo).toBe(1);
    expect(salida.error).toContain("No se pudo volver a leer el proyecto de Vercel para verificar");
    expect(salida.secreto).toBe("");
    expect(falso.variables.size).toBe(3);
  });

  it("si lo que Vercel guardó no es lo pedido (no sensible), la verificación lo detecta e imprime la contraseña", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso([], (p) => {
      if (p.metodo === "POST") {
        const c = p.cuerpo as { key: string; value: string; target: string[] };
        return new Response(JSON.stringify({ created: { key: c.key }, failed: [] }), {
          status: 200,
        });
      }
      return undefined;
    });
    const salida = await correr(url, ["--vercel", "preview"], { falso });
    expect(salida.codigo).toBe(1);
    expect(salida.error).toContain("ZULUHUB_DB_APP: no figura en preview.");
    expect(salida.secreto.split("\n").filter((l) => /^ZULUHUB_DB_[A-Z]+=/.test(l))).toHaveLength(3);
  });

  it("si un rol falla después de que otro ya quedó activo, el que quedó activo se carga en Vercel igual", async () => {
    const url = await nuevaBase();
    const falso = crearVercelFalso();
    let llamadas = 0;
    const salida = await correr(url, ["--vercel", "preview"], {
      falso,
      generarClave: () => {
        llamadas += 1;
        if (llamadas === 2) throw new Error("falla simulada del segundo rol");
        return "ClaveDelPrimerRolAbcdefghijklmn12";
      },
    });
    expect(salida.codigo).toBe(1);
    expect(salida.error).toContain(`no se pudo dar LOGIN al rol ${ROLES[1]?.rol}`);
    expect(salida.error).toContain("RESULTADO: FALLA");
    expect(falso.de("ZULUHUB_DB_APP")).toHaveLength(1);
    expect(salida.secreto).toBe("");
    expect(await puedeEntrar(ROLES[0]?.rol as string)).toBe(true);
    expect(await puedeEntrar(ROLES[1]?.rol as string)).toBe(false);
    expect(salida.todo).not.toContain("ClaveDelPrimerRolAbcdefghijklmn12");
    // Repetir completa el resto sin tocar el primero.
    const segunda = await correr(url, ["--vercel", "preview"], { falso });
    expect(segunda.codigo).toBe(0);
    expect(segunda.info).toContain("Ya estaban cargadas en Vercel (PREVIEW): ZULUHUB_DB_APP.");
    expect(falso.variables.size).toBe(3);
  });

  it("dos corridas simultáneas: la segunda espera por el bloqueo, y al entrar ve las variables ya cargadas; no se duplica nada", async () => {
    const url = await nuevaBase();
    let soltar: () => void = () => undefined;
    const puerta = new Promise<void>((resolver) => (soltar = resolver));
    let avisar: () => void = () => undefined;
    const primeraEscritura = new Promise<void>((resolver) => (avisar = resolver));
    let escrituras = 0;
    const falso = crearVercelFalso([], async (p) => {
      if (p.metodo === "POST") {
        escrituras += 1;
        if (escrituras === 1) {
          avisar();
          await puerta;
        }
      }
      return undefined;
    });
    const a = correr(url, ["--vercel", "preview"], { falso });
    await primeraEscritura;
    const b = correr(url, ["--vercel", "preview"], { falso });
    await new Promise((resolver) => setTimeout(resolver, 1500));
    // La primera sigue en medio de su escritura; la segunda espera: leyó la lista una sola vez (la de
    // antes de empezar) y no escribió nada.
    expect(falso.pedidos.filter((p) => p.metodo === "GET")).toHaveLength(3);
    expect(falso.escrituras()).toHaveLength(1);
    soltar();
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.codigo, rb.codigo]).toEqual([0, 0]);
    expect(rb.info).toContain(
      "Ya estaban cargadas en Vercel (PREVIEW): ZULUHUB_DB_APP, ZULUHUB_DB_TRABAJOS, ZULUHUB_DB_PUBLICO.",
    );
    expect(ra.secreto + rb.secreto).toBe("");
    expect(falso.variables.size).toBe(3);
    for (const { rol, variable } of ROLES) {
      expect(falso.de(variable)).toHaveLength(1);
      expect(await entraComo(valorDe(falso, variable), rol)).toBe(true);
    }
    expect(falso.escrituras()).toHaveLength(3);
  });
});
