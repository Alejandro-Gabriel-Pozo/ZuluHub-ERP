import { randomBytes } from "node:crypto";
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
  crearBaseAparte,
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
          coalesce(app_empresa_id()::text, '') as empresa,
          coalesce(app_tenant_id()::text, '') as tenant,
          coalesce(app_persona_id()::text, '') as persona`.execute(db);
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
        clave: base.clave,
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

    it("si el trabajo atrapa un error de la base y devuelve ok, no se informa éxito: Inesperado 25P02 y nada persiste", async () => {
      const antes = nombreAlAzar("antes-del-error");
      const repetida = nombreAlAzar("repetida");
      const r = await entorno.ejecutar(
        { contexto: comoEmpresa(a.empresa) },
        async ({ sucursales, db }) => {
          await sucursales.crear(a.empresa, antes);
          await sucursales.crear(a.empresa, repetida);
          try {
            // 23505: la base aborta la transacción; atraparlo no la revive.
            await sql`insert into sucursal (empresa_id, nombre) values (${a.empresa}, ${repetida})`.execute(
              db,
            );
          } catch {
            // el trabajo "sigue" como si nada
          }
          return ok("falso exito");
        },
      );
      expect(r).toMatchObject({
        ok: false,
        error: {
          tipo: "Inesperado",
          sqlstate: "25P02",
        },
      });
      expect(!r.ok && r.error).toMatchObject({
        mensaje: expect.stringContaining("abortada") as string,
      });
      const despues = await entorno.ejecutar(
        { contexto: comoEmpresa(a.empresa) },
        async ({ sucursales }) => ok((await sucursales.listar(a.empresa)).map((s) => s.nombre)),
      );
      expect(despues.ok && despues.valor).not.toContain(antes);
      expect(despues.ok && despues.valor).not.toContain(repetida);
    });

    it("un trabajo que atrapa un error de la base pero devuelve un error de negocio vuelve ese error", async () => {
      const r = await entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ db }) => {
        try {
          await sql`select 1/0`.execute(db);
        } catch {
          return err("YA_LO_SABIA" as const);
        }
        return ok(null);
      });
      expect(r).toEqual({ ok: false, error: "YA_LO_SABIA" });
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
     * Base PROPIA: bajo SERIALIZABLE, los otros archivos que escriben en `sucursal` al mismo tiempo
     * generan conflictos falsos (el recuento por prefijo recorre la tabla entera) y la repetición
     * también puede abortar hasta agotar los reintentos. Con una base aparte, el único conflicto es el
     * de la carrera que la prueba arma a propósito.
     */
    let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
    let propio: ReturnType<typeof crearEntornoDePrueba>;
    let ea: EmpresaDePrueba;

    beforeAll(async () => {
      if (base === null) return;
      aparte = await crearBaseAparte(base);
      propio = crearEntornoDePrueba(aparte.base);
      ea = await crearEmpresaActiva(propio);
    });
    afterAll(async () => {
      await propio.cerrar();
      await aparte.destruir();
    });

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
        propio.ejecutar(
          { contexto: comoEmpresa(ea.empresa), reintentos },
          async ({ db, sucursales }) => {
            intentos += 1;
            const primerIntento = intentos <= 2;
            const { rows } = await sql<{ n: number }>`
              select count(*)::int as n from sucursal where nombre like ${`${prefijo}%`}`.execute(
              db,
            );
            if (primerIntento) await encuentro();
            if ((rows[0]?.n ?? 0) > 0) return ok("ya existia" as const);
            await sucursales.crear(ea.empresa, `${prefijo}-${sufijo}`);
            return ok("creada" as const);
          },
        );
      const [uno, otro] = await Promise.all([intentar("1"), intentar("2")]);
      const total = await propio.ejecutar({ contexto: comoEmpresa(ea.empresa) }, async ({ db }) => {
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
      // Al menos las dos corridas iniciales más un reintento. No es un número exacto: SERIALIZABLE
      // puede abortar también la repetición (falsos positivos del detector con tablas chicas) y
      // eso sube el conteo sin romper la invariante, que es lo que esta prueba garantiza.
      expect(intentos).toBeGreaterThanOrEqual(3);
    });

    it("sin reintentos disponibles, devuelve ConcurrenciaAgotada y no deja nada a medias", async () => {
      const { uno, otro, total } = await carrera(0);
      const errores = [uno, otro].filter((r) => !r.ok).map((r) => (r.ok ? null : r.error));
      expect(errores).toEqual([{ tipo: "ConcurrenciaAgotada" }]);
      expect(total).toEqual({ ok: true, valor: 1 });
    });
    it.each([
      ["NaN", Number.NaN],
      ["negativo", -1],
      ["fraccionario", 1.5],
      ["infinito", Number.POSITIVE_INFINITY],
    ])(
      "reintentos inválido (%s): RangeError, sin ejecutar el trabajo",
      async (_nombre, reintentos) => {
        let corrio = false;
        await expect(
          propio.ejecutar({ contexto: comoEmpresa(ea.empresa), reintentos }, () => {
            corrio = true;
            return Promise.resolve(ok(null));
          }),
        ).rejects.toBeInstanceOf(RangeError);
        expect(corrio).toBe(false);
      },
    );

    it("reintentos: 0 es válido y el trabajo corre una vez", async () => {
      let corridas = 0;
      const r = await propio.ejecutar({ contexto: comoEmpresa(ea.empresa), reintentos: 0 }, () => {
        corridas += 1;
        return Promise.resolve(ok("listo"));
      });
      expect(r).toEqual({ ok: true, valor: "listo" });
      expect(corridas).toBe(1);
    });

    /**
     * Dos transacciones toman dos filas en orden opuesto: A bloquea S1 y pide S2; B bloquea S2 y
     * pide S1. El motor detecta el ciclo (deadlock_timeout, 1 s) y aborta una con 40P01; el
     * adaptador repite el trabajo completo y las DOS terminan bien. La barrera asegura que cada una
     * ya tiene su primera fila antes de pedir la segunda (solo en el primer intento de cada una).
     *
     * Corre en READ COMMITTED a propósito: bajo SERIALIZABLE el detector de dependencias puede
     * abortar con 40001 a una de las dos ANTES de la barrera (cada una lee la tabla entera con un
     * scan secuencial), la barrera quedaría sin su segunda participante y la prueba se colgaría.
     * El deadlock es un problema de bloqueos de fila, igual en ambos niveles.
     */
    it("deadlock (40P01): el motor aborta una, el adaptador repite el trabajo y ambas terminan ok", async () => {
      const par = await crearEmpresaActiva(propio, { nombreDeSucursal: nombreAlAzar("s1") });
      const s2 = nombreAlAzar("s2");
      const filas = await propio.ejecutar(
        { contexto: comoEmpresa(par.empresa) },
        async ({ sucursales }) => {
          await sucursales.crear(par.empresa, s2);
          return ok(await sucursales.listar(par.empresa));
        },
      );
      if (!filas.ok) throw new Error("no se prepararon las sucursales del deadlock");
      const [primera, segunda] = filas.valor.map((f) => f.id);
      if (primera === undefined || segunda === undefined) throw new Error("faltan sucursales");

      const encuentro = crearBarrera(2);
      const intentos = { A: 0, B: 0 };
      const mover = (quien: "A" | "B", orden: [string, string]) =>
        propio.ejecutar(
          { contexto: comoEmpresa(par.empresa), aislamiento: "read committed" },
          async ({ db }) => {
            intentos[quien] += 1;
            const intento = intentos[quien];
            const renombrar = (id: string, paso: number) =>
              sql`update sucursal set nombre = ${`${quien}-${intento}-${paso}-${randomBytes(3).toString("hex")}`}
                where id = ${id}`.execute(db);
            await renombrar(orden[0], 1);
            if (intento === 1) await encuentro();
            await renombrar(orden[1], 2);
            return ok(quien);
          },
        );

      const [ra, rb] = await Promise.all([
        mover("A", [primera, segunda]),
        mover("B", [segunda, primera]),
      ]);
      expect(ra).toEqual({ ok: true, valor: "A" });
      expect(rb).toEqual({ ok: true, valor: "B" });
      // Una de las dos fue víctima del deadlock y repitió el trabajo completo.
      expect(intentos.A + intentos.B).toBeGreaterThanOrEqual(3);
    }, 30_000);
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
      clave: base.clave,
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
      // Espera a que el pool se entere (hasta 5 s) en vez de una pausa fija: bajo carga el aviso
      // puede tardar más de 100 ms y la prueba dependía de eso.
      for (let espera = 0; avisos.length === 0 && espera < 100; espera += 1) {
        await new Promise((resolver) => setTimeout(resolver, 50));
      }
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

describe.skipIf(base === null)("registro de errores inesperados", () => {
  function entornoConRegistro(registro: (e: unknown) => void) {
    return crearTransacciones({
      urls: { PLATAFORMA: base!.plataforma, OPERATIVO: base!.app },
      clave: base!.clave,
      armar: (db) => ({ db }),
      maximoDeConexiones: 2,
      alRegistrarErrorInesperado: registro,
    });
  }

  it("se avisa de cada Inesperado, y lo que se devuelve no cambia", async () => {
    const registrados: unknown[] = [];
    const entorno = entornoConRegistro((e) => registrados.push(e));
    try {
      const r = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
        await sql`select 1/0`.execute(db);
        return ok(null);
      });
      expect(r).toMatchObject({ ok: false, error: { tipo: "Inesperado", sqlstate: "22012" } });
      expect(registrados).toHaveLength(1);
      expect(registrados[0]).toEqual(r.ok ? null : r.error);
    } finally {
      await entorno.cerrar();
    }
  });

  it("también se avisa del Inesperado por transacción abortada (25P02)", async () => {
    const registrados: unknown[] = [];
    const entorno = entornoConRegistro((e) => registrados.push(e));
    try {
      await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
        try {
          await sql`select 1/0`.execute(db);
        } catch {
          // atrapado
        }
        return ok(null);
      });
      expect(registrados).toMatchObject([{ tipo: "Inesperado", sqlstate: "25P02" }]);
    } finally {
      await entorno.cerrar();
    }
  });

  it("no se avisa de los errores con nombre ni de los de negocio ni de los éxitos", async () => {
    const registrados: unknown[] = [];
    const entorno = entornoConRegistro((e) => registrados.push(e));
    try {
      const negocio = await entorno.ejecutar({ contexto: comoPlataforma() }, () =>
        Promise.resolve(err("NEGOCIO" as const)),
      );
      const exito = await entorno.ejecutar({ contexto: comoPlataforma() }, () =>
        Promise.resolve(ok(1)),
      );
      const acceso = await entorno.ejecutar(
        { contexto: comoEmpresa(empresaId("x")) },
        async ({ db }) => {
          await sql`insert into tenant (nombre) values ('no puede')`.execute(db);
          return ok(null);
        },
      );
      expect(negocio).toEqual({ ok: false, error: "NEGOCIO" });
      expect(exito).toEqual({ ok: true, valor: 1 });
      expect(acceso).toMatchObject({ ok: false, error: { tipo: "AccesoDenegado" } });
      expect(registrados).toEqual([]);
    } finally {
      await entorno.cerrar();
    }
  });

  it("si el registro mismo falla, el resultado sigue siendo el error de persistencia", async () => {
    const entorno = entornoConRegistro(() => {
      throw new Error("el registro está caído");
    });
    try {
      const r = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
        await sql`select 1/0`.execute(db);
        return ok(null);
      });
      expect(r).toMatchObject({ ok: false, error: { tipo: "Inesperado", sqlstate: "22012" } });
    } finally {
      await entorno.cerrar();
    }
  });
});
