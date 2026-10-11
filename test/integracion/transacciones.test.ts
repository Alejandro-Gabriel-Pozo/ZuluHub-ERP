import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  ErrorDeConfiguracion,
  crearTransacciones,
} from "../../src/adaptadores/postgres/transacciones";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import { empresaId, tenantId } from "../../src/primitivas/identificadores/marca";
import {
  comoEmpresa,
  comoPlataforma,
  crearBarrera,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  cuitAlAzar,
  nombreAlAzar,
  type EmpresaDePrueba,
} from "./entorno";

const base = inject("baseDePruebas");

describe.skipIf(base === null)("Transacciones sobre Postgres (ADR-004)", () => {
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let a: EmpresaDePrueba;
  let b: EmpresaDePrueba;

  beforeAll(async () => {
    if (base === null) return;
    entorno = crearEntornoDePrueba(base);
    a = await crearEmpresaActiva(entorno);
    b = await crearEmpresaActiva(entorno);
  });
  afterAll(async () => {
    await entorno.cerrar();
  });

  describe("contexto", () => {
    it("la primera sentencia fija el contexto de la puerta que corresponde", async () => {
      const r = await entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ db }) => {
        const { rows } = await sql<Record<string, string>>`select
          current_user as rol,
          current_setting('app.empresa_id') as empresa,
          current_setting('app.tenant_id') as tenant,
          current_setting('app.persona_id') as persona`.execute(db);
        return ok(rows[0]);
      });
      expect(r).toEqual({
        ok: true,
        valor: { rol: "zuluhub_app", empresa: a.empresa, tenant: "", persona: "" },
      });
      const p = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
        const { rows } = await sql<{ rol: string }>`select current_user as rol`.execute(db);
        return ok(rows[0]?.rol);
      });
      expect(p).toEqual({ ok: true, valor: "zuluhub_plataforma" });
    });

    it("sin la cadena de conexión de la puerta, falla; no cae en otra", async () => {
      if (base === null) return;
      const sinPlataforma = crearTransacciones({
        urls: { OPERATIVO: base.app },
        armar: () => ({}),
      });
      try {
        await expect(
          sinPlataforma.ejecutar({ contexto: comoPlataforma() }, () => Promise.resolve(ok(null))),
        ).rejects.toBeInstanceOf(ErrorDeConfiguracion);
      } finally {
        await sinPlataforma.cerrar();
      }
    });

    it("300 transacciones en paralelo sobre pocas conexiones: cada una ve solo lo suyo", async () => {
      const apretado = crearEntornoDePrueba(base!, 3);
      try {
        const empresas = [a, b];
        const resultados = await Promise.all(
          Array.from({ length: 300 }, (_, i) => {
            const mia = empresas[i % 2] as EmpresaDePrueba;
            return apretado.ejecutar({ contexto: comoEmpresa(mia.empresa) }, async ({ db }) => {
              const { rows } = await sql<{
                empresa_id: string;
              }>`select empresa_id from sucursal`.execute(db);
              return ok(rows.every((f) => f.empresa_id === mia.empresa) && rows.length === 1);
            });
          }),
        );
        expect(resultados.every((r) => r.ok && r.valor)).toBe(true);
      } finally {
        await apretado.cerrar();
      }
    });
  });

  describe("resultado de negocio y atomicidad", () => {
    it("un error de negocio revierte todo y vuelve tal cual", async () => {
      const nombre = nombreAlAzar("revertida");
      const r = await entorno.ejecutar(
        { contexto: comoEmpresa(a.empresa) },
        async ({ sucursales }) => {
          await sucursales.crear(a.empresa, nombre);
          return err("REGLA_DE_NEGOCIO" as const);
        },
      );
      expect(r).toEqual({ ok: false, error: "REGLA_DE_NEGOCIO" });
      const despues = await entorno.ejecutar(
        { contexto: comoEmpresa(a.empresa) },
        async ({ sucursales }) => ok((await sucursales.listar(a.empresa)).map((s) => s.nombre)),
      );
      expect(despues.ok && despues.valor).not.toContain(nombre);
    });

    it("si algo falla a mitad de camino, no queda nada a medias", async () => {
      const nombre = nombreAlAzar("a-medias");
      const r = await entorno.ejecutar(
        { contexto: comoEmpresa(a.empresa) },
        async ({ sucursales, db }) => {
          await sucursales.crear(a.empresa, nombre);
          await sql`insert into sucursal (empresa_id, nombre) values (${b.empresa}, 'ajena')`.execute(
            db,
          );
          return ok(null);
        },
      );
      expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      const despues = await entorno.ejecutar(
        { contexto: comoEmpresa(a.empresa) },
        async ({ sucursales }) => ok((await sucursales.listar(a.empresa)).map((s) => s.nombre)),
      );
      expect(despues.ok && despues.valor).not.toContain(nombre);
    });

    it("una excepción que no viene de la base se vuelve a lanzar: nunca se traga", async () => {
      await expect(
        entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, () => {
          throw new TypeError("error de programación");
        }),
      ).rejects.toThrow("error de programación");
    });
  });

  describe("errores de la base, con nombre", () => {
    const comoAltaDeEmpresa = (tenant: string, cuit: string, razon = nombreAlAzar("e")) =>
      entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
        await sql`insert into empresa (tenant_id, cuit, razon_social) values (${tenant}, ${cuit}, ${razon})`.execute(
          db,
        );
        return ok(null);
      });

    it("23505 → Unicidad, con el nombre de la restricción", async () => {
      expect(await comoAltaDeEmpresa(a.tenant, a.cuit)).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "empresa_cuit_uk" },
      });
    });

    it("23514 → Check: CUIT con dígito verificador equivocado, y transición de estado inválida", async () => {
      expect(await comoAltaDeEmpresa(a.tenant, "20123456787")).toEqual({
        ok: false,
        error: { tipo: "Check", restriccion: "empresa_cuit_ck" },
      });
      const transicion = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
        await sql`update empresa set estado = 'PROVISIONING' where id = ${a.empresa}`.execute(db);
        return ok(null);
      });
      expect(transicion).toEqual({
        ok: false,
        error: { tipo: "Check", restriccion: "empresa_transicion_invalida" },
      });
    });

    it("23503 → Referencia: empresa de un tenant que no existe", async () => {
      expect(await comoAltaDeEmpresa("00000000-0000-4000-8000-000000000000", cuitAlAzar())).toEqual(
        {
          ok: false,
          error: { tipo: "Referencia", restriccion: "empresa_tenant_id_fkey" },
        },
      );
    });

    it("la empresa no se reasigna a otro tenant", async () => {
      const r = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
        await sql`update empresa set tenant_id = ${b.tenant} where id = ${a.empresa}`.execute(db);
        return ok(null);
      });
      // La plataforma no tiene permiso de escribir tenant_id: ni siquiera llega al disparador.
      expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
    });

    it("una transacción de solo lectura no escribe", async () => {
      const r = await entorno.ejecutar(
        { contexto: comoEmpresa(a.empresa), soloLectura: true },
        async ({ sucursales }) => {
          await sucursales.crear(a.empresa, nombreAlAzar("no-debe"));
          return ok(null);
        },
      );
      expect(r).toMatchObject({ ok: false, error: { tipo: "Inesperado", sqlstate: "25006" } });
    });
  });

  describe("reintentos ante conflicto de serialización", () => {
    /**
     * Dos transacciones leen "no hay sucursal con este prefijo" y las dos insertan una: el clásico
     * sesgo de escritura. Bajo SERIALIZABLE el motor aborta una; el adaptador repite el trabajo
     * completo y la repetición ya ve la fila de la otra.
     */
    async function carrera(reintentos: number) {
      const prefijo = nombreAlAzar("unica");
      const encuentro = crearBarrera(2);
      let intentos = 0;
      const intentar = (sufijo: string) =>
        entorno.ejecutar(
          { contexto: comoEmpresa(a.empresa), reintentos },
          async ({ db, sucursales }) => {
            intentos += 1;
            const primerIntento = intentos <= 2;
            const { rows } = await sql<{ n: number }>`
              select count(*)::int as n from sucursal where nombre like ${`${prefijo}%`}`.execute(
              db,
            );
            if (primerIntento) await encuentro();
            if ((rows[0]?.n ?? 0) > 0) return ok("ya existia" as const);
            await sucursales.crear(a.empresa, `${prefijo}-${sufijo}`);
            return ok("creada" as const);
          },
        );
      const [uno, otro] = await Promise.all([intentar("1"), intentar("2")]);
      const total = await entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ db }) => {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from sucursal where nombre like ${`${prefijo}%`}`.execute(db);
        return ok(rows[0]?.n);
      });
      return { uno, otro, total, intentos };
    }

    it("repite el trabajo completo y la invariante se cumple", async () => {
      const { uno, otro, total, intentos } = await carrera(3);
      expect(total).toEqual({ ok: true, valor: 1 });
      const valores = [uno, otro].map((r) => (r.ok ? r.valor : "error")).sort();
      expect(valores).toEqual(["creada", "ya existia"]);
      expect(intentos).toBe(3);
    });

    it("sin reintentos disponibles, devuelve ConcurrenciaAgotada y no deja nada a medias", async () => {
      const { uno, otro, total } = await carrera(0);
      const errores = [uno, otro].filter((r) => !r.ok).map((r) => (r.ok ? null : r.error));
      expect(errores).toEqual([{ tipo: "ConcurrenciaAgotada" }]);
      expect(total).toEqual({ ok: true, valor: 1 });
    });
  });

  describe("tipos de identificador", () => {
    it("los identificadores con marca son texto en ejecución", () => {
      expect(typeof empresaId("x")).toBe("string");
      expect(typeof tenantId("y")).toBe("string");
    });
  });
});

describe.skipIf(base === null)("conexiones ociosas cortadas por el servidor", () => {
  it("se avisa y el proceso sigue vivo; la próxima operación abre otra conexión", async () => {
    if (base === null) return;
    const avisos: Error[] = [];
    const entorno = crearTransacciones({
      urls: { PLATAFORMA: base.plataforma },
      armar: (db) => ({ db }),
      maximoDeConexiones: 1,
      alCortarseUnaConexionOciosa: (e) => avisos.push(e),
    });
    const cliente = new pg.Client({ connectionString: base.dueno });
    await cliente.connect();
    try {
      const rol = () =>
        entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
          const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db);
          return ok(rows[0]?.pid);
        });
      const primera = await rol();
      expect(primera.ok).toBe(true);
      // El servidor corta la conexión que quedó ociosa en el pool.
      await cliente.query("select pg_terminate_backend($1)", [primera.ok ? primera.valor : 0]);
      await new Promise((resolver) => setTimeout(resolver, 100));
      const segunda = await rol();
      expect(segunda.ok).toBe(true);
      expect(segunda.ok && primera.ok && segunda.valor !== primera.valor).toBe(true);
      expect(avisos.length).toBeGreaterThanOrEqual(1);
      expect(avisos[0]).toMatchObject({ code: "57P01" });
    } finally {
      await cliente.end();
      await entorno.cerrar();
    }
  });
});
