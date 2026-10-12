import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exigirAccion } from "../../src/capacidades/permisos/exigir";
import { PERMISOS_DE_EMPRESA, REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ClaveAccion } from "../../src/capacidades/modulos/catalogo";
import type { ReglasDelGuard } from "../../src/capacidades/permisos/guard";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../src/capacidades/permisos/roles";
import {
  comprobarQueOpera,
  estadoEfectivo,
  type EstadoDeEmpresa,
  type EstadoDeTenant,
} from "../../src/contexto/estados";
import {
  decidirAceptacion,
  type EmpresaInvitada,
  type Email,
  type EstadoGuardado,
  type Invitacion,
  type TipoDeInvitacion,
} from "../../src/modulos/identidad/publico";
import {
  empresaId,
  invitacionId,
  personaId,
  tenantId,
  type EmpresaId,
} from "../../src/primitivas/identificadores/marca";
import {
  explicarAccionDeEmpresa,
  explicarAceptacion,
  type HechosDeAccion,
} from "../../src/plataforma/dominio/soporte/explicar";
import "../propiedades/configuracion";

/**
 * Fidelidad (H5 §D): "explicar por qué" no puede contradecir a los casos reales. Para hechos al azar,
 * `explicarAccionDeEmpresa` da lo mismo que `exigirAccion` seguido de `comprobarQueOpera` con la matriz
 * REAL de empresa (la inyecta esta prueba: `src/plataforma` no la importa), y `explicarAceptacion` da
 * lo mismo que `decidirAceptacion` con el email de la invitación. El oráculo del rol es la regla de
 * `autorizacion.delActor`: membresía ACTIVA y persona activa globalmente.
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
const E1 = empresaId("e-1");

const hechosDeAccion: fc.Arbitrary<HechosDeAccion<RolDeEmpresa>> = fc.record({
  empresaId: fc.constant(E1),
  persona: fc.option(fc.record({ activoGlobal: fc.boolean() }), { nil: null }),
  membresia: fc.option(
    fc.record({ rol: fc.constantFrom(...ROLES_DE_EMPRESA), activo: fc.boolean() }),
    { nil: null },
  ),
  modulosActivados: fc.subarray(["administracion", "otro", "constructor", "__proto__"]),
  modulosHabilitados: fc.subarray(["administracion", "otro", "constructor", "__proto__"]),
  estadoDeEmpresa: estadosDeEmpresa,
  estadoDeTenant: estadosDeTenant,
});

/** El rol que carga `autorizacion.delActor`: membresía activa con la persona activa globalmente. */
function rolReal(h: HechosDeAccion<RolDeEmpresa>): RolDeEmpresa | null {
  if (h.persona === null || !h.persona.activoGlobal) return null;
  return h.membresia !== null && h.membresia.activo ? h.membresia.rol : null;
}

describe("explicarAccionDeEmpresa = exigirAccion + comprobarQueOpera (reglas reales de empresa)", () => {
  it("para cualquier acción y cualquier hecho, la decisión es la de los casos de uso reales", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...acciones), hechosDeAccion, async (accion, h) => {
        const real = await exigirAccion(REGLAS_DE_EMPRESA, accion, () =>
          Promise.resolve({
            rol: rolReal(h),
            modulosActivados: h.modulosActivados,
            modulosHabilitados: h.modulosHabilitados,
          }),
        );
        const estados = new Map([
          [h.empresaId, { empresa: h.estadoDeEmpresa, tenant: h.estadoDeTenant }],
        ]);
        const opera = comprobarQueOpera(h.empresaId, estados);
        const explicada = explicarAccionDeEmpresa(REGLAS_DE_EMPRESA, accion, h);

        expect(explicada.guard).toEqual(real);
        expect(explicada.opera).toEqual(opera);
        expect(explicada.decision).toEqual(real.ok ? opera : real);
        expect(explicada.rol).toBe(rolReal(h));
        expect(explicada.estadoEfectivo).toBe(estadoEfectivo(h.estadoDeTenant, h.estadoDeEmpresa));
        expect(explicada.accion).toBe(accion);
      }),
    );
  });

  it("la razón del rol es coherente con el rol: hay rol si y solo si la razón es CON_ROL", () => {
    fc.assert(
      fc.property(fc.constantFrom(...acciones), hechosDeAccion, (accion, h) => {
        const e = explicarAccionDeEmpresa(REGLAS_DE_EMPRESA, accion, h);
        expect(e.rol !== null).toBe(e.razonDelRol === "CON_ROL");
      }),
    );
  });
});

/**
 * El catálogo real de empresa solo tiene el módulo obligatorio: la solo lectura (módulo activado que el
 * plan ya no incluye) no se puede ejercitar con él. Esta prueba usa un catálogo de prueba con un módulo
 * activable, en sus tres efectos, para comprobar que explicar y exigir deciden lo mismo también ahí.
 */
