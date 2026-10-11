import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../../../contexto/estados";
import {
  empresaId,
  invitacionId,
  personaId,
  tenantId,
  type EmpresaId,
} from "../../../primitivas/identificadores/marca";
import "../../../../test/propiedades/configuracion";
import type { Email } from "./email";
import {
  PLAZOS_EN_MS,
  decidirAceptacion,
  estadoDeInvitacion,
  nuevaInvitacion,
  type EmpresaInvitada,
  type EstadoGuardado,
  type Invitacion,
  type TipoDeInvitacion,
} from "./invitacion";
import { decidirApagado, type Membresia, type RolDeEmpresa } from "./membresia";

// Rango de fechas que admite `Date`, dejando lugar para sumar el plazo más largo.
const MS_MAXIMO = 8_640_000_000_000_000 - 8 * 24 * 3_600_000;
const instante = fc.integer({ min: -1_000_000_000_000, max: 4_000_000_000_000 });

const EMAIL = "ana@x.com" as Email;
const OTRO = "beto@x.com" as Email;
const ANA = personaId("p-ana");
const empresasIds: EmpresaId[] = ["e-1", "e-2", "e-3", "e-4"].map(empresaId);

const estadoGuardado = fc.constantFrom<EstadoGuardado>("PENDIENTE", "ACEPTADA", "REVOCADA");
const tipo = fc.constantFrom<TipoDeInvitacion>("ALTA_GERENTE", "USUARIO");
const estadoDeEmpresa = fc.constantFrom<EstadoDeEmpresa>(
  "PROVISIONING",
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "DELETING",
);
const estadoDeTenant = fc.constantFrom<EstadoDeTenant>("ACTIVE", "SUSPENDED");

function invitacionDe(
  tipoDeInvitacion: TipoDeInvitacion,
  estado: EstadoGuardado,
  emitida: number,
  duracion: number,
  cantidad: number,
  aceptadaPorAna: boolean,
): Invitacion {
  const empresas: EmpresaInvitada[] = empresasIds.slice(0, cantidad).map((id) => ({
    empresaId: id,
    rol: tipoDeInvitacion === "ALTA_GERENTE" ? "GERENTE" : "OPERADOR",
    sucursales: [],
  }));
  return {
    id: invitacionId("inv-1"),
    tenantId: tenantId("t-1"),
    tipo: tipoDeInvitacion,
    email: EMAIL,
    estado,
    emitidaEn: new Date(emitida),
    venceEn: new Date(emitida + duracion),
    empresas,
    aceptadaPor: aceptadaPorAna ? ANA : null,
    reemplazadaPor: null,
    version: 1,
  };
}

describe("propiedades de estadoDeInvitacion", () => {
  it("es monótona en ahora: una vez VENCIDA sigue VENCIDA; las no pendientes nunca vencen", () => {
    fc.assert(
      fc.property(
        tipo,
        estadoGuardado,
        instante,
        fc.integer({ min: 1, max: 10_000_000_000 }),
        instante,
        fc.integer({ min: 0, max: 5_000_000_000 }),
        (t, estado, emitida, duracion, ahora, despues) => {
          const i = invitacionDe(t, estado, emitida, duracion, 1, false);
          const antes = estadoDeInvitacion(i, new Date(ahora));
          const luego = estadoDeInvitacion(i, new Date(ahora + despues));
          if (antes === "VENCIDA") expect(luego).toBe("VENCIDA");
          if (estado !== "PENDIENTE") {
            expect(antes).toBe(estado);
            expect(luego).toBe(estado);
          } else {
            expect(antes).toBe(ahora >= emitida + duracion ? "VENCIDA" : "PENDIENTE");
          }
        },
      ),
    );
  });
});

describe("propiedades de nuevaInvitacion", () => {
  it("siempre produce venceEn > emitidaEn, exactamente por el plazo del tipo", () => {
    fc.assert(
      fc.property(tipo, fc.integer({ min: -8_640_000_000_000_000, max: MS_MAXIMO }), (t, ms) => {
        const rol: RolDeEmpresa = t === "ALTA_GERENTE" ? "GERENTE" : "ADMINISTRADOR";
        const ahora = new Date(ms);
        const resultado = nuevaInvitacion(
          {
            id: invitacionId("inv-1"),
            tokenHash: "h",
            tenantId: tenantId("t-1"),
            tipo: t,
            email: EMAIL,
            empresas: [{ empresaId: empresasIds[0] as EmpresaId, rol, sucursales: [] }],
            emitidaPor: null,
          },
          ahora,
        );
        expect(resultado.ok).toBe(true);
        if (!resultado.ok) return;
        expect(resultado.valor.emitidaEn.getTime()).toBe(ms);
        expect(resultado.valor.venceEn.getTime()).toBeGreaterThan(
          resultado.valor.emitidaEn.getTime(),
        );
        expect(resultado.valor.venceEn.getTime() - ms).toBe(PLAZOS_EN_MS[t]);
      }),
    );
  });
});

