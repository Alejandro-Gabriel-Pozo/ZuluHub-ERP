import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ClaveAccion } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { exigirAccion } from "../../src/capacidades/permisos/exigir";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../src/capacidades/permisos/roles";
import {
  comprobarQueOpera,
  type EstadoDeEmpresa,
  type EstadoDeTenant,
  type EstadosDeEmpresa,
} from "../../src/contexto/estados";
import {
  decidirAceptacion,
  type EmpresaInvitada,
  type EstadoGuardado,
  type Invitacion,
  type TipoDeInvitacion,
} from "../../src/modulos/identidad/publico";
import {
  armarExplicarPorQue,
  type TxDeExplicar,
} from "../../src/plataforma/casos-de-uso/explicar-por-que";
import {
  resultadoDeUnaAccionExplicada,
  resultadoDeUnaAceptacionExplicada,
} from "../../src/plataforma/dominio/soporte/registro";
import {
  empresaId,
  invitacionId,
  tenantId,
  type EmpresaId,
} from "../../src/primitivas/identificadores/marca";
import "../propiedades/configuracion";
import {
  auditoriaFalsa,
  comoAdministrador,
  conRol,
  emailDePrueba,
  idempotenciaFalsa,
  lecturaFalsa,
  personaDePrueba,
  transaccionesDe,
  uuid,
} from "./apoyo-de-soporte";

/**
 * Fidelidad del CASO DE USO (H5 §D): no solo las funciones puras (ya probadas en
 * `fidelidad-de-explicar.test.ts`) sino todo el camino: los hechos que lee «explicar por qué» (persona,
 * membresía, estados, invitación) y cómo los junta. Para hechos al azar guardados en la «base», lo
 * explicado es EXACTAMENTE lo que respondería el caso de uso real: `exigirAccion` y `comprobarQueOpera`
 * con la matriz REAL de empresa, y `decidirAceptacion` con el email de la invitación.
 */

const acciones = Object.keys(PERMISOS_DE_EMPRESA) as ClaveAccion[];
const estadosDeEmpresa = fc.constantFrom<EstadoDeEmpresa>(
  "PROVISIONING",
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "DELETING",
);
const estadosDeTenant = fc.constantFrom<EstadoDeTenant>("ACTIVE", "SUSPENDED");
const EMPRESA = empresaId(uuid(10));
const PERSONA_ID = uuid(20);
const EMAIL = "ana@x.test";

function conCaso(datos: Parameters<typeof lecturaFalsa>[0]) {
  const soporte = lecturaFalsa(datos);
  const auditoria = auditoriaFalsa();
  const tx: TxDeExplicar = {
    soporte,
    autorizacionDePlataforma: conRol("ADMIN"),
    auditoriaDePlataforma: auditoria,
    idempotencia: idempotenciaFalsa(),
  };
  return {
    auditoria,
    explicarPorQue: armarExplicarPorQue({
      transacciones: transaccionesDe(tx),
      reglas: REGLAS_DE_PLATAFORMA,
      reglasDeEmpresa: REGLAS_DE_EMPRESA,
    }),
  };
}

const hechosDeAccion = fc.record({
  accion: fc.constantFrom(...acciones),
  persona: fc.option(fc.boolean(), { nil: null }),
  membresia: fc.option(
    fc.record({ rol: fc.constantFrom(...ROLES_DE_EMPRESA), activo: fc.boolean() }),
    { nil: null },
  ),
  modulosActivados: fc.subarray(["administracion", "otro", "constructor", "__proto__"]),
  estadoDeEmpresa: estadosDeEmpresa,
  estadoDeTenant: estadosDeTenant,
  porId: fc.boolean(),
});

describe("explicarPorQue (acción) = exigirAccion + comprobarQueOpera reales", () => {
  it("para cualquier acción y cualquier hecho guardado, lo explicado es lo que respondería el caso real", async () => {
    await fc.assert(
      fc.asyncProperty(hechosDeAccion, async (h) => {
        const persona = h.persona === null ? null : personaDePrueba(20, h.persona, EMAIL);
        const { explicarPorQue, auditoria } = conCaso({
          estados: new Map([[EMPRESA, { empresa: h.estadoDeEmpresa, tenant: h.estadoDeTenant }]]),
          personas: persona === null ? [] : [persona],
          membresias:
            persona === null || h.membresia === null
              ? []
              : [{ empresaId: EMPRESA, personaId: persona.id, ...h.membresia }],
          modulosActivados: h.modulosActivados,
        });

        const r = await explicarPorQue(comoAdministrador, {
          claveDeIdempotencia: "clave-de-fidelidad-01",
          objetivo: {
            tipo: "ACCION",
            empresaId: EMPRESA,
            persona: h.porId
              ? { por: "ID", personaId: PERSONA_ID }
              : { por: "EMAIL", email: EMAIL },
            accion: h.accion,
          },
        });
        expect(r.ok).toBe(true);
        if (!r.ok || r.valor.tipo !== "ACCION") return;

        // El oráculo: lo que carga `autorizacion.delActor` y lo que hacen los casos de uso reales.
        const rol: RolDeEmpresa | null =
          persona !== null && persona.activoGlobal && h.membresia !== null && h.membresia.activo
            ? h.membresia.rol
            : null;
        const real = await exigirAccion(REGLAS_DE_EMPRESA, h.accion, () =>
          Promise.resolve({ rol, modulosActivados: h.modulosActivados }),
        );
        const opera = comprobarQueOpera(
          EMPRESA,
          new Map([[EMPRESA, { empresa: h.estadoDeEmpresa, tenant: h.estadoDeTenant }]]),
        );
        const { explicacion } = r.valor;
        expect(explicacion.guard).toEqual(real);
        expect(explicacion.opera).toEqual(opera);
        expect(explicacion.decision).toEqual(real.ok ? opera : real);
        expect(explicacion.rol).toBe(rol);
        expect(r.valor.personaId).toBe(persona === null ? null : persona.id);
        // Y lo asentado en la constancia es ese mismo resultado.
        expect(auditoria.registros).toHaveLength(1);
        expect(auditoria.registros[0]?.despues).toMatchObject({
          resultado: resultadoDeUnaAccionExplicada(real.ok ? opera : real),
        });
      }),
    );
  });
});

