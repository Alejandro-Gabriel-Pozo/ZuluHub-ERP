import { describe, expect, it } from "vitest";
import {
  armarPlanDeEmpresa,
  type EntradasDelPlanDeEmpresa,
} from "../../apps/plataforma/logica/plan-de-empresa";

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const V1 = "33333333-3333-4333-8333-333333333331";
const V2 = "33333333-3333-4333-8333-333333333332";

function asignacion(numero: number, estado: string, version: string, dia: number) {
  return {
    numero,
    versionDePlanId: version,
    planId: "p",
    planCodigo: version === V1 ? "basico" : "pro",
    versionNumero: version === V1 ? 1 : 2,
    nombreComercial: version === V1 ? "Básico" : "Pro",
    vigenteDesde: new Date(Date.UTC(2026, 9, dia)),
    origen: "MANUAL",
    reemplazaProgramada: false,
    motivo: "m",
    asignadoPor: "x",
    creadoEn: new Date(0),
    estado,
  };
}

function entradas(
  asignaciones: ReturnType<typeof asignacion>[],
  extra: Partial<{
    versionDePlan: unknown;
    cliente: unknown;
    razonSocial: string | null;
    estadoDeLosPlanes: [string, string];
  }> = {},
): EntradasDelPlanDeEmpresa {
  return {
    derechos: {
      empresaId: EMPRESA,
      tenantId: TENANT,
      leidoEn: new Date(0),
      versionDePlan: "versionDePlan" in extra ? extra.versionDePlan : null,
      modulos: [
        {
          modulo: "ventas",
          obligatorio: false,
          disponible: true,
          habilitadoPorElPlan: true,
          activado: true,
          estado: "ACTIVO",
        },
      ],
      perillas: [{ perilla: "usuarios", valor: { tipo: "LIMITE", limite: 5 }, origen: "PLAN" }],
    },
    plan: { tenantId: TENANT, asignaciones, ajustes: [], empresas: [] },
    planes: {
      planes: [
        {
          plan: { estado: extra.estadoDeLosPlanes?.[0] ?? "ACTIVO" },
          ultimaVersion: { versionDePlanId: V1, numero: 1, nombreComercial: "Básico" },
          hayBorrador: false,
        },
        {
          plan: { estado: extra.estadoDeLosPlanes?.[1] ?? "ACTIVO" },
          ultimaVersion: { versionDePlanId: V2, numero: 2, nombreComercial: "Pro" },
          hayBorrador: true,
        },
        { plan: {}, ultimaVersion: null, hayBorrador: true },
      ],
    },
    razonSocial: "razonSocial" in extra ? extra.razonSocial : "Acme SA",
    cliente: "cliente" in extra ? extra.cliente : { empresasEnUso: 2, limiteDeEmpresas: 3 },
  } as unknown as EntradasDelPlanDeEmpresa;
}