describe("propiedades de decidirAceptacion", () => {
  const fila = fc.record({ empresa: estadoDeEmpresa, tenant: estadoDeTenant });

  const escenario = fc.record({
    tipo,
    estado: estadoGuardado,
    cantidad: fc.integer({ min: 1, max: 4 }),
    emitida: instante,
    duracion: fc.integer({ min: 1, max: 1_000_000 }),
    desfase: fc.integer({ min: -2_000_000, max: 2_000_000 }),
    aceptadaPorAna: fc.boolean(),
    emailCoincide: fc.boolean(),
    hayEmail: fc.boolean(),
    persona: fc.constantFrom("ninguna", "activa", "suspendida", "otra"),
    filas: fc.array(fila, { minLength: 4, maxLength: 4 }),
    miembro: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
  });

  type Escenario = typeof escenario extends fc.Arbitrary<infer T> ? T : never;
  type FilaDeEstados = { empresa: EstadoDeEmpresa; tenant: EstadoDeTenant };

  function armar(e: Escenario) {
    const i = invitacionDe(e.tipo, e.estado, e.emitida, e.duracion, e.cantidad, e.aceptadaPorAna);
    const persona =
      e.persona === "ninguna"
        ? null
        : {
            id: e.persona === "otra" ? personaId("p-otra") : ANA,
            email: EMAIL,
            activoGlobal: e.persona !== "suspendida",
          };
    const estados = new Map<EmpresaId, FilaDeEstados>(
      empresasIds.map((id, n) => [id, e.filas[n] as FilaDeEstados]),
    );
    const ahoraMs = e.emitida + e.duracion + e.desfase;
    const resultado = decidirAceptacion(i, {
      ahora: new Date(ahoraMs),
      emailAutenticado: e.hayEmail ? (e.emailCoincide ? EMAIL : OTRO) : null,
      persona,
      estados,
      miembroActivoEn: new Set(empresasIds.filter((_, n) => e.miembro[n])),
    });
    return { i, persona, estados, resultado, ahoraMs };
  }

  it("nunca acepta (ACEPTAR) si alguna empresa de la invitación no opera", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const { i, estados, resultado } = armar(e);
        if (!resultado.ok || resultado.valor.tipo !== "ACEPTAR") return;
        for (const { empresaId: id } of i.empresas) {
          const { empresa, tenant } = estados.get(id) as FilaDeEstados;
          expect(tenant).toBe("ACTIVE");
          // El alta se acepta con la empresa en alta: la propia aceptación la activa.
          expect(
            i.tipo === "ALTA_GERENTE" ? empresa === "PROVISIONING" : empresa === "ACTIVE",
          ).toBe(true);
        }
      }),
    );
  });

  it("acepta exactamente cuando se cumplen todas las condiciones (sin falsos rechazos)", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const { i, persona, estados, resultado, ahoraMs } = armar(e);
        const operan = i.empresas.every(({ empresaId: id }) => {
          const { empresa, tenant } = estados.get(id) as FilaDeEstados;
          return (
            tenant === "ACTIVE" &&
            (i.tipo === "ALTA_GERENTE" ? empresa === "PROVISIONING" : empresa === "ACTIVE")
          );
        });
        const vigente = i.estado === "PENDIENTE" && ahoraMs < e.emitida + e.duracion;
        const aceptaria =
          vigente &&
          operan &&
          e.hayEmail &&
          e.emailCoincide &&
          (persona === null || persona.activoGlobal) &&
          !i.empresas.some((_, n) => e.miembro[n]);
        expect(resultado.ok && resultado.valor.tipo === "ACEPTAR").toBe(aceptaria);
      }),
    );
  });
});

describe("propiedades de decidirApagado", () => {
  const rol = fc.constantFrom<RolDeEmpresa>("GERENTE", "ADMINISTRADOR", "OPERADOR");
  const miembros = fc.array(fc.record({ rol, activo: fc.boolean() }), {
    minLength: 1,
    maxLength: 6,
  });

  it("apagar nunca deja a una empresa sin admin activo si lo tenía", () => {
    fc.assert(
      fc.property(miembros, fc.nat(5), (lista, indice) => {
        const todas: Membresia[] = lista.map((m, n) => ({
          empresaId: empresaId("e-1"),
          personaId: personaId(`p-${n}`),
          rol: m.rol,
          activo: m.activo,
          version: 1,
        }));
        const objetivo = todas[indice % todas.length] as Membresia;
        const activas = todas.filter((m) => m.activo);
        const resultado = decidirApagado(objetivo, activas);
        const esAdmin = (m: Membresia) => m.activo && m.rol !== "OPERADOR";
        const adminsAntes = todas.filter(esAdmin).length;
        if (resultado.ok && resultado.valor === "APAGAR" && adminsAntes > 0) {
          expect(todas.filter((m) => esAdmin(m) && m !== objetivo).length).toBeGreaterThan(0);
        }
        if (resultado.ok && resultado.valor === "YA_APAGADA") expect(objetivo.activo).toBe(false);
      }),
    );
  });
});
