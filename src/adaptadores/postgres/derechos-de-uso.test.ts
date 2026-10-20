import { describe, expect, it } from "vitest";
import type {
  AjusteGuardado,
  AsignacionConVersion,
  LecturaDePlanes,
} from "../../modulos/planes/publico";
import {
  empresaId,
  planId,
  tenantId,
  versionDePlanId,
  type EmpresaId,
  type TenantId,
} from "../../primitivas/identificadores/marca";
import type { ContextoDePlataforma, ContextoOperativo } from "../../contexto/contexto";
import { marcaComercialId } from "../../primitivas/identificadores/marca";
import { MODULOS_DE_PRUEBA, PERILLAS_DE_PRUEBA } from "../../../test/utilidades/planes";
import { crearLecturaDeDerechosDeUso } from "./derechos-de-uso";

/**
 * El adaptador de derechos sin base: cómo arma los datos que lee (la asignación vigente, la
 * interpretación de cada ajuste) y que la carta pública no lee nada. El cálculo es de `derechosDeUso`
 * (probado en `capacidades/planes`); la lectura real, con RLS, está en
 * `test/integracion/derechos-de-uso.test.ts`.
 */

const T = tenantId("t1");
const E = empresaId("e1");
const CATALOGOS = { catalogoDeModulos: MODULOS_DE_PRUEBA, catalogoDePerillas: PERILLAS_DE_PRUEBA };
const hoy = new Date("2026-10-13T12:00:00Z");
const antes = new Date("2026-10-13T11:00:00Z");
const despues = new Date("2026-10-13T13:00:00Z");

const operativo: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: E,
  personaId: null,
  marcaDeEntrada: marcaComercialId("m1"),
  ahora: hoy,
};
const plataforma: ContextoDePlataforma = {
  tipo: "PLATAFORMA",
  actor: { tipo: "SISTEMA", proceso: "prueba" },
  ahora: hoy,
};

const version = (
  n: number,
  modulos: string[],
  limite: number,
): AsignacionConVersion["version"] => ({
  planId: planId("p1"),
  versionDePlanId: versionDePlanId(`v${n}`),
  numero: n,
  modulos,
  perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite } },
});

function planesCon(datos: {
  tenant?: TenantId | null;
  existe?: boolean;
  asignaciones?: AsignacionConVersion[];
  ajustes?: AjusteGuardado[];
}) {
  const llamadas: string[] = [];
  const planes: LecturaDePlanes = {
    tenantDeLaEmpresa(empresa: EmpresaId) {
      llamadas.push(`tenantDeLaEmpresa:${empresa}`);
      return Promise.resolve(datos.tenant === undefined ? T : datos.tenant);
    },
    existeElTenant(tenant) {
      llamadas.push(`existeElTenant:${tenant}`);
      return Promise.resolve(datos.existe ?? true);
    },
    asignacionesDelTenant(tenant) {
      llamadas.push(`asignaciones:${tenant}`);
      return Promise.resolve(datos.asignaciones ?? []);
    },
    ajustesDelTenant(tenant, empresa) {
      llamadas.push(`ajustes:${tenant}:${empresa ?? "-"}`);
      return Promise.resolve(datos.ajustes ?? []);
    },
  };
  return { derechos: crearLecturaDeDerechosDeUso(planes, CATALOGOS), llamadas };
}

const ajuste = (
  perilla: string,
  valor: string,
  extra: Partial<AjusteGuardado> = {},
): AjusteGuardado => ({
  perilla,
  empresaId: null,
  numero: 1,
  vigenteDesde: antes,
  valor,
  ...extra,
});

