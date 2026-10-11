import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { cambiarEstado } from "../../src/modulos/empresas/publico";
import { suspender } from "../../src/modulos/tenants/publico";
import { ok, err } from "../../src/primitivas/resultado/resultado";
import {
  comoEmpresa,
  comoPlataforma,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  cuitAlAzar,
  nombreAlAzar,
  type EmpresaDePrueba,
} from "./entorno";

const base = inject("baseDePruebas");

describe.skipIf(base === null)("concurrencia e idempotencia de la base de tenancy", () => {
  let entorno: ReturnType<typeof crearEntornoDePrueba>;

  beforeAll(() => {
    if (base !== null) entorno = crearEntornoDePrueba(base, 10);
  });
  afterAll(async () => {
    await entorno.cerrar();
  });

  const altaDeEmpresa = (tenant: string, cuit: string) =>
    entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
      await sql`insert into empresa (tenant_id, cuit, razon_social)
                values (${tenant}, ${cuit}, ${nombreAlAzar("alta")})`.execute(db);
      return ok("creada" as const);
    });

  describe("dos altas con el mismo CUIT", () => {
    it("gana una sola, también cuando son de tenants distintos (20 rondas)", async () => {
      for (let ronda = 0; ronda < 20; ronda++) {
        const cuit = cuitAlAzar();
        const [t1, t2] = await Promise.all([
          entorno.ejecutar({ contexto: comoPlataforma() }, async ({ tenants }) =>
            ok((await tenants.crear(nombreAlAzar("t"))).id),
          ),
          entorno.ejecutar({ contexto: comoPlataforma() }, async ({ tenants }) =>
            ok((await tenants.crear(nombreAlAzar("t"))).id),
          ),
        ]);
        if (!t1.ok || !t2.ok) throw new Error("no se crearon los tenants");
        const resultados = await Promise.all([
          altaDeEmpresa(t1.valor, cuit),
          altaDeEmpresa(t2.valor, cuit),
        ]);
        const ganadoras = resultados.filter((r) => r.ok);
        const perdedoras = resultados.filter((r) => !r.ok);
        expect(ganadoras, `ronda ${ronda}`).toHaveLength(1);
        expect(perdedoras.map((r) => (r.ok ? null : r.error))).toEqual([
          { tipo: "Unicidad", restriccion: "empresa_cuit_uk" },
        ]);
      }
    });

    it("el mismo alta repetida (doble clic) tampoco duplica: una empresa", async () => {
      const t = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ tenants }) =>
        ok((await tenants.crear(nombreAlAzar("t"))).id),
      );
      if (!t.ok) throw new Error("sin tenant");
      const cuit = cuitAlAzar();
      const rafaga = await Promise.all(
        Array.from({ length: 5 }, () => altaDeEmpresa(t.valor, cuit)),
      );
      expect(rafaga.filter((r) => r.ok)).toHaveLength(1);
    });

    it("un CUIT de alta cancelada se puede volver a usar; antes de cancelar, no", async () => {
      const t = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ tenants }) =>
        ok((await tenants.crear(nombreAlAzar("t"))).id),
      );
      if (!t.ok) throw new Error("sin tenant");
      const cuit = cuitAlAzar();
      expect((await altaDeEmpresa(t.valor, cuit)).ok).toBe(true);
      expect(await altaDeEmpresa(t.valor, cuit)).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "empresa_cuit_uk" },
      });
      const cancelada = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
        await sql`update empresa set estado = 'CANCELLED', motivo_estado = 'alta vencida' where cuit = ${cuit}`.execute(
          db,
        );
        return ok(null);
      });
      expect(cancelada.ok).toBe(true);
      expect((await altaDeEmpresa(t.valor, cuit)).ok).toBe(true);
    });
  });

  describe("aceptar y cancelar el alta a la vez (caso 0c)", () => {
    it("gana una sola; la otra recibe un rechazo claro y la empresa queda en un estado válido (20 rondas)", async () => {
      for (let ronda = 0; ronda < 20; ronda++) {
        const alta = await entorno.ejecutar(
          { contexto: comoPlataforma() },
          async ({ tenants, empresas }) => {
            const tenant = await tenants.crear(nombreAlAzar("t"));
            return ok(
              await empresas.crear({
                tenantId: tenant.id,
                cuit: cuitAlAzar(),
                razonSocial: nombreAlAzar("e"),
              }),
            );
          },
        );
        if (!alta.ok) throw new Error("sin empresa");
        const id = alta.valor.id;

        const mover = (hacia: "ACTIVE" | "CANCELLED") =>
          entorno.ejecutar({ contexto: comoPlataforma() }, async ({ empresas }) => {
            const actual = await empresas.obtener(id);
            if (actual === null) return err("EMPRESA_NO_ENCONTRADA" as const);
            const cambio = cambiarEstado(
              actual,
              hacia,
              hacia === "CANCELLED" ? "alta cancelada" : null,
            );
            if (!cambio.ok) return err(cambio.error);
            const guardado = await empresas.cambiarEstado(id, actual.version, cambio.valor);
            return guardado.ok ? ok(hacia) : err(guardado.error);
          });

        const [aceptar, cancelar] = await Promise.all([mover("ACTIVE"), mover("CANCELLED")]);
        const ganadoras = [aceptar, cancelar].filter((r) => r.ok);
        expect(ganadoras, `ronda ${ronda}`).toHaveLength(1);
        const perdedora = [aceptar, cancelar].find((r) => !r.ok);
        expect(
          perdedora && !perdedora.ok && ["TRANSICION_NO_PERMITIDA", "VERSION_DESACTUALIZADA"],
        ).toContain(perdedora && !perdedora.ok ? perdedora.error : "");
        const final = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ empresas }) =>
          ok((await empresas.obtener(id))?.estado),
        );
        expect(final.ok && final.valor).toBe(
          ganadoras[0] && ganadoras[0].ok ? ganadoras[0].valor : "?",
        );
      }
    });
  });

  describe("control optimista: dos ediciones con la misma versión", () => {
    it("una se aplica y la otra recibe VERSION_DESACTUALIZADA", async () => {
      const e = await crearEmpresaActiva(entorno);
      const obtener = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ empresas }) =>
        ok(await empresas.obtener(e.empresa)),
      );
      if (!obtener.ok || obtener.valor === null) throw new Error("sin empresa");
      const version = obtener.valor.version;
      const suspender_ = (motivo: string) =>
        entorno.ejecutar(
          { contexto: comoPlataforma(), aislamiento: "read committed" },
          async ({ empresas }) =>
            ok(
              await empresas.cambiarEstado(e.empresa, version, {
                estado: "SUSPENDED",
                motivoEstado: motivo,
              }),
            ),
        );
      const [x, y] = await Promise.all([suspender_("uno"), suspender_("dos")]);
      const resultados = [x, y].map((r) => (r.ok ? r.valor : null));
      expect(resultados.filter((r) => r?.ok)).toHaveLength(1);
      expect(
        resultados.filter((r) => r !== null && !r.ok).map((r) => (r && !r.ok ? r.error : "")),
      ).toEqual(["VERSION_DESACTUALIZADA"]);
    });
  });

  describe("suspender el tenant frena las operaciones que empiezan después", () => {
    const crearSucursal = (e: EmpresaDePrueba, nombre: string) =>
      entorno.ejecutar({ contexto: comoEmpresa(e.empresa) }, async ({ sucursales }) =>
        ok((await sucursales.crear(e.empresa, nombre)).nombre),
      );
    const cambiarTenant = (e: EmpresaDePrueba, suspendido: boolean) =>
      entorno.ejecutar({ contexto: comoPlataforma() }, async ({ tenants }) => {
        const t = await tenants.obtener(e.tenant);
        if (t === null) throw new Error("sin tenant");
        const cambio = suspendido
          ? suspender(t, "falta de pago")
          : ok({ estado: "ACTIVE" as const, motivoEstado: null });
        if (!cambio.ok) return err(cambio.error);
        const r = await tenants.cambiarEstado(t.id, t.version, cambio.valor);
        return r.ok ? ok(r.tenant.estado) : err(r.error);
      });

    it("la operación anterior queda registrada; la posterior se rechaza; al reactivar vuelve a andar", async () => {
      const e = await crearEmpresaActiva(entorno);
      expect(await crearSucursal(e, "antes")).toEqual({ ok: true, valor: "antes" });

      expect(await cambiarTenant(e, true)).toEqual({ ok: true, valor: "SUSPENDED" });
      expect(await crearSucursal(e, "durante")).toEqual({
        ok: false,
        error: { tipo: "AccesoDenegado" },
      });

      expect(await cambiarTenant(e, false)).toEqual({ ok: true, valor: "ACTIVE" });
      expect(await crearSucursal(e, "despues")).toEqual({ ok: true, valor: "despues" });

      const nombres = await entorno.ejecutar(
        { contexto: comoEmpresa(e.empresa) },
        async ({ sucursales }) =>
          ok((await sucursales.listar(e.empresa)).map((s) => s.nombre).sort()),
      );
      expect(nombres).toEqual({ ok: true, valor: ["Casa central", "antes", "despues"] });
    });

    it("una empresa suspendida o en alta tampoco opera, aunque su tenant esté activo", async () => {
      const e = await crearEmpresaActiva(entorno);
      await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
        await sql`update empresa set estado = 'SUSPENDED', motivo_estado = 'revisión' where id = ${e.empresa}`.execute(
          db,
        );
        return ok(null);
      });
      expect(await crearSucursal(e, "x")).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
    });

    it("suspender y operar a la vez: el resultado es siempre consistente con algún orden (20 rondas)", async () => {
      for (let ronda = 0; ronda < 20; ronda++) {
        const e = await crearEmpresaActiva(entorno);
        const nombre = nombreAlAzar("simultanea");
        const [operacion, suspension] = await Promise.all([
          crearSucursal(e, nombre),
          cambiarTenant(e, true),
        ]);
        expect(suspension.ok, `ronda ${ronda}`).toBe(true);
        // Si la operación se confirmó, la sucursal existe; si se rechazó, no existe. Nunca a medias.
        const verificacion = new pg.Client({ connectionString: base!.dueno });
        await verificacion.connect();
        try {
          const { rows } = await verificacion.query<{ n: number }>(
            "select count(*)::int as n from sucursal where nombre = $1",
            [nombre],
          );
          expect(rows[0]?.n).toBe(operacion.ok ? 1 : 0);
        } finally {
          await verificacion.end();
        }
      }
    });
  });

  describe("instalación SINGLE: a lo sumo un tenant", () => {
    it("dos altas de tenant simultáneas: gana una; con MULTI, ambas (en una base aparte)", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base);
      const propio = crearEntornoDePrueba(aparte.base, 5);
      const dueno = new pg.Client({ connectionString: aparte.base.dueno });
      await dueno.connect();
      try {
        const crear = () =>
          propio.ejecutar({ contexto: comoPlataforma() }, async ({ tenants }) =>
            ok((await tenants.crear(nombreAlAzar("t"))).id),
          );

        const enMulti = await Promise.all([crear(), crear()]);
        expect(enMulti.every((r) => r.ok)).toBe(true);

        await dueno.query("update instalacion set modo = 'SINGLE'");
        for (let ronda = 0; ronda < 10; ronda++) {
          await dueno.query("delete from membresia_tenant");
          await dueno.query("delete from trabajo");
          await dueno.query("delete from empresa");
          await dueno.query("delete from tenant");
          const enSingle = await Promise.all([crear(), crear()]);
          expect(
            enSingle.filter((r) => r.ok),
            `ronda ${ronda}`,
          ).toHaveLength(1);
          expect(enSingle.filter((r) => !r.ok).map((r) => (r.ok ? null : r.error))).toEqual([
            { tipo: "Check", restriccion: "tenant_instalacion_single" },
          ]);
        }
      } finally {
        await dueno.end();
        await propio.cerrar();
        await aparte.destruir();
      }
    });
  });
});
