import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  firmarCarga,
  instalarClaveDeContexto,
  type CargaDeContexto,
  type ClaveDeContexto,
} from "../../src/adaptadores/postgres/contexto-firmado";
import {
  ErrorDeConfiguracion,
  crearTransacciones,
} from "../../src/adaptadores/postgres/transacciones";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  comoEmpresa,
  comoGrupo,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  crearPropietario,
  type EmpresaDePrueba,
} from "./entorno";

/**
 * Falsificación del contexto firmado (ADR-011, H2). Cada caso intenta, como lo haría un rol limitado
 * con SQL arbitrario, ver datos de otra empresa; todos tienen que terminar en cero filas y SIN error.
 * Las conexiones son directas por `pg` con el rol real: no pasan por el adaptador, que solo se usa
 * para armar datos y para los casos que prueban al propio adaptador.
 */

const base = inject("baseDePruebas");

const ahoraEnS = () => Math.floor(Date.now() / 1000);

/** Una carga para el rol app, vigente 5 minutos, con lo que se le pase por encima. */
function carga(cambios: Partial<CargaDeContexto> = {}): CargaDeContexto {
  return { u: "zuluhub_app", e: null, t: null, p: null, i: null, x: ahoraEnS() + 300, ...cambios };
}

/** Firma con HMAC propio un payload arbitrario (en bytes), para armar tokens "válidos" con basura. */
function firmarBytes(clave: ClaveDeContexto, payload: Buffer, kid = clave.kid): string {
  const cuerpo = `v1.${kid}.${payload.toString("hex")}`;
  return `${cuerpo}.${createHmac("sha256", clave.secreto).update(cuerpo).digest("hex")}`;
}

/** Una sesión con el rol dado: cada intento corre en su propia transacción que se deshace. */
async function enSesion<T>(
  url: string,
  token: string | null,
  trabajo: (c: pg.Client) => Promise<T>,
): Promise<T> {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query("begin");
    if (token !== null) await cliente.query("select set_config('app.ctx', $1, true)", [token]);
    return await trabajo(cliente);
  } finally {
    await cliente.query("rollback").catch(() => undefined);
    await cliente.end();
  }
}

const contar = async (c: pg.Client, tabla: string) =>
  (await c.query<{ n: number }>(`select count(*)::int as n from ${tabla}`)).rows[0]?.n;

/** Cuántas empresas y sucursales ve la sesión de la aplicación con ese token. */
async function veComoApp(url: string, token: string | null) {
  return enSesion(url, token, async (c) => ({
    empresas: await contar(c, "empresa"),
    sucursales: await contar(c, "sucursal"),
  }));
}

const CERO = { empresas: 0, sucursales: 0 };

