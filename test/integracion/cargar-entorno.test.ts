import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  hayClavesDeContextoInstaladas,
  instalarClaveDeContexto,
  leerClaveDeContexto,
} from "../../src/adaptadores/postgres/contexto-firmado";
import type { BaseDeLaClave } from "../../src/adaptadores/vercel/cargar-entorno";
import { VARIABLES_GENERABLES } from "../../src/adaptadores/vercel/plan-de-variables";
import { ejecutarCargaDeEntorno } from "../../scripts/ejecutar-cargar-entorno";
import { VARIABLE_DE_LA_CADENA } from "../../scripts/ejecutar-instalar-clave";
import { crearBaseAparte } from "./entorno";
import { TOKEN_FALSO, crearVercelFalso, type VariableFalsa } from "./vercel-falso";

/**
 * `scripts/ejecutar-cargar-entorno.ts` (el paso de `cargar-entorno.yml`): con el Vercel falso con estado (el mismo de
 * `migrar-base --vercel`, que habla con el cliente REAL) y, donde hace falta, una base real descartable.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const ejecutarArchivo = promisify(execFile);

const CADENA_FALSA = "postgresql://usuario-x:clave-de-prueba@ep-prueba-123.invalid:5432/pedernal";
const GENERABLES: readonly string[] = VARIABLES_GENERABLES;

type Salida = {
  codigo: number;
  info: string;
  error: string;
  comandos: string[];
  /** Todo lo que salió por cualquier canal. */
  todo: string;
  eventos: string[];
};

function baseFalsa(eventos: string[], opciones: { hay?: boolean; instalar?: boolean } = {}) {
  const instaladas: string[] = [];
  const falsa: BaseDeLaClave = {
    hayClavesInstaladas: () => {
      eventos.push("base: hay claves?");
      return Promise.resolve({ ok: true, hay: opciones.hay ?? false });
    },
    instalar: (clave) => {
      eventos.push("base: instalar");
      instaladas.push(clave);
      return Promise.resolve(
        opciones.instalar === false ? { ok: false, motivo: `falló con ${clave}` } : { ok: true },
      );
    },
  };
  return { falsa, instaladas };
}

async function correr(
  argumentos: string[],
  o: {
    falso?: ReturnType<typeof crearVercelFalso>;
    entorno?: Record<string, string | undefined>;
    base?: BaseDeLaClave;
    bytesAlAzar?: (cuantos: number) => Uint8Array;
    eventos?: string[];
  } = {},
): Promise<Salida> {
  const falso = o.falso ?? crearVercelFalso();
  const eventos = o.eventos ?? [];
  const info: string[] = [];
  const error: string[] = [];
  const comandos: string[] = [];
  const codigo = await ejecutarCargaDeEntorno({
    argumentos,
    entorno: {
      PEDERNAL_VERCEL_TOKEN: TOKEN_FALSO,
      [VARIABLE_DE_LA_CADENA]: CADENA_FALSA,
      ...o.entorno,
    },
    info: (l) => info.push(l),
    error: (l) => error.push(l),
    comando: (l) => {
      eventos.push("comando");
      comandos.push(l);
    },
    ...(o.base === undefined ? {} : { base: () => o.base as BaseDeLaClave }),
    ...(o.bytesAlAzar === undefined ? {} : { bytesAlAzar: o.bytesAlAzar }),
    fetch: ((url: string, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      if (metodo !== "GET") eventos.push(`vercel: ${metodo}`);
      return (falso.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>)(
        url,
        init,
      );
    }) as unknown as typeof fetch,
    esperarEntreLecturas: () => Promise.resolve(),
  });
  return {
    codigo,
    info: info.join("\n"),
    error: error.join("\n"),
    comandos,
    todo: [...info, ...error].join("\n"),
    eventos,
  };
}

const valoresGuardados = (falso: ReturnType<typeof crearVercelFalso>) =>
  [...falso.variables.values()].map((v) => v.valor);

/** Ningún valor guardado en Vercel, ni su parte secreta, salió por ningún canal. */
function sinValores(salida: Salida, falso: ReturnType<typeof crearVercelFalso>): void {
  const guardados = valoresGuardados(falso);
  expect(guardados.length).toBeGreaterThan(0);
  for (const valor of guardados) {
    expect(salida.todo).not.toContain(valor);
    expect(salida.todo).not.toContain(valor.slice(valor.indexOf(":") + 1));
  }
  expect(salida.todo).not.toContain(TOKEN_FALSO);
  expect(salida.todo).not.toContain("clave-de-prueba");
  expect(salida.todo).not.toContain(CADENA_FALSA);
}

