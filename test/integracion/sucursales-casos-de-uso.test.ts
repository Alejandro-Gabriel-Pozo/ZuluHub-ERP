import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeEmpresas,
  crearConsultasDeEmpresas,
  type CasosDeUsoDeEmpresas,
  type ConsultasDeEmpresas,
} from "../../src/modulos/empresas/publico";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../src/primitivas/identificadores/marca";
import type { OpcionesDeTransaccion, Transacciones } from "../../src/puertos/transacciones";
import {
  comoEmpresa,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
  type TxDePrueba,
} from "./entorno";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  sucursalDe,
  type RolDePrueba,
} from "./fixtures-identidad";

/**
 * H6, tramo T2: los casos de uso y las consultas de sucursales contra una base real, con los roles
 * limitados y el contexto firmado (nunca el dueño de la base, salvo para armar el escenario y para
 * mirar). Cubre autorización por rol, aislamiento entre empresas, idempotencia, atomicidad,
 * auditoría y las consultas. La concurrencia está en `sucursales-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");

type Fila = Record<string, unknown>;
const cualquierTexto = expect.any(String) as string;

describe.skipIf(base === null)(
  "sucursales: los casos de uso y las consultas contra una base real",
  () => {
    // Base propia de este archivo (ver `identidad-casos-de-uso.test.ts`): SERIALIZABLE aborta por
    // falsos positivos cuando otros archivos, en paralelo, escriben las mismas tablas.
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let entorno: ReturnType<typeof crearEntornoDePrueba>;
    let dueno: pg.Client;
    let casos: CasosDeUsoDeEmpresas;
    let consultas: ConsultasDeEmpresas;
    /** Las opciones con las que las consultas abren su transacción. */
    const opcionesVistas: OpcionesDeTransaccion[] = [];

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDePrueba(propia.base, 10);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      casos = crearCasosDeUsoDeEmpresas({ transacciones: entorno, reglas: REGLAS_DE_EMPRESA });
      const espia: Transacciones<TxDePrueba> = {
        ejecutar: (opciones, trabajo) => {
          opcionesVistas.push(opciones);
          return entorno.ejecutar(opciones, trabajo);
        },
      };
      consultas = crearConsultasDeEmpresas({ transacciones: espia, reglas: REGLAS_DE_EMPRESA });
    });
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    });

    const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
      (await dueno.query<T>(texto, parametros)).rows;
    const contar = async (texto: string, parametros: unknown[] = []) =>
      Number((await filas<{ n: string }>(texto, parametros))[0]?.n);

    // ---- escenarios ---------------------------------------------------------------------------

    type Escenario = EmpresaDePrueba &
      Readonly<{
        empresaId: EmpresaId;
        /** La sucursal que trae la empresa de prueba ("Casa central"). */
        sucursal: SucursalId;
        gerente: PersonaId;
        ctx: ContextoOperativo;
      }>;

    /** Una empresa activa con su sucursal y su gerente (miembro activo). */
    const escenario = async (tenant?: EmpresaDePrueba["tenant"]): Promise<Escenario> => {
      const e = await crearEmpresaActiva(entorno, tenant === undefined ? {} : { tenant });
      const sucursal = sucursalId(await sucursalDe(dueno, e.empresa));
      const g = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, g.id, "GERENTE");
      const gerente = personaId(g.id);
      return {
        ...e,
        empresaId: e.empresa,
        sucursal,
        gerente,
        ctx: comoEmpresa(e.empresa, gerente),
      };
    };

    /** Un miembro más de la empresa (creado por el dueño de la base). */
    const miembro = async (e: Escenario, rol: RolDePrueba, activo = true) => {
      const p = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, p.id, rol, activo);
      return { id: personaId(p.id), ctx: comoEmpresa(e.empresa, personaId(p.id)) };
    };

    /** Una sucursal extra, creada por el caso de uso con el gerente (tiene que salir bien). */
    const sucursalNueva = async (e: Escenario, nombre: string): Promise<SucursalId> => {
      const r = await casos.crearSucursal(e.ctx, { nombre });
      if (!r.ok) throw new Error(`no se pudo crear la sucursal: ${JSON.stringify(r.error)}`);
      return r.valor.sucursalId;
    };

    // ---- lo que se mira en la base ------------------------------------------------------------

    const sucursales = (empresa: string) =>
      filas(
        "select id, nombre, activa, version from sucursal where empresa_id = $1 order by nombre, id",
        [empresa],
      );
    const sucursal = async (id: string) =>
      (await filas("select * from sucursal where id = $1", [id]))[0];
    const auditoria = (empresa: string, accion?: string) =>
      filas(
        `select accion, actor_persona_id, entidad, entidad_id, antes, despues from auditoria_empresa
       where empresa_id = $1 and ($2::text is null or accion = $2) order by id`,
        [empresa, accion ?? null],
      );
    const foto = async (empresa: string) =>
      JSON.stringify({
        sucursales: await filas("select * from sucursal where empresa_id = $1 order by id", [
          empresa,
        ]),
        auditoria: await filas(
          "select * from auditoria_empresa where empresa_id = $1 order by id",
          [empresa],
        ),
        asignaciones: await filas(
          "select * from asignacion_sucursal where empresa_id = $1 order by sucursal_id, persona_id",
          [empresa],
        ),
      });

    const suspenderEmpresa = (empresa: string) =>
      dueno.query(
        "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [empresa],
      );
    const suspenderTenant = (tenant: string) =>
      dueno.query(
        "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [tenant],
      );

    // =============================================================================================
    describe("crearSucursal", () => {
      it("el gerente crea una sucursal: queda activa, en su empresa, y deja su auditoría", async () => {
        const e = await escenario();
        const r = await casos.crearSucursal(e.ctx, { nombre: "Sucursal norte" });
        expect(r).toEqual({ ok: true, valor: { sucursalId: cualquierTexto, yaExistia: false } });
        if (!r.ok) return;
        expect(await sucursal(r.valor.sucursalId)).toMatchObject({
          empresa_id: e.empresa,
          nombre: "Sucursal norte",
          activa: true,
          version: 1,
        });
        expect(await auditoria(e.empresa, "SUCURSAL_CREADA")).toEqual([
          {
            accion: "SUCURSAL_CREADA",
            actor_persona_id: e.gerente,
            entidad: "sucursal",
            entidad_id: r.valor.sucursalId,
            antes: null,
            despues: { nombre: "Sucursal norte", activa: true },
          },
        ]);
      });

      it("el administrador también crea; la Casa central sigue como estaba", async () => {
        const e = await escenario();
        const admin = await miembro(e, "ADMINISTRADOR");
        const r = await casos.crearSucursal(admin.ctx, { nombre: "Local 2" });
        expect(r.ok && r.valor.yaExistia).toBe(false);
        expect((await sucursales(e.empresa)).map((s) => s["nombre"])).toEqual([
          "Casa central",
          "Local 2",
        ]);
        expect((await auditoria(e.empresa, "SUCURSAL_CREADA"))[0]?.["actor_persona_id"]).toBe(
          admin.id,
        );
      });

      it("el nombre se limpia: sin espacios en los extremos ni piezas sueltas de una letra", async () => {
        const e = await escenario();
        const r = await casos.crearSucursal(e.ctx, { nombre: "  Café del centro \t" });
        expect(r.ok).toBe(true);
        expect((await sucursales(e.empresa)).map((s) => s["nombre"])).toContain("Café del centro");
      });

      it("un nombre inválido da NOMBRE_DE_SUCURSAL_INVALIDO y no escribe nada", async () => {
        const e = await escenario();
        const antes = await foto(e.empresa);
        for (const nombre of ["", "   ", "Local\nnorte", "x".repeat(101)]) {
          expect(await casos.crearSucursal(e.ctx, { nombre })).toEqual({
            ok: false,
            error: "NOMBRE_DE_SUCURSAL_INVALIDO",
          });
        }
        expect(await foto(e.empresa)).toBe(antes);
      });

      it("un nombre de 100 caracteres entra", async () => {
        const e = await escenario();
        expect((await casos.crearSucursal(e.ctx, { nombre: "x".repeat(100) })).ok).toBe(true);
      });

      it("idempotente: repetir el alta devuelve la misma sucursal (yaExistia) y no duplica nada", async () => {
        const e = await escenario();
        const primera = await casos.crearSucursal(e.ctx, { nombre: "Sucursal norte" });
        const segunda = await casos.crearSucursal(e.ctx, { nombre: "Sucursal norte" });
        if (!primera.ok || !segunda.ok) throw new Error("tenían que salir bien");
        expect(primera.valor.yaExistia).toBe(false);
        expect(segunda.valor).toEqual({ sucursalId: primera.valor.sucursalId, yaExistia: true });
        expect(await sucursales(e.empresa)).toHaveLength(2);
        expect(await auditoria(e.empresa, "SUCURSAL_CREADA")).toHaveLength(1);
        // El repetido no tocó la sucursal.
        expect(await sucursal(primera.valor.sucursalId)).toMatchObject({ version: 1 });
      });

      it("el nombre repetido no distingue mayúsculas ni cómo se escribe la letra con acento", async () => {
        const e = await escenario();
        const primera = await casos.crearSucursal(e.ctx, { nombre: "Café Norte" });
        if (!primera.ok) throw new Error("tenía que salir bien");
        // Las mayúsculas se prueban con letras ASCII: `lower()` de la base depende de su locale (en una
        // base con locale C no pliega "É" con "é"), y eso está anotado como riesgo del tramo.
        for (const nombre of ["CAFé NORTE", "café norte", "Café Norte", "  Café Norte  "]) {
          const r = await casos.crearSucursal(e.ctx, { nombre });
          expect(r, nombre).toEqual({
            ok: true,
            valor: { sucursalId: primera.valor.sucursalId, yaExistia: true },
          });
        }
        expect(await sucursales(e.empresa)).toHaveLength(2);
      });

      it("con el nombre de una sucursal desactivada da SUCURSAL_INACTIVA_CON_ESE_NOMBRE y no crea otra", async () => {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        await casos.desactivarSucursal(e.ctx, { sucursalId: norte });
        const antes = await foto(e.empresa);
        expect(await casos.crearSucursal(e.ctx, { nombre: "sucursal NORTE" })).toEqual({
          ok: false,
          error: "SUCURSAL_INACTIVA_CON_ESE_NOMBRE",
        });
        expect(await foto(e.empresa)).toBe(antes);
      });

      it("el mismo nombre en otra empresa es otra sucursal; ninguna ve ni toca a la otra", async () => {
        const a = await escenario();
        const b = await escenario(a.tenant);
        const deA = await casos.crearSucursal(a.ctx, { nombre: "Centro" });
        const deB = await casos.crearSucursal(b.ctx, { nombre: "Centro" });
        if (!deA.ok || !deB.ok) throw new Error("tenían que salir bien");
        expect(deA.valor.sucursalId).not.toBe(deB.valor.sucursalId);
        expect(deA.valor.yaExistia || deB.valor.yaExistia).toBe(false);
        expect(await sucursal(deA.valor.sucursalId)).toMatchObject({ empresa_id: a.empresa });
        expect(await sucursal(deB.valor.sucursalId)).toMatchObject({ empresa_id: b.empresa });
        expect(await auditoria(a.empresa, "SUCURSAL_CREADA")).toHaveLength(1);
        expect(await auditoria(b.empresa, "SUCURSAL_CREADA")).toHaveLength(1);
      });

      it("atomicidad: si falla la auditoría no queda la sucursal", async () => {
        const e = await escenario();
        const falla = crearEntornoDePrueba(propia.base, 2, (tx) => ({
          ...tx,
          auditoria: {
            registrar: () => Promise.reject(new Error("falla forzada de la auditoría")),
          },
        }));
        try {
          const roto = crearCasosDeUsoDeEmpresas({
            transacciones: falla,
            reglas: REGLAS_DE_EMPRESA,
          });
          const antes = await foto(e.empresa);
          await expect(roto.crearSucursal(e.ctx, { nombre: "Sucursal norte" })).rejects.toThrow(
            "falla forzada de la auditoría",
          );
          expect(await foto(e.empresa)).toBe(antes);
          expect(await sucursales(e.empresa)).toHaveLength(1);
        } finally {
          await falla.cerrar();
        }
      });
    });

    // =============================================================================================
    describe("editarSucursal", () => {
      it("renombra con la versión vigente: sube la versión y audita el antes y el después", async () => {
        const e = await escenario();
        const r = await casos.editarSucursal(e.ctx, {
          sucursalId: e.sucursal,
          versionEsperada: 1,
          nombre: "  Casa matriz ",
        });
        expect(r).toEqual({ ok: true, valor: { version: 2 } });
        expect(await sucursal(e.sucursal)).toMatchObject({ nombre: "Casa matriz", version: 2 });
        expect(await auditoria(e.empresa, "SUCURSAL_EDITADA")).toEqual([
          {
            accion: "SUCURSAL_EDITADA",
            actor_persona_id: e.gerente,
            entidad: "sucursal",
            entidad_id: e.sucursal,
            antes: { nombre: "Casa central" },
            despues: { nombre: "Casa matriz" },
          },
        ]);
      });

      it("el administrador también edita", async () => {
        const e = await escenario();
        const admin = await miembro(e, "ADMINISTRADOR");
        const r = await casos.editarSucursal(admin.ctx, {
          sucursalId: e.sucursal,
          versionEsperada: 1,
          nombre: "Matriz",
        });
        expect(r).toEqual({ ok: true, valor: { version: 2 } });
      });

      it("idempotente: repetir la edición ya aplicada devuelve la versión vigente y no escribe ni audita", async () => {
        const e = await escenario();
        const entrada = { sucursalId: e.sucursal, versionEsperada: 1, nombre: "Casa matriz" };
        expect(await casos.editarSucursal(e.ctx, entrada)).toEqual({
          ok: true,
          valor: { version: 2 },
        });
        const antes = await foto(e.empresa);
        // La pantalla no supo que ya se aplicó y repite con la versión vieja.
        expect(await casos.editarSucursal(e.ctx, entrada)).toEqual({
          ok: true,
          valor: { version: 2 },
        });
        expect(await casos.editarSucursal(e.ctx, { ...entrada, versionEsperada: 2 })).toEqual({
          ok: true,
          valor: { version: 2 },
        });
        expect(await foto(e.empresa)).toBe(antes);
        expect(await auditoria(e.empresa, "SUCURSAL_EDITADA")).toHaveLength(1);
      });

      it("con una versión desactualizada da VERSION_DESACTUALIZADA y no cambia nada", async () => {
        const e = await escenario();
        await casos.editarSucursal(e.ctx, {
          sucursalId: e.sucursal,
          versionEsperada: 1,
          nombre: "Casa matriz",
        });
        const antes = await foto(e.empresa);
        expect(
          await casos.editarSucursal(e.ctx, {
            sucursalId: e.sucursal,
            versionEsperada: 1,
            nombre: "Otro nombre",
          }),
        ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
        // Una versión inventada hacia adelante tampoco coincide.
        expect(
          await casos.editarSucursal(e.ctx, {
            sucursalId: e.sucursal,
            versionEsperada: 99,
            nombre: "Otro nombre",
          }),
        ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
        expect(await foto(e.empresa)).toBe(antes);
      });

      it("un nombre que ya usa otra sucursal (sin distinguir mayúsculas) da SUCURSAL_DUPLICADA y no cambia nada", async () => {
        const e = await escenario();
        await sucursalNueva(e, "Sucursal norte");
        const antes = await foto(e.empresa);
        expect(
          await casos.editarSucursal(e.ctx, {
            sucursalId: e.sucursal,
            versionEsperada: 1,
            nombre: "SUCURSAL NORTE",
          }),
        ).toEqual({ ok: false, error: "SUCURSAL_DUPLICADA" });
        expect(await foto(e.empresa)).toBe(antes);
      });

      it("también da SUCURSAL_DUPLICADA contra una sucursal desactivada (conserva su nombre)", async () => {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        await casos.desactivarSucursal(e.ctx, { sucursalId: norte });
        expect(
          await casos.editarSucursal(e.ctx, {
            sucursalId: e.sucursal,
            versionEsperada: 1,
            nombre: "sucursal norte",
          }),
        ).toEqual({ ok: false, error: "SUCURSAL_DUPLICADA" });
      });

      it("cambiar solo las mayúsculas del propio nombre se puede", async () => {
        const e = await escenario();
        const r = await casos.editarSucursal(e.ctx, {
          sucursalId: e.sucursal,
          versionEsperada: 1,
          nombre: "CASA CENTRAL",
        });
        expect(r).toEqual({ ok: true, valor: { version: 2 } });
        expect(await sucursal(e.sucursal)).toMatchObject({ nombre: "CASA CENTRAL" });
      });

      it("un nombre inválido da NOMBRE_DE_SUCURSAL_INVALIDO y no escribe nada", async () => {
        const e = await escenario();
        const antes = await foto(e.empresa);
        for (const nombre of ["", "  ", "a\tb", "x".repeat(101)]) {
          expect(
            await casos.editarSucursal(e.ctx, {
              sucursalId: e.sucursal,
              versionEsperada: 1,
              nombre,
            }),
          ).toEqual({ ok: false, error: "NOMBRE_DE_SUCURSAL_INVALIDO" });
        }
        expect(await foto(e.empresa)).toBe(antes);
      });

      it("una sucursal inexistente, un texto que no es un id o una de otra empresa dan SUCURSAL_NO_ENCONTRADA", async () => {
        const e = await escenario();
        const otra = await escenario(e.tenant);
        const antesDeOtra = await foto(otra.empresa);
        const antes = await foto(e.empresa);
        for (const id of [randomUUID(), "no-es-un-id", otra.sucursal]) {
          expect(
            await casos.editarSucursal(e.ctx, {
              sucursalId: sucursalId(id),
              versionEsperada: 1,
              nombre: "Otro",
            }),
          ).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
        }
        expect(await foto(otra.empresa)).toBe(antesDeOtra);
        expect(await foto(e.empresa)).toBe(antes);
      });

      it("se puede editar una sucursal desactivada: sigue desactivada", async () => {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        await casos.desactivarSucursal(e.ctx, { sucursalId: norte });
        const version = (await sucursal(norte))?.["version"] as number;
        expect(
          await casos.editarSucursal(e.ctx, {
            sucursalId: norte,
            versionEsperada: version,
            nombre: "Sucursal norte vieja",
          }),
        ).toEqual({ ok: true, valor: { version: version + 1 } });
        expect(await sucursal(norte)).toMatchObject({
          nombre: "Sucursal norte vieja",
          activa: false,
        });
      });

      it("editar no cambia si está activa ni sus asignaciones", async () => {
        const e = await escenario();
        const op = await miembro(e, "OPERADOR");
        await crearAsignacionDeBase(dueno, e.empresa, op.id, e.sucursal);
        await casos.editarSucursal(e.ctx, {
          sucursalId: e.sucursal,
          versionEsperada: 1,
          nombre: "Matriz",
        });
        expect(await sucursal(e.sucursal)).toMatchObject({ activa: true });
        expect(
          await contar(
            "select count(*) as n from asignacion_sucursal where sucursal_id = $1 and activa",
            [e.sucursal],
          ),
        ).toBe(1);
      });
    });

    // =============================================================================================
    describe("desactivarSucursal", () => {
      it("el gerente desactiva: queda inactiva, conserva su nombre y sus asignaciones, y deja su auditoría", async () => {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        const op = await miembro(e, "OPERADOR");
        await crearAsignacionDeBase(dueno, e.empresa, op.id, norte);

        expect(await casos.desactivarSucursal(e.ctx, { sucursalId: norte })).toEqual({
          ok: true,
          valor: { yaEstabaInactiva: false },
        });
        expect(await sucursal(norte)).toMatchObject({
          nombre: "Sucursal norte",
          activa: false,
          version: 2,
        });
        // Desactivar no apaga las asignaciones.
        expect(
          await filas("select activa from asignacion_sucursal where sucursal_id = $1", [norte]),
        ).toEqual([{ activa: true }]);
        expect(await auditoria(e.empresa, "SUCURSAL_DESACTIVADA")).toEqual([
          {
            accion: "SUCURSAL_DESACTIVADA",
            actor_persona_id: e.gerente,
            entidad: "sucursal",
            entidad_id: norte,
            antes: { nombre: "Sucursal norte", activa: true },
            despues: { nombre: "Sucursal norte", activa: false },
          },
        ]);
        // Nada se borra.
        expect(await sucursales(e.empresa)).toHaveLength(2);
      });

      it("la última sucursal activa no se desactiva: ULTIMA_SUCURSAL_ACTIVA y nada escrito", async () => {
        const e = await escenario();
        const antes = await foto(e.empresa);
        expect(await casos.desactivarSucursal(e.ctx, { sucursalId: e.sucursal })).toEqual({
          ok: false,
          error: "ULTIMA_SUCURSAL_ACTIVA",
        });
        expect(await foto(e.empresa)).toBe(antes);
      });

      it("las inactivas no cuentan como activas: con una desactivada, la otra tampoco se desactiva", async () => {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        await casos.desactivarSucursal(e.ctx, { sucursalId: norte });
        expect(await casos.desactivarSucursal(e.ctx, { sucursalId: e.sucursal })).toEqual({
          ok: false,
          error: "ULTIMA_SUCURSAL_ACTIVA",
        });
        expect(await sucursal(e.sucursal)).toMatchObject({ activa: true });
      });

      it("idempotente: desactivar dos veces es ok, no escribe ni audita la segunda y no sube la versión", async () => {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        await casos.desactivarSucursal(e.ctx, { sucursalId: norte });
        const antes = await foto(e.empresa);
        expect(await casos.desactivarSucursal(e.ctx, { sucursalId: norte })).toEqual({
          ok: true,
          valor: { yaEstabaInactiva: true },
        });
        expect(await foto(e.empresa)).toBe(antes);
        expect(await auditoria(e.empresa, "SUCURSAL_DESACTIVADA")).toHaveLength(1);
      });

      it("una inexistente, un texto que no es un id o una de otra empresa dan SUCURSAL_NO_ENCONTRADA", async () => {
        const e = await escenario();
        const otra = await escenario(e.tenant);
        await sucursalNueva(otra, "Otra sucursal");
        const antesDeOtra = await foto(otra.empresa);
        for (const id of [randomUUID(), "no-es-un-id", otra.sucursal]) {
          expect(await casos.desactivarSucursal(e.ctx, { sucursalId: sucursalId(id) })).toEqual({
            ok: false,
            error: "SUCURSAL_NO_ENCONTRADA",
          });
        }
        expect(await foto(otra.empresa)).toBe(antesDeOtra);
      });

      it("las activas de otra empresa no cuentan: con una sola activa propia, no se desactiva", async () => {
        const e = await escenario();
        const otra = await escenario(e.tenant);
        await sucursalNueva(otra, "Otra sucursal");
        expect(await casos.desactivarSucursal(e.ctx, { sucursalId: e.sucursal })).toEqual({
          ok: false,
          error: "ULTIMA_SUCURSAL_ACTIVA",
        });
      });
    });

    // =============================================================================================
    describe("reactivarSucursal", () => {
      it("el gerente reactiva: vuelve activa, con el mismo nombre y sus asignaciones como estaban, y deja su auditoría", async () => {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        const op = await miembro(e, "OPERADOR");
        await crearAsignacionDeBase(dueno, e.empresa, op.id, norte);
        await casos.desactivarSucursal(e.ctx, { sucursalId: norte });

        expect(await casos.reactivarSucursal(e.ctx, { sucursalId: norte })).toEqual({
          ok: true,
          valor: { yaEstabaActiva: false },
        });
        expect(await sucursal(norte)).toMatchObject({
          nombre: "Sucursal norte",
          activa: true,
          version: 3,
        });
        expect(
          await filas("select activa from asignacion_sucursal where sucursal_id = $1", [norte]),
        ).toEqual([{ activa: true }]);
        expect(await auditoria(e.empresa, "SUCURSAL_REACTIVADA")).toEqual([
          {
            accion: "SUCURSAL_REACTIVADA",
            actor_persona_id: e.gerente,
            entidad: "sucursal",
            entidad_id: norte,
            antes: { nombre: "Sucursal norte", activa: false },
            despues: { nombre: "Sucursal norte", activa: true },
          },
        ]);
      });

      it("idempotente: reactivar una activa es ok y no escribe ni audita", async () => {
        const e = await escenario();
        const antes = await foto(e.empresa);
        expect(await casos.reactivarSucursal(e.ctx, { sucursalId: e.sucursal })).toEqual({
          ok: true,
          valor: { yaEstabaActiva: true },
        });
        expect(await foto(e.empresa)).toBe(antes);
      });

      it("reactivar dos veces escribe una sola vez", async () => {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        await casos.desactivarSucursal(e.ctx, { sucursalId: norte });
        await casos.reactivarSucursal(e.ctx, { sucursalId: norte });
        const antes = await foto(e.empresa);
        expect(await casos.reactivarSucursal(e.ctx, { sucursalId: norte })).toEqual({
          ok: true,
          valor: { yaEstabaActiva: true },
        });
        expect(await foto(e.empresa)).toBe(antes);
        expect(await auditoria(e.empresa, "SUCURSAL_REACTIVADA")).toHaveLength(1);
      });

      it("una inexistente, un texto que no es un id o una de otra empresa dan SUCURSAL_NO_ENCONTRADA", async () => {
        const e = await escenario();
        const otra = await escenario(e.tenant);
        const otraNorte = await sucursalNueva(otra, "Otra sucursal");
        await casos.desactivarSucursal(otra.ctx, { sucursalId: otraNorte });
        const antesDeOtra = await foto(otra.empresa);
        for (const id of [randomUUID(), "no-es-un-id", otraNorte]) {
          expect(await casos.reactivarSucursal(e.ctx, { sucursalId: sucursalId(id) })).toEqual({
            ok: false,
            error: "SUCURSAL_NO_ENCONTRADA",
          });
        }
        expect(await foto(otra.empresa)).toBe(antesDeOtra);
        expect(await sucursal(otraNorte)).toMatchObject({ activa: false });
      });

      it("tras desactivar, el alta con ese nombre falla y reactivar devuelve esa misma sucursal", async () => {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        await casos.desactivarSucursal(e.ctx, { sucursalId: norte });
        expect(await casos.crearSucursal(e.ctx, { nombre: "Sucursal norte" })).toEqual({
          ok: false,
          error: "SUCURSAL_INACTIVA_CON_ESE_NOMBRE",
        });
        await casos.reactivarSucursal(e.ctx, { sucursalId: norte });
        expect(await casos.crearSucursal(e.ctx, { nombre: "Sucursal norte" })).toEqual({
          ok: true,
          valor: { sucursalId: norte, yaExistia: true },
        });
      });
    });

    // =============================================================================================
    describe("autorización por rol (en el servidor)", () => {
      type Actor = { nombre: string; armar: (e: Escenario) => Promise<ContextoOperativo> };
      const sinPermiso: Actor[] = [
        { nombre: "un operador", armar: async (e) => (await miembro(e, "OPERADOR")).ctx },
        {
          nombre: "un administrador apagado",
          armar: async (e) => (await miembro(e, "ADMINISTRADOR", false)).ctx,
        },
        {
          nombre: "una persona que no es miembro",
          armar: async (e) =>
            comoEmpresa(e.empresa, personaId((await crearPersonaDeBase(dueno)).id)),
        },
        {
          nombre: "el sistema (sin persona)",
          armar: (e) => Promise.resolve(comoEmpresa(e.empresa, null)),
        },
        {
          nombre: "el gerente de OTRA empresa",
          armar: async (e) => comoEmpresa(e.empresa, (await escenario(e.tenant)).gerente),
        },
        {
          nombre: "un gerente suspendido globalmente (persona.activo_global = false)",
          armar: async (e) => {
            await dueno.query("update persona set activo_global = false where id = $1", [
              e.gerente,
            ]);
            return e.ctx;
          },
        },
      ];

      for (const actor of sinPermiso) {
        it(`${actor.nombre} no crea, edita, desactiva ni reactiva, ni consulta: SIN_PERMISO y nada escrito`, async () => {
          const e = await escenario();
          const norte = await sucursalNueva(e, "Sucursal norte");
          const ctx = await actor.armar(e);
          const antes = await foto(e.empresa);
          const sinPermisoEsperado = { ok: false, error: "SIN_PERMISO" };

          expect(await casos.crearSucursal(ctx, { nombre: "Otra" })).toEqual(sinPermisoEsperado);
          expect(
            await casos.editarSucursal(ctx, {
              sucursalId: norte,
              versionEsperada: 1,
              nombre: "Cambiada",
            }),
          ).toEqual(sinPermisoEsperado);
          expect(await casos.desactivarSucursal(ctx, { sucursalId: norte })).toEqual(
            sinPermisoEsperado,
          );
          expect(await casos.reactivarSucursal(ctx, { sucursalId: norte })).toEqual(
            sinPermisoEsperado,
          );
          expect(await consultas.listarSucursales(ctx, { incluirInactivas: true })).toEqual(
            sinPermisoEsperado,
          );
          expect(await consultas.fichaDeSucursal(ctx, { sucursalId: norte })).toEqual(
            sinPermisoEsperado,
          );
          expect(await foto(e.empresa)).toBe(antes);
        });
      }

      it("el administrador crea, edita y consulta, pero no desactiva ni reactiva (solo el gerente)", async () => {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        const admin = await miembro(e, "ADMINISTRADOR");
        expect((await casos.crearSucursal(admin.ctx, { nombre: "Local 2" })).ok).toBe(true);
        expect(
          (
            await casos.editarSucursal(admin.ctx, {
              sucursalId: norte,
              versionEsperada: 1,
              nombre: "Norte",
            })
          ).ok,
        ).toBe(true);
        expect((await consultas.listarSucursales(admin.ctx, { incluirInactivas: true })).ok).toBe(
          true,
        );
        expect((await consultas.fichaDeSucursal(admin.ctx, { sucursalId: norte })).ok).toBe(true);
        const antes = await foto(e.empresa);
        expect(await casos.desactivarSucursal(admin.ctx, { sucursalId: norte })).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
        await casos.desactivarSucursal(e.ctx, { sucursalId: norte });
        const despues = await foto(e.empresa);
        expect(despues).not.toBe(antes);
        expect(await casos.reactivarSucursal(admin.ctx, { sucursalId: norte })).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
        expect(await foto(e.empresa)).toBe(despues);
      });

      it("la baja de un administrador surte efecto en la operación siguiente (nada se guarda en sesión)", async () => {
        const e = await escenario();
        const admin = await miembro(e, "ADMINISTRADOR");
        expect((await casos.crearSucursal(admin.ctx, { nombre: "Local 2" })).ok).toBe(true);
        await dueno.query(
          "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
          [e.empresa, admin.id],
        );
        expect(await casos.crearSucursal(admin.ctx, { nombre: "Local 3" })).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
      });
    });

    // =============================================================================================
    describe("la empresa tiene que operar", () => {
      const sinOperar: {
        nombre: string;
        preparar: (e: Escenario) => Promise<unknown>;
        motivo: string;
      }[] = [
        {
          nombre: "suspendida",
          preparar: (e) => suspenderEmpresa(e.empresa),
          motivo: "EMPRESA_SUSPENDIDA",
        },
        {
          nombre: "con el tenant suspendido",
          preparar: (e) => suspenderTenant(e.tenant),
          motivo: "TENANT_SUSPENDIDO",
        },
      ];

      for (const caso of sinOperar) {
        it(`una empresa ${caso.nombre} no crea, edita, desactiva ni reactiva: EMPRESA_NO_OPERA y nada escrito`, async () => {
          const e = await escenario();
          const norte = await sucursalNueva(e, "Sucursal norte");
          await casos.desactivarSucursal(e.ctx, { sucursalId: norte });
          await caso.preparar(e);
          const antes = await foto(e.empresa);
          const esperado = {
            ok: false,
            error: { codigo: "EMPRESA_NO_OPERA", empresaId: e.empresa, motivo: caso.motivo },
          };

          expect(await casos.crearSucursal(e.ctx, { nombre: "Otra" })).toEqual(esperado);
          expect(
            await casos.editarSucursal(e.ctx, {
              sucursalId: e.sucursal,
              versionEsperada: 1,
              nombre: "Cambiada",
            }),
          ).toEqual(esperado);
          expect(await casos.desactivarSucursal(e.ctx, { sucursalId: e.sucursal })).toEqual(
            esperado,
          );
          expect(await casos.reactivarSucursal(e.ctx, { sucursalId: norte })).toEqual(esperado);
          expect(await foto(e.empresa)).toBe(antes);
        });
      }

      it("una empresa todavía en alta (PROVISIONING) no opera", async () => {
        const enAlta = await crearEmpresaEnAlta(entorno);
        const g = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, enAlta.empresa, g.id, "GERENTE");
        expect(
          await casos.crearSucursal(comoEmpresa(enAlta.empresa, personaId(g.id)), {
            nombre: "Local",
          }),
        ).toEqual({
          ok: false,
          error: {
            codigo: "EMPRESA_NO_OPERA",
            empresaId: enAlta.empresa,
            motivo: "EMPRESA_EN_ALTA",
          },
        });
      });

      it("el motivo del guard va antes que el de la empresa: sin permiso, SIN_PERMISO aunque no opere", async () => {
        const e = await escenario();
        const op = await miembro(e, "OPERADOR");
        await suspenderEmpresa(e.empresa);
        expect(await casos.crearSucursal(op.ctx, { nombre: "Otra" })).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
      });
    });

    // =============================================================================================
    describe("listarSucursales", () => {
      it("lista las de la empresa, ordenadas por nombre e id, con la zona horaria de la empresa", async () => {
        const e = await escenario();
        await sucursalNueva(e, "Zona sur");
        await sucursalNueva(e, "Almagro");
        const r = await consultas.listarSucursales(e.ctx, { incluirInactivas: true });
        expect(r).toEqual({
          ok: true,
          valor: [
            {
              id: cualquierTexto,
              nombre: "Almagro",
              activa: true,
              version: 1,
              zonaHoraria: "America/Argentina/Buenos_Aires",
            },
            {
              id: e.sucursal,
              nombre: "Casa central",
              activa: true,
              version: 1,
              zonaHoraria: "America/Argentina/Buenos_Aires",
            },
            {
              id: cualquierTexto,
              nombre: "Zona sur",
              activa: true,
              version: 1,
              zonaHoraria: "America/Argentina/Buenos_Aires",
            },
          ],
        });
      });

      it("devuelve la zona horaria que tenga la empresa", async () => {
        const e = await escenario();
        await dueno.query("update empresa set zona_horaria = 'America/Montevideo' where id = $1", [
          e.empresa,
        ]);
        const r = await consultas.listarSucursales(e.ctx, { incluirInactivas: false });
        expect(r.ok && r.valor.map((s) => s.zonaHoraria)).toEqual(["America/Montevideo"]);
      });

      it("sin incluirInactivas oculta las desactivadas; con incluirInactivas las muestra y dice cuáles son", async () => {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        await casos.desactivarSucursal(e.ctx, { sucursalId: norte });
        const activas = await consultas.listarSucursales(e.ctx, { incluirInactivas: false });
        expect(activas.ok && activas.valor.map((s) => s.nombre)).toEqual(["Casa central"]);
        const todas = await consultas.listarSucursales(e.ctx, { incluirInactivas: true });
        expect(todas.ok && todas.valor.map((s) => [s.nombre, s.activa])).toEqual([
          ["Casa central", true],
          ["Sucursal norte", false],
        ]);
      });

      it("no mezcla empresas: la de otra empresa (ni del mismo tenant) no aparece", async () => {
        const a = await escenario();
        const b = await escenario(a.tenant);
        await sucursalNueva(b, "Solo de B");
        const deA = await consultas.listarSucursales(a.ctx, { incluirInactivas: true });
        expect(deA.ok && deA.valor.map((s) => s.nombre)).toEqual(["Casa central"]);
        expect(deA.ok && deA.valor.map((s) => s.id)).toEqual([a.sucursal]);
        const deB = await consultas.listarSucursales(b.ctx, { incluirInactivas: true });
        expect(deB.ok && deB.valor.map((s) => s.nombre)).toEqual(["Casa central", "Solo de B"]);
      });

      it("la versión que devuelve es la que acepta editar", async () => {
        const e = await escenario();
        await casos.editarSucursal(e.ctx, {
          sucursalId: e.sucursal,
          versionEsperada: 1,
          nombre: "Matriz",
        });
        const r = await consultas.listarSucursales(e.ctx, { incluirInactivas: false });
        expect(r.ok && r.valor[0]).toMatchObject({ nombre: "Matriz", version: 2 });
      });

      it("corre en read committed y solo lectura, y no escribe nada", async () => {
        const e = await escenario();
        const antes = await foto(e.empresa);
        opcionesVistas.length = 0;
        await consultas.listarSucursales(e.ctx, { incluirInactivas: true });
        await consultas.fichaDeSucursal(e.ctx, { sucursalId: e.sucursal });
        expect(opcionesVistas).toHaveLength(2);
        for (const o of opcionesVistas) {
          expect(o).toMatchObject({ aislamiento: "read committed", soloLectura: true });
        }
        expect(await foto(e.empresa)).toBe(antes);
      });

      it("una empresa suspendida sigue viendo sus sucursales (la lectura no exige que opere)", async () => {
        const e = await escenario();
        await suspenderEmpresa(e.empresa);
        const r = await consultas.listarSucursales(e.ctx, { incluirInactivas: true });
        expect(r.ok && r.valor).toHaveLength(1);
      });
    });

    // =============================================================================================
    describe("fichaDeSucursal", () => {
      it("devuelve la ficha, con la zona horaria de la empresa", async () => {
        const e = await escenario();
        expect(await consultas.fichaDeSucursal(e.ctx, { sucursalId: e.sucursal })).toEqual({
          ok: true,
          valor: {
            id: e.sucursal,
            nombre: "Casa central",
            activa: true,
            version: 1,
            zonaHoraria: "America/Argentina/Buenos_Aires",
          },
        });
      });

      it("muestra también una desactivada, con su nombre", async () => {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        await casos.desactivarSucursal(e.ctx, { sucursalId: norte });
        expect(await consultas.fichaDeSucursal(e.ctx, { sucursalId: norte })).toEqual({
          ok: true,
          valor: {
            id: norte,
            nombre: "Sucursal norte",
            activa: false,
            version: 2,
            zonaHoraria: "America/Argentina/Buenos_Aires",
          },
        });
      });

      it("devuelve null si no existe, si no es un id o si es de otra empresa", async () => {
        const e = await escenario();
        const otra = await escenario(e.tenant);
        for (const id of [randomUUID(), "no-es-un-id", otra.sucursal]) {
          expect(await consultas.fichaDeSucursal(e.ctx, { sucursalId: sucursalId(id) })).toEqual({
            ok: true,
            valor: null,
          });
        }
      });
    });
  },
);
