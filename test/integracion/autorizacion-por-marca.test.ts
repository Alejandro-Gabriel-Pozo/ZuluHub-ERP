import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import type { ClaveAccion } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../src/capacidades/permisos/roles";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeEmpresas,
  crearConsultasDeEmpresas,
  DECLARACIONES_DE_CONSULTAS_DE_EMPRESAS,
  DECLARACIONES_DE_EMPRESAS,
} from "../../src/modulos/empresas/publico";
import {
  crearCasosDeUsoDeIdentidad,
  crearConsultasDeIdentidad,
  DECLARACIONES_DE_CONSULTAS_DE_IDENTIDAD,
  DECLARACIONES_DE_IDENTIDAD,
} from "../../src/modulos/identidad/publico";
import {
  empresaId,
  invitacionId,
  marcaComercialId,
  personaId,
  sucursalId,
  type EmpresaId,
  type MarcaComercialId,
  type PersonaId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../utilidades/marcas";
import {
  comoEmpresa,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
} from "./entorno";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  sucursalDe,
  type RolDePrueba,
} from "./fixtures-identidad";
import { crearMarca, crearMundoDeMarca } from "./marcas-apoyo";

/**
 * Q1: la carga de autorización compara la MARCA DE ENTRADA del contexto con la marca del tenant de la
 * empresa (marcas y planes, §B.2.4). Contra una base real y con los roles limitados: una persona con
 * membresía en una empresa de la marca A autoriza por la puerta A y NO por la puerta B (ni sin puerta), en
 * el adaptador y en TODOS los casos de uso y consultas que pasan por el guard (identidad y empresas
 * completos; el resto de los módulos entra por el mismo adaptador, que cada `guard-primero` prueba). El
 * resultado es el mismo repetido y desde transacciones simultáneas, y desde la puerta equivocada no se
 * escribe nada.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("autorización por marca de entrada contra una base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  /** La marca A es la principal de las pruebas (la de los tenants que arma `crearEmpresaActiva`). */
  const A: MarcaComercialId = MARCA_PRINCIPAL_DE_PRUEBA;
  let B: MarcaComercialId;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 12);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    B = marcaComercialId(await crearMarca(dueno));
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const SIN_ROL = { rol: null, modulosActivados: [], modulosHabilitados: [] };

  /** Una empresa activa de la marca A con un miembro de ese rol. */
  const empresaDeA = async (rol: RolDePrueba = "GERENTE") => {
    const e = await crearEmpresaActiva(entorno);
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, p.id, rol);
    return { ...e, persona: personaId(p.id), sucursal: await sucursalDe(dueno, e.empresa) };
  };

  const delActor = async (contexto: ContextoOperativo) => {
    const r = await entorno.ejecutar({ contexto }, async (tx) =>
      ok(await tx.autorizacion.delActor(contexto)),
    );
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  };
  const sucursalesDelActor = async (contexto: ContextoOperativo) => {
    const r = await entorno.ejecutar({ contexto }, async (tx) =>
      ok(await tx.autorizacion.sucursalesDelActor(contexto)),
    );
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  // ===============================================================================================
  describe("el adaptador de autorización", () => {
    it.each(ROLES_DE_EMPRESA)(
      "un %s de la marca A: su rol por la puerta A; sin rol por la puerta B, por una marca inexistente y sin puerta",
      async (rol) => {
        const e = await empresaDeA(rol);
        const por = (marca: MarcaComercialId | null) =>
          delActor(comoEmpresa(e.empresa, e.persona, marca));
        expect(await por(A)).toEqual({ rol, modulosActivados: [], modulosHabilitados: [] });
        expect(await por(B)).toEqual(SIN_ROL);
        expect(await por(marcaComercialId(randomUUID()))).toEqual(SIN_ROL);
        // Una marca de entrada nula con una persona no autoriza (falla cerrado): el `null` es del sistema.
        expect(await por(null)).toEqual(SIN_ROL);
      },
    );

    it("la persona con membresía en una empresa de la marca A y en una de la marca B tiene en cada una el rol de SU puerta, y solo de esa", async () => {
      const ea = await empresaDeA("ADMINISTRADOR");
      const mundoB = await crearMundoDeMarca(dueno, { marca: B });
      await crearMembresiaDeBase(dueno, mundoB.empresa, ea.persona, "OPERADOR");
      const rol = async (empresa: string, marca: MarcaComercialId) =>
        (await delActor(comoEmpresa(empresaId(empresa), ea.persona, marca))).rol;
      expect(await rol(ea.empresa, A)).toBe("ADMINISTRADOR");
      expect(await rol(ea.empresa, B)).toBeNull();
      expect(await rol(mundoB.empresa, B)).toBe("OPERADOR");
      expect(await rol(mundoB.empresa, A)).toBeNull();
    });

    it("el sistema (sin persona y sin puerta) sigue sin rol, y una persona nula sin rol aunque entre por la marca correcta", async () => {
      const e = await empresaDeA();
      expect(await delActor(comoEmpresa(e.empresa, null, null))).toEqual(SIN_ROL);
      expect(await delActor(comoEmpresa(e.empresa, null, A))).toEqual(SIN_ROL);
    });

    it("la persona suspendida globalmente o con la membresía apagada sigue sin rol por la puerta correcta (la marca no abre lo que lo demás cierra)", async () => {
      const e = await empresaDeA("ADMINISTRADOR");
      await dueno.query("update persona set activo_global = false where id = $1", [e.persona]);
      expect((await delActor(comoEmpresa(e.empresa, e.persona, A))).rol).toBeNull();
      await dueno.query("update persona set activo_global = true where id = $1", [e.persona]);
      expect((await delActor(comoEmpresa(e.empresa, e.persona, A))).rol).toBe("ADMINISTRADOR");
      await dueno.query(
        "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
        [e.empresa, e.persona],
      );
      expect((await delActor(comoEmpresa(e.empresa, e.persona, A))).rol).toBeNull();
    });

    it("sucursalesDelActor usa el mismo filtro: gerente, administrador y operador con asignaciones ven su alcance por la puerta A y NINGUNA sucursal por la B ni sin puerta", async () => {
      for (const rol of ROLES_DE_EMPRESA) {
        const e = await empresaDeA(rol);
        if (rol === "OPERADOR") {
          await crearAsignacionDeBase(dueno, e.empresa, e.persona, e.sucursal);
        }
        const por = (marca: MarcaComercialId | null) =>
          sucursalesDelActor(comoEmpresa(e.empresa, e.persona, marca));
        expect(await por(A), rol).toEqual(rol === "OPERADOR" ? [sucursalId(e.sucursal)] : "TODAS");
        expect(await por(B), rol).toEqual([]);
        expect(await por(null), rol).toEqual([]);
      }
    });

    it("nada se guarda entre una operación y la siguiente: si la base cambia la marca del tenant, el rol la sigue de inmediato", async () => {
      const e = await empresaDeA("GERENTE");
      const contextoA = comoEmpresa(e.empresa, e.persona, A);
      expect((await delActor(contextoA)).rol).toBe("GERENTE");
      // El tenant no cambia de marca en producción (`tenant_marca_inmutable`): el disparador se apaga solo acá.
      const cambiarMarca = async (marca: MarcaComercialId) => {
        await dueno.query("begin");
        try {
          await dueno.query("alter table tenant disable trigger tenant_marca_inmutable");
          await dueno.query("update tenant set marca_id = $2 where id = $1", [e.tenant, marca]);
          await dueno.query("alter table tenant enable trigger tenant_marca_inmutable");
          await dueno.query("commit");
        } catch (error) {
          await dueno.query("rollback");
          throw error;
        }
      };
      await cambiarMarca(B);
      expect((await delActor(contextoA)).rol).toBeNull();
      expect((await delActor(comoEmpresa(e.empresa, e.persona, B))).rol).toBe("GERENTE");
      await cambiarMarca(A);
      expect((await delActor(contextoA)).rol).toBe("GERENTE");
    });

    it("defensa en profundidad: se compara con la marca de la empresa del contexto recibido, no con la de la transacción", async () => {
      const ea = await empresaDeA("ADMINISTRADOR");
      const mundoB = await crearMundoDeMarca(dueno, { marca: B });
      await crearMembresiaDeBase(dueno, mundoB.empresa, ea.persona, "ADMINISTRADOR");
      // La transacción corre con el contexto de la empresa de A por la puerta A (la RLS solo deja ver esa
      // empresa y su tenant); se pregunta por la empresa de B: no se ve, no hay rol, nunca uno prestado.
      const enA = comoEmpresa(ea.empresa, ea.persona, A);
      const r = await entorno.ejecutar({ contexto: enA }, async (tx) =>
        ok({
          propia: (await tx.autorizacion.delActor(enA)).rol,
          ajena: (
            await tx.autorizacion.delActor(comoEmpresa(empresaId(mundoB.empresa), ea.persona, B))
          ).rol,
        }),
      );
      expect(r).toEqual({ ok: true, valor: { propia: "ADMINISTRADOR", ajena: null } });
    });

    it("determinista: repetido y desde transacciones simultáneas da siempre lo mismo (puerta A con rol, puerta B sin rol)", async () => {
      const e = await empresaDeA("GERENTE");
      const puertas = [A, B, A, B, A, B, null, A];
      const barrera = crearBarrera(puertas.length);
      const resultados = await Promise.all(
        puertas.map(async (marca) => {
          const contexto = comoEmpresa(e.empresa, e.persona, marca);
          const r = await entorno.ejecutar({ contexto }, async (tx) => {
            await barrera();
            return ok({
              rol: (await tx.autorizacion.delActor(contexto)).rol,
              alcance: await tx.autorizacion.sucursalesDelActor(contexto),
            });
          });
          if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
          return r.valor;
        }),
      );
      expect(resultados).toEqual(
        puertas.map((marca) =>
          marca === A ? { rol: "GERENTE", alcance: "TODAS" } : { rol: null, alcance: [] },
        ),
      );
      for (let i = 0; i < 5; i++) {
        expect((await delActor(comoEmpresa(e.empresa, e.persona, B))).rol).toBeNull();
        expect((await delActor(comoEmpresa(e.empresa, e.persona, A))).rol).toBe("GERENTE");
      }
    });
  });

  // ===============================================================================================
  describe("todos los casos de uso y consultas que pasan por el guard", () => {
    const tokens = () => crearTokensHmac(randomBytes(32));

    type Escenario = Readonly<{
      empresa: EmpresaId;
      sucursal: string;
      otra: PersonaId;
      invitacion: string;
      ctx: (persona: PersonaId, marca: MarcaComercialId | null) => ContextoOperativo;
      persona: (rol: RolDeEmpresa) => PersonaId;
    }>;

    /** Una empresa de A con un miembro por rol, otra persona de la que hablan algunos casos y una invitación pendiente. */
    const escenario = async (): Promise<Escenario> => {
      const e = await crearEmpresaActiva(entorno);
      const empresa = empresaId(e.empresa);
      const miembros = new Map<RolDeEmpresa, PersonaId>();
      for (const rol of ROLES_DE_EMPRESA) {
        const p = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, e.empresa, p.id, rol);
        miembros.set(rol, personaId(p.id));
      }
      const otra = personaId((await crearPersonaDeBase(dueno)).id);
      await crearMembresiaDeBase(dueno, e.empresa, otra, "OPERADOR");
      return {
        empresa,
        sucursal: await sucursalDe(dueno, e.empresa),
        otra,
        invitacion: randomUUID(),
        ctx: (persona, marca) => comoEmpresa(empresa, persona, marca),
        persona: (rol) => miembros.get(rol) as PersonaId,
      };
    };

    type Operaciones = Readonly<{
      identidad: ReturnType<typeof crearCasosDeUsoDeIdentidad>;
      consultasDeIdentidad: ReturnType<typeof crearConsultasDeIdentidad>;
      empresas: ReturnType<typeof crearCasosDeUsoDeEmpresas>;
      consultasDeEmpresas: ReturnType<typeof crearConsultasDeEmpresas>;
    }>;
    let ops: Operaciones;

    beforeAll(() => {
      if (base === null) return;
      ops = {
        identidad: crearCasosDeUsoDeIdentidad({
          transacciones: entorno,
          tokens: tokens(),
          reglas: REGLAS_DE_EMPRESA,
        }),
        consultasDeIdentidad: crearConsultasDeIdentidad({
          transacciones: entorno,
          reglas: REGLAS_DE_EMPRESA,
        }),
        empresas: crearCasosDeUsoDeEmpresas({ transacciones: entorno, reglas: REGLAS_DE_EMPRESA }),
        consultasDeEmpresas: crearConsultasDeEmpresas({
          transacciones: entorno,
          reglas: REGLAS_DE_EMPRESA,
        }),
      };
    });

    type Operacion = Readonly<{
      nombre: string;
      accion: ClaveAccion;
      llamar: (e: Escenario, ctx: ContextoOperativo) => Promise<unknown>;
    }>;

    /**
     * Una fila por caso de uso y por consulta con acción: las claves salen de las declaraciones, así que
     * un caso nuevo sin fila no compila (y la prueba de abajo exige que no sobre ni falte ninguna).
     */
    const DE_IDENTIDAD: Record<
      Exclude<keyof typeof DECLARACIONES_DE_IDENTIDAD, "aceptarInvitacion">,
      (e: Escenario, ctx: ContextoOperativo) => Promise<unknown>
    > = {
      invitarUsuario: (e, ctx) =>
        ops.identidad.invitarUsuario(ctx, {
          email: `${randomUUID().slice(0, 12)}@prueba.test`,
          rol: "OPERADOR",
          sucursales: [sucursalId(e.sucursal)],
        }),
      reenviarInvitacion: (e, ctx) =>
        ops.identidad.reenviarInvitacion(ctx, { invitacionId: invitacionId(e.invitacion) }),
      apagarMembresia: (e, ctx) => ops.identidad.apagarMembresia(ctx, { personaId: e.otra }),
      revocarInvitacion: (e, ctx) =>
        ops.identidad.revocarInvitacion(ctx, { invitacionId: invitacionId(e.invitacion) }),
      asignarSucursales: (e, ctx) =>
        ops.identidad.asignarSucursales(ctx, {
          personaId: e.otra,
          sucursales: [sucursalId(e.sucursal)],
        }),
      proponerTraspaso: (e, ctx) =>
        ops.identidad.proponerTraspaso(ctx, { entrantePersonaId: e.otra }),
      cancelarTraspaso: (_e, ctx) => ops.identidad.cancelarTraspaso(ctx, {}),
      aceptarTraspaso: (_e, ctx) =>
        ops.identidad.aceptarTraspaso(ctx, { traspasoId: randomUUID() }),
      rechazarTraspaso: (_e, ctx) =>
        ops.identidad.rechazarTraspaso(ctx, { traspasoId: randomUUID() }),
    };
    const DE_CONSULTAS_DE_IDENTIDAD: Record<
      keyof typeof DECLARACIONES_DE_CONSULTAS_DE_IDENTIDAD,
      (e: Escenario, ctx: ContextoOperativo) => Promise<unknown>
    > = {
      listarMiembros: (_e, ctx) => ops.consultasDeIdentidad.listarMiembros(ctx),
      listarInvitacionesPendientes: (_e, ctx) =>
        ops.consultasDeIdentidad.listarInvitacionesPendientes(ctx),
      traspasoEnCurso: (_e, ctx) => ops.consultasDeIdentidad.traspasoEnCurso(ctx),
    };
    const DE_EMPRESAS: Record<
      keyof typeof DECLARACIONES_DE_EMPRESAS,
      (e: Escenario, ctx: ContextoOperativo) => Promise<unknown>
    > = {
      crearSucursal: (_e, ctx) => ops.empresas.crearSucursal(ctx, { nombre: "Sucursal norte" }),
      editarSucursal: (e, ctx) =>
        ops.empresas.editarSucursal(ctx, {
          sucursalId: sucursalId(e.sucursal),
          versionEsperada: 1,
          nombre: "Sucursal sur",
        }),
      desactivarSucursal: (e, ctx) =>
        ops.empresas.desactivarSucursal(ctx, { sucursalId: sucursalId(e.sucursal) }),
      reactivarSucursal: (e, ctx) =>
        ops.empresas.reactivarSucursal(ctx, { sucursalId: sucursalId(e.sucursal) }),
    };
    /**
     * Las consultas de empresas que ya existen (`planYModulos` y `permisosDelActor` las suma el tramo T5 de
     * H6 y entonces suman su fila: una consulta declarada e implementada sin fila no compila).
     */
    const DE_CONSULTAS_DE_EMPRESAS: Record<
      Exclude<
        keyof typeof DECLARACIONES_DE_CONSULTAS_DE_EMPRESAS,
        "planYModulos" | "permisosDelActor"
      >,
      (e: Escenario, ctx: ContextoOperativo) => Promise<unknown>
    > = {
      listarSucursales: (_e, ctx) =>
        ops.consultasDeEmpresas.listarSucursales(ctx, { incluirInactivas: true }),
      fichaDeSucursal: (e, ctx) =>
        ops.consultasDeEmpresas.fichaDeSucursal(ctx, { sucursalId: sucursalId(e.sucursal) }),
      sucursalesElegibles: (_e, ctx) => ops.consultasDeEmpresas.sucursalesElegibles(ctx),
    };

    const accionDe = (declaraciones: Readonly<Record<string, unknown>>, nombre: string) => {
      const d = declaraciones[nombre] as { accion: ClaveAccion };
      return d.accion;
    };
    const operaciones: Operacion[] = [
      ...Object.entries(DE_IDENTIDAD).map(([nombre, llamar]) => ({
        nombre,
        accion: accionDe(DECLARACIONES_DE_IDENTIDAD, nombre),
        llamar,
      })),
      ...Object.entries(DE_CONSULTAS_DE_IDENTIDAD).map(([nombre, llamar]) => ({
        nombre,
        accion: accionDe(DECLARACIONES_DE_CONSULTAS_DE_IDENTIDAD, nombre),
        llamar,
      })),
      ...Object.entries(DE_EMPRESAS).map(([nombre, llamar]) => ({
        nombre,
        accion: accionDe(DECLARACIONES_DE_EMPRESAS, nombre),
        llamar,
      })),
      ...Object.entries(DE_CONSULTAS_DE_EMPRESAS).map(([nombre, llamar]) => ({
        nombre,
        accion: accionDe(DECLARACIONES_DE_CONSULTAS_DE_EMPRESAS, nombre),
        llamar,
      })),
    ];

    /** `true` si el guard dejó pasar: cualquier resultado que no sea `SIN_PERMISO` (o una falla más adentro). */
    const autorizo = async (llamada: Promise<unknown>): Promise<boolean> => {
      try {
        const r = (await llamada) as { ok: boolean; error?: unknown };
        return !(r.ok === false && r.error === "SIN_PERMISO");
      } catch {
        return true;
      }
    };

    /** Todo lo que un caso de uso podría tocar de la empresa. */
    const foto = async (empresa: EmpresaId) =>
      JSON.stringify({
        membresias: (
          await dueno.query("select * from membresia where empresa_id = $1 order by persona_id", [
            empresa,
          ])
        ).rows,
        asignaciones: (
          await dueno.query(
            "select * from asignacion_sucursal where empresa_id = $1 order by persona_id, sucursal_id",
            [empresa],
          )
        ).rows,
        invitaciones: (
          await dueno.query(
            "select * from invitacion_empresa where empresa_id = $1 order by invitacion_id",
            [empresa],
          )
        ).rows,
        traspasos: (
          await dueno.query("select * from traspaso_gerencia where empresa_id = $1 order by id", [
            empresa,
          ])
        ).rows,
        sucursales: (
          await dueno.query("select * from sucursal where empresa_id = $1 order by id", [empresa])
        ).rows,
        auditoria: (
          await dueno.query("select id from auditoria_empresa where empresa_id = $1 order by id", [
            empresa,
          ])
        ).rows,
        trabajos: (
          await dueno.query("select id from trabajo where empresa_id = $1 order by id", [empresa])
        ).rows,
      });

    it("la lista cubre exactamente los casos de uso y las consultas con acción de identidad y de empresas", () => {
      const nombres = operaciones.map((o) => o.nombre).sort();
      const declarados = [
        ...Object.keys(DECLARACIONES_DE_IDENTIDAD).filter((n) => n !== "aceptarInvitacion"),
        ...Object.keys(DECLARACIONES_DE_CONSULTAS_DE_IDENTIDAD),
        ...Object.keys(DECLARACIONES_DE_EMPRESAS),
        ...Object.keys(DECLARACIONES_DE_CONSULTAS_DE_EMPRESAS).filter(
          (n) => n !== "planYModulos" && n !== "permisosDelActor",
        ),
      ].sort();
      expect(nombres).toEqual(declarados);
      expect(nombres.length).toBeGreaterThanOrEqual(18);
    });

    it("por la puerta de OTRA marca, cada rol de la empresa da SIN_PERMISO en TODAS las operaciones, no escribe nada y repetido da lo mismo", async () => {
      const e = await escenario();
      const antes = await foto(e.empresa);
      for (const rol of ROLES_DE_EMPRESA) {
        for (const o of operaciones) {
          for (let repeticion = 0; repeticion < 2; repeticion++) {
            const r = await o.llamar(e, e.ctx(e.persona(rol), B));
            expect(r, `${o.nombre} como ${rol}, repetición ${repeticion}`).toEqual({
              ok: false,
              error: "SIN_PERMISO",
            });
          }
        }
      }
      expect(await foto(e.empresa)).toBe(antes);
    });

    it("sin puerta (marca nula) tampoco: SIN_PERMISO en TODAS las operaciones y no escribe nada", async () => {
      const e = await escenario();
      const antes = await foto(e.empresa);
      for (const o of operaciones) {
        const r = await o.llamar(e, e.ctx(e.persona("GERENTE"), null));
        expect(r, o.nombre).toEqual({ ok: false, error: "SIN_PERMISO" });
      }
      expect(await foto(e.empresa)).toBe(antes);
    });

    it.each(ROLES_DE_EMPRESA)(
      "por la puerta de SU marca, un %s sigue pudiendo exactamente lo que la matriz de permisos le deja (el filtro de marca no cambia nada para quien entra bien)",
      async (rol) => {
        for (const o of operaciones) {
          const e = await escenario();
          const permitido = (PERMISOS_DE_EMPRESA[o.accion] as readonly RolDeEmpresa[]).includes(
            rol,
          );
          expect(
            await autorizo(o.llamar(e, e.ctx(e.persona(rol), A))),
            `${o.nombre} como ${rol}`,
          ).toBe(permitido);
        }
      },
    );

    it("simultáneo: la misma persona invita por la puerta A y por la B a la vez; solo se crean las de A, y las de B dan SIN_PERMISO siempre", async () => {
      const e = await escenario();
      const puertas = [A, B, A, B, B, A, B, A];
      const barrera = crearBarrera(puertas.length);
      const resultados = await Promise.all(
        puertas.map(async (marca) => {
          await barrera();
          return ops.identidad.invitarUsuario(e.ctx(e.persona("GERENTE"), marca), {
            email: `${randomUUID().slice(0, 12)}@prueba.test`,
            rol: "OPERADOR",
            sucursales: [sucursalId(e.sucursal)],
          });
        }),
      );
      resultados.forEach((r, i) => {
        if (puertas[i] === A) expect(r.ok, `puerta A, intento ${i}`).toBe(true);
        else expect(r, `puerta B, intento ${i}`).toEqual({ ok: false, error: "SIN_PERMISO" });
      });
      const { rows } = await dueno.query<{ n: string }>(
        "select count(*) as n from invitacion_empresa where empresa_id = $1",
        [e.empresa],
      );
      expect(Number(rows[0]?.n)).toBe(puertas.filter((p) => p === A).length);
    });
  });
});
