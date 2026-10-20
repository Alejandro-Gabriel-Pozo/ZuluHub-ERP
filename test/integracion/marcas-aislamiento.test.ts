import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { firmarContexto } from "../../src/adaptadores/postgres/contexto-firmado";
import { adminPlataformaId, personaId, tenantId } from "../../src/primitivas/identificadores/marca";
import { SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import { comoGrupo, comoPlataforma, comoTrabajos } from "./entorno";
import { conAppDe, conPlataformaDe, type ActorDePrueba } from "./fiscal-apoyo";
import { crearPersonaDeBase } from "./fixtures-identidad";
import type { BaseDePruebas } from "./global";
import {
  ARCHIVO_0007,
  HASTA_0006,
  ACTOR_DE_PRUEBA,
  ajustarPerilla,
  asignarPlan,
  baseConMigraciones,
  crearBorradorDeMarca,
  crearBorradorDePlan,
  crearDominio,
  crearDominioDeEmpresa,
  crearMarca,
  crearMundoDeMarca,
  crearPlan,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
  hostAlAzar,
  marcaPrincipal,
  publicarVersionDePlan,
  type MundoDeMarca,
} from "./marcas-apoyo";
import { SesionDePrueba, type Intento } from "./sesiones";

/**
 * Marcas y planes (M3), migración 0007: AISLAMIENTO con los roles reales y su contexto firmado. Qué lee y qué
 * escribe cada uno de los seis roles de base en las tablas nuevas, entre empresas, entre tenants y entre
 * marcas: el rol público sin contexto, la aplicación por empresa, el grupo y los trabajos (nada), la
 * plataforma según su actor (ADMIN, SOPORTE, `sistema`, de baja o desconocido).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const TABLAS_NUEVAS = [
  "marca",
  "dominio",
  "plan",
  "version_de_plan",
  "version_de_marca",
  "plan_de_tenant",
  "ajuste_de_perilla",
  "modulo_de_empresa",
  "nivel_de_control",
] as const;
/** Las nueve tablas y la vista de resolución del host. */
const RELACIONES_NUEVAS = [...TABLAS_NUEVAS, "resolucion_de_host"] as const;
const LEIBLES_POR_LA_PLATAFORMA = TABLAS_NUEVAS.filter((t) => t !== "nivel_de_control");

/** Rechazo por falta de permiso de tabla o de columna (42501 «permission denied»). */
function sinPermiso(r: Intento): void {
  expect(r.ok, "tenía que rechazarse").toBe(false);
  if (r.ok) return;
  expect(r.codigo, r.mensaje).toBe("42501");
  expect(r.mensaje).toMatch(/permission denied/);
}
/** Rechazo por una política de RLS (42501 «row-level security»). */
function violaPolitica(r: Intento): void {
  expect(r.ok, "tenía que rechazarse").toBe(false);
  if (r.ok) return;
  expect(r.codigo, r.mensaje).toBe("42501");
  expect(r.mensaje).toMatch(/row-level security/);
}
const valores = (r: Intento, columna: string): unknown[] => {
  expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
  return r.ok ? r.rows.map((f) => f[columna]) : [];
};

describe.skipIf(base === null)(
  "marcas y planes: aislamiento por rol, empresa, tenant y marca",
  () => {
    let previa: Awaited<ReturnType<typeof baseConMigraciones>>;
    let dueno: pg.Client;
    let b: BaseDePruebas;

    // marcas
    let principal: string;
    let marcaB: string;
    let marcaRetirada: string;
    // dominios
    let dominioA: string;
    let aliasA: string;
    let dominioRetiradoA: string;
    let dominioDeRetirada: string;
    // planes
    let planP: string;
    let versionP1: string;
    let versionP2: string;
    let borradorP3: string;
    let versionQ1: string;
    // mundo
    let e1a: MundoDeMarca;
    let e1b: MundoDeMarca;
    let e2: MundoDeMarca;
    let propietario1: string;
    let sinMembresia: string;
    let adminDeBaja: string;

    beforeAll(async () => {
      if (base === null) return;
      previa = await baseConMigraciones(base, [...HASTA_0006, ARCHIVO_0007]);
      b = previa.aparte.base; // las sesiones con los roles reales se abren contra ESTA base
      dueno = previa.cliente;
      principal = await marcaPrincipal(dueno);
      marcaB = await crearMarca(dueno, { padre: principal });
      marcaRetirada = await crearMarca(dueno);

      planP = await crearPlan(dueno);
      versionP1 = await crearBorradorDePlan(dueno, planP, {
        nombreComercial: "Plan P v1",
        modulos: ["reservas"],
      });
      await publicarVersionDePlan(dueno, versionP1);
      versionP2 = await crearBorradorDePlan(dueno, planP, {
        nombreComercial: "Plan P v2",
        modulos: ["reservas", "ventas"],
        perillas: { empresas_por_tenant: { tipo: "LIMITE", limite: 3 } },
      });
      await publicarVersionDePlan(dueno, versionP2);
      borradorP3 = await crearBorradorDePlan(dueno, planP, { nombreComercial: "Plan P borrador" });
      versionQ1 = (await crearPlanPublicado(dueno, { nombreComercial: "Plan Q v1" })).version;

      await crearVersionDeMarcaConfirmada(dueno, principal, { nombreVisible: "Marca A v1" });
      await crearVersionDeMarcaConfirmada(dueno, principal, {
        nombreVisible: "Marca A v2 (futura)",
        desdeSegundos: 86_400,
      });
      await crearBorradorDeMarca(dueno, principal, {
        nombreVisible: "Marca A borrador",
        modulosIniciales: ["reservas"],
        planPorDefecto: planP,
      });
      await crearVersionDeMarcaConfirmada(dueno, marcaB, { nombreVisible: "Marca B v1" });
      await crearBorradorDeMarca(dueno, marcaB, { nombreVisible: "Marca B borrador" });
      await crearVersionDeMarcaConfirmada(dueno, marcaRetirada, {
        nombreVisible: "Marca retirada",
      });

      dominioA = (await crearDominio(dueno, principal, { canonico: true })).id;
      aliasA = (await crearDominio(dueno, principal)).id;
      dominioRetiradoA = (await crearDominio(dueno, principal, { estado: "RETIRADO" })).id;
      await crearDominio(dueno, marcaB, { canonico: true });
      dominioDeRetirada = (await crearDominio(dueno, marcaRetirada, { canonico: true })).id;
      await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [marcaRetirada]);

      e1a = await crearMundoDeMarca(dueno, { marca: principal });
      e1b = await crearMundoDeMarca(dueno, { marca: principal, tenant: e1a.tenant });
      e2 = await crearMundoDeMarca(dueno, { marca: marcaB });
      await asignarPlan(dueno, e1a.tenant, versionP1, { origen: "ALTA" });
      await asignarPlan(dueno, e1a.tenant, versionP2, { origen: "CAMBIO" });
      await asignarPlan(dueno, e2.tenant, versionQ1, { origen: "ALTA" });
      await ajustarPerilla(dueno, e1a.tenant, "empresas_por_tenant", "2");
      await ajustarPerilla(dueno, e1a.tenant, "empresas_por_tenant", "3", { empresa: e1a.empresa });
      await ajustarPerilla(dueno, e1a.tenant, "empresas_por_tenant", "4", { empresa: e1b.empresa });
      await ajustarPerilla(dueno, e2.tenant, "empresas_por_tenant", "5");
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'reservas')",
        [e1a.empresa],
      );
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'ventas')",
        [e1b.empresa],
      );
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'ventas')",
        [e2.empresa],
      );
      for (const [empresa, nivel] of [
        [e1a.empresa, "AVISAR"],
        [e1b.empresa, "BLOQUEAR"],
        [e2.empresa, "AVISAR"],
      ] as const) {
        await dueno.query(
          "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'caja.descuadre', $2)",
          [empresa, nivel],
        );
      }
      propietario1 = (await crearPersonaDeBase(dueno)).id;
      await dueno.query(
        "insert into membresia_tenant (persona_id, tenant_id, rol, activo) values ($1, $2, 'PROPIETARIO', true)",
        [propietario1, e1a.tenant],
      );
      sinMembresia = (await crearPersonaDeBase(dueno)).id;
      adminDeBaja = randomUUID();
      await dueno.query(
        "insert into admin_plataforma (id, email, rol, activo) values ($1, $2, 'ADMIN', false)",
        [adminDeBaja, `baja-${adminDeBaja.slice(0, 8)}@prueba.test`],
      );
    });
    afterAll(async () => {
      await previa?.cerrar();
    });

    const publico = async <T>(trabajo: (s: SesionDePrueba) => Promise<T>): Promise<T> => {
      const s = await SesionDePrueba.abrir(b, "pedernal_publico", null);
      try {
        return await trabajo(s);
      } finally {
        await s.cerrar();
      }
    };
    const grupo = async <T>(
      tenant: string,
      persona: string,
      trabajo: (s: SesionDePrueba) => Promise<T>,
    ): Promise<T> => {
      const s = await SesionDePrueba.abrir(
        b,
        "pedernal_grupo",
        comoGrupo(tenantId(tenant), personaId(persona)),
      );
      try {
        return await trabajo(s);
      } finally {
        await s.cerrar();
      }
    };
    const trabajos = async <T>(trabajo: (s: SesionDePrueba) => Promise<T>): Promise<T> => {
      const s = await SesionDePrueba.abrir(b, "pedernal_trabajos", comoTrabajos());
      try {
        return await trabajo(s);
      } finally {
        await s.cerrar();
      }
    };
    /** La plataforma con un actor cualquiera (`null`: sin contexto firmado). */
    const plataforma = async <T>(
      actor: ActorDePrueba | "BAJA" | "INEXISTENTE" | null,
      trabajo: (s: SesionDePrueba) => Promise<T>,
    ): Promise<T> => {
      if (actor === "ADMIN" || actor === "SOPORTE" || actor === "SISTEMA") {
        return conPlataformaDe(b, actor, trabajo);
      }
      const contexto =
        actor === null
          ? null
          : comoPlataforma({
              tipo: "ADMIN",
              id: adminPlataformaId(actor === "BAJA" ? adminDeBaja : randomUUID()),
            });
      const s = await SesionDePrueba.abrir(b, "pedernal_plataforma", contexto);
      try {
        return await trabajo(s);
      } finally {
        await s.cerrar();
      }
    };

    // ===========================================================================================
    // El rol público: sin contexto, solo las columnas públicas, solo lo vigente
    // ===========================================================================================
    describe("pedernal_publico", () => {
      it("lee las marcas ACTIVAS, con sus columnas públicas y ninguna otra", async () => {
        await publico(async (s) => {
          const r = await s.intentar(
            "select id, codigo, marca_padre_id, nivel, es_principal from marca order by codigo",
          );
          const ids = valores(r, "id");
          expect(ids).toHaveLength(2);
          expect(ids).toContain(principal);
          expect(ids).toContain(marcaB);
          expect(ids).not.toContain(marcaRetirada);
          // las columnas que no son públicas no se pueden ni nombrar
          for (const columna of ["estado", "creado_en", "actualizado_en", "version"]) {
            sinPermiso(await s.intentar(`select ${columna} from marca`));
          }
          sinPermiso(await s.intentar("select * from marca"));
          // ni siquiera filtrar por una columna que no ve
          sinPermiso(await s.intentar("select id from marca where estado = 'RETIRADA'"));
        });
      });

      it("lee los dominios ACTIVOS (host, superficie, dueño, marca): ni los pendientes ni los retirados, ni el titular, ni quién los registró, ni el motivo", async () => {
        await publico(async (s) => {
          const r = await s.intentar("select host, marca_id, superficie from dominio");
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          const porMarca = new Map<string, number>();
          for (const f of r.rows)
            porMarca.set(f["marca_id"] as string, (porMarca.get(f["marca_id"] as string) ?? 0) + 1);
          expect(porMarca.get(principal)).toBe(2); // el canónico y un alias; el retirado no
          for (const f of r.rows) expect(f["superficie"]).toBe("APP");
          expect(porMarca.get(marcaB)).toBe(1);
          expect(r.rows).toHaveLength(4); // y el de la marca retirada (lo filtra la unión con la marca)
          for (const columna of [
            "id",
            "es_canonico",
            "titular",
            "verificado_en",
            "motivo",
            "registrado_por",
            "creado_en",
            "version",
          ]) {
            sinPermiso(await s.intentar(`select ${columna} from dominio`));
          }
        });
      });

      it("resolver un host: el exacto sí; el desconocido, el de sufijo o prefijo engañoso, con mayúsculas, el retirado y el de una marca retirada, no", async () => {
        const host = (id: string) =>
          dueno
            .query<{ host: string }>("select host from dominio where id = $1", [id])
            .then((r) => r.rows[0]?.host as string);
        const hostA = await host(dominioA);
        const hostRetirado = await host(dominioRetiradoA);
        const hostDeRetirada = await host(dominioDeRetirada);
        await publico(async (s) => {
          const resolver = (h: string) =>
            s.intentar(`select host, superficie from resolucion_de_host where host = $1`, [h]);
          expect(valores(await resolver(hostA), "host")).toEqual([hostA]);
          for (const h of [
            "desconocido.prueba.test",
            `${hostA}.otro.net`,
            `x.${hostA}`,
            hostA.toUpperCase(),
            `${hostA}.`,
            `${hostA}:3000`,
            hostRetirado, // retirado
            hostDeRetirada, // de una marca RETIRADA (la vista la deja afuera)
            "",
          ]) {
            expect(valores(await resolver(h), "host"), h).toEqual([]);
          }
        });
      });

      it("lee solo versiones de marca CONFIRMADAS y ya vigentes, y solo sus columnas públicas", async () => {
        await publico(async (s) => {
          const r = await s.intentar(
            "select marca_id, numero, nombre_visible from version_de_marca order by nombre_visible",
          );
          // A v1 (vigente), B v1 y la de la marca retirada (que el resolver deja afuera por la marca); no la futura ni los borradores
          expect(valores(r, "nombre_visible")).toEqual([
            "Marca A v1",
            "Marca B v1",
            "Marca retirada",
          ]);
          for (const columna of [
            "modulos_iniciales",
            "plan_por_defecto_id",
            "motivo",
            "confirmada_por",
            "confirmada_en",
            "estado",
            "reemplaza_programada",
            "id",
            "creado_en",
            "version",
          ]) {
            sinPermiso(await s.intentar(`select ${columna} from version_de_marca`));
          }
          sinPermiso(await s.intentar("select * from version_de_marca"));
          sinPermiso(
            await s.intentar(
              "select marca_id from version_de_marca where plan_por_defecto_id is not null",
            ),
          );
          sinPermiso(
            await s.intentar("select marca_id from version_de_marca where estado = 'BORRADOR'"),
          );
        });
      });

      it("no lee NINGUNA otra tabla: ni las de marcas y planes, ni tenant, empresa, persona ni las de 0001 a 0006", async () => {
        await publico(async (s) => {
          const { rows } = await dueno.query<{ relname: string }>(
            `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
             and relname not in ('marca', 'dominio', 'version_de_marca', 'migracion') order by 1`,
          );
          expect(rows.length).toBeGreaterThan(30);
          for (const { relname } of rows) {
            sinPermiso(await s.intentar(`select 1 from ${relname} limit 1`));
          }
        });
      });

      it("no escribe nada, en ninguna tabla: ni INSERT, ni UPDATE, ni DELETE, ni TRUNCATE", async () => {
        await publico(async (s) => {
          sinPermiso(await s.intentar("insert into marca (codigo) values ('intruso')"));
          sinPermiso(await s.intentar("update marca set codigo = 'x'"));
          sinPermiso(await s.intentar("delete from marca"));
          sinPermiso(await s.intentar("truncate marca"));
          sinPermiso(
            await s.intentar(
              "insert into dominio (duenio_marca_id, host, superficie, titular, registrado_por) values ($1, 'x.test', 'APP', 'OPERADOR', 'x')",
              [principal],
            ),
          );
          sinPermiso(await s.intentar("update dominio set estado = 'RETIRADO'"));
          sinPermiso(await s.intentar("update version_de_marca set nombre_visible = 'x'"));
          sinPermiso(
            await s.intentar("insert into tenant (nombre, marca_id) values ('x', $1)", [principal]),
          );
          sinPermiso(await s.intentar("insert into plan (codigo) values ('intruso')"));
          sinPermiso(
            await s.intentar(
              "insert into referencia_de_error (referencia, accion, motivo) values ('PD-0000-0000', 'a.b', 'X')",
            ),
          );
        });
      });

      it("no ejecuta funciones de la base, no crea objetos y no se vuelve otro rol", async () => {
        await publico(async (s) => {
          for (const funcion of [
            "contexto_firmado()",
            "app_empresa_id()",
            "host_valido('a.com')",
            "texto_visible_valido('x', 10)",
            "empresa_operable(gen_random_uuid())",
            "plataforma_actor_vigente()",
          ]) {
            sinPermiso(await s.intentar(`select ${funcion}`));
          }
          sinPermiso(await s.intentar("create table trampa (x int)"));
          sinPermiso(await s.intentar("create temp table trampa (x int)"));
          expect((await s.intentar("set role pedernal_plataforma")).ok).toBe(false);
          expect((await s.intentar("set role pedernal_app")).ok).toBe(false);
        });
      });

      it("un contexto firmado ajeno no le suma nada: sigue viendo lo mismo", async () => {
        const s = await SesionDePrueba.abrir(b, "pedernal_publico", null);
        try {
          // un token de otro rol puesto a mano en la sesión pública: no cambia lo que ve ni lo que puede
          const token = firmarContexto(b.clave, comoPlataforma(), Math.floor(Date.now() / 1000));
          await s.intentar("select set_config('app.ctx', $1, true)", [token]);
          expect(valores(await s.intentar("select codigo from marca"), "codigo")).toHaveLength(2);
          sinPermiso(await s.intentar("select 1 from admin_plataforma"));
          sinPermiso(await s.intentar("select 1 from plan"));
        } finally {
          await s.cerrar();
        }
      });
    });

    // ===========================================================================================
    // La aplicación: por empresa, por tenant, y sin escribir nada de marcas ni planes
    // ===========================================================================================
    describe("pedernal_app", () => {
      it("sin contexto firmado no ve ninguna fila de lo nuevo (falla cerrado), pero tampoco recibe un error", async () => {
        const s = await SesionDePrueba.abrir(b, "pedernal_app", null);
        try {
          for (const [tabla, columnas] of [
            ["marca", "id"],
            ["dominio", "host"],
            ["version_de_marca", "marca_id"],
            ["version_de_plan", "id"],
            ["plan_de_tenant", "id"],
            ["ajuste_de_perilla", "id"],
            ["modulo_de_empresa", "empresa_id"],
            ["nivel_de_control", "empresa_id"],
          ] as const) {
            const r = await s.intentar(`select ${columnas} from ${tabla}`);
            expect(r.ok, tabla).toBe(true);
            if (r.ok) expect(r.rows, tabla).toEqual([]);
          }
        } finally {
          await s.cerrar();
        }
      });

      it("con contexto ve las marcas (para heredar y para los mails), sus dominios CANÓNICOS activos y sus versiones vigentes", async () => {
        await conAppDe(b, e1a, async (s) => {
          expect(valores(await s.intentar("select id from marca"), "id")).toHaveLength(3);
          const dominios = await s.intentar("select host, es_canonico from dominio");
          expect(valores(dominios, "es_canonico")).toEqual([true, true, true]); // A, B y la retirada (canónicos activos)
          expect(
            valores(
              await s.intentar(
                "select nombre_visible from version_de_marca order by nombre_visible",
              ),
              "nombre_visible",
            ),
          ).toEqual(["Marca A v1", "Marca B v1", "Marca retirada"]);
          // lo mismo que el rol público: nunca módulos iniciales, plan por defecto, motivo ni quién
          for (const columna of [
            "modulos_iniciales",
            "plan_por_defecto_id",
            "motivo",
            "confirmada_por",
            "estado",
          ]) {
            sinPermiso(await s.intentar(`select ${columna} from version_de_marca`));
          }
          for (const columna of [
            "id",
            "estado",
            "titular",
            "motivo",
            "registrado_por",
            "verificado_en",
            "duenio_marca_id",
            "duenio_empresa_id",
          ]) {
            sinPermiso(await s.intentar(`select ${columna} from dominio`));
          }
        });
      });

      it("la empresa ve las versiones de plan que SU tenant tiene asignadas (todas las asignadas), sin los borradores ni las de otro tenant", async () => {
        await conAppDe(b, e1a, async (s) => {
          const r = await s.intentar(
            "select numero, nombre_comercial from version_de_plan order by nombre_comercial",
          );
          expect(valores(r, "nombre_comercial")).toEqual(["Plan P v1", "Plan P v2"]);
          for (const columna of [
            "motivo",
            "publicada_por",
            "publicada_en",
            "estado",
            "creado_en",
          ]) {
            sinPermiso(await s.intentar(`select ${columna} from version_de_plan`));
          }
        });
        await conAppDe(b, e2, async (s) => {
          const r = await s.intentar("select nombre_comercial from version_de_plan");
          expect(valores(r, "nombre_comercial")).toEqual(["Plan Q v1"]);
        });
      });

      it("ve la asignación de plan de su tenant (con sus fechas y su origen) y no el motivo ni quién la decidió; no la de otro tenant", async () => {
        await conAppDe(b, e1a, async (s) => {
          const r = await s.intentar(
            "select numero, origen, tenant_id from plan_de_tenant order by numero",
          );
          expect(valores(r, "numero")).toEqual([1, 2]);
          expect(valores(r, "origen")).toEqual(["ALTA", "CAMBIO"]);
          expect(new Set(valores(r, "tenant_id"))).toEqual(new Set([e1a.tenant]));
          for (const columna of ["motivo", "asignado_por", "reemplaza_programada"]) {
            sinPermiso(await s.intentar(`select ${columna} from plan_de_tenant`));
          }
          sinPermiso(await s.intentar("select * from plan_de_tenant"));
        });
        // la otra empresa del MISMO tenant ve lo mismo; la de otro tenant, lo suyo
        await conAppDe(b, e1b, async (s) => {
          expect(
            valores(
              await s.intentar("select numero from plan_de_tenant order by numero"),
              "numero",
            ),
          ).toEqual([1, 2]);
        });
        await conAppDe(b, e2, async (s) => {
          const r = await s.intentar("select numero, tenant_id from plan_de_tenant");
          expect(valores(r, "numero")).toEqual([1]);
          expect(valores(r, "tenant_id")).toEqual([e2.tenant]);
        });
      });

      it("ve los ajustes de su tenant y de SU empresa; no los de otra empresa del mismo tenant ni los de otro tenant", async () => {
        await conAppDe(b, e1a, async (s) => {
          const r = await s.intentar(
            "select valor, empresa_id from ajuste_de_perilla order by valor",
          );
          expect(valores(r, "valor")).toEqual(["2", "3"]); // el del tenant y el de e1a; no el "4" de e1b ni el "5" del otro tenant
          for (const columna of ["motivo", "asignado_por", "reemplaza_programada"]) {
            sinPermiso(await s.intentar(`select ${columna} from ajuste_de_perilla`));
          }
        });
        await conAppDe(b, e1b, async (s) => {
          expect(
            valores(
              await s.intentar("select valor from ajuste_de_perilla order by valor"),
              "valor",
            ),
          ).toEqual(["2", "4"]);
        });
        await conAppDe(b, e2, async (s) => {
          expect(valores(await s.intentar("select valor from ajuste_de_perilla"), "valor")).toEqual(
            ["5"],
          );
        });
      });

      it("ve los módulos activados y los niveles de control de SU empresa, y de ninguna otra", async () => {
        await conAppDe(b, e1a, async (s) => {
          expect(
            valores(await s.intentar("select modulo from modulo_de_empresa"), "modulo"),
          ).toEqual(["reservas"]);
          expect(valores(await s.intentar("select nivel from nivel_de_control"), "nivel")).toEqual([
            "AVISAR",
          ]);
        });
        await conAppDe(b, e1b, async (s) => {
          expect(
            valores(await s.intentar("select modulo from modulo_de_empresa"), "modulo"),
          ).toEqual(["ventas"]);
          expect(valores(await s.intentar("select nivel from nivel_de_control"), "nivel")).toEqual([
            "BLOQUEAR",
          ]);
        });
        await conAppDe(b, e2, async (s) => {
          expect(
            valores(await s.intentar("select empresa_id from modulo_de_empresa"), "empresa_id"),
          ).toEqual([e2.empresa]);
        });
      });

      it("no ve los planes (el plan mismo, con su código), ni borradores de marca, ni nada del otro tenant: sin permiso o sin filas", async () => {
        await conAppDe(b, e1a, async (s) => {
          sinPermiso(await s.intentar("select codigo from plan"));
          sinPermiso(await s.intentar("select * from version_de_marca where estado = 'BORRADOR'"));
          // el borrador del plan P (v3) no figura entre las versiones visibles
          const ids = valores(await s.intentar("select id from version_de_plan"), "id");
          expect(ids).not.toContain(borradorP3);
        });
      });

      it("no escribe NADA de marcas ni de planes ni de módulos activados (solo la plataforma activa módulos)", async () => {
        await conAppDe(b, e1a, async (s) => {
          sinPermiso(await s.intentar("insert into marca (codigo) values ('intruso')"));
          sinPermiso(await s.intentar("update marca set estado = 'RETIRADA'"));
          sinPermiso(await s.intentar("insert into plan (codigo) values ('intruso')"));
          sinPermiso(await s.intentar("update version_de_plan set nombre_comercial = 'x'"));
          sinPermiso(await s.intentar("update version_de_marca set nombre_visible = 'x'"));
          sinPermiso(await s.intentar("update dominio set estado = 'RETIRADO'"));
          sinPermiso(
            await s.intentar(
              `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
             values ($1, 3, $2, now(), 'CAMBIO', 'x', 'a')`,
              [e1a.tenant, versionP1],
            ),
          );
          sinPermiso(
            await s.intentar(
              `insert into ajuste_de_perilla (tenant_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
             values ($1, 'empresas_por_tenant', 5, '9', now(), 'x', 'a')`,
              [e1a.tenant],
            ),
          );
          sinPermiso(
            await s.intentar(
              "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'ventas')",
              [e1a.empresa],
            ),
          );
          sinPermiso(await s.intentar("update modulo_de_empresa set activo = false"));
          sinPermiso(await s.intentar("delete from nivel_de_control"));
          sinPermiso(await s.intentar("truncate nivel_de_control"));
          sinPermiso(await s.intentar("delete from modulo_de_empresa"));
        });
      });

      it("ve la marca de su tenant (tenant.marca_id) y no puede cambiarla", async () => {
        await conAppDe(b, e1a, async (s) => {
          expect(valores(await s.intentar("select marca_id from tenant"), "marca_id")).toEqual([
            principal,
          ]);
          sinPermiso(await s.intentar("update tenant set marca_id = $1", [marcaB]));
          sinPermiso(
            await s.intentar("insert into tenant (nombre, marca_id) values ('x', $1)", [principal]),
          );
        });
        await conAppDe(b, e2, async (s) => {
          expect(valores(await s.intentar("select marca_id from tenant"), "marca_id")).toEqual([
            marcaB,
          ]);
        });
      });

      it("nivel_de_control: la empresa fija el nivel de SUS controles (no los de otra), solo si opera", async () => {
        await conAppDe(b, e1a, async (s) => {
          const ok = await s.intentar(
            "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'stock.existencia_negativa', 'BLOQUEAR')",
            [e1a.empresa],
          );
          expect(ok.ok, ok.ok ? "" : ok.mensaje).toBe(true);
          violaPolitica(
            await s.intentar(
              "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'stock.existencia_negativa', 'BLOQUEAR')",
              [e2.empresa],
            ),
          );
          // actualizar: el propio sí; el ajeno ni se ve
          const propio = await s.intentar(
            "update nivel_de_control set nivel = 'PERMITIR' where empresa_id = $1",
            [e1a.empresa],
          );
          expect(propio.ok && propio.filas).toBe(2);
          const ajeno = await s.intentar(
            "update nivel_de_control set nivel = 'PERMITIR' where empresa_id = $1",
            [e2.empresa],
          );
          expect(ajeno.ok && ajeno.filas).toBe(0);
          // control y sucursal no se cambian (solo el nivel)
          sinPermiso(await s.intentar("update nivel_de_control set control = 'otro.control'"));
          sinPermiso(await s.intentar("update nivel_de_control set empresa_id = $1", [e2.empresa]));
          // una sucursal de otra empresa no vale (clave foránea compuesta)
          expect(
            (
              await s.intentar(
                "insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, $2, 'caja.otro', 'AVISAR')",
                [e1a.empresa, e2.sucursal],
              )
            ).ok,
          ).toBe(false);
          await s.deshacer();
        });
      });

      it("nivel_de_control y hora_de_corte: una empresa que no opera (tenant suspendido o alta en curso) no los cambia", async () => {
        const suspendido = await crearMundoDeMarca(dueno, { marca: principal });
        await dueno.query(
          "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
          [suspendido.tenant],
        );
        const enAlta = await crearMundoDeMarca(dueno, { marca: principal, estado: "PROVISIONING" });
        for (const m of [suspendido, enAlta]) {
          await conAppDe(b, m, async (s) => {
            violaPolitica(
              await s.intentar(
                "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'caja.descuadre', 'AVISAR')",
                [m.empresa],
              ),
            );
            const r = await s.intentar(
              "update sucursal set hora_de_corte = '04:00' where empresa_id = $1",
              [m.empresa],
            );
            expect(r.ok && r.filas).toBe(0);
          });
        }
      });

      it("hora_de_corte: la empresa cambia la de SUS sucursales (la política de sucursal ya la acota) y no la de otra", async () => {
        await conAppDe(b, e1a, async (s) => {
          const propia = await s.intentar(
            "update sucursal set hora_de_corte = '04:30' where id = $1",
            [e1a.sucursal],
          );
          expect(propia.ok && propia.filas).toBe(1);
          const ajena = await s.intentar(
            "update sucursal set hora_de_corte = '04:30' where id = $1",
            [e2.sucursal],
          );
          expect(ajena.ok && ajena.filas).toBe(0);
          expect(
            valores(await s.intentar("select hora_de_corte::text as h from sucursal"), "h"),
          ).toContain("04:30:00");
          // no puede crear la sucursal con una hora a mano: el INSERT sigue siendo (empresa_id, nombre)
          sinPermiso(
            await s.intentar(
              "insert into sucursal (empresa_id, nombre, hora_de_corte) values ($1, 'X', '03:00')",
              [e1a.empresa],
            ),
          );
          await s.deshacer();
        });
      });
    });

    // ===========================================================================================
    // El grupo, los trabajos y la autenticación: nada de lo nuevo (salvo lo que ya leían)
    // ===========================================================================================
    describe("pedernal_grupo, pedernal_trabajos y pedernal_autenticacion", () => {
      it("el grupo y los trabajos fallan cerrado en las nueve tablas y en la vista de resolución (42501), también con contexto válido", async () => {
        await grupo(e1a.tenant, propietario1, async (s) => {
          for (const tabla of RELACIONES_NUEVAS) {
            sinPermiso(await s.intentar(`select 1 from ${tabla} limit 1`));
            if (tabla !== "resolucion_de_host") {
              sinPermiso(await s.intentar(`delete from ${tabla}`));
            }
          }
          sinPermiso(await s.intentar("insert into marca (codigo) values ('x')"));
          sinPermiso(
            await s.intentar("insert into plan_de_tenant (tenant_id) values ($1)", [e1a.tenant]),
          );
        });
        await trabajos(async (s) => {
          for (const tabla of RELACIONES_NUEVAS) {
            sinPermiso(await s.intentar(`select 1 from ${tabla} limit 1`));
          }
          sinPermiso(
            await s.intentar(
              "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'x1')",
              [e1a.empresa],
            ),
          );
        });
      });

      it("la autenticación no recibe nada de lo nuevo", async () => {
        const c = new pg.Client({ connectionString: b.autenticacion });
        await c.connect();
        try {
          for (const tabla of RELACIONES_NUEVAS) {
            await expect(c.query(`select 1 from ${tabla} limit 1`), tabla).rejects.toMatchObject({
              code: "42501",
            });
          }
        } finally {
          await c.end();
        }
      });

      it("el propietario del grupo ve la marca de su tenant (tenant.marca_id) y no la de otro", async () => {
        await grupo(e1a.tenant, propietario1, async (s) => {
          expect(valores(await s.intentar("select marca_id from tenant"), "marca_id")).toEqual([
            principal,
          ]);
          sinPermiso(await s.intentar("update tenant set marca_id = $1", [marcaB]));
        });
      });

      it("la hora de corte es legible por el grupo (como el resto de la sucursal) pero no editable", async () => {
        await grupo(e1a.tenant, propietario1, async (s) => {
          const r = await s.intentar(
            "select hora_de_corte::text as h from sucursal where id = $1",
            [e1a.sucursal],
          );
          expect(valores(r, "h")).toHaveLength(1);
          sinPermiso(await s.intentar("update sucursal set hora_de_corte = '05:00'"));
        });
      });
    });

    // ===========================================================================================
    // Intentos fallidos de la vista de grupo (auditoria_acceso_grupo.resultado)
    // ===========================================================================================
    describe("auditoria_acceso_grupo: intentos fallidos", () => {
      const insertar = (
        s: SesionDePrueba,
        tenant: string,
        persona: string,
        resultado: string | null,
        empresa: string | null = null,
      ) =>
        resultado === null
          ? s.intentar(
              "insert into auditoria_acceso_grupo (tenant_id, persona_id, empresa_id) values ($1, $2, $3)",
              [tenant, persona, empresa],
            )
          : s.intentar(
              "insert into auditoria_acceso_grupo (tenant_id, persona_id, empresa_id, resultado) values ($1, $2, $3, $4)",
              [tenant, persona, empresa, resultado],
            );

      it("el propietario activo registra su acceso como PERMITIDO (sin indicarlo, igual que antes) y no puede registrarse como DENEGADO", async () => {
        await grupo(e1a.tenant, propietario1, async (s) => {
          expect((await insertar(s, e1a.tenant, propietario1, null)).ok).toBe(true);
          expect((await insertar(s, e1a.tenant, propietario1, "PERMITIDO", e1a.empresa)).ok).toBe(
            true,
          );
          violaPolitica(await insertar(s, e1a.tenant, propietario1, "DENEGADO"));
          await s.deshacer();
        });
      });

      it("quien NO es propietario deja constancia de su intento como DENEGADO y no puede hacerse pasar por PERMITIDO", async () => {
        await grupo(e1a.tenant, sinMembresia, async (s) => {
          expect((await insertar(s, e1a.tenant, sinMembresia, "DENEGADO")).ok).toBe(true);
          violaPolitica(await insertar(s, e1a.tenant, sinMembresia, "PERMITIDO"));
          violaPolitica(await insertar(s, e1a.tenant, sinMembresia, null));
          await s.deshacer();
        });
      });

      it("el tenant y la persona salen del contexto: no se puede registrar a nombre de otro tenant ni de otra persona", async () => {
        await grupo(e1a.tenant, sinMembresia, async (s) => {
          violaPolitica(await insertar(s, e2.tenant, sinMembresia, "DENEGADO"));
          violaPolitica(await insertar(s, e1a.tenant, propietario1, "DENEGADO"));
        });
        await grupo(e1a.tenant, propietario1, async (s) => {
          violaPolitica(await insertar(s, e2.tenant, propietario1, "PERMITIDO"));
          violaPolitica(await insertar(s, e1a.tenant, sinMembresia, "PERMITIDO"));
        });
      });

      it("un propietario dado de baja es, para esto, alguien que no es propietario: su intento queda como DENEGADO", async () => {
        const baja = (await crearPersonaDeBase(dueno)).id;
        await dueno.query(
          "insert into membresia_tenant (persona_id, tenant_id, rol, activo) values ($1, $2, 'PROPIETARIO', false)",
          [baja, e1a.tenant],
        );
        await grupo(e1a.tenant, baja, async (s) => {
          expect((await insertar(s, e1a.tenant, baja, "DENEGADO")).ok).toBe(true);
          violaPolitica(await insertar(s, e1a.tenant, baja, "PERMITIDO"));
          await s.deshacer();
        });
      });

      it("el grupo registra pero no lee la auditoría, y ninguna fila se modifica ni se borra", async () => {
        await grupo(e1a.tenant, sinMembresia, async (s) => {
          sinPermiso(await s.intentar("select 1 from auditoria_acceso_grupo"));
          sinPermiso(await s.intentar("update auditoria_acceso_grupo set resultado = 'PERMITIDO'"));
          sinPermiso(await s.intentar("delete from auditoria_acceso_grupo"));
        });
      });

      it("la aplicación no puede registrar accesos de grupo, ni PERMITIDO ni DENEGADO", async () => {
        await conAppDe(b, e1a, async (s) => {
          sinPermiso(
            await s.intentar(
              "insert into auditoria_acceso_grupo (tenant_id, persona_id, resultado) values ($1, $2, 'DENEGADO')",
              [e1a.tenant, sinMembresia],
            ),
          );
        });
      });
    });

    // ===========================================================================================
    // La plataforma: según el actor firmado
    // ===========================================================================================
    describe("pedernal_plataforma", () => {
      it("sin actor firmado, de baja o desconocido no ve ninguna fila de lo nuevo", async () => {
        for (const actor of [null, "BAJA", "INEXISTENTE"] as const) {
          await plataforma(actor, async (s) => {
            for (const tabla of LEIBLES_POR_LA_PLATAFORMA) {
              const r = await s.intentar(`select count(*)::int as n from ${tabla}`);
              expect(valores(r, "n"), `${String(actor)}: ${tabla}`).toEqual([0]);
            }
          });
        }
      });

      it("ADMIN, SOPORTE y `sistema` leen todo lo nuevo (menos los niveles de control, que son de la empresa)", async () => {
        for (const actor of ["ADMIN", "SOPORTE", "SISTEMA"] as const) {
          await plataforma(actor, async (s) => {
            for (const tabla of LEIBLES_POR_LA_PLATAFORMA) {
              const r = await s.intentar(`select count(*)::int as n from ${tabla}`);
              expect(Number(valores(r, "n")[0]), `${actor}: ${tabla}`).toBeGreaterThan(0);
            }
            // ve los borradores, los motivos y quién decidió: es la consola de la fábrica
            const m = await s.intentar(
              "select motivo, asignado_por from plan_de_tenant order by numero",
            );
            expect(valores(m, "asignado_por")).toContain(ACTOR_DE_PRUEBA);
            expect(
              valores(
                await s.intentar(
                  "select nombre_visible from version_de_marca where estado = 'BORRADOR' order by 1",
                ),
                "nombre_visible",
              ),
            ).toEqual(["Marca A borrador", "Marca B borrador"]);
            sinPermiso(await s.intentar("select 1 from nivel_de_control limit 1"));
          });
        }
      });

      it("SOPORTE y `sistema` no escriben nada de lo nuevo (ven, no cambian estructura); lo para ADMIN lo frena la política restrictiva", async () => {
        for (const actor of ["SOPORTE", "SISTEMA"] as const) {
          await plataforma(actor, async (s) => {
            violaPolitica(await s.intentar("insert into marca (codigo) values ('de-soporte')"));
            violaPolitica(await s.intentar("insert into plan (codigo) values ('de-soporte')"));
            violaPolitica(
              await s.intentar(
                `insert into dominio (duenio_marca_id, host, superficie, titular, registrado_por)
                 values ($1, $2, 'APP', 'OPERADOR', $3)`,
                [principal, hostAlAzar(), actor === "SOPORTE" ? SOPORTE_DE_PRUEBA : "sistema"],
              ),
            );
            violaPolitica(
              await s.intentar(
                "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'x1')",
                [e1a.empresa],
              ),
            );
            violaPolitica(
              await s.intentar("insert into tenant (nombre, marca_id) values ('de-soporte', $1)", [
                principal,
              ]),
            );
            // UPDATE: la restrictiva filtra la lectura previa: 0 filas
            for (const texto of [
              "update marca set estado = 'RETIRADA' where id = $1",
              "update modulo_de_empresa set activo = false where empresa_id = $1",
            ]) {
              const r = await s.intentar(texto, [
                texto.includes("marca set") ? marcaB : e1a.empresa,
              ]);
              expect(r.ok && r.filas, texto).toBe(0);
            }
            const dom = await s.intentar(
              "update dominio set estado = 'RETIRADO', motivo = 'x' where id = $1",
              [aliasA],
            );
            expect(dom.ok && dom.filas).toBe(0);
            await s.deshacer();
          });
        }
      });

      it("un administrador de baja, uno desconocido y la sesión sin actor no escriben nada", async () => {
        for (const actor of [null, "BAJA", "INEXISTENTE"] as const) {
          await plataforma(actor, async (s) => {
            violaPolitica(await s.intentar("insert into marca (codigo) values ('de-baja')"));
            violaPolitica(await s.intentar("insert into plan (codigo) values ('de-baja')"));
            violaPolitica(
              await s.intentar(
                "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'x1')",
                [e1a.empresa],
              ),
            );
          });
        }
      });

      it("un ADMIN activo recorre el circuito completo con los permisos de la plataforma: marca, dominio, versión confirmada, plan, versión publicada, tenant con marca, asignación, ajuste y módulo", async () => {
        await conPlataformaDe(b, "ADMIN", async (s) => {
          const un = async (texto: string, p: unknown[] = []) => {
            const r = await s.intentar(texto, p);
            expect(r.ok, r.ok ? "" : `${r.codigo} ${r.restriccion ?? ""} ${r.mensaje}`).toBe(true);
            return r.ok ? r.rows : [];
          };
          const marca = (
            await un("insert into marca (codigo, marca_padre_id) values ($1, $2) returning id", [
              `circuito-${randomUUID().slice(0, 6)}`,
              principal,
            ])
          )[0]?.["id"] as string;
          const dominio = (
            await un(
              `insert into dominio (duenio_marca_id, host, superficie, titular, es_canonico, registrado_por)
               values ($1, $2, 'APP', 'OPERADOR', true, $3) returning id`,
              [marca, hostAlAzar(), ACTOR_DE_PRUEBA],
            )
          )[0]?.["id"] as string;
          await un(
            "update dominio set estado = 'VERIFICADO', verificado_en = now() where id = $1",
            [dominio],
          );
          await un("update dominio set estado = 'ACTIVO' where id = $1", [dominio]);
          const plan = (
            await un("insert into plan (codigo) values ($1) returning id", [
              `circuito-${randomUUID().slice(0, 6)}`,
            ])
          )[0]?.["id"] as string;
          const vplan = (
            await un(
              "insert into version_de_plan (plan_id, nombre_comercial, modulos, perillas) values ($1, 'Circuito', '{}', '{}') returning id",
              [plan],
            )
          )[0]?.["id"] as string;
          await un(
            "update version_de_plan set nombre_comercial = 'Circuito editado' where id = $1",
            [vplan],
          );
          await un(
            "update version_de_plan set estado = 'PUBLICADA', numero = 1, motivo = 'primera', publicada_en = now(), publicada_por = $2 where id = $1",
            [vplan, ACTOR_DE_PRUEBA],
          );
          const vmarca = (
            await un(
              "insert into version_de_marca (marca_id, nombre_visible, plan_por_defecto_id) values ($1, 'Circuito', $2) returning id",
              [marca, plan],
            )
          )[0]?.["id"] as string;
          await un(
            `update version_de_marca set estado = 'CONFIRMADA', numero = 1, vigente_desde = now(), motivo = 'primera',
                  confirmada_en = now(), confirmada_por = $2 where id = $1`,
            [vmarca, ACTOR_DE_PRUEBA],
          );
          const tenant = (
            await un("insert into tenant (nombre, marca_id) values ('Circuito', $1) returning id", [
              marca,
            ])
          )[0]?.["id"] as string;
          const empresa = (
            await un(
              "insert into empresa (tenant_id, cuit, razon_social) values ($1, '30500010912', 'Circuito SA') returning id",
              [tenant],
            )
          )[0]?.["id"] as string;
          await un(
            `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
           values ($1, 1, $2, now(), 'ALTA', 'alta', $3)`,
            [tenant, vplan, ACTOR_DE_PRUEBA],
          );
          await un(
            `insert into ajuste_de_perilla (tenant_id, empresa_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
           values ($1, $2, 'empresas_por_tenant', 1, 'ILIMITADO', now(), 'extra', $3)`,
            [tenant, empresa, ACTOR_DE_PRUEBA],
          );
          await un("insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'reservas')", [
            empresa,
          ]);
          await un("update modulo_de_empresa set activo = false where empresa_id = $1", [empresa]);
          await un(
            `insert into dominio (duenio_marca_id, host, superficie, titular, registrado_por)
             values ($1, $2, 'CARTA', 'OPERADOR', $3)`,
            [marca, hostAlAzar(), ACTOR_DE_PRUEBA],
          );
          const retirados = await s.intentar(
            "update dominio set estado = 'RETIRADO', motivo = 'x' where duenio_marca_id = $1 and not es_canonico",
            [marca],
          );
          expect(retirados.ok && retirados.filas).toBe(1);
          await un("update plan set estado = 'RETIRADO' where id = $1", [plan]);
          await un("update marca set estado = 'RETIRADA' where id = $1", [marca]);
          // …y la base impuso sus reglas en el camino: el tenant quedó con la marca que se le dio
          expect(
            (await un("select marca_id from tenant where id = $1", [tenant]))[0]?.["marca_id"],
          ).toBe(marca);
          await s.deshacer();
        });
      });

      it("ADMIN no puede escribir en nombre de otro: registrado_por, asignado_por, publicada_por y confirmada_por son el actor firmado", async () => {
        await conPlataformaDe(b, "ADMIN", async (s) => {
          violaPolitica(
            await s.intentar(
              `insert into dominio (duenio_marca_id, host, superficie, titular, registrado_por)
               values ($1, $2, 'APP', 'OPERADOR', $3)`,
              [principal, hostAlAzar(), SOPORTE_DE_PRUEBA],
            ),
          );
          violaPolitica(
            await s.intentar(
              `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
             values ($1, 3, $2, now(), 'CAMBIO', 'x', $3)`,
              [e1a.tenant, versionP1, SOPORTE_DE_PRUEBA],
            ),
          );
          violaPolitica(
            await s.intentar(
              `insert into ajuste_de_perilla (tenant_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
             values ($1, 'empresas_por_tenant', 2, '9', now(), 'x', 'otro')`,
              [e1a.tenant],
            ),
          );
          // publicar un borrador a nombre de otro
          const plan = await s.intentar("insert into plan (codigo) values ($1) returning id", [
            `ajeno-${randomUUID().slice(0, 6)}`,
          ]);
          const planId = plan.ok ? (plan.rows[0]?.["id"] as string) : "";
          const v = await s.intentar(
            "insert into version_de_plan (plan_id, nombre_comercial) values ($1, 'x') returning id",
            [planId],
          );
          const vId = v.ok ? (v.rows[0]?.["id"] as string) : "";
          violaPolitica(
            await s.intentar(
              "update version_de_plan set estado = 'PUBLICADA', numero = 1, motivo = 'x', publicada_en = now(), publicada_por = 'otro' where id = $1",
              [vId],
            ),
          );
          // confirmar una versión de marca a nombre de otro
          const marca = await s.intentar("insert into marca (codigo) values ($1) returning id", [
            `ajena-${randomUUID().slice(0, 6)}`,
          ]);
          const marcaId = marca.ok ? (marca.rows[0]?.["id"] as string) : "";
          const vm = await s.intentar(
            "insert into version_de_marca (marca_id) values ($1) returning id",
            [marcaId],
          );
          const vmId = vm.ok ? (vm.rows[0]?.["id"] as string) : "";
          violaPolitica(
            await s.intentar(
              `update version_de_marca set estado = 'CONFIRMADA', numero = 1, vigente_desde = now(), motivo = 'x',
                    confirmada_en = now(), confirmada_por = 'otro' where id = $1`,
              [vmId],
            ),
          );
          await s.deshacer();
        });
      });

      it("ADMIN no toca lo inmutable por columna: ni el código de una marca, ni «principal», ni la marca de un tenant, ni una asignación o un ajuste", async () => {
        await conPlataformaDe(b, "ADMIN", async (s) => {
          sinPermiso(await s.intentar("update marca set codigo = 'x' where id = $1", [marcaB]));
          sinPermiso(
            await s.intentar("update marca set es_principal = true where id = $1", [marcaB]),
          );
          sinPermiso(
            await s.intentar("insert into marca (codigo, es_principal) values ('otra', true)"),
          );
          sinPermiso(
            await s.intentar("update marca set marca_padre_id = null where id = $1", [marcaB]),
          );
          sinPermiso(
            await s.intentar("update tenant set marca_id = $1 where id = $2", [marcaB, e1a.tenant]),
          );
          sinPermiso(await s.intentar("update plan_de_tenant set motivo = 'x'"));
          sinPermiso(await s.intentar("update ajuste_de_perilla set valor = '1'"));
          sinPermiso(await s.intentar("update dominio set host = 'otro.test'"));
          sinPermiso(await s.intentar("update plan set codigo = 'x'"));
          sinPermiso(await s.intentar("update modulo_de_empresa set modulo = 'x1'"));
          sinPermiso(await s.intentar("delete from marca"));
          sinPermiso(await s.intentar("delete from plan_de_tenant"));
          sinPermiso(await s.intentar("truncate marca"));
          sinPermiso(await s.intentar("select 1 from nivel_de_control limit 1"));
        });
      });

      it("una versión publicada o confirmada no se edita ni con los permisos del ADMIN (la política la saca del alcance del UPDATE)", async () => {
        await conPlataformaDe(b, "ADMIN", async (s) => {
          const p = await s.intentar(
            "update version_de_plan set nombre_comercial = 'X' where id = $1",
            [versionP1],
          );
          expect(p.ok && p.filas).toBe(0);
          const m = await s.intentar(
            "update version_de_marca set nombre_visible = 'X' where estado = 'CONFIRMADA'",
          );
          expect(m.ok && m.filas).toBe(0);
          // el borrador sí
          const bor = await s.intentar(
            "update version_de_plan set nombre_comercial = 'Borrador editado' where id = $1",
            [borradorP3],
          );
          expect(bor.ok && bor.filas).toBe(1);
          await s.deshacer();
        });
      });
    });

    // ===========================================================================================
    // Sin ciclos de políticas
    // ===========================================================================================
    describe("las políticas no forman ciclos", () => {
      it("leer, insertar y actualizar las tablas nuevas se planifica con cada rol, sin «infinite recursion»", async () => {
        const consultas = TABLAS_NUEVAS.flatMap((t) => [
          `select count(*) from ${t}`,
          `update ${t} set creado_en = creado_en where false`,
          `explain select * from ${t}`,
        ]);
        const sin = (r: Intento, donde: string) => {
          if (!r.ok) expect(r.mensaje, donde).not.toMatch(/infinite recursion/);
        };
        await publico(async (s) => {
          for (const texto of consultas) sin(await s.intentar(texto), `publico: ${texto}`);
        });
        await conAppDe(b, e1a, async (s) => {
          for (const texto of consultas) sin(await s.intentar(texto), `app: ${texto}`);
        });
        await grupo(e1a.tenant, propietario1, async (s) => {
          for (const texto of consultas) sin(await s.intentar(texto), `grupo: ${texto}`);
        });
        await trabajos(async (s) => {
          for (const texto of consultas) sin(await s.intentar(texto), `trabajos: ${texto}`);
        });
        for (const actor of ["ADMIN", "SOPORTE"] as const) {
          await plataforma(actor, async (s) => {
            for (const texto of consultas) sin(await s.intentar(texto), `${actor}: ${texto}`);
          });
        }
        // y las lecturas encadenadas que usan las políticas de planes (versión -> asignación -> empresa -> tenant)
        await conAppDe(b, e1a, async (s) => {
          const r = await s.intentar(
            `select v.nombre_comercial from version_de_plan v
             join plan_de_tenant p on p.version_de_plan_id = v.id
             join ajuste_de_perilla a on a.tenant_id = p.tenant_id
             join modulo_de_empresa m on m.empresa_id = $1`,
            [e1a.empresa],
          );
          expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
        });
      });
    });

    it("lo que ve cada empresa de lo nuevo no cambia por el estado de otra: una empresa suspendida no oculta ni muestra datos de las demás", async () => {
      const suspendida = await crearMundoDeMarca(dueno, { marca: principal, tenant: e1a.tenant });
      await dueno.query(
        "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [suspendida.empresa],
      );
      await conAppDe(b, e1a, async (s) => {
        expect(
          valores(await s.intentar("select numero from plan_de_tenant order by numero"), "numero"),
        ).toEqual([1, 2]);
      });
      // la suspendida lee (las políticas de lectura no miran si opera) pero no escribe niveles de control
      await conAppDe(b, suspendida, async (s) => {
        expect(
          valores(await s.intentar("select numero from plan_de_tenant order by numero"), "numero"),
        ).toEqual([1, 2]);
        violaPolitica(
          await s.intentar(
            "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'caja.descuadre', 'AVISAR')",
            [suspendida.empresa],
          ),
        );
      });
    });

    // ===========================================================================================
    // Dominios por superficie: host -> (dueño, superficie, marca). Va antes de la vigencia programada
    // porque crea marcas nuevas (los casos de arriba las cuentan).
    // ===========================================================================================
    describe("dominios por superficie", () => {
      type Fila = Readonly<{
        host: string;
        superficie: string;
        duenio_marca_id: string | null;
        duenio_empresa_id: string | null;
        marca_id: string;
      }>;

      /** Dos marcas con una empresa cada una y dominios de todos los estados y superficies. */
      async function armarMundo() {
        const mx = await crearMarca(dueno);
        const my = await crearMarca(dueno);
        const ex = await crearMundoDeMarca(dueno, { marca: mx });
        const ey = await crearMundoDeMarca(dueno, { marca: my });
        const appX = await crearDominio(dueno, mx, { superficie: "APP", canonico: true });
        const cartaX = await crearDominio(dueno, mx, { superficie: "CARTA" });
        const landingX = await crearDominio(dueno, mx, { superficie: "LANDING" });
        const consolaX = await crearDominio(dueno, mx, { superficie: "CONSOLA" });
        const cartaDeEx = await crearDominioDeEmpresa(dueno, ex.empresa, { superficie: "CARTA" });
        const appDeEy = await crearDominioDeEmpresa(dueno, ey.empresa, { superficie: "APP" });
        const pendienteDeEx = await crearDominioDeEmpresa(dueno, ex.empresa, {
          superficie: "APP",
          estado: "PENDIENTE_VERIFICACION",
        });
        const verificadoDeEy = await crearDominioDeEmpresa(dueno, ey.empresa, {
          superficie: "CARTA",
          estado: "VERIFICADO",
        });
        const retiradoDeEy = await crearDominioDeEmpresa(dueno, ey.empresa, {
          superficie: "CARTA",
          estado: "RETIRADO",
        });
        return {
          mx,
          my,
          ex,
          ey,
          appX,
          cartaX,
          landingX,
          consolaX,
          cartaDeEx,
          appDeEy,
          pendienteDeEx,
          verificadoDeEy,
          retiradoDeEy,
        };
      }

      it("el público resuelve host -> (dueño, superficie, marca): un host de marca devuelve la marca dueña; uno de empresa, la empresa y la marca de SU tenant", async () => {
        const w = await armarMundo();
        await publico(async (s) => {
          const resolver = async (host: string): Promise<Fila[]> => {
            const r = await s.intentar(
              "select host, superficie, duenio_marca_id, duenio_empresa_id, marca_id from resolucion_de_host where host = $1",
              [host],
            );
            expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
            return r.ok ? (r.rows as Fila[]) : [];
          };
          expect(await resolver(w.appX.host)).toEqual([
            {
              host: w.appX.host,
              superficie: "APP",
              duenio_marca_id: w.mx,
              duenio_empresa_id: null,
              marca_id: w.mx,
            },
          ]);
          for (const [d, superficie] of [
            [w.cartaX, "CARTA"],
            [w.landingX, "LANDING"],
            [w.consolaX, "CONSOLA"],
          ] as const) {
            const [fila] = await resolver(d.host);
            expect(fila?.superficie).toBe(superficie);
            expect(fila?.duenio_marca_id).toBe(w.mx);
          }
          // host de empresa: dueño empresa, marca de entrada la de su tenant (cada una la suya)
          expect(await resolver(w.cartaDeEx.host)).toEqual([
            {
              host: w.cartaDeEx.host,
              superficie: "CARTA",
              duenio_marca_id: null,
              duenio_empresa_id: w.ex.empresa,
              marca_id: w.mx,
            },
          ]);
          expect(await resolver(w.appDeEy.host)).toEqual([
            {
              host: w.appDeEy.host,
              superficie: "APP",
              duenio_marca_id: null,
              duenio_empresa_id: w.ey.empresa,
              marca_id: w.my,
            },
          ]);
        });
      });

      it("un host sirve SOLO su superficie: pedido con otra superficie no resuelve; tampoco el pendiente, el verificado ni el retirado", async () => {
        const w = await armarMundo();
        await publico(async (s) => {
          const cuantos = async (host: string, superficie: string) =>
            valores(
              await s.intentar(
                "select host from resolucion_de_host where host = $1 and superficie = $2",
                [host, superficie],
              ),
              "host",
            ).length;
          const todas = ["APP", "CARTA", "LANDING", "CONSOLA"];
          for (const [d, propia] of [
            [w.appX, "APP"],
            [w.cartaX, "CARTA"],
            [w.landingX, "LANDING"],
            [w.consolaX, "CONSOLA"],
            [w.cartaDeEx, "CARTA"],
            [w.appDeEy, "APP"],
          ] as const) {
            for (const superficie of todas) {
              expect(await cuantos(d.host, superficie), `${propia} pedido como ${superficie}`).toBe(
                superficie === propia ? 1 : 0,
              );
            }
          }
          for (const d of [w.pendienteDeEx, w.verificadoDeEy, w.retiradoDeEy]) {
            for (const superficie of todas) expect(await cuantos(d.host, superficie)).toBe(0);
          }
        });
      });

      it("el público no ve datos de empresas ni de tenants: la vista trae solo cinco columnas y no se abre empresa, tenant, persona ni membresía", async () => {
        const w = await armarMundo();
        await publico(async (s) => {
          const r = await s.intentar("select * from resolucion_de_host where host = $1", [
            w.cartaDeEx.host,
          ]);
          expect(r.ok).toBe(true);
          if (r.ok) {
            expect(Object.keys(r.rows[0] ?? {}).sort()).toEqual([
              "duenio_empresa_id",
              "duenio_marca_id",
              "host",
              "marca_id",
              "superficie",
            ]);
          }
          for (const tabla of ["empresa", "tenant", "persona", "membresia_tenant", "sucursal"]) {
            sinPermiso(await s.intentar(`select * from ${tabla} limit 1`));
          }
          // ni el titular, ni quién lo registró, ni el motivo, ni la verificación: ni por la vista ni por la tabla
          for (const columna of ["titular", "registrado_por", "motivo", "verificado_en", "id"]) {
            const enLaVista = await s.intentar(`select ${columna} from resolucion_de_host`);
            expect(!enLaVista.ok && enLaVista.codigo, columna).toBe("42703"); // la vista no la tiene
            sinPermiso(await s.intentar(`select ${columna} from dominio`));
          }
          // y no escribe
          sinPermiso(await s.intentar("update dominio set estado = 'RETIRADO'"));
          // la vista une dos tablas: no admite escrituras (55000) y, aunque pudiera, el rol no tiene el privilegio
          for (const texto of [
            "insert into resolucion_de_host (host) values ('x.test')",
            "update resolucion_de_host set host = 'x.test'",
            "delete from resolucion_de_host",
          ]) {
            const r = await s.intentar(texto);
            expect(!r.ok && ["55000", "42501"].includes(r.codigo), texto).toBe(true);
          }
        });
      });

      it("entre marcas: el host de la empresa de una marca nunca resuelve a otra marca, y un tenant no cambia de marca", async () => {
        const w = await armarMundo();
        await publico(async (s) => {
          const r = await s.intentar(
            "select host, marca_id from resolucion_de_host where host = any($1)",
            [[w.cartaDeEx.host, w.appDeEy.host, w.appX.host]],
          );
          const porHost = new Map(
            (r.ok ? r.rows : []).map((f) => [f["host"] as string, f["marca_id"] as string]),
          );
          expect(porHost.get(w.cartaDeEx.host)).toBe(w.mx);
          expect(porHost.get(w.appDeEy.host)).toBe(w.my);
          expect(porHost.get(w.appX.host)).toBe(w.mx);
        });
        // el tenant de Ey no puede pasar a la marca de Ex (si pudiera, el host de su empresa cambiaría de puerta)
        const r = await dueno
          .query("update tenant set marca_id = $1 where id = $2", [w.mx, w.ey.tenant])
          .then(
            () => null,
            (e: { constraint?: string }) => e.constraint,
          );
        expect(r).toBe("tenant_marca_inmutable");
      });

      it("la aplicación, con contexto de empresa, ve solo los dominios CANÓNICOS y ACTIVOS (de marcas), nunca los de empresas, ni los de su propia empresa, ni titular ni verificación", async () => {
        const w = await armarMundo();
        await conAppDe(b, w.ex, async (s) => {
          const r = await s.intentar(
            "select host, superficie, marca_id, es_canonico from dominio where host = any($1)",
            [[w.appX.host, w.cartaX.host, w.cartaDeEx.host, w.pendienteDeEx.host, w.appDeEy.host]],
          );
          expect(r.ok).toBe(true);
          expect(r.ok ? r.rows : []).toEqual([
            { host: w.appX.host, superficie: "APP", marca_id: w.mx, es_canonico: true },
          ]);
          for (const columna of ["titular", "estado", "verificado_en", "duenio_empresa_id", "id"]) {
            sinPermiso(await s.intentar(`select ${columna} from dominio`));
          }
          sinPermiso(await s.intentar("select * from resolucion_de_host"));
          sinPermiso(await s.intentar("update dominio set estado = 'RETIRADO'"));
        });
      });

      it("un ADMIN registra el host de una empresa, lo verifica, lo activa y lo retira; la marca de entrada la fija la base; un SOPORTE lo ve pero no lo cambia; sin actor vigente no ve nada", async () => {
        const w = await armarMundo();
        const host = hostAlAzar();
        const id = await conPlataformaDe(b, "ADMIN", async (s) => {
          const alta = await s.intentar(
            `insert into dominio (host, superficie, duenio_empresa_id, titular, registrado_por)
             values ($1, 'CARTA', $2, 'CLIENTE', $3) returning id, estado, marca_id`,
            [host, w.ex.empresa, ACTOR_DE_PRUEBA],
          );
          expect(alta.ok, alta.ok ? "" : alta.mensaje).toBe(true);
          if (!alta.ok) throw new Error("no se registró");
          expect(alta.rows[0]).toMatchObject({ estado: "PENDIENTE_VERIFICACION", marca_id: w.mx });
          const dominioId = alta.rows[0]?.["id"] as string;
          for (const paso of [
            "update dominio set estado = 'VERIFICADO', verificado_en = now() where id = $1",
            "update dominio set estado = 'ACTIVO' where id = $1",
          ]) {
            const r = await s.intentar(paso, [dominioId]);
            expect(r.ok && r.filas, paso).toBe(1);
          }
          const c = await s.confirmar();
          expect(c.ok).toBe(true);
          return dominioId;
        });
        await publico(async (s) => {
          expect(
            valores(
              await s.intentar("select host from resolucion_de_host where host = $1", [host]),
              "host",
            ),
          ).toEqual([host]);
        });
        // SOPORTE: ve, no cambia
        await conPlataformaDe(b, "SOPORTE", async (s) => {
          expect(
            valores(await s.intentar("select estado from dominio where id = $1", [id]), "estado"),
          ).toEqual(["ACTIVO"]);
          const r = await s.intentar(
            "update dominio set estado = 'RETIRADO', motivo = 'x' where id = $1",
            [id],
          );
          expect(r.ok && r.filas).toBe(0);
          violaPolitica(
            await s.intentar(
              `insert into dominio (host, superficie, duenio_empresa_id, titular, registrado_por)
               values ($1, 'CARTA', $2, 'CLIENTE', $3)`,
              [hostAlAzar(), w.ex.empresa, SOPORTE_DE_PRUEBA],
            ),
          );
        });
        // sin actor vigente (sin contexto, de baja o desconocido): no ve ni un dominio
        for (const actor of [null, "BAJA", "INEXISTENTE"] as const) {
          await plataforma(actor, async (s) => {
            const r = await s.intentar("select id from dominio");
            expect(r.ok && r.rows.length, String(actor)).toBe(0);
          });
        }
        // el retiro vuelve a la página neutra de inmediato
        await conPlataformaDe(b, "ADMIN", async (s) => {
          const r = await s.intentar(
            "update dominio set estado = 'RETIRADO', motivo = 'se fue el cliente' where id = $1",
            [id],
          );
          expect(r.ok && r.filas).toBe(1);
          expect((await s.confirmar()).ok).toBe(true);
        });
        await publico(async (s) => {
          expect(
            valores(
              await s.intentar("select host from resolucion_de_host where host = $1", [host]),
              "host",
            ),
          ).toEqual([]);
        });
      });

      it("el alta es idempotente: repetir el pedido con la misma clave no duplica nada, y otro pedido con el mismo host choca con la única nombrada", async () => {
        const w = await armarMundo();
        const host = hostAlAzar();
        const clave = `alta-dominio-${randomUUID()}`;
        const huella = "a".repeat(64);
        /** Lo que hace el caso de uso en UNA transacción: reserva la clave y registra el host. */
        const pedido = async (claveDelPedido: string) =>
          conPlataformaDe(b, "ADMIN", async (s) => {
            const reserva = await s.intentar(
              `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado)
               values ($1, $2, 'dominios.agregar', $3, '{}'::jsonb)`,
              [ACTOR_DE_PRUEBA, claveDelPedido, huella],
            );
            if (!reserva.ok) {
              await s.deshacer();
              return reserva;
            }
            const alta = await s.intentar(
              `insert into dominio (host, superficie, duenio_empresa_id, titular, registrado_por)
               values ($1, 'CARTA', $2, 'CLIENTE', $3)`,
              [host, w.ex.empresa, ACTOR_DE_PRUEBA],
            );
            if (!alta.ok) {
              await s.deshacer();
              return alta;
            }
            const c = await s.confirmar();
            return c.ok ? alta : c;
          });
        const primero = await pedido(clave);
        expect(primero.ok).toBe(true);
        // el reintento (misma clave): la reserva choca y no se registra nada más
        const reintento = await pedido(clave);
        expect(!reintento.ok && reintento.restriccion).toBe("idempotencia_plataforma_pkey");
        // otro pedido (otra clave) por el mismo host: la única del host lo frena y la reserva se deshace
        const otraClave = `alta-dominio-${randomUUID()}`;
        const otro = await pedido(otraClave);
        expect(!otro.ok && otro.restriccion).toBe("dominio_host_uk");
        const { rows } = await dueno.query(
          "select 1 from dominio where host = $1 union all select 1 from idempotencia_plataforma where clave = $2",
          [host, otraClave],
        );
        expect(rows).toHaveLength(0 + 1); // el dominio único y NINGUNA reserva de la clave que se deshizo
      });
    });

    // Va al final: crea una marca nueva y los demás casos cuentan las marcas de la base.
    describe("vigencia programada", () => {
      it("una versión programada empieza a verse cuando llega su fecha, no antes", async () => {
        const m = await crearMarca(dueno);
        await crearVersionDeMarcaConfirmada(dueno, m, {
          nombreVisible: "Casi vigente",
          desdeSegundos: 1,
        });
        const nombres = () =>
          publico(async (s) =>
            valores(
              await s.intentar("select nombre_visible from version_de_marca where marca_id = $1", [
                m,
              ]),
              "nombre_visible",
            ),
          );
        expect(await nombres()).toEqual([]);
        await new Promise((r) => setTimeout(r, 1_300));
        expect(await nombres()).toEqual(["Casi vigente"]);
      });
    });
  },
);