describe("cargar-entorno: uso, token y cadena", () => {
  it.each([
    [[]],
    [["--vercel"]],
    [["--vercel", "Preview"]],
    [["--vercel", "preview", "--confirmo", "production"]],
    [["--vercel", "production"]],
    [["--vercel", "production", "--confirmo", "preview"]],
    [["--vercel", "production", "--confirmo", "production", "--rotar"]],
    [["--preparar-roles"]],
  ])("el uso incorrecto %j se rechaza sin hacer ningún pedido", async (argumentos) => {
    const falso = crearVercelFalso();
    const salida = await correr(argumentos, { falso });
    expect(salida.codigo).toBe(2);
    expect(salida.error).toContain("uso: cargar-entorno --vercel <preview|production>");
    expect(falso.pedidos).toEqual([]);
  });

  it("sin token explica cómo crearlo y no hace ningún pedido; con un token roto, también", async () => {
    for (const token of [undefined, "", "con espacio"]) {
      const falso = crearVercelFalso();
      const salida = await correr(["--vercel", "preview"], {
        falso,
        entorno: { PEDERNAL_VERCEL_TOKEN: token },
      });
      expect(salida.codigo).toBe(1);
      expect(salida.error).toContain("PEDERNAL_VERCEL_TOKEN");
      expect(falso.pedidos).toEqual([]);
    }
  });

  it("una cadena que no sirve (pooler o no es de Postgres) corta sin tocar Vercel; sin cadena sigue sin la clave de contexto", async () => {
    for (const cadena of ["postgresql://u:c@ep-algo-pooler.aws.neon.tech/db", "no-es-una-cadena"]) {
      const falso = crearVercelFalso();
      const salida = await correr(["--vercel", "preview"], {
        falso,
        entorno: { [VARIABLE_DE_LA_CADENA]: cadena },
      });
      expect(salida.codigo).toBe(1);
      expect(falso.pedidos).toEqual([]);
      expect(salida.todo).not.toContain("c@ep-algo");
    }
    const falso = crearVercelFalso();
    const salida = await correr(["--vercel", "preview"], {
      falso,
      entorno: { [VARIABLE_DE_LA_CADENA]: undefined },
    });
    expect(salida.codigo).toBe(1);
    expect(falso.de("PEDERNAL_CLAVE_CONTEXTO")).toEqual([]);
    expect(salida.error).toContain(
      "PEDERNAL_CLAVE_CONTEXTO: falta que la cargues vos (falta la cadena",
    );
    expect(falso.escrituras()).toHaveLength(4);
  });
});