describe.skipIf(base === null)("contexto firmado: falsificación", () => {
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let a: EmpresaDePrueba;
  let b: EmpresaDePrueba;
  const clave = (): ClaveDeContexto => base!.clave;
  const tokenDeA = (cambios: Partial<CargaDeContexto> = {}) =>
    firmarCarga(clave(), carga({ e: a.empresa, ...cambios }));

  beforeAll(async () => {
    if (base === null) return;
    entorno = crearEntornoDePrueba(base);
    a = await crearEmpresaActiva(entorno);
    b = await crearEmpresaActiva(entorno);
  });
  afterAll(async () => {
    await entorno.cerrar();
  });

  describe("(k) control positivo", () => {
    it("un token válido de A funciona para A: ve su empresa y su sucursal, y nada de B", async () => {
      expect(await veComoApp(base!.app, tokenDeA())).toEqual({ empresas: 1, sucursales: 1 });
      const ids = await enSesion(base!.app, tokenDeA(), async (c) => ({
        empresas: (await c.query<{ id: string }>("select id from empresa")).rows.map((f) => f.id),
        sucursales: (
          await c.query<{ empresa_id: string }>("select empresa_id from sucursal")
        ).rows.map((f) => f.empresa_id),
      }));
      expect(ids).toEqual({ empresas: [a.empresa], sucursales: [a.empresa] });
    });

    it("lo único que se puede hacer con un token de A es cambiarlo por otro válido de A", async () => {
      const resultado = await enSesion(base!.app, tokenDeA(), async (c) => {
        const primero = await contar(c, "sucursal");
        await c.query("select set_config('app.ctx', $1, true)", [
          tokenDeA({ x: ahoraEnS() + 120 }),
        ]);
        const segundo = await contar(c, "sucursal");
        return { primero, segundo };
      });
      expect(resultado).toEqual({ primero: 1, segundo: 1 });
    });

    it("contexto_firmado() devuelve el payload y nada más (jamás el secreto)", async () => {
      const { filas, texto } = await enSesion(base!.app, tokenDeA(), async (c) => {
        const r = await c.query<{ ctx: Record<string, unknown> }>(
          "select contexto_firmado() as ctx",
        );
        return { filas: r.rows, texto: JSON.stringify(r.rows) };
      });
      expect(filas).toHaveLength(1);
      expect(Object.keys(filas[0]?.ctx ?? {}).sort()).toEqual(["e", "i", "p", "t", "u", "x"]);
      expect(filas[0]?.ctx).toMatchObject({ u: "zuluhub_app", e: a.empresa, t: null, p: null });
      expect(texto).not.toContain(clave().secreto.toString("hex"));
    });
  });

  describe("(a) el ataque original", () => {
    it("set_config('app.empresa_id', <ajena>) ya no da acceso: 0 filas", async () => {
      const visto = await enSesion(base!.app, null, async (c) => {
        await c.query("select set_config('app.empresa_id', $1, true)", [b.empresa]);
        await c.query("select set_config('app.tenant_id', $1, true)", [b.tenant]);
        return { empresas: await contar(c, "empresa"), sucursales: await contar(c, "sucursal") };
      });
      expect(visto).toEqual(CERO);
    });

    it("con un token propio válido, pisar app.empresa_id con la ajena no cambia lo que se ve", async () => {
      const ids = await enSesion(base!.app, tokenDeA(), async (c) => {
        await c.query("select set_config('app.empresa_id', $1, true)", [b.empresa]);
        await c.query("select set_config('app.tenant_id', $1, true)", [b.tenant]);
        await c.query("select set_config('app.persona_id', $1, true)", [randomUUID()]);
        return (await c.query<{ id: string }>("select id from empresa")).rows.map((f) => f.id);
      });
      expect(ids).toEqual([a.empresa]);
    });

    it("tampoco sirve escribir: la empresa ajena no admite una sucursal desde la sesión de A", async () => {
      const codigo = await enSesion(base!.app, tokenDeA(), async (c) => {
        await c.query("select set_config('app.empresa_id', $1, true)", [b.empresa]);
        try {
          await c.query("insert into sucursal (empresa_id, nombre) values ($1, 'intrusa')", [
            b.empresa,
          ]);
          return null;
        } catch (e) {
          return (e as pg.DatabaseError).code;
        }
      });
      expect(codigo).toBe("42501");
    });

    it("las variables viejas ya no existen: el adaptador no las fija", async () => {
      const r = await entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ db }) => {
        const { rows } = await sql<{
          empresa: string | null;
          tenant: string | null;
          persona: string | null;
          ctx: string | null;
        }>`select current_setting('app.empresa_id', true) as empresa,
                  current_setting('app.tenant_id', true) as tenant,
                  current_setting('app.persona_id', true) as persona,
                  current_setting('app.ctx', true) as ctx`.execute(db);
        return ok(rows[0]);
      });
      expect(r.ok && r.valor).toBeTruthy();
      if (r.ok) {
        expect(r.valor?.empresa ?? "").toBe("");
        expect(r.valor?.tenant ?? "").toBe("");
        expect(r.valor?.persona ?? "").toBe("");
        expect(r.valor?.ctx).toMatch(/^v1\.1\.[0-9a-f]+\.[0-9a-f]{64}$/);
      }
    });
  });

  describe("(b) (c) (d) token falsificado, alterado o vencido", () => {
    it("(b) firmado con otra clave (mismo kid): 0 filas", async () => {
      const ajena: ClaveDeContexto = { kid: clave().kid, secreto: randomBytes(32) };
      const token = firmarCarga(ajena, carga({ e: a.empresa }));
      expect(await veComoApp(base!.app, token)).toEqual(CERO);
    });

    it("(c) payload alterado (e de A por e de B) conservando el mac: 0 filas", async () => {
      const [version, kid, payloadHex, mac] = tokenDeA().split(".") as [
        string,
        string,
        string,
        string,
      ];
      const original = JSON.parse(
        Buffer.from(payloadHex, "hex").toString("utf8"),
      ) as CargaDeContexto;
      expect(original.e).toBe(a.empresa);
      const alterado = Buffer.from(JSON.stringify({ ...original, e: b.empresa })).toString("hex");
      expect(await veComoApp(base!.app, [version, kid, alterado, mac].join("."))).toEqual(CERO);
    });

    it("(c) payload alterado para alargar el vencimiento o cambiar de rol: 0 filas", async () => {
      const [version, kid, payloadHex, mac] = tokenDeA({ x: ahoraEnS() - 10 }).split(".") as [
        string,
        string,
        string,
        string,
      ];
      const original = JSON.parse(
        Buffer.from(payloadHex, "hex").toString("utf8"),
      ) as CargaDeContexto;
      for (const cambio of [{ x: ahoraEnS() + 3600 }, { u: "zuluhub_grupo" }, { t: b.tenant }]) {
        const alterado = Buffer.from(JSON.stringify({ ...original, ...cambio })).toString("hex");
        expect(await veComoApp(base!.app, [version, kid, alterado, mac].join("."))).toEqual(CERO);
      }
    });

    it("(c) mac alterado en un solo dígito: 0 filas", async () => {
      const token = tokenDeA();
      const ultimo = token.slice(-1) === "0" ? "1" : "0";
      expect(await veComoApp(base!.app, token.slice(0, -1) + ultimo)).toEqual(CERO);
    });

    it("(d) token vencido: 0 filas", async () => {
      expect(await veComoApp(base!.app, tokenDeA({ x: ahoraEnS() - 1 }))).toEqual(CERO);
      expect(await veComoApp(base!.app, tokenDeA({ x: 0 }))).toEqual(CERO);
    });

    it("(d) el vencimiento también rige en plena transacción: deja de ver datos al vencer", async () => {
      const r = await enSesion(base!.app, tokenDeA({ x: ahoraEnS() + 3 }), async (c) => {
        const antes = await contar(c, "sucursal");
        await c.query("select pg_sleep(3.6)");
        const despues = await contar(c, "sucursal");
        return { antes, despues };
      });
      expect(r).toEqual({ antes: 1, despues: 0 });
    });

    it("el adaptador usa el reloj real, no contexto.ahora: el token vence ~300 s desde ya", async () => {
      const r = await entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ db }) => {
        const { rows } = await sql<{
          ctx: string;
        }>`select current_setting('app.ctx') as ctx`.execute(db);
        return ok(rows[0]?.ctx);
      });
      expect(r.ok).toBe(true);
      const payloadHex = (r.ok ? (r.valor as string) : "").split(".")[2] as string;
      const { x } = JSON.parse(Buffer.from(payloadHex, "hex").toString("utf8")) as { x: number };
      // `comoEmpresa` trae ahora = 2026-10-11 fijo: si el vencimiento saliera de ahí, no estaría cerca.
      expect(Math.abs(x - (ahoraEnS() + 300))).toBeLessThanOrEqual(10);
    });

    it("se firma de nuevo en cada reintento", async () => {
      const real = Date.now.bind(Date);
      let adelanto = 0;
      const espia = vi.spyOn(Date, "now").mockImplementation(() => real() + adelanto);
      const vencimientos: number[] = [];
      try {
        const r = await entorno.ejecutar(
          { contexto: comoEmpresa(a.empresa), reintentos: 3 },
          async ({ db }) => {
            const { rows } = await sql<{
              ctx: string;
            }>`select current_setting('app.ctx') as ctx`.execute(db);
            const payloadHex = (rows[0]?.ctx ?? "").split(".")[2] as string;
            vencimientos.push(
              (JSON.parse(Buffer.from(payloadHex, "hex").toString("utf8")) as { x: number }).x,
            );
            if (vencimientos.length === 1) {
              adelanto += 60_000; // el reloj avanza un minuto antes del reintento
              // 40001 de verdad: un conflicto de serialización simulado con un bloque anónimo.
              await sql`do $$ begin raise exception 'conflicto simulado' using errcode = '40001'; end $$`.execute(
                db,
              );
            }
            return ok(null);
          },
        );
        expect(r.ok).toBe(true);
      } finally {
        espia.mockRestore();
      }
      expect(vencimientos).toHaveLength(2);
      expect((vencimientos[1] as number) - (vencimientos[0] as number)).toBeGreaterThanOrEqual(59);
    });
  });

  describe("(e) un token de otro rol no sirve en esta sesión", () => {
    it("un token válido de GRUPO usado desde una sesión del rol app: 0 filas", async () => {
      const dueno = await crearPropietario(entorno, a.tenant);
      const token = firmarCarga(clave(), carga({ u: "zuluhub_grupo", t: a.tenant, p: dueno }));
      // Control: en la sesión del rol grupo, ese mismo token sí funciona.
      const enGrupo = await enSesion(base!.grupo, token, (c) => contar(c, "empresa"));
      expect(enGrupo).toBe(1);
      // Con el rol app: u no coincide con session_user.
      expect(await veComoApp(base!.app, token)).toEqual(CERO);
      const ctx = await enSesion(
        base!.app,
        token,
        async (c) => (await c.query<{ ctx: unknown }>("select contexto_firmado() as ctx")).rows[0],
      );
      expect(ctx).toEqual({ ctx: null });
    });

    it("el token de la aplicación tampoco sirve en una sesión del rol grupo ni del rol trabajos", async () => {
      const token = tokenDeA();
      for (const url of [base!.grupo, base!.trabajos, base!.plataforma]) {
        const ctx = await enSesion(url, token, async (c) => {
          const r = await c.query<{ ctx: unknown; e: string | null }>(
            "select contexto_firmado() as ctx, app_empresa_id() as e",
          );
          return r.rows[0];
        });
        expect(ctx).toEqual({ ctx: null, e: null });
      }
    });

    it("el rol del token se compara con session_user: SET ROLE no lo engaña", async () => {
      // Un rol limitado no puede cambiar a otro; el intento falla y no abre nada.
      const codigo = await enSesion(base!.app, tokenDeA(), async (c) => {
        try {
          await c.query("set role zuluhub_grupo");
          return null;
        } catch (e) {
          return (e as pg.DatabaseError).code;
        }
      });
      expect(codigo).toBe("42501");
    });
  });

  describe("(i) basura en app.ctx: 0 filas y SIN error", () => {
    const valido = () => tokenDeA();
    const partes = () => valido().split(".") as [string, string, string, string];
    const casos: Array<[string, () => string]> = [
      ["cadena vacía", () => ""],
      ["sin puntos", () => "esto no es un token"],
      ["solo la versión", () => "v1"],
      ["tres partes", () => partes().slice(0, 3).join(".")],
      ["partes de más", () => `${valido()}.extra`],
      ["punto de más al final", () => `${valido()}.`],
      ["versión desconocida", () => ["v2", ...partes().slice(1)].join(".")],
      ["versión en mayúscula", () => ["V1", ...partes().slice(1)].join(".")],
      ["kid no numérico", () => [partes()[0], "x", partes()[2], partes()[3]].join(".")],
      [
        "kid con cero a la izquierda",
        () => [partes()[0], "01", partes()[2], partes()[3]].join("."),
      ],
      [
        "kid enorme (fuera de smallint)",
        () => [partes()[0], "99999999999999999999", partes()[2], partes()[3]].join("."),
      ],
      ["kid negativo", () => [partes()[0], "-1", partes()[2], partes()[3]].join(".")],
      ["hex impar", () => [partes()[0], partes()[1], `${partes()[2]}a`, partes()[3]].join(".")],
      [
        "hex con dígitos que no lo son",
        () => [partes()[0], partes()[1], "zz", partes()[3]].join("."),
      ],
      ["payload vacío", () => [partes()[0], partes()[1], "", partes()[3]].join(".")],
      [
        "mac corto",
        () => [partes()[0], partes()[1], partes()[2], partes()[3].slice(0, 62)].join("."),
      ],
      [
        "mac con mayúsculas",
        () => [partes()[0], partes()[1], partes()[2], partes()[3].toUpperCase()].join("."),
      ],
      ["mac vacío", () => [partes()[0], partes()[1], partes()[2], ""].join(".")],
      [
        "JSON roto, con firma válida",
        () => firmarBytes(clave(), Buffer.from('{"u":"zuluhub_app","e":')),
      ],
      [
        "bytes que no son UTF-8, con firma válida",
        () => firmarBytes(clave(), Buffer.from([0xff, 0xfe, 0xfd])),
      ],
      [
        "JSON que no es un objeto, con firma válida",
        () => firmarBytes(clave(), Buffer.from("[1,2,3]")),
      ],
      [
        "NUL dentro del JSON, con firma válida",
        () => firmarBytes(clave(), Buffer.from('{"u":"a\\u0000b"}')),
      ],
      [
        "vencimiento ausente, con firma válida",
        () => firmarBytes(clave(), Buffer.from(JSON.stringify({ u: "zuluhub_app", e: a.empresa }))),
      ],
      [
        "vencimiento no numérico, con firma válida",
        () =>
          firmarBytes(
            clave(),
            Buffer.from(JSON.stringify({ u: "zuluhub_app", e: a.empresa, x: "pronto" })),
          ),
      ],
      [
        "vencimiento enorme, con firma válida",
        () =>
          firmarBytes(
            clave(),
            Buffer.from('{"u":"zuluhub_app","e":null,"x":99999999999999999999999}'),
          ),
      ],
      [
        "rol ausente, con firma válida",
        () =>
          firmarBytes(clave(), Buffer.from(JSON.stringify({ e: a.empresa, x: ahoraEnS() + 300 }))),
      ],
    ];

    it.each(casos)("%s", async (_, armar) => {
      const token = armar();
      const r = await enSesion(base!.app, token, async (c) => {
        const ctx = (await c.query<{ ctx: unknown }>("select contexto_firmado() as ctx")).rows[0];
        const empresa = (await c.query<{ e: unknown }>("select app_empresa_id() as e")).rows[0];
        return {
          ctx,
          empresa,
          visto: { empresas: await contar(c, "empresa"), sucursales: await contar(c, "sucursal") },
        };
      });
      expect(r).toEqual({ ctx: { ctx: null }, empresa: { e: null }, visto: CERO });
    });

    it("la variable ausente y la variable en blanco también dan 0 filas sin error", async () => {
      expect(await veComoApp(base!.app, null)).toEqual(CERO);
      expect(await veComoApp(base!.app, "   ")).toEqual(CERO);
    });

    it("un UUID roto dentro de un payload bien firmado no tira error de SQL en la política", async () => {
      // Lo firma solo el servidor, pero la base igual no debe explotar si algún día se equivoca.
      const token = firmarCarga(clave(), carga({ e: "no-es-un-uuid" }));
      const codigo = await enSesion(base!.app, token, async (c) => {
        try {
          await contar(c, "empresa");
          return null;
        } catch (e) {
          return (e as pg.DatabaseError).code;
        }
      });
      // Falla cerrado: o error explícito de sintaxis de uuid, o cero filas; nunca datos de otra empresa.
      expect([null, "22P02"]).toContain(codigo);
    });
  });

  describe("(j) los roles limitados no llegan a los secretos", () => {
    const ROLES_URL = () =>
      [
        ["zuluhub_app", base!.app],
        ["zuluhub_grupo", base!.grupo],
        ["zuluhub_trabajos", base!.trabajos],
        ["zuluhub_plataforma", base!.plataforma],
      ] as const;

    const codigoDe = async (url: string, consulta: string) =>
      enSesion(url, tokenDeA(), async (c) => {
        try {
          await c.query(consulta);
          return null;
        } catch (e) {
          return (e as pg.DatabaseError).code ?? "sin código";
        }
      });

    it("select *, select secreto, count, fila entera, table, copy, insert, update y delete: permiso denegado", async () => {
      const consultas = [
        "select * from contexto_clave",
        "select secreto from contexto_clave",
        "select kid from contexto_clave",
        "select count(*) from contexto_clave",
        "select contexto_clave from contexto_clave",
        "select encode(secreto, 'hex') from public.contexto_clave",
        "table contexto_clave",
        "copy contexto_clave to stdout",
        "insert into contexto_clave (kid, secreto) values (9, decode(repeat('ab', 32), 'hex'))",
        "update contexto_clave set vigente = false",
        "update contexto_clave set secreto = decode(repeat('ab', 32), 'hex')",
        "delete from contexto_clave",
        "truncate contexto_clave",
      ];
      for (const [rol, url] of ROLES_URL()) {
        for (const consulta of consultas) {
          expect(await codigoDe(url, consulta), `${rol}: ${consulta}`).toBe("42501");
        }
      }
    });

    it("las estadísticas del planificador no filtran los valores (pg_stats exige permiso de columna)", async () => {
      const dueno = new pg.Client({ connectionString: base!.dueno });
      await dueno.connect();
      try {
        await dueno.query("analyze contexto_clave");
      } finally {
        await dueno.end();
      }
      for (const [rol, url] of ROLES_URL()) {
        const filas = await enSesion(
          url,
          null,
          async (c) =>
            (
              await c.query<Record<string, unknown>>(
                "select * from pg_stats where tablename = 'contexto_clave'",
              )
            ).rows,
        );
        expect(filas, rol).toEqual([]);
      }
    });

    it("las funciones de pgcrypto no están abiertas a los roles limitados (no hay HMAC a demanda)", async () => {
      for (const [rol, url] of ROLES_URL()) {
        expect(
          await codigoDe(url, "select public.hmac('x'::bytea, 'y'::bytea, 'sha256')"),
          rol,
        ).toBe("42501");
      }
    });

    it("no pueden pasarse al rol dueño ni a ningún otro", async () => {
      const dueno = new pg.Client({ connectionString: base!.dueno });
      await dueno.connect();
      let nombreDelDueno: string;
      try {
        nombreDelDueno = (await dueno.query<{ u: string }>("select session_user::text as u"))
          .rows[0]?.u as string;
      } finally {
        await dueno.end();
      }
      for (const [rol, url] of ROLES_URL()) {
        expect(await codigoDe(url, `set role "${nombreDelDueno}"`), rol).toBe("42501");
        expect(await codigoDe(url, `set session authorization "${nombreDelDueno}"`), rol).toBe(
          "42501",
        );
      }
    });

    it("llamar a contexto_firmado() solo devuelve el payload; la definición de la función no trae secretos", async () => {
      for (const [rol, url] of ROLES_URL()) {
        const texto = await enSesion(url, firmarCarga(clave(), carga({ u: rol })), async (c) => {
          const ctx = (await c.query<{ t: string }>("select contexto_firmado()::text as t")).rows[0]
            ?.t;
          const def = (
            await c.query<{ d: string }>(
              "select pg_get_functiondef('public.contexto_firmado()'::regprocedure) as d",
            )
          ).rows[0]?.d;
          return `${ctx}\n${def}`;
        });
        expect(texto, rol).not.toContain(clave().secreto.toString("hex"));
        expect(texto, rol).toContain('"u"');
      }
    });
  });

  describe("(l) el token de invitación se expone solo con firma válida", () => {
    const hash = "ab".repeat(32);
    const invitacion = async (token: string | null, url = base!.app) =>
      enSesion(
        url,
        token,
        async (c) =>
          (await c.query<{ i: string | null }>("select app_token_invitacion() as i")).rows[0]?.i,
      );

    it("con firma válida, app_token_invitacion() devuelve el hash", async () => {
      expect(await invitacion(firmarCarga(clave(), carga({ i: hash })))).toBe(hash);
    });

    it("sin firma válida, vencido o de otro rol: NULL", async () => {
      const otraClave: ClaveDeContexto = { kid: clave().kid, secreto: randomBytes(32) };
      expect(await invitacion(null)).toBeNull();
      expect(await invitacion(firmarCarga(otraClave, carga({ i: hash })))).toBeNull();
      expect(
        await invitacion(firmarCarga(clave(), carga({ i: hash, x: ahoraEnS() - 1 }))),
      ).toBeNull();
      expect(
        await invitacion(firmarCarga(clave(), carga({ i: hash, u: "zuluhub_grupo" }))),
      ).toBeNull();
      const [version, kid, payloadHex, mac] = firmarCarga(clave(), carga({ i: hash })).split(
        ".",
      ) as [string, string, string, string];
      const original = JSON.parse(
        Buffer.from(payloadHex, "hex").toString("utf8"),
      ) as CargaDeContexto;
      const alterado = Buffer.from(JSON.stringify({ ...original, i: "cd".repeat(32) })).toString(
        "hex",
      );
      expect(await invitacion([version, kid, alterado, mac].join("."))).toBeNull();
    });

    it("un token sin invitación da NULL", async () => {
      expect(await invitacion(tokenDeA())).toBeNull();
    });

    it("el adaptador firma el contexto de INVITACION: rol app, sin empresa ni persona; usa la URL operativa", async () => {
      const r = await entorno.ejecutar(
        { contexto: { tipo: "INVITACION", tokenHash: hash, ahora: new Date() } },
        async ({ db }) => {
          const { rows } = await sql<{
            rol: string;
            invitacion: string | null;
            empresa: string | null;
            persona: string | null;
          }>`select current_user::text as rol, app_token_invitacion() as invitacion,
                    app_empresa_id()::text as empresa, app_persona_id()::text as persona`.execute(
            db,
          );
          return ok(rows[0]);
        },
      );
      expect(r).toEqual({
        ok: true,
        valor: { rol: "zuluhub_app", invitacion: hash, empresa: null, persona: null },
      });
    });

    it("con una URL propia para INVITACION, la usa", async () => {
      const propio = crearTransacciones({
        urls: { INVITACION: base!.app },
        clave: clave(),
        armar: (db) => ({ db }),
        maximoDeConexiones: 1,
      });
      try {
        const r = await propio.ejecutar(
          { contexto: { tipo: "INVITACION", tokenHash: hash, ahora: new Date() } },
          async ({ db }) => {
            const { rows } = await sql<{
              i: string | null;
            }>`select app_token_invitacion() as i`.execute(db);
            return ok(rows[0]?.i);
          },
        );
        expect(r).toEqual({ ok: true, valor: hash });
        // Y sin URL de INVITACION ni de OPERATIVO, falla: no cae en otra puerta.
        const sinNinguna = crearTransacciones({
          urls: { GRUPO: base!.grupo },
          clave: clave(),
          armar: () => ({}),
        });
        try {
          await expect(
            sinNinguna.ejecutar(
              { contexto: { tipo: "INVITACION", tokenHash: hash, ahora: new Date() } },
              () => Promise.resolve(ok(null)),
            ),
          ).rejects.toBeInstanceOf(ErrorDeConfiguracion);
        } finally {
          await sinNinguna.cerrar();
        }
      } finally {
        await propio.cerrar();
      }
    });
  });

  describe("el adaptador falla cerrado sin clave", () => {
    it("sin clave (o con una clave corta) no se construye", () => {
      expect(() => crearTransacciones({ urls: {}, armar: () => ({}) } as never)).toThrow(
        ErrorDeConfiguracion,
      );
      expect(() =>
        crearTransacciones({
          urls: {},
          clave: { kid: 1, secreto: Buffer.alloc(8) },
          armar: () => ({}),
        }),
      ).toThrow(ErrorDeConfiguracion);
    });
  });

  describe("grupo: el contexto firmado sigue dando la vista de grupo, y solo la suya", () => {
    it("el propietario del grupo ve las empresas de su tenant; el token de otro tenant no le abre las de A", async () => {
      const dueno = await crearPropietario(entorno, a.tenant);
      const r = await entorno.ejecutar({ contexto: comoGrupo(a.tenant, dueno) }, async ({ db }) => {
        const { rows } = await sql<{ id: string }>`select id from empresa`.execute(db);
        return ok(rows.map((f) => f.id));
      });
      expect(r).toEqual({ ok: true, valor: [a.empresa] });
      // Un token firmado con el tenant de B pero con la persona dueña de A: no es propietaria de B.
      const token = firmarCarga(clave(), carga({ u: "zuluhub_grupo", t: b.tenant, p: dueno }));
      expect(await enSesion(base!.grupo, token, (c) => contar(c, "empresa"))).toBe(0);
    });
  });
});

