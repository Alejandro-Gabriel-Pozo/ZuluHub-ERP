import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { personaId } from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  comoEmpresa,
  comoGrupo,
  comoPlataforma,
  comoTrabajos,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  crearPropietario,
  nombreAlAzar,
  type EmpresaDePrueba,
} from "./entorno";

const base = inject("baseDePruebas");

type Entorno = ReturnType<typeof crearEntornoDePrueba>;

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

    it("la empresa no puede cambiar su propio CUIT, estado ni tenant: no tiene permiso de escritura", async () => {
      for (const consulta of [
        sql`update empresa set cuit = '20123456786'`,
        sql`update empresa set estado = 'SUSPENDED', motivo_estado = 'x'`,
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

    it("el contexto de una transacción no se filtra a la siguiente en la misma conexión", async () => {
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
                  values ('admin-de-prueba', 'PRUEBA', 'tenant', 'x')`.execute(db);
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