describe("cargar-entorno: de punta a punta con el Vercel falso", () => {
  it("preview: crea las cinco como sensibles solo en preview, SIN upsert, y nada imprime un valor", async () => {
    const falso = crearVercelFalso([
      { key: "PEDERNAL_URL_BASE", type: "sensitive", target: ["preview"], valor: "https://valor" },
    ]);
    const eventos: string[] = [];
    const { falsa, instaladas } = baseFalsa(eventos);
    const salida = await correr(["--vercel", "preview"], { falso, base: falsa, eventos });
    expect(salida.error).toBe("");
    expect(salida.codigo).toBe(0);
    expect(salida.info).toContain(
      "Se cargará en Vercel: PREVIEW (proyecto pedernal-erp, equipo alepozod).",
    );
    for (const nombre of GENERABLES) expect(salida.info).toContain(`  - ${nombre}: creada`);
    expect(salida.info).toContain("  - PEDERNAL_URL_BASE: ya cargada");
    expect(salida.info).toContain("  - PEDERNAL_RESEND_API_KEY: falta");
    expect(salida.info).toContain("RESULTADO: OK");

    for (const nombre of GENERABLES) {
      const guardada = falso.de(nombre);
      expect(guardada).toHaveLength(1);
      expect(guardada[0]).toMatchObject({ type: "sensitive", target: ["preview"] });
    }
    // Ni una escritura con `upsert`: nada se pisa.
    for (const p of falso.escrituras()) {
      expect(p.metodo).toBe("POST");
      expect(p.consulta).toEqual({ slug: "alepozod" });
    }
    expect(falso.escrituras()).toHaveLength(5);
    // La clave que se instaló en la base es la que quedó en Vercel.
    expect(instaladas).toEqual([falso.de("PEDERNAL_CLAVE_CONTEXTO")[0]?.valor]);
    sinValores(salida, falso);
    // Lo que ya estaba (de mano) no se tocó.
    expect(falso.de("PEDERNAL_URL_BASE")[0]?.valor).toBe("https://valor");
  });

  it("production solo con --confirmo production, y escribe solo en production", async () => {
    const falso = crearVercelFalso();
    const { falsa } = baseFalsa([]);
    const salida = await correr(["--vercel", "production", "--confirmo", "production"], {
      falso,
      base: falsa,
    });
    expect(salida.codigo).toBe(0);
    expect(salida.info).toContain("PRODUCTION");
    for (const nombre of GENERABLES) expect(falso.de(nombre)[0]?.target).toEqual(["production"]);
  });

  it("repetirlo no cambia nada: todas «ya existía», ninguna escritura, la base no se toca", async () => {
    const falso = crearVercelFalso();
    const eventos: string[] = [];
    const primera = baseFalsa(eventos);
    await correr(["--vercel", "preview"], { falso, base: primera.falsa, eventos });
    const foto = falso.foto();
    const escrituras = falso.escrituras().length;
    const segunda = baseFalsa(eventos);
    const salida = await correr(["--vercel", "preview"], { falso, base: segunda.falsa, eventos });
    expect(salida.codigo).toBe(0);
    for (const nombre of GENERABLES) expect(salida.info).toContain(`  - ${nombre}: ya existía`);
    expect(falso.foto()).toBe(foto);
    expect(falso.escrituras()).toHaveLength(escrituras);
    expect(segunda.instaladas).toEqual([]);
  });

  it("no sobrescribe: con las cinco cargadas con valores conocidos, nada cambia", async () => {
    const previas: Omit<VariableFalsa, "id">[] = GENERABLES.map((key) => ({
      key,
      type: "sensitive",
      target: ["preview"],
      valor: `valor-previo-de-${key}`,
    }));
    const falso = crearVercelFalso(previas);
    const { falsa } = baseFalsa([]);
    const foto = falso.foto();
    const salida = await correr(["--vercel", "preview"], { falso, base: falsa });
    expect(salida.codigo).toBe(0);
    expect(falso.foto()).toBe(foto);
    expect(falso.escrituras()).toEqual([]);
  });

  it("la base ya tiene una clave y Vercel no: sale con error, sin ningún pedido de escritura ni instalación", async () => {
    const falso = crearVercelFalso();
    const eventos: string[] = [];
    const { falsa, instaladas } = baseFalsa(eventos, { hay: true });
    const salida = await correr(["--vercel", "preview"], { falso, base: falsa, eventos });
    expect(salida.codigo).toBe(1);
    expect(salida.error).toContain(
      "SE DETUVO: la base de PREVIEW ya tiene una clave de contexto instalada",
    );
    expect(salida.error).toContain("Lo decide el dueño");
    expect(falso.escrituras()).toEqual([]);
    expect(instaladas).toEqual([]);
    expect(salida.comandos).toEqual([]);
  });

  it("si la instalación falla, la clave no se carga en Vercel, y el motivo (que repetía la clave) sale tapado", async () => {
    const falso = crearVercelFalso();
    const eventos: string[] = [];
    const { falsa } = baseFalsa(eventos, { instalar: false });
    const salida = await correr(["--vercel", "preview"], { falso, base: falsa, eventos });
    expect(salida.codigo).toBe(1);
    expect(falso.de("PEDERNAL_CLAVE_CONTEXTO")).toEqual([]);
    expect(salida.error).toContain(
      "PEDERNAL_CLAVE_CONTEXTO: no se pudo cargar (no se pudo instalar en la base (falló con",
    );
    expect(salida.error).toContain("***");
    sinValores(salida, falso);
  });

  it("un Vercel que repite el valor en su error no lo filtra", async () => {
    const eventos: string[] = [];
    const falso = crearVercelFalso([], (pedido) => {
      const c = pedido.cuerpo as { key?: string; value?: string } | undefined;
      if (pedido.metodo === "POST" && c?.key === "CRON_SECRET") {
        return new Response(
          JSON.stringify({ error: { code: "bad_request", message: `valor ${c.value} no sirve` } }),
          { status: 400 },
        );
      }
      return undefined;
    });
    const { falsa } = baseFalsa(eventos);
    const salida = await correr(["--vercel", "preview"], { falso, base: falsa, eventos });
    expect(salida.codigo).toBe(1);
    expect(salida.error).toContain("CRON_SECRET: no se pudo cargar (Vercel respondió 400");
    expect(salida.error).toContain("***");
    // El valor que se mandó está en el pedido anotado del falso: no aparece en la salida.
    const mandado = falso.pedidos
      .map((p) => p.cuerpo as { key?: string; value?: string } | undefined)
      .find((c) => c?.key === "CRON_SECRET")?.value;
    expect(mandado).toMatch(/^[0-9a-f]{64}$/);
    expect(salida.todo).not.toContain(mandado as string);
    sinValores(salida, falso);
  });

  it("una excepción inesperada no filtra nada: solo el tipo de la falla", async () => {
    const eventos: string[] = [];
    const secretoQueNoDebeSalir = "secreto-que-no-debe-salir";
    const falsa: BaseDeLaClave = {
      hayClavesInstaladas: () => Promise.reject(new TypeError(secretoQueNoDebeSalir)),
      instalar: () => Promise.resolve({ ok: true }),
    };
    const salida = await correr(["--vercel", "preview"], { base: falsa, eventos });
    expect(salida.codigo).toBe(1);
    expect(salida.error).toContain("ERROR inesperado (TypeError)");
    expect(salida.todo).not.toContain(secretoQueNoDebeSalir);
  });

  it("en GitHub Actions cada valor se entrega al runner con ::add-mask:: ANTES de la primera escritura; fuera de Actions, no", async () => {
    const falso = crearVercelFalso();
    const eventos: string[] = [];
    const { falsa } = baseFalsa(eventos);
    const salida = await correr(["--vercel", "preview"], {
      falso,
      base: falsa,
      eventos,
      entorno: { GITHUB_ACTIONS: "true" },
    });
    expect(salida.codigo).toBe(0);
    const guardados = valoresGuardados(falso);
    for (const valor of guardados) {
      expect(salida.comandos).toContain(`::add-mask::${valor}`);
      expect(salida.comandos).toContain(`::add-mask::${valor.slice(valor.indexOf(":") + 1)}`);
    }
    expect(salida.comandos.every((c) => c.startsWith("::add-mask::"))).toBe(true);
    const primeraEscritura = salida.eventos.findIndex((e) => e.startsWith("vercel:"));
    expect(salida.eventos.lastIndexOf("comando")).toBeLessThan(primeraEscritura);
    // Los comandos van por su canal: ni info ni error los repiten.
    for (const valor of guardados) expect(salida.todo).not.toContain(valor);

    const fuera = await correr(["--vercel", "preview"], {
      falso: crearVercelFalso(),
      base: baseFalsa([]).falsa,
    });
    expect(fuera.comandos).toEqual([]);
  });

  it("los valores son al azar de verdad (otra corrida, otros valores) y de 32 bytes", async () => {
    const a = crearVercelFalso();
    const b = crearVercelFalso();
    await correr(["--vercel", "preview"], { falso: a, base: baseFalsa([]).falsa });
    await correr(["--vercel", "preview"], { falso: b, base: baseFalsa([]).falsa });
    for (const nombre of GENERABLES) {
      expect(a.de(nombre)[0]?.valor).not.toBe(b.de(nombre)[0]?.valor);
    }
  });
});