describe("armarPlanDeEmpresa", () => {
  it("sin asignaciones: sin plan y sin número", () => {
    const r = armarPlanDeEmpresa(entradas([]));
    expect(r.sinPlan).toBe(true);
    expect(r.planActual).toBeNull();
    expect(r.programada).toBeNull();
    expect(r.ultimoNumeroDeAsignacion).toBeNull();
    expect(r.empresaId).toBe(EMPRESA);
    expect(r.tenantId).toBe(TENANT);
  });

  it("con vigente: plan actual con fecha ISO", () => {
    const r = armarPlanDeEmpresa(
      entradas([asignacion(1, "VIGENTE", V1, 1)], { versionDePlan: { versionDePlanId: V1 } }),
    );
    expect(r.sinPlan).toBe(false);
    expect(r.planActual).toEqual({
      nombreComercial: "Básico",
      planCodigo: "basico",
      versionNumero: 1,
      vigenteDesde: "2026-10-01T00:00:00.000Z",
    });
    expect(r.programada).toBeNull();
    expect(r.ultimoNumeroDeAsignacion).toBe(1);
  });

  it("con vigente y programada: toma la más próxima", () => {
    const r = armarPlanDeEmpresa(
      entradas([
        asignacion(1, "ANTERIOR", V1, 1),
        asignacion(2, "VIGENTE", V1, 2),
        asignacion(4, "PROGRAMADA", V2, 20),
        asignacion(3, "PROGRAMADA", V2, 10),
      ]),
    );
    expect(r.planActual?.versionNumero).toBe(1);
    expect(r.programada).toEqual({
      nombreComercial: "Pro",
      versionNumero: 2,
      vigenteDesde: "2026-10-10T00:00:00.000Z",
    });
  });

  it("el último número es el máximo aunque no venga en orden", () => {
    const r = armarPlanDeEmpresa(
      entradas([
        asignacion(5, "ANTERIOR", V1, 1),
        asignacion(9, "VIGENTE", V1, 2),
        asignacion(7, "SIN_EFECTO", V2, 3),
      ]),
    );
    expect(r.ultimoNumeroDeAsignacion).toBe(9);
  });

  it("pasa módulos y perillas tal cual", () => {
    const r = armarPlanDeEmpresa(entradas([]));
    expect(r.modulos).toEqual([
      {
        modulo: "ventas",
        obligatorio: false,
        disponible: true,
        habilitadoPorElPlan: true,
        activado: true,
        estado: "ACTIVO",
      },
    ]);
    expect(r.perillas).toEqual([
      { perilla: "usuarios", valor: { tipo: "LIMITE", limite: 5 }, origen: "PLAN" },
    ]);
  });

  it("empresas del cliente: presentes o null si faltan", () => {
    expect(armarPlanDeEmpresa(entradas([])).empresasDelCliente).toEqual({ enUso: 2, limite: 3 });
    expect(armarPlanDeEmpresa(entradas([], { cliente: null })).empresasDelCliente).toBeNull();
  });

  it("razón social por defecto", () => {
    expect(armarPlanDeEmpresa(entradas([])).empresa).toBe("Acme SA");
    expect(armarPlanDeEmpresa(entradas([], { razonSocial: null })).empresa).toBe("Empresa");
  });

  it("planes elegibles: solo con versión publicada, con su número de versión, marcando la actual", () => {
    const r = armarPlanDeEmpresa(
      entradas([asignacion(1, "VIGENTE", V2, 1)], { versionDePlan: { versionDePlanId: V2 } }),
    );
    expect(r.planesElegibles).toEqual([
      { versionDePlanId: V1, nombre: "Básico", versionNumero: 1, esActual: false },
      { versionDePlanId: V2, nombre: "Pro", versionNumero: 2, esActual: true },
    ]);
  });

  it("planes elegibles: un plan retirado no se ofrece, salvo que sea el actual", () => {
    const sinActual = armarPlanDeEmpresa(
      entradas([asignacion(1, "VIGENTE", V2, 1)], {
        versionDePlan: { versionDePlanId: V2 },
        estadoDeLosPlanes: ["RETIRADO", "ACTIVO"],
      }),
    );
    expect(sinActual.planesElegibles.map((p) => p.versionDePlanId)).toEqual([V2]);
    const conActual = armarPlanDeEmpresa(
      entradas([asignacion(1, "VIGENTE", V1, 1)], {
        versionDePlan: { versionDePlanId: V1 },
        estadoDeLosPlanes: ["RETIRADO", "RETIRADO"],
      }),
    );
    expect(conActual.planesElegibles).toEqual([
      { versionDePlanId: V1, nombre: "Básico", versionNumero: 1, esActual: true },
    ]);
  });

  it("pasa si el módulo está disponible o en desarrollo", () => {
    const e = entradas([]);
    const r = armarPlanDeEmpresa({
      ...e,
      derechos: {
        ...e.derechos,
        modulos: e.derechos.modulos.map((m) => ({ ...m, disponible: false })),
      },
    });
    expect(r.modulos.map((m) => m.disponible)).toEqual([false]);
  });
});
