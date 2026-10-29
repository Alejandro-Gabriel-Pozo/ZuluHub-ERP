import { sql, type RawBuilder } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Contexto } from "../../src/contexto/contexto";
import { personaId, type PersonaId } from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import { ADMIN_DE_PRUEBA } from "./admins-de-prueba";
import {
  comoEmpresa,
  comoGrupo,
  comoPlataforma,
  comoTrabajos,
  crearEmpresaActiva,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  crearPropietario,
  cuitAlAzar,
  nombreAlAzar,
  type EmpresaDePrueba,
} from "./entorno";

const base = inject("baseDePruebas");

type Entorno = ReturnType<typeof crearEntornoDePrueba>;

const DENEGADO = { ok: false, error: { tipo: "AccesoDenegado" } } as const;

describe.skipIf(base === null)("aislamiento por empresa (RLS)", () => {
  let entorno: Entorno;
  let a: EmpresaDePrueba;
  let b: EmpresaDePrueba;
  let c: EmpresaDePrueba; // mismo tenant que A
  let otroTenant: EmpresaDePrueba;

  beforeAll(async () => {
    if (base === null) return;
    entorno = crearEntornoDePrueba(base);
    a = await crearEmpresaActiva(entorno, { nombreDeSucursal: "Sucursal de A" });
    b = await crearEmpresaActiva(entorno, { nombreDeSucursal: "Sucursal de B" });
    c = await crearEmpresaActiva(entorno, { tenant: a.tenant, nombreDeSucursal: "Sucursal de C" });
    otroTenant = await crearEmpresaActiva(entorno, { nombreDeSucursal: "Sucursal de otro tenant" });
  });
  afterAll(async () => {
    await entorno.cerrar();
  });

  /** Ejecuta una sentencia con el contexto dado y devuelve ok(null) o el error de persistencia. */
  const intentar = (contexto: Contexto, consulta: RawBuilder<unknown>) =>
    entorno.ejecutar({ contexto }, async ({ db }) => {
      await consulta.execute(db);
      return ok(null);
    });
  const comoPlataformaEjecutar = async (consulta: RawBuilder<unknown>) => {
    const r = await intentar(comoPlataforma(), consulta);
    if (!r.ok) throw new Error(`falló la preparación: ${JSON.stringify(r.error)}`);
  };

  const nombresDeSucursales = async (contexto: ReturnType<typeof comoEmpresa>) => {
    const r = await entorno.ejecutar({ contexto }, async ({ db }) => {
      const { rows } = await sql<{
        nombre: string;
      }>`select nombre from sucursal order by nombre`.execute(db);
      return ok(rows.map((f) => f.nombre));
    });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.valor;
  };

  describe("la empresa A no ve ni toca lo de B", () => {
    it("una consulta sin filtro solo devuelve las filas de la propia empresa", async () => {
      expect(await nombresDeSucursales(comoEmpresa(a.empresa))).toEqual(["Sucursal de A"]);
      expect(await nombresDeSucursales(comoEmpresa(b.empresa))).toEqual(["Sucursal de B"]);
    });

    it("tampoco por identificador: la fila de B es invisible desde A", async () => {
      const idDeB = await entorno.ejecutar(
        { contexto: comoEmpresa(b.empresa) },
        async ({ sucursales }) => ok((await sucursales.listar(b.empresa))[0]?.id),
      );
      expect(idDeB.ok && idDeB.valor).toBeTruthy();
      const desdeA = await entorno.ejecutar(
        { contexto: comoEmpresa(a.empresa) },
        async ({ db }) => {
          const { rows } =
            await sql`select * from sucursal where id = ${idDeB.ok ? idDeB.valor : ""}`.execute(db);
          return ok(rows.length);
        },
      );
      expect(desdeA).toEqual({ ok: true, valor: 0 });
    });

    it("modificar la fila de B desde A no afecta ninguna fila", async () => {
      const r = await entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ db }) => {
        const res =
          await sql`update sucursal set nombre = 'tomada' where empresa_id = ${b.empresa}`.execute(
            db,
          );
        return ok(Number(res.numAffectedRows));
      });
      expect(r).toEqual({ ok: true, valor: 0 });
      expect(await nombresDeSucursales(comoEmpresa(b.empresa))).toEqual(["Sucursal de B"]);
    });

    it("insertar una fila a nombre de B desde A se rechaza", async () => {
      const r = await entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ db }) => {
        await sql`insert into sucursal (empresa_id, nombre) values (${b.empresa}, 'intrusa')`.execute(
          db,
        );
        return ok(null);
      });
      expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
    });

    it("nadie borra: DELETE no está permitido a ningún rol", async () => {
      const r = await entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ db }) => {
        await sql`delete from sucursal`.execute(db);
        return ok(null);
      });
      expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
    });

    it("la empresa ve solo su propia fila de empresa y su propio tenant", async () => {
      const r = await entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ db }) => {
        const e = await sql<{ id: string }>`select id from empresa`.execute(db);
        const t = await sql<{ id: string }>`select id from tenant`.execute(db);
        return ok({ empresas: e.rows.map((f) => f.id), tenants: t.rows.map((f) => f.id) });
      });
      expect(r).toEqual({ ok: true, valor: { empresas: [a.empresa], tenants: [a.tenant] } });
    });

    it("la empresa no puede cambiar su propio estado: la política de activación del alta (H3) no deja pasar nada sin una aceptación de alta", async () => {
      // Desde H3 la aplicación tiene UPDATE(estado, motivo_estado) sobre `empresa`, acotado por una
      // política que solo se abre con el contexto de INVITACION de un alta aceptada: en el contexto
      // operativo no afecta ninguna fila (ni se rechaza: simplemente no ve filas que actualizar).
      for (const consulta of [
        sql`update empresa set estado = 'SUSPENDED', motivo_estado = 'x'`,
        sql`update empresa set estado = 'ACTIVE'`,
        sql`update empresa set estado = 'CANCELLED', motivo_estado = 'x' where id = ${a.empresa}`,
      ]) {
        const r = await entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ db }) => {
          const res = await consulta.execute(db);
          return ok(Number(res.numAffectedRows));
        });
        expect(r).toEqual({ ok: true, valor: 0 });
      }
      const estado = await entorno.ejecutar(
        { contexto: comoEmpresa(a.empresa) },
        async ({ db }) => {
          const { rows } = await sql<{ estado: string }>`select estado from empresa`.execute(db);
          return ok(rows.map((f) => f.estado));
        },
      );
      expect(estado).toEqual({ ok: true, valor: ["ACTIVE"] });
    });

    it("la empresa no puede cambiar su propio CUIT ni tenant, ni tocar el tenant: no tiene permiso de escritura", async () => {
      for (const consulta of [
        sql`update empresa set cuit = '20123456786'`,
        sql`update empresa set tenant_id = tenant_id`,
        sql`update tenant set nombre = 'otro'`,
        sql`insert into tenant (nombre) values ('nuevo')`,
      ]) {
        const r = await entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ db }) => {
          await consulta.execute(db);
          return ok(null);
        });
        expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      }
    });
  });

  describe("mismo tenant no es acceso", () => {
    it("la empresa A no ve la empresa C, aunque sean del mismo cliente", async () => {
      expect(a.tenant).toBe(c.tenant);
      expect(await nombresDeSucursales(comoEmpresa(a.empresa))).toEqual(["Sucursal de A"]);
      expect(await nombresDeSucursales(comoEmpresa(c.empresa))).toEqual(["Sucursal de C"]);
      const r = await entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ empresas }) =>
        ok(await empresas.obtener(c.empresa)),
      );
      expect(r).toEqual({ ok: true, valor: null });
    });
  });

  describe("sin contexto no se ve nada", () => {
    it("una conexión de la aplicación que no fijó contexto ve cero filas", async () => {
      if (base === null) return;
      const cliente = new pg.Client({ connectionString: base.app });
      await cliente.connect();
      try {
        for (const tabla of [
          "empresa",
          "tenant",
          "sucursal",
          "persona",
          "auditoria_empresa",
          "trabajo",
        ]) {
          const r = await cliente.query(`select count(*)::int as n from ${tabla}`);
          expect(r.rows[0]).toEqual({ n: 0 });
        }
      } finally {
        await cliente.end();
      }
    });

    // Limitación honesta: cada transacción vuelve a fijar los tres valores de contexto, así que este
    // test NO detectaría un set_config(..., false) (de sesión) que dejara el contexto "pegado": la
    // transacción siguiente lo pisaría igual. Lo que sí prueba es que, compartiendo la única
    // conexión del pool, cada transacción ve exclusivamente los datos de su propio contexto. Que
    // el contexto sea local a la transacción (set_config con `true`) lo garantiza el adaptador;
    // este test no lo verifica por sí solo.
    it("cada transacción ve solo lo de su contexto aunque comparta conexión", async () => {
      const unaSola = crearEntornoDePrueba(base!, 1);
      try {
        const contar = async (contexto: ReturnType<typeof comoEmpresa>) => {
          const r = await unaSola.ejecutar({ contexto }, async ({ db }) => {
            const { rows } = await sql<{
              n: number;
            }>`select count(*)::int as n from sucursal`.execute(db);
            return ok(rows[0]?.n);
          });
          return r.ok ? r.valor : -1;
        };
        expect(await contar(comoEmpresa(a.empresa))).toBe(1);
        expect(await contar(comoEmpresa(b.empresa))).toBe(1);
        expect(await contar(comoEmpresa(otroTenant.empresa))).toBe(1);
      } finally {
        await unaSola.cerrar();
      }
    });
  });

  describe("el dueño del grupo (PROPIETARIO) lee pero no escribe", () => {
    it("ve todas las empresas y sucursales de su tenant, y no las de otro", async () => {
      const dueno = await crearPropietario(entorno, a.tenant);
      const r = await entorno.ejecutar({ contexto: comoGrupo(a.tenant, dueno) }, async ({ db }) => {
        const e = await sql<{ id: string }>`select id from empresa order by id`.execute(db);
        const s = await sql<{
          nombre: string;
        }>`select nombre from sucursal order by nombre`.execute(db);
        return ok({
          empresas: e.rows.map((f) => f.id).sort(),
          sucursales: s.rows.map((f) => f.nombre),
        });
      });
      expect(r).toEqual({
        ok: true,
        valor: {
          empresas: [a.empresa, c.empresa].sort(),
          sucursales: ["Sucursal de A", "Sucursal de C"],
        },
      });
    });

    it("el repositorio de sucursales filtra por empresa por sí mismo: con la política del grupo, que deja ver las dos empresas del tenant, `listar(A)` trae solo las de A", async () => {
      // Acá la RLS NO separa a A de C (el grupo ve las dos): lo único que las separa es el `where empresa_id` del repositorio.
      // Sin ese filtro, `listar(A)` traería también las de C y esta prueba falla.
      const dueno = await crearPropietario(entorno, a.tenant);
      const listadas = async (empresa: string) => {
        const r = await entorno.ejecutar(
          { contexto: comoGrupo(a.tenant, dueno) },
          async ({ sucursales }) =>
            ok((await sucursales.listar(empresa as never)).map((s) => s.nombre)),
        );
        if (!r.ok) throw new Error(JSON.stringify(r.error));
        return r.valor;
      };
      expect(await listadas(a.empresa)).toEqual(["Sucursal de A"]);
      expect(await listadas(c.empresa)).toEqual(["Sucursal de C"]);
    });

    it("no puede escribir en ninguna empresa: ni insertar, ni modificar, ni borrar", async () => {
      const dueno = await crearPropietario(entorno, a.tenant);
      for (const consulta of [
        sql`insert into sucursal (empresa_id, nombre) values (${a.empresa}, 'nueva')`,
        sql`update sucursal set nombre = 'x'`,
        sql`delete from sucursal`,
        sql`update empresa set razon_social = 'x'`,
        sql`update tenant set nombre = 'x'`,
      ]) {
        const r = await entorno.ejecutar(
          { contexto: comoGrupo(a.tenant, dueno) },
          async ({ db }) => {
            await consulta.execute(db);
            return ok(null);
          },
        );
        expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      }
    });

    it("no lee ninguna empresa de otro tenant, ni aunque lo pida por contexto", async () => {
      const dueno = await crearPropietario(entorno, a.tenant);
      const r = await entorno.ejecutar(
        { contexto: comoGrupo(otroTenant.tenant, dueno) },
        async ({ db }) => {
          const e = await sql`select id from empresa`.execute(db);
          const s = await sql`select id from sucursal`.execute(db);
          const t = await sql`select id from tenant`.execute(db);
          return ok([e.rows.length, s.rows.length, t.rows.length]);
        },
      );
      expect(r).toEqual({ ok: true, valor: [0, 0, 0] });
    });

    it("quien no es propietario, o lo es con la membresía apagada, no ve nada en ninguna tabla", async () => {
      const inactivo = await crearPropietario(entorno, a.tenant, { activo: false });
      const sinMembresia = await entorno.ejecutar(
        { contexto: comoPlataforma() },
        async ({ db }) => {
          const { rows } = await sql<{ id: string }>`
          insert into persona (email) values (${`${nombreAlAzar("sin")}@prueba.test`}) returning id`.execute(
            db,
          );
          return ok(rows[0]?.id as string);
        },
      );
      if (!sinMembresia.ok) throw new Error("sin persona");
      const deOtroTenant = await crearPropietario(entorno, otroTenant.tenant);
      for (const persona of [inactivo, personaId(sinMembresia.valor), deOtroTenant]) {
        const r = await entorno.ejecutar(
          { contexto: comoGrupo(a.tenant, persona) },
          async ({ db }) => {
            const conteos: number[] = [];
            for (const tabla of ["empresa", "sucursal", "tenant"]) {
              const { rows } = await sql<{
                n: number;
              }>`select count(*)::int as n from ${sql.table(tabla)}`.execute(db);
              conteos.push(rows[0]?.n ?? -1);
            }
            return ok(conteos);
          },
        );
        expect(r, persona).toEqual({ ok: true, valor: [0, 0, 0] });
      }
    });

    it("una persona desactivada globalmente deja de ver el grupo aunque su membresía siga activa", async () => {
      const dueno = await crearPropietario(entorno, a.tenant);
      const desactivar = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
        await sql`update persona set activo_global = false where id = ${dueno}`.execute(db);
        return ok(null);
      });
      expect(desactivar.ok).toBe(true);
      const r = await entorno.ejecutar({ contexto: comoGrupo(a.tenant, dueno) }, async ({ db }) => {
        const { rows } = await sql<{ n: number }>`select count(*)::int as n from empresa`.execute(
          db,
        );
        return ok(rows[0]?.n);
      });
      expect(r).toEqual({ ok: true, valor: 0 });
    });

    it("con el tenant suspendido ve la lista y los estados, pero no los datos operativos", async () => {
      const aparte = await crearEmpresaActiva(entorno, { nombreDeSucursal: "Datos operativos" });
      const dueno = await crearPropietario(entorno, aparte.tenant);
      const suspension = await entorno.ejecutar(
        { contexto: comoPlataforma() },
        async ({ tenants }) => {
          const t = await tenants.obtener(aparte.tenant);
          if (t === null) throw new Error("sin tenant");
          const cambio = await tenants.cambiarEstado(t.id, t.version, {
            estado: "SUSPENDED",
            motivoEstado: "prueba",
          });
          return ok(cambio.ok);
        },
      );
      expect(suspension).toEqual({ ok: true, valor: true });

      const r = await entorno.ejecutar(
        { contexto: comoGrupo(aparte.tenant, dueno) },
        async ({ db }) => {
          const e = await sql<{ estado: string }>`select estado from empresa`.execute(db);
          const s = await sql`select id from sucursal`.execute(db);
          const t = await sql<{ estado: string }>`select estado from tenant`.execute(db);
          return ok({
            empresas: e.rows.map((f) => f.estado),
            sucursales: s.rows.length,
            tenant: t.rows.map((f) => f.estado),
          });
        },
      );
      expect(r).toEqual({
        ok: true,
        valor: { empresas: ["ACTIVE"], sucursales: 0, tenant: ["SUSPENDED"] },
      });
    });

    it("con una empresa suspendida y el tenant activo, el propietario sí ve sus sucursales", async () => {
      const aparte = await crearEmpresaActiva(entorno, { nombreDeSucursal: "Sucursal suspendida" });
      const dueno = await crearPropietario(entorno, aparte.tenant);
      await comoPlataformaEjecutar(
        sql`update empresa set estado = 'SUSPENDED', motivo_estado = 'revisión' where id = ${aparte.empresa}`,
      );
      const r = await entorno.ejecutar(
        { contexto: comoGrupo(aparte.tenant, dueno) },
        async ({ db }) => {
          const e = await sql<{ estado: string }>`select estado from empresa`.execute(db);
          const s = await sql<{ nombre: string }>`select nombre from sucursal`.execute(db);
          return ok({
            empresas: e.rows.map((f) => f.estado),
            sucursales: s.rows.map((f) => f.nombre),
          });
        },
      );
      expect(r).toEqual({
        ok: true,
        valor: { empresas: ["SUSPENDED"], sucursales: ["Sucursal suspendida"] },
      });
    });

    it("deja registro de su acceso, y no puede registrarlo a nombre de otro", async () => {
      const dueno = await crearPropietario(entorno, a.tenant);
      const otro = await crearPropietario(entorno, a.tenant);
      const propio = await entorno.ejecutar(
        { contexto: comoGrupo(a.tenant, dueno) },
        async ({ db }) => {
          await sql`insert into auditoria_acceso_grupo (tenant_id, persona_id, empresa_id)
                  values (${a.tenant}, ${dueno}, ${a.empresa})`.execute(db);
          return ok(null);
        },
      );
      expect(propio).toEqual({ ok: true, valor: null });
      const ajeno = await entorno.ejecutar(
        { contexto: comoGrupo(a.tenant, dueno) },
        async ({ db }) => {
          await sql`insert into auditoria_acceso_grupo (tenant_id, persona_id, empresa_id)
                  values (${a.tenant}, ${otro}, ${a.empresa})`.execute(db);
          return ok(null);
        },
      );
      expect(ajeno).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      const deOtroTenant = await entorno.ejecutar(
        { contexto: comoGrupo(a.tenant, dueno) },
        async ({ db }) => {
          await sql`insert into auditoria_acceso_grupo (tenant_id, persona_id)
                  values (${otroTenant.tenant}, ${dueno})`.execute(db);
          return ok(null);
        },
      );
      expect(deOtroTenant).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
    });
  });

  describe("el rol de plataforma administra sin leer datos operativos", () => {
    it("puede sembrar una sucursal, pero no leerla ni modificarla ni borrarla", async () => {
      const sembrar = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
        await sql`insert into sucursal (empresa_id, nombre) values (${a.empresa}, ${nombreAlAzar("sembrada")})`.execute(
          db,
        );
        return ok(null);
      });
      expect(sembrar).toEqual({ ok: true, valor: null });
      for (const consulta of [
        sql`select * from sucursal`,
        sql`update sucursal set nombre = 'x'`,
        sql`delete from sucursal`,
        sql`select * from auditoria_empresa`,
      ]) {
        const r = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
          await consulta.execute(db);
          return ok(null);
        });
        expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      }
    });

    it("ve tenants y empresas, que es lo que administra", async () => {
      const r = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
        const e = await sql<{ n: number }>`select count(*)::int as n from empresa`.execute(db);
        return ok((e.rows[0]?.n ?? 0) >= 4);
      });
      expect(r).toEqual({ ok: true, valor: true });
    });

    it("no puede borrar nada en ninguna tabla", async () => {
      for (const tabla of [
        "tenant",
        "empresa",
        "persona",
        "membresia_tenant",
        "trabajo",
        "auditoria_plataforma",
      ]) {
        const r = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
          await sql.raw(`delete from ${tabla}`).execute(db);
          return ok(null);
        });
        expect(r, tabla).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      }
    });
  });

  describe("el rol de trabajos solo ve y avanza la cola", () => {
    it("lee y avanza trabajos, pero no ve datos de negocio", async () => {
      const clave = nombreAlAzar("trabajo");
      const encolar = await entorno.ejecutar(
        { contexto: comoEmpresa(a.empresa) },
        async ({ db }) => {
          await sql`insert into trabajo (empresa_id, tipo, clave_idempotencia)
                  values (${a.empresa}, 'enviar_invitacion', ${clave})`.execute(db);
          return ok(null);
        },
      );
      expect(encolar).toEqual({ ok: true, valor: null });

      const avanzar = await entorno.ejecutar({ contexto: comoTrabajos() }, async ({ db }) => {
        const res = await sql`update trabajo set estado = 'EN_CURSO', intentos = intentos + 1
                              where clave_idempotencia = ${clave}`.execute(db);
        return ok(Number(res.numAffectedRows));
      });
      expect(avanzar).toEqual({ ok: true, valor: 1 });

      for (const tabla of ["empresa", "tenant", "sucursal", "persona", "auditoria_empresa"]) {
        const r = await entorno.ejecutar({ contexto: comoTrabajos() }, async ({ db }) => {
          await sql.raw(`select * from ${tabla}`).execute(db);
          return ok(null);
        });
        expect(r, tabla).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      }
    });

    it("la misma clave de idempotencia puede usarse desde dos empresas distintas", async () => {
      const clave = nombreAlAzar("compartida");
      const encolar = (e: EmpresaDePrueba) =>
        intentar(
          comoEmpresa(e.empresa),
          sql`insert into trabajo (empresa_id, tipo, clave_idempotencia)
              values (${e.empresa}, 'enviar_invitacion', ${clave})`,
        );
      expect(await encolar(a)).toEqual({ ok: true, valor: null });
      expect(await encolar(b)).toEqual({ ok: true, valor: null });
      // Y dentro de cada empresa sigue siendo única.
      const repetida = { ok: false, error: { tipo: "Unicidad", restriccion: "trabajo_clave_uk" } };
      expect(await encolar(a)).toEqual(repetida);
      expect(await encolar(b)).toEqual(repetida);
    });

    it("dos trabajos del ámbito plataforma (sin empresa) con la misma clave chocan", async () => {
      const clave = nombreAlAzar("plataforma");
      const encolar = () =>
        intentar(
          comoPlataforma(),
          sql`insert into trabajo (empresa_id, tipo, clave_idempotencia)
              values (null, 'mantenimiento', ${clave})`,
        );
      expect(await encolar()).toEqual({ ok: true, valor: null });
      expect(await encolar()).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "trabajo_clave_uk" },
      });
    });

    it("encolar dos veces la misma clave deja una sola fila", async () => {
      const clave = nombreAlAzar("idem");
      const encolar = () =>
        entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ db }) => {
          await sql`insert into trabajo (empresa_id, tipo, clave_idempotencia)
                    values (${a.empresa}, 'enviar_invitacion', ${clave})`.execute(db);
          return ok(null);
        });
      expect(await encolar()).toEqual({ ok: true, valor: null });
      expect(await encolar()).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "trabajo_clave_uk" },
      });
    });
  });

  describe("una empresa que no está operable no encola ni audita", () => {
    const CASOS: ReadonlyArray<{ nombre: string; preparar: () => Promise<EmpresaDePrueba> }> = [
      {
        nombre: "el tenant suspendido",
        preparar: async () => {
          const e = await crearEmpresaActiva(entorno);
          await comoPlataformaEjecutar(
            sql`update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = ${e.tenant}`,
          );
          return e;
        },
      },
      {
        nombre: "la empresa suspendida (con el tenant activo)",
        preparar: async () => {
          const e = await crearEmpresaActiva(entorno);
          await comoPlataformaEjecutar(
            sql`update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = ${e.empresa}`,
          );
          return e;
        },
      },
      { nombre: "la empresa todavía en alta", preparar: () => crearEmpresaEnAlta(entorno) },
    ];

    const encolar = (e: EmpresaDePrueba) =>
      intentar(
        comoEmpresa(e.empresa),
        sql`insert into trabajo (empresa_id, tipo, clave_idempotencia)
            values (${e.empresa}, 'enviar_invitacion', ${nombreAlAzar("clave")})`,
      );
    const auditar = (e: EmpresaDePrueba, actor: PersonaId | null = null) =>
      intentar(
        comoEmpresa(e.empresa, actor),
        sql`insert into auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id)
            values (${e.empresa}, ${actor}, 'PRUEBA', 'sucursal', 'x')`,
      );

    for (const caso of CASOS) {
      it(`con ${caso.nombre}: ni encola un trabajo ni escribe una auditoría`, async () => {
        const e = await caso.preparar();
        expect(await encolar(e)).toEqual(DENEGADO);
        expect(await auditar(e)).toEqual(DENEGADO);
      });
    }

    it("al reactivar el tenant vuelve a poder encolar y auditar", async () => {
      const e = await crearEmpresaActiva(entorno);
      await comoPlataformaEjecutar(
        sql`update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = ${e.tenant}`,
      );
      expect(await encolar(e)).toEqual(DENEGADO);
      await comoPlataformaEjecutar(
        sql`update tenant set estado = 'ACTIVE', motivo_estado = null where id = ${e.tenant}`,
      );
      expect(await encolar(e)).toEqual({ ok: true, valor: null });
      expect(await auditar(e)).toEqual({ ok: true, valor: null });
    });

    it("la auditoría de la aplicación se escribe a nombre de la persona del contexto, no de otra", async () => {
      const e = await crearEmpresaActiva(entorno);
      const yo = await crearPropietario(entorno, e.tenant);
      const otra = await crearPropietario(entorno, e.tenant);
      expect(await auditar(e, yo)).toEqual({ ok: true, valor: null });
      expect(await auditar(e, null)).toEqual({ ok: true, valor: null });

      const comoYoAuditandoA = (actor: PersonaId | null) =>
        intentar(
          comoEmpresa(e.empresa, yo),
          sql`insert into auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id)
              values (${e.empresa}, ${actor}, 'PRUEBA', 'sucursal', 'x')`,
        );
      expect(await comoYoAuditandoA(yo)).toEqual({ ok: true, valor: null });
      expect(await comoYoAuditandoA(otra)).toEqual(DENEGADO);
      expect(await comoYoAuditandoA(null)).toEqual(DENEGADO);
      // Sin persona en el contexto tampoco se puede firmar a nombre de alguien.
      const sinPersona = await intentar(
        comoEmpresa(e.empresa),
        sql`insert into auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id)
            values (${e.empresa}, ${otra}, 'PRUEBA', 'sucursal', 'x')`,
      );
      expect(sinPersona).toEqual(DENEGADO);
    });
  });

  describe("el INSERT es por columna: nadie falsea creado_en, version, estado ni intentos", () => {
    const hace = "2001-01-01T00:00:00Z";
    const CASOS: ReadonlyArray<{
      nombre: string;
      contexto: () => Contexto;
      consulta: () => RawBuilder<unknown>;
    }> = [
      {
        nombre: "plataforma: una empresa dada de alta directamente como ACTIVE",
        contexto: comoPlataforma,
        consulta: () =>
          sql`insert into empresa (tenant_id, cuit, razon_social, estado)
              values (${a.tenant}, ${cuitAlAzar()}, ${nombreAlAzar("e")}, 'ACTIVE')`,
      },
      {
        nombre: "plataforma: una empresa con creado_en antedatado",
        contexto: comoPlataforma,
        consulta: () =>
          sql`insert into empresa (tenant_id, cuit, razon_social, creado_en)
              values (${a.tenant}, ${cuitAlAzar()}, ${nombreAlAzar("e")}, ${hace})`,
      },
      {
        nombre: "plataforma: un tenant con creado_en antedatado",
        contexto: comoPlataforma,
        consulta: () =>
          sql`insert into tenant (nombre, creado_en) values (${nombreAlAzar("t")}, ${hace})`,
      },
      {
        nombre: "plataforma: un tenant con version elegida",
        contexto: comoPlataforma,
        consulta: () => sql`insert into tenant (nombre, version) values (${nombreAlAzar("t")}, 99)`,
      },
      {
        nombre: "plataforma: un tenant dado de alta ya SUSPENDED",
        contexto: comoPlataforma,
        consulta: () =>
          sql`insert into tenant (nombre, estado, motivo_estado)
              values (${nombreAlAzar("t")}, 'SUSPENDED', 'x')`,
      },
      {
        nombre: "plataforma: un trabajo ya HECHO",
        contexto: comoPlataforma,
        consulta: () =>
          sql`insert into trabajo (tipo, clave_idempotencia, estado)
              values ('mantenimiento', ${nombreAlAzar("clave")}, 'HECHO')`,
      },
      {
        nombre: "plataforma: una auditoría de plataforma con creado_en antedatado",
        contexto: comoPlataforma,
        consulta: () =>
          sql`insert into auditoria_plataforma (actor, accion, entidad, entidad_id, creado_en)
              values (${ADMIN_DE_PRUEBA}, 'PRUEBA', 'tenant', 'x', ${hace})`,
      },
      {
        nombre: "plataforma: una persona dada de alta ya desactivada globalmente",
        contexto: comoPlataforma,
        consulta: () =>
          sql`insert into persona (email, activo_global)
              values (${`${nombreAlAzar("p")}@prueba.test`}, false)`,
      },
      {
        nombre: "aplicación: un trabajo ya HECHO",
        contexto: () => comoEmpresa(a.empresa),
        consulta: () =>
          sql`insert into trabajo (empresa_id, tipo, clave_idempotencia, estado)
              values (${a.empresa}, 'enviar_invitacion', ${nombreAlAzar("clave")}, 'HECHO')`,
      },
      {
        nombre: "aplicación: un trabajo con intentos ya gastados",
        contexto: () => comoEmpresa(a.empresa),
        consulta: () =>
          sql`insert into trabajo (empresa_id, tipo, clave_idempotencia, intentos)
              values (${a.empresa}, 'enviar_invitacion', ${nombreAlAzar("clave")}, 5)`,
      },
      {
        nombre: "aplicación: una sucursal con creado_en antedatado",
        contexto: () => comoEmpresa(a.empresa),
        consulta: () =>
          sql`insert into sucursal (empresa_id, nombre, creado_en)
              values (${a.empresa}, ${nombreAlAzar("s")}, ${hace})`,
      },
      {
        nombre: "aplicación: una sucursal con version elegida",
        contexto: () => comoEmpresa(a.empresa),
        consulta: () =>
          sql`insert into sucursal (empresa_id, nombre, version)
              values (${a.empresa}, ${nombreAlAzar("s")}, 7)`,
      },
      {
        nombre: "aplicación: una auditoría con creado_en antedatado",
        contexto: () => comoEmpresa(a.empresa),
        consulta: () =>
          sql`insert into auditoria_empresa (empresa_id, accion, entidad, entidad_id, creado_en)
              values (${a.empresa}, 'PRUEBA', 'sucursal', 'x', ${hace})`,
      },
      {
        nombre: "aplicación: una auditoría con el id elegido",
        contexto: () => comoEmpresa(a.empresa),
        consulta: () =>
          sql`insert into auditoria_empresa (id, empresa_id, accion, entidad, entidad_id)
              overriding system value
              values (-1, ${a.empresa}, 'PRUEBA', 'sucursal', 'x')`,
      },
    ];

    for (const caso of CASOS) {
      it(`se rechaza ${caso.nombre}`, async () => {
        expect(await intentar(caso.contexto(), caso.consulta())).toEqual(DENEGADO);
      });
    }

    it("el registro de acceso del grupo no admite un creado_en antedatado", async () => {
      const dueno = await crearPropietario(entorno, a.tenant);
      const r = await intentar(
        comoGrupo(a.tenant, dueno),
        sql`insert into auditoria_acceso_grupo (tenant_id, persona_id, creado_en)
            values (${a.tenant}, ${dueno}, ${hace})`,
      );
      expect(r).toEqual(DENEGADO);
    });
  });

  describe("sin tablas temporales no hay suplantación", () => {
    it("ningún rol limitado puede crear una tabla temporal, ni una que se llame como una de las reales", async () => {
      const dueno = await crearPropietario(entorno, a.tenant);
      const contextos: ReadonlyArray<readonly [string, Contexto]> = [
        ["aplicación", comoEmpresa(a.empresa)],
        ["grupo", comoGrupo(a.tenant, dueno)],
        ["trabajos", comoTrabajos()],
        ["plataforma", comoPlataforma()],
      ];
      for (const [rol, contexto] of contextos) {
        for (const consulta of [
          sql`create temp table empresa (id uuid, tenant_id uuid, estado text)`,
          sql`create temporary table tenant (id uuid, estado text)`,
          sql`create table pg_temp.membresia_tenant (persona_id uuid)`,
          sql`create function pg_temp.empresa_operable(uuid) returns boolean language sql as 'select true'`,
        ]) {
          expect(await intentar(contexto, consulta), rol).toEqual(DENEGADO);
        }
      }
    });

    it("tampoco puede crear objetos en el esquema público", async () => {
      expect(
        await intentar(comoEmpresa(a.empresa), sql`create table public.puerta_trasera (id int)`),
      ).toEqual(DENEGADO);
    });
  });

  describe("las auditorías no se modifican ni borran", () => {
    it("ni la aplicación, ni la plataforma, ni el dueño de la base pueden alterarlas", async () => {
      if (base === null) return;
      const insertar = await entorno.ejecutar(
        { contexto: comoEmpresa(a.empresa) },
        async ({ db }) => {
          await sql`insert into auditoria_empresa (empresa_id, accion, entidad, entidad_id)
                  values (${a.empresa}, 'PRUEBA', 'sucursal', 'x')`.execute(db);
          return ok(null);
        },
      );
      expect(insertar).toEqual({ ok: true, valor: null });

      for (const consulta of [
        sql`update auditoria_empresa set accion = 'ALTERADA'`,
        sql`delete from auditoria_empresa`,
        sql`truncate auditoria_empresa`,
      ]) {
        const r = await entorno.ejecutar({ contexto: comoEmpresa(a.empresa) }, async ({ db }) => {
          await consulta.execute(db);
          return ok(null);
        });
        expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      }

      // El disparador actúa por fila: hace falta que cada auditoría tenga al menos una.
      const dueno_ = await crearPropietario(entorno, a.tenant);
      await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
        await sql`insert into auditoria_plataforma (actor, accion, entidad, entidad_id)
                  values (${ADMIN_DE_PRUEBA}, 'PRUEBA', 'tenant', 'x')`.execute(db);
        return ok(null);
      });
      await entorno.ejecutar({ contexto: comoGrupo(a.tenant, dueno_) }, async ({ db }) => {
        await sql`insert into auditoria_acceso_grupo (tenant_id, persona_id)
                  values (${a.tenant}, ${dueno_})`.execute(db);
        return ok(null);
      });

      // El dueño de la base tiene los permisos, pero el disparador lo frena igual.
      const dueno = new pg.Client({ connectionString: base.dueno });
      await dueno.connect();
      try {
        for (const texto of [
          "update auditoria_empresa set accion = 'ALTERADA'",
          "delete from auditoria_empresa",
          "truncate auditoria_empresa",
          "update auditoria_plataforma set accion = 'x'",
          "delete from auditoria_acceso_grupo",
        ]) {
          await expect(dueno.query(texto), texto).rejects.toMatchObject({ code: "42501" });
        }
      } finally {
        await dueno.end();
      }
    });
  });
});