describe.skipIf(base === null)("cargar-entorno con una base real", () => {
  let dueno: pg.Client;
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;

  async function nuevaBase() {
    if (base === null) throw new Error("sin base");
    return crearBaseAparte(base, { sinClave: true });
  }
  const claves = async (cliente: pg.Client) =>
    (
      await cliente.query<{ kid: number; secreto: string }>(
        "select kid, encode(secreto, 'hex') as secreto from contexto_clave order by kid",
      )
    ).rows;

  beforeAll(async () => {
    propia = await nuevaBase();
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  it("hayClavesDeContextoInstaladas: no en una base sin claves, sí con cualquiera", async () => {
    const vacia = await nuevaBase();
    try {
      expect(await hayClavesDeContextoInstaladas(vacia.base.dueno)).toBe(false);
      await instalarClaveDeContexto(
        vacia.base.dueno,
        leerClaveDeContexto(`4:${randomBytes(32).toString("hex")}`),
      );
      expect(await hayClavesDeContextoInstaladas(vacia.base.dueno)).toBe(true);
    } finally {
      await vacia.destruir();
    }
  });

  it("de punta a punta: instala en la base la MISMA clave que carga en Vercel, y repetir no cambia nada", async () => {
    const aparte = await nuevaBase();
    try {
      const falso = crearVercelFalso();
      const entorno = { [VARIABLE_DE_LA_CADENA]: aparte.base.dueno };
      const primera = await ejecutarCargaDeEntorno({
        argumentos: ["--vercel", "preview"],
        entorno: { PEDERNAL_VERCEL_TOKEN: TOKEN_FALSO, ...entorno },
        info: () => undefined,
        error: () => undefined,
        comando: () => undefined,
        fetch: falso.fetch,
        esperarEntreLecturas: () => Promise.resolve(),
      });
      expect(primera).toBe(0);
      const clienteDueno = new pg.Client({ connectionString: aparte.base.dueno });
      await clienteDueno.connect();
      try {
        const enVercel = falso.de("PEDERNAL_CLAVE_CONTEXTO")[0]?.valor ?? "";
        expect(enVercel).toMatch(/^1:[0-9a-f]{64}$/);
        expect(await claves(clienteDueno)).toEqual([{ kid: 1, secreto: enVercel.slice(2) }]);
        const foto = falso.foto();
        const segunda = await ejecutarCargaDeEntorno({
          argumentos: ["--vercel", "preview"],
          entorno: { PEDERNAL_VERCEL_TOKEN: TOKEN_FALSO, ...entorno },
          info: () => undefined,
          error: () => undefined,
          comando: () => undefined,
          fetch: falso.fetch,
          esperarEntreLecturas: () => Promise.resolve(),
        });
        expect(segunda).toBe(0);
        expect(falso.foto()).toBe(foto);
        expect(await claves(clienteDueno)).toEqual([{ kid: 1, secreto: enVercel.slice(2) }]);
      } finally {
        await clienteDueno.end();
      }
    } finally {
      await aparte.destruir();
    }
  });

  it("la base ya tiene una clave (instalada por el dueño) y Vercel no: para, y la clave de la base queda intacta", async () => {
    const aparte = await nuevaBase();
    try {
      const delDueno = `7:${randomBytes(32).toString("hex")}`;
      await instalarClaveDeContexto(aparte.base.dueno, leerClaveDeContexto(delDueno));
      const falso = crearVercelFalso();
      const error: string[] = [];
      const codigo = await ejecutarCargaDeEntorno({
        argumentos: ["--vercel", "preview"],
        entorno: { PEDERNAL_VERCEL_TOKEN: TOKEN_FALSO, [VARIABLE_DE_LA_CADENA]: aparte.base.dueno },
        info: () => undefined,
        error: (l) => error.push(l),
        comando: () => undefined,
        fetch: falso.fetch,
        esperarEntreLecturas: () => Promise.resolve(),
      });
      expect(codigo).toBe(1);
      expect(error.join("\n")).toContain("SE DETUVO");
      expect(falso.escrituras()).toEqual([]);
      const cliente = new pg.Client({ connectionString: aparte.base.dueno });
      await cliente.connect();
      try {
        expect(await claves(cliente)).toEqual([{ kid: 7, secreto: delDueno.slice(2) }]);
      } finally {
        await cliente.end();
      }
      expect(error.join("\n")).not.toContain(delDueno.slice(2));
    } finally {
      await aparte.destruir();
    }
  });

  it("una base sin migrar (no existe contexto_clave) para antes de cambiar nada y no filtra la cadena", async () => {
    if (base === null) return;
    const sinMigrar = await crearBaseAparte(base, { migrar: false });
    try {
      const falso = crearVercelFalso();
      const todo: string[] = [];
      const codigo = await ejecutarCargaDeEntorno({
        argumentos: ["--vercel", "preview"],
        entorno: {
          PEDERNAL_VERCEL_TOKEN: TOKEN_FALSO,
          [VARIABLE_DE_LA_CADENA]: sinMigrar.base.dueno,
        },
        info: (l) => todo.push(l),
        error: (l) => todo.push(l),
        comando: () => undefined,
        fetch: falso.fetch,
        esperarEntreLecturas: () => Promise.resolve(),
      });
      expect(codigo).toBe(1);
      expect(todo.join("\n")).toContain(
        "SE DETUVO: no se pudo mirar si la base ya tiene una clave de contexto",
      );
      expect(falso.escrituras()).toEqual([]);
      expect(todo.join("\n")).not.toContain(sinMigrar.base.dueno);
    } finally {
      await sinMigrar.destruir();
    }
  });
});

describe("arranca de verdad con Node sin compilar", () => {
  it("el comando se carga y rechaza un uso incorrecto con el código 2 (no necesita red ni base)", async () => {
    const intento = ejecutarArchivo(process.execPath, [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      join(import.meta.dirname, "../../scripts/cargar-entorno.ts"),
      "--vercel",
    ]);
    await expect(intento).rejects.toMatchObject({ code: 2 });
  });
});