describe("explicarAccionDeEmpresa = exigirAccion con un módulo activable (solo lectura por plan)", () => {
  type Modulo = "base" | "ventas";
  type Accion = "base.ver" | "ventas.mirar" | "ventas.vender" | "ventas.cerrar";
  const REGLAS_CON_PLAN: ReglasDelGuard<Modulo, Accion, never, "JEFE"> = {
    catalogo: {
      base: {
        estado: "disponible",
        obligatorio: true,
        acciones: { "base.ver": { capacidad: null, efecto: "LECTURA" } },
      },
      ventas: {
        estado: "disponible",
        obligatorio: false,
        acciones: {
          "ventas.mirar": { capacidad: null, efecto: "LECTURA" },
          "ventas.vender": { capacidad: null, efecto: "CREA_AMPLIA" },
          "ventas.cerrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
        },
      },
    },
    permisos: {
      "base.ver": ["JEFE"],
      "ventas.mirar": ["JEFE"],
      "ventas.vender": ["JEFE"],
      "ventas.cerrar": ["JEFE"],
    },
  };
  const claves = ["base", "ventas", "otro", "constructor"];

  it("para cualquier acción, activación y plan, la explicación es la del guard real", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Accion>("base.ver", "ventas.mirar", "ventas.vender", "ventas.cerrar"),
        fc.subarray(claves),
        fc.subarray(claves),
        fc.boolean(),
        async (accion, modulosActivados, modulosHabilitados, conRol) => {
          const rol = conRol ? ("JEFE" as const) : null;
          const real = await exigirAccion(REGLAS_CON_PLAN, accion, () =>
            Promise.resolve({ rol, modulosActivados, modulosHabilitados }),
          );
          const explicada = explicarAccionDeEmpresa(REGLAS_CON_PLAN, accion, {
            empresaId: E1,
            persona: { activoGlobal: true },
            membresia: rol === null ? null : { rol, activo: true },
            modulosActivados,
            modulosHabilitados,
            estadoDeEmpresa: "ACTIVE",
            estadoDeTenant: "ACTIVE",
          });
          expect(explicada.guard).toEqual(real);
        },
      ),
    );
  });
});

const EMAIL = "ana@x.com" as Email;
const ANA = personaId("p-ana");
const ids: EmpresaId[] = ["e-1", "e-2", "e-3"].map(empresaId);

const hechosDeAceptacion = fc
  .record({
    tipo: fc.constantFrom<TipoDeInvitacion>("ALTA_GERENTE", "USUARIO"),
    estado: fc.constantFrom<EstadoGuardado>("PENDIENTE", "ACEPTADA", "REVOCADA"),
    cantidad: fc.integer({ min: 1, max: 3 }),
    emitida: fc.integer({ min: 0, max: 1_000_000_000 }),
    duracion: fc.integer({ min: 1, max: 1_000_000_000 }),
    ahora: fc.integer({ min: 0, max: 2_000_000_000 }),
    aceptadaPorAna: fc.boolean(),
    persona: fc.option(fc.boolean(), { nil: null }),
    empresas: fc.array(fc.record({ empresa: estadosDeEmpresa, tenant: estadosDeTenant }), {
      minLength: 3,
      maxLength: 3,
    }),
    miembroEn: fc.subarray(ids),
    anteriores: fc.array(fc.option(fc.constantFrom(...ROLES_DE_EMPRESA), { nil: null }), {
      minLength: 3,
      maxLength: 3,
    }),
  })
  .map((g) => {
    const empresas: EmpresaInvitada[] = ids.slice(0, g.cantidad).map((id) => ({
      empresaId: id,
      rol: g.tipo === "ALTA_GERENTE" ? "GERENTE" : "OPERADOR",
      sucursales: [],
    }));
    const invitacion: Invitacion = {
      id: invitacionId("inv-1"),
      tenantId: tenantId("t-1"),
      tipo: g.tipo,
      email: EMAIL,
      estado: g.estado,
      emitidaEn: new Date(g.emitida),
      venceEn: new Date(g.emitida + g.duracion),
      empresas,
      aceptadaPor: g.aceptadaPorAna ? ANA : null,
      reemplazadaPor: null,
      version: 1,
    };
    const hechos = {
      ahora: new Date(g.ahora),
      persona: g.persona === null ? null : { id: ANA, email: EMAIL, activoGlobal: g.persona },
      estados: new Map<EmpresaId, { empresa: EstadoDeEmpresa; tenant: EstadoDeTenant }>(
        ids.map((id, i) => [id, g.empresas[i] ?? { empresa: "ACTIVE", tenant: "ACTIVE" }]),
      ),
      miembroActivoEn: new Set(g.miembroEn),
      rolesAnteriores: new Map(
        ids.flatMap((id, i) => {
          const rol = g.anteriores[i];
          return rol === null || rol === undefined ? [] : [[id, rol] as const];
        }),
      ),
    };
    return { invitacion, hechos };
  });

describe("explicarAceptacion = decidirAceptacion con el email de la invitación", () => {
  it("para cualquier invitación y cualquier hecho, la decisión es la del caso de uso real", () => {
    fc.assert(
      fc.property(hechosDeAceptacion, ({ invitacion, hechos }) => {
        const explicada = explicarAceptacion(invitacion, hechos);
        expect(explicada.decision).toEqual(
          decidirAceptacion(invitacion, { ...hechos, emailAutenticado: invitacion.email }),
        );
        expect(explicada.supuestos).toEqual(["EMAIL_AUTENTICADO_ES_EL_DE_LA_INVITACION"]);
      }),
    );
  });

  it("nunca responde que el email es de otro: lo da por propio", () => {
    fc.assert(
      fc.property(hechosDeAceptacion, ({ invitacion, hechos }) => {
        const { decision } = explicarAceptacion(invitacion, hechos);
        expect(decision.ok ? null : decision.error).not.toBe("INVITACION_DE_OTRO_EMAIL");
      }),
    );
  });
});