const EMAIL_DE_LA_INVITACION = emailDePrueba(EMAIL);
const ids: EmpresaId[] = [10, 11, 12].map((n) => empresaId(uuid(n)));

const hechosDeAceptacion = fc.record({
  tipo: fc.constantFrom<TipoDeInvitacion>("ALTA_GERENTE", "USUARIO"),
  estado: fc.constantFrom<EstadoGuardado>("PENDIENTE", "ACEPTADA", "REVOCADA"),
  cantidad: fc.integer({ min: 1, max: 3 }),
  emitida: fc.integer({ min: 0, max: 1_000_000_000 }),
  duracion: fc.integer({ min: 1, max: 1_000_000_000 }),
  ahora: fc.integer({ min: 0, max: 2_000_000_000 }),
  aceptadaPorLaPersona: fc.boolean(),
  persona: fc.option(fc.boolean(), { nil: null }),
  empresas: fc.array(fc.record({ empresa: estadosDeEmpresa, tenant: estadosDeTenant }), {
    minLength: 3,
    maxLength: 3,
  }),
  membresias: fc.array(
    fc.option(fc.record({ rol: fc.constantFrom(...ROLES_DE_EMPRESA), activo: fc.boolean() }), {
      nil: null,
    }),
    { minLength: 3, maxLength: 3 },
  ),
});

describe("explicarPorQue (aceptación) = decidirAceptacion real con el email de la invitación", () => {
  it("para cualquier invitación y cualquier hecho guardado, lo explicado es la decisión real", async () => {
    await fc.assert(
      fc.asyncProperty(hechosDeAceptacion, async (g) => {
        const persona = g.persona === null ? null : personaDePrueba(20, g.persona, EMAIL);
        const invitadas: EmpresaInvitada[] = ids.slice(0, g.cantidad).map((id) => ({
          empresaId: id,
          rol: g.tipo === "ALTA_GERENTE" ? "GERENTE" : "OPERADOR",
          sucursales: [],
        }));
        const invitacion: Invitacion = {
          id: invitacionId(uuid(30)),
          tenantId: tenantId(uuid(31)),
          tipo: g.tipo,
          email: EMAIL_DE_LA_INVITACION,
          estado: g.estado,
          emitidaEn: new Date(g.emitida),
          venceEn: new Date(g.emitida + g.duracion),
          empresas: invitadas,
          aceptadaPor: g.aceptadaPorLaPersona && persona !== null ? persona.id : null,
          reemplazadaPor: null,
          version: 1,
        };
        const estados: EstadosDeEmpresa = new Map(
          ids.map(
            (id, i) => [id, g.empresas[i] ?? { empresa: "ACTIVE", tenant: "ACTIVE" }] as const,
          ),
        );
        const membresias =
          persona === null
            ? []
            : ids.flatMap((id, i) => {
                const m = g.membresias[i];
                return m === null || m === undefined
                  ? []
                  : [{ empresaId: id, personaId: persona.id, ...m }];
              });
        const { explicarPorQue, auditoria } = conCaso({
          estados,
          personas: persona === null ? [] : [persona],
          membresias,
          invitaciones: [invitacion],
        });

        const ahora = new Date(g.ahora);
        const r = await explicarPorQue(
          { ...comoAdministrador, ahora },
          {
            claveDeIdempotencia: "clave-de-fidelidad-02",
            objetivo: { tipo: "ACEPTACION", invitacionId: invitacion.id },
          },
        );
        expect(r.ok).toBe(true);
        if (!r.ok || r.valor.tipo !== "ACEPTACION") return;

        // El oráculo: la misma decisión que toma `aceptarInvitacion` ya con las membresías a la vista.
        const desdeLasInvitadas = membresias.filter((m) =>
          invitadas.some((e) => e.empresaId === m.empresaId),
        );
        const real = decidirAceptacion(invitacion, {
          ahora,
          emailAutenticado: invitacion.email,
          persona,
          estados,
          miembroActivoEn: new Set(
            desdeLasInvitadas.filter((m) => m.activo).map((m) => m.empresaId),
          ),
          rolesAnteriores: new Map(
            desdeLasInvitadas.filter((m) => !m.activo).map((m) => [m.empresaId, m.rol] as const),
          ),
        });
        expect(r.valor.explicacion.decision).toEqual(real);
        expect(auditoria.registros[0]?.despues).toMatchObject({
          objetivo: "ACEPTACION",
          resultado: resultadoDeUnaAceptacionExplicada(real),
        });
      }),
    );
  });
});