describe("deLaEmpresa", () => {
  it("lee el tenant de la empresa, sus asignaciones y los ajustes del tenant y de ESA empresa", async () => {
    const { derechos, llamadas } = planesCon({});
    const d = await derechos.deLaEmpresa(operativo);
    expect(llamadas).toEqual(["tenantDeLaEmpresa:e1", "asignaciones:t1", "ajustes:t1:e1"]);
    expect(d.tenantId).toBe(T);
    expect(d.empresaId).toBe(E);
    expect(d.leidoEn).toBe(hoy);
    expect(d.versionDePlan).toBeNull();
  });

  it("una empresa que no se ve es un defecto: lanza", async () => {
    const { derechos } = planesCon({ tenant: null });
    await expect(derechos.deLaEmpresa(operativo)).rejects.toThrow(RangeError);
  });

  it("rige la asignación de mayor número entre las que ya empezaron", async () => {
    const { derechos } = planesCon({
      asignaciones: [
        { numero: 1, vigenteDesde: antes, version: version(1, ["caja"], 2) },
        { numero: 2, vigenteDesde: antes, version: version(2, ["caja", "ventas"], 4) },
        { numero: 3, vigenteDesde: despues, version: version(3, ["reservas"], 8) },
      ],
    });
    const d = await derechos.deLaEmpresa(operativo);
    expect(d.versionDePlan?.versionDePlanId).toBe("v2");
    expect([...d.modulosHabilitados].sort()).toEqual(["caja", "nucleo", "ventas"]);
    expect(d.perillas.get("cajas_por_sucursal")).toEqual({
      tipo: "LIMITE",
      limite: 4,
      origen: "PLAN",
    });
    // el mismo historial, visto desde después, rige la tercera
    const luego = await derechos.deLaEmpresa({
      ...operativo,
      ahora: new Date("2026-10-13T14:00:00Z"),
    });
    expect(luego.versionDePlan?.versionDePlanId).toBe("v3");
  });

  it("el orden en que llegan las asignaciones no cambia cuál rige", async () => {
    const asignaciones: AsignacionConVersion[] = [
      { numero: 2, vigenteDesde: antes, version: version(2, [], 4) },
      { numero: 1, vigenteDesde: antes, version: version(1, [], 2) },
    ];
    const { derechos } = planesCon({ asignaciones });
    expect((await derechos.deLaEmpresa(operativo)).versionDePlan?.versionDePlanId).toBe("v2");
  });

  it("interpreta cada ajuste contra su perilla: límite, interruptor, DEL_PLAN", async () => {
    const { derechos } = planesCon({
      asignaciones: [{ numero: 1, vigenteDesde: antes, version: version(1, [], 2) }],
      ajustes: [
        ajuste("cajas_por_sucursal", "ILIMITADO"),
        ajuste("carta_por_qr", "1"),
        ajuste("con_sello", "DEL_PLAN"),
      ],
    });
    const d = await derechos.deLaEmpresa(operativo);
    expect(d.perillas.get("cajas_por_sucursal")).toEqual({
      tipo: "LIMITE",
      limite: "ILIMITADO",
      origen: "AJUSTE",
    });
    expect(d.perillas.get("carta_por_qr")).toEqual({
      tipo: "INTERRUPTOR",
      encendida: true,
      origen: "AJUSTE",
    });
    expect(d.perillas.get("con_sello")).toEqual({
      tipo: "INTERRUPTOR",
      encendida: true,
      origen: "BASE",
    });
  });

  it("un ajuste ilegible vale DEL_PLAN (falla cerrado: gana el plan, no el ajuste anterior) y una perilla desconocida se ignora", async () => {
    const { derechos } = planesCon({
      asignaciones: [{ numero: 1, vigenteDesde: antes, version: version(1, [], 2) }],
      ajustes: [
        ajuste("cajas_por_sucursal", "9", { numero: 1 }),
        ajuste("cajas_por_sucursal", "nueve", { numero: 2 }),
        ajuste("ya_no_existe", "5"),
      ],
    });
    const d = await derechos.deLaEmpresa(operativo);
    expect(d.perillas.get("cajas_por_sucursal")).toEqual({
      tipo: "LIMITE",
      limite: 2,
      origen: "PLAN",
    });
    expect(d.perillas.has("ya_no_existe" as never)).toBe(false);
  });

  it("el ajuste de una empresa llega con su empresa para que el cálculo elija el más específico", async () => {
    const { derechos } = planesCon({
      ajustes: [
        ajuste("carta_por_qr", "0"),
        ajuste("carta_por_qr", "1", { empresaId: E }),
        ajuste("con_sello", "0", { empresaId: empresaId("e2") }),
      ],
    });
    const d = await derechos.deLaEmpresa(operativo);
    expect(d.perillas.get("carta_por_qr")).toEqual({
      tipo: "INTERRUPTOR",
      encendida: true,
      origen: "AJUSTE",
    });
    expect(d.perillas.get("con_sello")?.origen).toBe("BASE");
  });
});

