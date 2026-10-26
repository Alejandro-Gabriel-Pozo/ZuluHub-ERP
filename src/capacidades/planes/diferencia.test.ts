import { describe, expect, it } from "vitest";
import {
  MODULOS_DE_PRUEBA,
  PERILLAS_DE_PRUEBA,
  apagada,
  encendida,
  limite,
} from "../../../test/utilidades/planes";
import { empresaId, tenantId } from "../../primitivas/identificadores/marca";
import type { AjusteDePerilla } from "./derechos";
import {
  diferenciaEntreVersiones,
  type ContenidoParaComparar,
  type TenantParaLaDiferencia,
} from "./diferencia";
import type { ValorDePerilla } from "./valores";

const BASE = Date.UTC(2026, 9, 12, 12, 0, 0);
const DIA = 86_400_000;
const ahora = new Date(BASE);
const E1 = empresaId("empresa-1");
const E2 = empresaId("empresa-2");

const version = (
  modulos: readonly string[],
  perillas: Record<string, ValorDePerilla> = {},
): ContenidoParaComparar => ({ modulos, perillas });

const diferencia = (
  desde: ContenidoParaComparar,
  hasta: ContenidoParaComparar,
  tenants: readonly TenantParaLaDiferencia[] = [],
) =>
  diferenciaEntreVersiones({
    catalogoDeModulos: MODULOS_DE_PRUEBA,
    catalogoDePerillas: PERILLAS_DE_PRUEBA,
    desde,
    hasta,
    tenants,
    ahora,
  });

let numero = 0;
const ajuste = (
  perilla: string,
  valor: ValorDePerilla | "DEL_PLAN",
  extra: Partial<AjusteDePerilla> = {},
): AjusteDePerilla => ({
  perilla,
  empresaId: null,
  numero: ++numero,
  vigenteDesde: new Date(BASE - DIA),
  valor,
  ...extra,
});

const tenant = (
  id: string,
  extra: Partial<TenantParaLaDiferencia> = {},
): TenantParaLaDiferencia => ({
  tenantId: tenantId(id),
  ajustes: [],
  empresas: [],
  ...extra,
});

describe("diferenciaEntreVersiones: módulos y perillas", () => {
  it("dos versiones iguales no tienen diferencia", () => {
    const v = version(["caja"], { cajas_por_sucursal: limite(3) });
    expect(diferencia(v, v)).toEqual({
      modulosQueEntran: [],
      modulosQueSalen: [],
      perillas: [],
      porTenant: [],
    });
  });

  it("módulos que entran y que salen, en el orden del catálogo; los obligatorios no cuentan", () => {
    const r = diferencia(
      version(["ventas", "caja"]),
      version(["reservas", "cuentas", "ventas", "nucleo"]),
    );
    expect(r.modulosQueEntran).toEqual(["reservas", "cuentas"]);
    expect(r.modulosQueSalen).toEqual(["caja"]);
  });

  it("un módulo desconocido en alguna versión no cuenta", () => {
    const r = diferencia(version(["fantasma"]), version(["caja", "otro"]));
    expect(r.modulosQueEntran).toEqual(["caja"]);
    expect(r.modulosQueSalen).toEqual([]);
  });

  it("perillas que suben y que bajan, con los dos valores, en el orden del catálogo", () => {
    const r = diferencia(
      version([], {
        cajas_por_sucursal: limite(1),
        vidriera_por_qr: encendida,
        con_sello: encendida,
      }),
      version([], { cajas_por_sucursal: limite(4), vidriera_por_qr: apagada, con_sello: apagada }),
    );
    expect(r.perillas).toEqual([
      { perilla: "cajas_por_sucursal", desde: limite(1), hasta: limite(4), sentido: "SUBE" },
      { perilla: "vidriera_por_qr", desde: encendida, hasta: apagada, sentido: "BAJA" },
      { perilla: "con_sello", desde: encendida, hasta: apagada, sentido: "BAJA" },
    ]);
  });

  it("lo que ninguna versión fija vale la base en las dos: no hay diferencia", () => {
    const r = diferencia(version([], { vidriera_por_qr: apagada }), version([]));
    expect(r.perillas).toEqual([]);
  });

  it("de un límite a ILIMITADO sube; de ILIMITADO a un límite baja; ILIMITADO contra ILIMITADO no cambia", () => {
    const sube = diferencia(
      version([], { cajas_por_sucursal: limite(9) }),
      version([], { cajas_por_sucursal: limite("ILIMITADO") }),
    );
    expect(sube.perillas).toEqual([
      {
        perilla: "cajas_por_sucursal",
        desde: limite(9),
        hasta: limite("ILIMITADO"),
        sentido: "SUBE",
      },
    ]);
    const baja = diferencia(
      version([], { cajas_por_sucursal: limite("ILIMITADO") }),
      version([], { cajas_por_sucursal: limite(9) }),
    );
    expect(baja.perillas[0]?.sentido).toBe("BAJA");
    const igual = diferencia(
      version([], { cajas_por_sucursal: limite("ILIMITADO") }),
      version([], { cajas_por_sucursal: limite("ILIMITADO") }),
    );
    expect(igual.perillas).toEqual([]);
  });

  it("de 0 a 1 sube, de 1 a 0 baja", () => {
    expect(
      diferencia(version([], { overbooking: limite(0) }), version([], { overbooking: limite(1) }))
        .perillas,
    ).toEqual([]); // sin asignacion_diferida las dos valen 0 efectivo
    const r = diferencia(
      version([], { cajas_por_sucursal: limite(0) }),
      version([], { cajas_por_sucursal: limite(1) }),
    );
    expect(r.perillas[0]?.sentido).toBe("SUBE");
  });

  it("incluye el efecto de requiere: encender una dependiente sin su requerida no cambia nada", () => {
    const sinRequerida = diferencia(version([]), version([], { confirmacion_por_sena: encendida }));
    expect(sinRequerida.perillas).toEqual([]);
    const conRequerida = diferencia(
      version([]),
      version([], { confirmacion_por_sena: encendida, reserva_provisoria: encendida }),
    );
    expect(conRequerida.perillas.map((p) => p.perilla)).toEqual([
      "reserva_provisoria",
      "confirmacion_por_sena",
    ]);
  });

  it("no modifica sus entradas", () => {
    const desde = version(["caja"], { cajas_por_sucursal: limite(1) });
    const hasta = version(["ventas", "caja"], { cajas_por_sucursal: limite(2) });
    const copia = structuredClone({ desde, hasta });
    diferencia(desde, hasta);
    expect({ desde, hasta }).toEqual(copia);
  });
});