describe.skipIf(base === null)("contexto firmado: claves, rotación y falla cerrada", () => {
  const nuevaClave = (kid: number): ClaveDeContexto => ({ kid, secreto: randomBytes(32) });

  /** Una base aparte con su propia empresa y la clave 1 de la corrida instalada. */
  async function conBaseConDatos<T>(
    trabajo: (
      aparte: Awaited<ReturnType<typeof crearBaseAparte>>["base"],
      empresa: EmpresaDePrueba,
      dueno: pg.Client,
    ) => Promise<T>,
    opciones: { sinClave?: boolean } = {},
  ): Promise<T> {
    const aparte = await crearBaseAparte(base!, opciones);
    const dueno = new pg.Client({ connectionString: aparte.base.dueno });
    await dueno.connect();
    const entorno = crearEntornoDePrueba(aparte.base, 2);
    try {
      let empresa: EmpresaDePrueba | undefined;
      if (opciones.sinClave !== true) empresa = await crearEmpresaActiva(entorno);
      return await trabajo(aparte.base, empresa as EmpresaDePrueba, dueno);
    } finally {
      await entorno.cerrar();
      await dueno.end();
      await aparte.destruir();
    }
  }

  const tokenCon = (
    clave: ClaveDeContexto,
    empresa: string,
    cambios: Partial<CargaDeContexto> = {},
  ) => firmarCarga(clave, carga({ e: empresa, ...cambios }));

  it("(g) con dos claves vigentes, los tokens de ambas funcionan; al revocar una, sus tokens dejan de funcionar", async () => {
    await conBaseConDatos(async (aparte, a, dueno) => {
      const k1 = aparte.clave;
      const k2 = nuevaClave(2);
      await instalarClaveDeContexto(aparte.dueno, k2);

      expect(await veComoApp(aparte.app, tokenCon(k1, a.empresa))).toEqual({
        empresas: 1,
        sucursales: 1,
      });
      expect(await veComoApp(aparte.app, tokenCon(k2, a.empresa))).toEqual({
        empresas: 1,
        sucursales: 1,
      });

      // Se revoca la 1: sus tokens mueren, los de la 2 siguen.
      await dueno.query("update contexto_clave set vigente = false where kid = 1");
      expect(await veComoApp(aparte.app, tokenCon(k1, a.empresa))).toEqual(CERO);
      expect(await veComoApp(aparte.app, tokenCon(k2, a.empresa))).toEqual({
        empresas: 1,
        sucursales: 1,
      });

      // (f) La clave 2 con vigente = false: también 0 filas.
      await dueno.query("update contexto_clave set vigente = false where kid = 2");
      expect(await veComoApp(aparte.app, tokenCon(k2, a.empresa))).toEqual(CERO);

      // Reactivarla (el dueño decide) devuelve el acceso: la vigencia es lo que manda.
      await dueno.query("update contexto_clave set vigente = true where kid = 2");
      expect(await veComoApp(aparte.app, tokenCon(k2, a.empresa))).toEqual({
        empresas: 1,
        sucursales: 1,
      });
    });
  });

  it("(f) un kid inexistente (con el secreto de otra clave) o fuera de rango: 0 filas", async () => {
    await conBaseConDatos(async (aparte, a) => {
      const k1 = aparte.clave;
      expect(
        await veComoApp(aparte.app, tokenCon({ kid: 5, secreto: k1.secreto }, a.empresa)),
      ).toEqual(CERO);
      expect(
        await veComoApp(aparte.app, tokenCon({ kid: 40000, secreto: k1.secreto }, a.empresa)),
      ).toEqual(CERO);
      // Y el control: el kid real con ese secreto sí funciona.
      expect(await veComoApp(aparte.app, tokenCon(k1, a.empresa))).toEqual({
        empresas: 1,
        sucursales: 1,
      });
    });
  });

  it("(f) una clave con vigente = false desde su instalación no sirve", async () => {
    await conBaseConDatos(async (aparte, a, dueno) => {
      const k3 = nuevaClave(3);
      await dueno.query(
        "insert into contexto_clave (kid, secreto, vigente) values ($1, decode($2, 'hex'), false)",
        [k3.kid, k3.secreto.toString("hex")],
      );
      expect(await veComoApp(aparte.app, tokenCon(k3, a.empresa))).toEqual(CERO);
    });
  });

  it("(h) sin ninguna clave instalada todo da 0 filas (falla cerrada), sin error", async () => {
    await conBaseConDatos(async (aparte, a, dueno) => {
      // Control: con la clave instalada se ve la empresa.
      expect(await veComoApp(aparte.app, tokenCon(aparte.clave, a.empresa))).toEqual({
        empresas: 1,
        sucursales: 1,
      });
      await dueno.query("delete from contexto_clave");
      expect(await veComoApp(aparte.app, tokenCon(aparte.clave, a.empresa))).toEqual(CERO);
      expect(await veComoApp(aparte.app, null)).toEqual(CERO);
      const ctx = await enSesion(
        aparte.app,
        tokenCon(aparte.clave, a.empresa),
        async (c) => (await c.query<{ ctx: unknown }>("select contexto_firmado() as ctx")).rows[0],
      );
      expect(ctx).toEqual({ ctx: null });
    });
  });

  it("(h) una base migrada y sin claves (la migración no inserta ninguna) ve todo en 0", async () => {
    await conBaseConDatos(
      async (aparte) => {
        const dueno = new pg.Client({ connectionString: aparte.dueno });
        await dueno.connect();
        try {
          expect(
            (await dueno.query<{ n: number }>("select count(*)::int as n from contexto_clave"))
              .rows[0],
          ).toEqual({ n: 0 });
        } finally {
          await dueno.end();
        }
        const token = tokenCon(aparte.clave, randomUUID());
        expect(await veComoApp(aparte.app, token)).toEqual(CERO);
        const ctx = await enSesion(
          aparte.app,
          token,
          async (c) =>
            (await c.query<{ ctx: unknown }>("select contexto_firmado() as ctx")).rows[0],
        );
        expect(ctx).toEqual({ ctx: null });
      },
      { sinClave: true },
    );
  });

  it("la tabla rechaza kid <= 0 y secretos de menos de 32 bytes", async () => {
    await conBaseConDatos(async (_, __, dueno) => {
      const insertar = async (kid: number, bytes: number) => {
        await dueno.query("savepoint s");
        try {
          await dueno.query("insert into contexto_clave (kid, secreto) values ($1, $2)", [
            kid,
            randomBytes(bytes),
          ]);
          return null;
        } catch (e) {
          return (e as pg.DatabaseError).code;
        } finally {
          await dueno.query("rollback to savepoint s").catch(() => undefined);
        }
      };
      await dueno.query("begin");
      try {
        expect(await insertar(0, 32)).toBe("23514");
        expect(await insertar(-3, 32)).toBe("23514");
        expect(await insertar(4, 31)).toBe("23514");
        expect(await insertar(4, 32)).toBeNull();
      } finally {
        await dueno.query("rollback");
      }
    });
  });

  it("instalarClaveDeContexto: idempotente con el mismo secreto; rechaza otro secreto o una clave revocada, sin filtrar el secreto", async () => {
    await conBaseConDatos(async (aparte, _, dueno) => {
      const k1 = aparte.clave;
      await instalarClaveDeContexto(aparte.dueno, k1); // ya estaba: no hace nada
      const otra: ClaveDeContexto = { kid: 1, secreto: randomBytes(32) };
      const error = await instalarClaveDeContexto(aparte.dueno, otra).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ErrorDeConfiguracion);
      expect((error as Error).message).not.toContain(otra.secreto.toString("hex"));
      expect((error as Error).message).not.toContain(k1.secreto.toString("hex"));
      // Sigue valiendo la original.
      expect(
        (
          await dueno.query("select secreto = $1 as igual from contexto_clave where kid = 1", [
            k1.secreto,
          ])
        ).rows[0],
      ).toEqual({ igual: true });
      await dueno.query("update contexto_clave set vigente = false where kid = 1");
      await expect(instalarClaveDeContexto(aparte.dueno, k1)).rejects.toBeInstanceOf(
        ErrorDeConfiguracion,
      );
    });
  });
});