describe("delTenant", () => {
  it("un tenant que no se ve da null y no lee nada más", async () => {
    const { derechos, llamadas } = planesCon({ existe: false });
    expect(await derechos.delTenant(plataforma, T)).toBeNull();
    expect(llamadas).toEqual(["existeElTenant:t1"]);
  });

  it("lee las asignaciones y SOLO los ajustes de todo el tenant, y calcula sin empresa", async () => {
    const { derechos, llamadas } = planesCon({
      asignaciones: [{ numero: 1, vigenteDesde: antes, version: version(1, ["caja"], 3) }],
    });
    const d = await derechos.delTenant(plataforma, T);
    expect(llamadas).toEqual(["existeElTenant:t1", "asignaciones:t1", "ajustes:t1:-"]);
    expect(d?.empresaId).toBeNull();
    expect(d?.tenantId).toBe(T);
    expect(d?.leidoEn).toBe(hoy);
    expect([...(d?.modulosHabilitados ?? [])].sort()).toEqual(["caja", "nucleo"]);
  });
});

describe("deLaEmpresaParaLaPlataforma", () => {
  it("una empresa que no se ve da null y no lee nada más", async () => {
    const { derechos, llamadas } = planesCon({ tenant: null });
    expect(await derechos.deLaEmpresaParaLaPlataforma(plataforma, E)).toBeNull();
    expect(llamadas).toEqual(["tenantDeLaEmpresa:e1"]);
  });

  it("lee el tenant de la empresa, sus asignaciones y los ajustes del tenant y de ESA empresa", async () => {
    const { derechos, llamadas } = planesCon({
      asignaciones: [{ numero: 1, vigenteDesde: antes, version: version(1, ["caja"], 3) }],
    });
    const d = await derechos.deLaEmpresaParaLaPlataforma(plataforma, E);
    expect(llamadas).toEqual(["tenantDeLaEmpresa:e1", "asignaciones:t1", "ajustes:t1:e1"]);
    expect(d?.empresaId).toBe(E);
    expect(d?.tenantId).toBe(T);
    expect(d?.leidoEn).toBe(hoy);
    expect(d?.versionDePlan?.versionDePlanId).toBe("v1");
    expect([...(d?.modulosHabilitados ?? [])].sort()).toEqual(["caja", "nucleo"]);
  });

  it("el ajuste de la empresa gana al del tenant y se ve con su origen", async () => {
    const { derechos } = planesCon({
      ajustes: [
        ajuste("cajas_por_sucursal", "2"),
        ajuste("cajas_por_sucursal", "7", { empresaId: E }),
      ],
    });
    const d = await derechos.deLaEmpresaParaLaPlataforma(plataforma, E);
    expect(d?.perillas.get("cajas_por_sucursal")).toEqual({
      tipo: "LIMITE",
      limite: 7,
      origen: "AJUSTE",
    });
  });
});

describe("deLaCartaPublica: falla cerrado hasta que exista el módulo de catálogo", () => {
  it("devuelve null para cualquier código y NO lee nada de la base", async () => {
    const { derechos, llamadas } = planesCon({
      asignaciones: [{ numero: 1, vigenteDesde: antes, version: version(1, ["caja"], 3) }],
    });
    for (const codigo of ["", "x", "a".repeat(43), "0123456789abcdef".repeat(4)]) {
      for (const marca of [marcaComercialId("m1"), marcaComercialId("m2")]) {
        expect(await derechos.deLaCartaPublica(marca, codigo), `${marca}/${codigo}`).toBeNull();
      }
    }
    expect(llamadas).toEqual([]);
  });
});