describe("diferenciaEntreVersiones: por tenant", () => {
  const desde = version(["caja", "ventas"], { cajas_por_sucursal: limite(2) });
  const hasta = version(["caja"], { cajas_por_sucursal: limite(1) });

  it("un tenant sin ajustes ni módulos figura igual, con listas vacías", () => {
    const r = diferencia(desde, hasta, [tenant("t1"), tenant("t2")]);
    expect(r.porTenant).toEqual([
      {
        tenantId: tenantId("t1"),
        ajustes: [],
        modulosEnSoloLectura: [],
        modulosQueVuelvenAOperar: [],
      },
      {
        tenantId: tenantId("t2"),
        ajustes: [],
        modulosEnSoloLectura: [],
        modulosQueVuelvenAOperar: [],
      },
    ]);
  });

  it("módulos activados que quedarían en solo lectura (por empresa, en el orden del catálogo)", () => {
    const t = tenant("t1", {
      empresas: [
        { empresaId: E1, modulosActivados: ["ventas", "caja"] },
        { empresaId: E2, modulosActivados: ["caja"] },
      ],
    });
    const r = diferencia(desde, hasta, [t]);
    expect(r.porTenant[0]?.modulosEnSoloLectura).toEqual([
      { empresaId: E1, modulo: "ventas", yaLoEstaba: false },
    ]);
    expect(r.porTenant[0]?.modulosQueVuelvenAOperar).toEqual([]);
  });

  it("los obligatorios y los módulos en desarrollo no aparecen", () => {
    const t = tenant("t1", {
      empresas: [{ empresaId: E1, modulosActivados: ["nucleo", "comandas"] }],
    });
    expect(diferencia(desde, hasta, [t]).porTenant[0]?.modulosEnSoloLectura).toEqual([]);
  });

  it("lo que ya estaba en solo lectura con la versión de origen se marca", () => {
    const t = tenant("t1", { empresas: [{ empresaId: E1, modulosActivados: ["ventas", "caja"] }] });
    const r = diferencia(version(["caja"]), version([]), [t]);
    expect(r.porTenant[0]?.modulosEnSoloLectura).toEqual([
      { empresaId: E1, modulo: "caja", yaLoEstaba: false },
      { empresaId: E1, modulo: "ventas", yaLoEstaba: true },
    ]);
  });

  it("los módulos en solo lectura que vuelven a operar con la versión de destino", () => {
    const t = tenant("t1", { empresas: [{ empresaId: E1, modulosActivados: ["ventas", "caja"] }] });
    const r = diferencia(version(["caja"]), version(["caja", "ventas"]), [t]);
    expect(r.porTenant[0]?.modulosEnSoloLectura).toEqual([]);
    expect(r.porTenant[0]?.modulosQueVuelvenAOperar).toEqual([{ empresaId: E1, modulo: "ventas" }]);
  });

  it("un módulo activo en las dos versiones no aparece en ninguna lista", () => {
    const t = tenant("t1", { empresas: [{ empresaId: E1, modulosActivados: ["caja"] }] });
    const r = diferencia(version(["caja"]), version(["caja", "ventas"]), [t]);
    expect(r.porTenant[0]?.modulosEnSoloLectura).toEqual([]);
    expect(r.porTenant[0]?.modulosQueVuelvenAOperar).toEqual([]);
  });

  it("los ajustes vigentes sobreviven y se ven; DEL_PLAN no pisa nada; los programados no cuentan", () => {
    const t = tenant("t1", {
      ajustes: [
        ajuste("cajas_por_sucursal", limite(9)),
        ajuste("vidriera_por_qr", "DEL_PLAN"),
        ajuste("con_sello", apagada, { vigenteDesde: new Date(BASE + DIA) }),
      ],
    });
    const r = diferencia(desde, hasta, [t]);
    expect(r.porTenant[0]?.ajustes).toEqual([
      {
        perilla: "cajas_por_sucursal",
        empresaId: null,
        valor: limite(9),
        enDesde: limite(2),
        enHasta: limite(1),
        pisaUnCambio: true,
      },
    ]);
  });

  it("un ajuste sobre una perilla que las versiones no cambian no «pisa un cambio»", () => {
    const t = tenant("t1", { ajustes: [ajuste("empresas_por_tenant", limite(5))] });
    const r = diferencia(desde, hasta, [t]);
    expect(r.porTenant[0]?.ajustes).toEqual([
      {
        perilla: "empresas_por_tenant",
        empresaId: null,
        valor: limite(5),
        enDesde: limite(1),
        enHasta: limite(1),
        pisaUnCambio: false,
      },
    ]);
  });

  it("rige el último ajuste de cada alcance; el del tenant va antes que los de sus empresas", () => {
    const t = tenant("t1", {
      ajustes: [
        ajuste("cajas_por_sucursal", limite(3), { empresaId: E2 }),
        ajuste("cajas_por_sucursal", limite(5), { numero: 1 }),
        ajuste("cajas_por_sucursal", limite(6), { numero: 2 }),
        ajuste("cajas_por_sucursal", limite(4), { empresaId: E1 }),
        ajuste("cajas_por_sucursal", "DEL_PLAN", { empresaId: E1, numero: 99 }),
        ajuste("vidriera_por_qr", encendida, { empresaId: E2 }),
      ],
    });
    const r = diferencia(desde, hasta, [t]);
    expect(r.porTenant[0]?.ajustes.map((a) => [a.perilla, a.empresaId, a.valor])).toEqual([
      ["cajas_por_sucursal", null, limite(6)],
      ["cajas_por_sucursal", E2, limite(3)],
      ["vidriera_por_qr", E2, encendida],
    ]);
  });

  it("los ajustes de varias empresas salen en orden de empresa, sin importar el orden en que llegan", () => {
    const t = tenant("t1", {
      ajustes: [
        ajuste("vidriera_por_qr", encendida, { empresaId: E2 }),
        ajuste("vidriera_por_qr", apagada, { empresaId: E1 }),
      ],
    });
    const r = diferencia(desde, hasta, [t]);
    expect(r.porTenant[0]?.ajustes.map((a) => a.empresaId)).toEqual([E1, E2]);
  });

  it("un ajuste de tipo equivocado o de una perilla desconocida se ignora", () => {
    const t = tenant("t1", {
      ajustes: [ajuste("cajas_por_sucursal", encendida), ajuste("inventada", encendida)],
    });
    expect(diferencia(desde, hasta, [t]).porTenant[0]?.ajustes).toEqual([]);
  });

  it("devuelve un tenant por cada uno que se le pasa, en el mismo orden", () => {
    const r = diferencia(desde, hasta, [tenant("b"), tenant("a"), tenant("c")]);
    expect(r.porTenant.map((p) => p.tenantId)).toEqual(["b", "a", "c"]);
  });
});
