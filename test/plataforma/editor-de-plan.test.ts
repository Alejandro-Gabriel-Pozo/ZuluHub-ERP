import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { CATALOGO_DE_PERILLAS } from "../../src/capacidades/planes/perillas";
import {
  advertenciasDeLaVersion,
  CLAVES_DE_MODULOS,
  CLAVES_DE_PERILLAS,
  conLoQueSePide,
  conModulo,
  lineasDeDiferencia,
  modulosParaElegir,
  perillasParaElegir,
  textoDelValor,
  valorDe,
  type ContenidoDePlan,
} from "../../apps/plataforma/logica/editor-de-plan";
import { permisosDePlanes } from "../../apps/plataforma/logica/permisos-de-planes";
import { fichaVista, filaDePlan } from "../../apps/plataforma/logica/vista-de-planes";

/** El editor de un borrador de plan: lo que se marca solo, lo que se quita junto, las advertencias que no bloquean y lo que cambia. Puro, sobre los catálogos reales. */

const OBLIGATORIOS = CLAVES_DE_MODULOS.filter(
  (k) => CATALOGO_DE_MODULOS[k as keyof typeof CATALOGO_DE_MODULOS].obligatorio,
);
const contenido = (c: Partial<ContenidoDePlan> = {}): ContenidoDePlan => ({
  nombreComercial: "Plan",
  modulos: [],
  perillas: {},
  ...c,
});

describe("módulos", () => {
  it("los obligatorios siempre están y salen en el orden del catálogo", () => {
    expect(OBLIGATORIOS.length).toBeGreaterThan(0);
    expect(conLoQueSePide([])).toEqual(OBLIGATORIOS);
  });

  it("al elegir un módulo entran los que requiere, incluso los de segundo nivel; lo desconocido se ignora", () => {
    const con = conLoQueSePide(["ventas", "no-existe", "toString"]);
    for (const k of ["administracion", "catalogo", "caja", "ventas"]) expect(con).toContain(k);
    expect(con).not.toContain("no-existe");
    expect(con).toEqual(CLAVES_DE_MODULOS.filter((k) => con.includes(k)));
    expect(conLoQueSePide(["salon"])).toContain("comandas");
  });

  it("conModulo: marcar suma solo ese; quitar saca también los que dependen de él, y un obligatorio o desconocido no cambia", () => {
    expect(conModulo([], "ventas", true)).toEqual(["ventas"]);
    expect(conModulo(["ventas"], "ventas", true)).toEqual(["ventas"]);
    expect(conModulo(["catalogo", "caja", "ventas", "stock"], "catalogo", false)).toEqual(["caja"]);
    expect(conModulo(["caja", "ventas"], "ventas", false)).toEqual(["caja"]);
    expect(conModulo(["caja"], OBLIGATORIOS[0] ?? "", false)).toEqual(["caja"]);
    expect(conModulo(["caja"], "no-existe", true)).toEqual(["caja"]);
    expect(conModulo(["caja"], "constructor", true)).toEqual(["caja"]);
  });

  it("modulosParaElegir cubre el catálogo entero con rótulo, obligatorio, en desarrollo y requisitos", () => {
    const todos = modulosParaElegir();
    expect(todos.map((m) => m.clave)).toEqual([...CLAVES_DE_MODULOS]);
    expect(todos.filter((m) => m.obligatorio).map((m) => m.clave)).toEqual(OBLIGATORIOS);
    expect(todos.some((m) => m.enDesarrollo)).toBe(true);
    expect(todos.some((m) => !m.enDesarrollo)).toBe(true);
    expect(todos.find((m) => m.clave === "ventas")?.requiere).toEqual(
      CATALOGO_DE_MODULOS.ventas.requiere,
    );
    expect(todos.every((m) => m.rotulo !== "")).toBe(true);
  });
});

describe("perillas", () => {
  it("perillasParaElegir cubre el catálogo con su tipo, su módulo y lo que requiere", () => {
    const todas = perillasParaElegir();
    expect(todas.map((p) => p.clave)).toEqual([...CLAVES_DE_PERILLAS]);
    expect(todas.some((p) => p.tipo === "LIMITE")).toBe(true);
    expect(todas.some((p) => p.tipo === "INTERRUPTOR")).toBe(true);
    const tresVias = todas.find((p) => p.clave === "conciliacion_de_tres_vias");
    expect(tresVias).toMatchObject({
      tipo: "INTERRUPTOR",
      modulo: "compras",
      requiere: "recepcion_separada",
    });
    expect(todas.find((p) => p.clave === "salon")?.requiere).toBeNull();
  });

  it("valorDe: lo que fija el plan o, si no, la base del catálogo (sin tomar claves heredadas)", () => {
    expect(valorDe({}, "salon")).toEqual({ tipo: "INTERRUPTOR", encendida: false });
    expect(valorDe({ salon: { tipo: "INTERRUPTOR", encendida: true } }, "salon")).toEqual({
      tipo: "INTERRUPTOR",
      encendida: true,
    });
    expect(valorDe({}, "cajas_por_sucursal")).toEqual({
      tipo: "LIMITE",
      limite: CATALOGO_DE_PERILLAS.cajas_por_sucursal.base.limite,
    });
  });

  it("textoDelValor: encendida, apagada, el número y el sin límite", () => {
    expect(textoDelValor({ tipo: "INTERRUPTOR", encendida: true })).toBe("Encendida");
    expect(textoDelValor({ tipo: "INTERRUPTOR", encendida: false })).toBe("Apagada");
    expect(textoDelValor({ tipo: "LIMITE", limite: 7 })).toBe("7");
    expect(textoDelValor({ tipo: "LIMITE", limite: "ILIMITADO" })).toBe("∞");
  });
});

describe("advertencias (avisan, no bloquean)", () => {
  it("una perilla encendida cuyo módulo el plan no incluye se advierte con su rótulo y su módulo", () => {
    const a = advertenciasDeLaVersion(
      contenido({ perillas: { salon: { tipo: "INTERRUPTOR", encendida: true } } }),
    );
    expect(a).toEqual(["La perilla «Salón» pertenece al módulo Salón, que este plan no incluye."]);
  });

  it("sin advertencia si el módulo está incluido (aunque entre solo), si la perilla está apagada o si es un límite", () => {
    const encendida = { salon: { tipo: "INTERRUPTOR", encendida: true } } as const;
    expect(advertenciasDeLaVersion(contenido({ modulos: ["salon"], perillas: encendida }))).toEqual(
      [],
    );
    expect(
      advertenciasDeLaVersion(
        contenido({ perillas: { salon: { tipo: "INTERRUPTOR", encendida: false } } }),
      ),
    ).toEqual([]);
    expect(
      advertenciasDeLaVersion(
        contenido({ perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 5 } } }),
      ),
    ).toEqual([]);
    expect(advertenciasDeLaVersion(contenido())).toEqual([]);
  });
});

describe("lineasDeDiferencia", () => {
  it("módulos que se suman, módulos que se quitan y perillas que cambian, con los textos aprobados", () => {
    const lineas = lineasDeDiferencia(
      contenido({ modulos: ["caja"], perillas: {} }),
      contenido({
        modulos: ["catalogo"],
        perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 3 } },
      }),
    );
    expect(lineas).toContain("Se suma el módulo Catálogo");
    expect(lineas).toContain("Se quita el módulo Caja");
    expect(lineas).toContain("Cajas por sucursal: de 1 a 3");
  });

  it("dos contenidos iguales no cambian nada, aunque uno llegue con módulos de más que ya entraban solos", () => {
    expect(
      lineasDeDiferencia(
        contenido({ modulos: ["ventas"] }),
        contenido({ modulos: ["catalogo", "caja", "ventas"] }),
      ),
    ).toEqual([]);
  });
});

describe("permisos de la pantalla (solo una ayuda: decide el servidor)", () => {
  it("ADMIN crea, edita y publica; SOPORTE no ve ningún botón de escritura", () => {
    expect(permisosDePlanes("ADMIN")).toEqual({ crear: true, editar: true, publicar: true });
    expect(permisosDePlanes("SOPORTE")).toEqual({ crear: false, editar: false, publicar: false });
  });
});

describe("la vista de la ficha", () => {
  const ID = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
  const version = (n: number | null, estado: "BORRADOR" | "PUBLICADA", extra = {}) => ({
    versionDePlanId: ID(n ?? 9),
    numero: n,
    estado,
    nombreComercial: `V${String(n)}`,
    modulos: ["caja"],
    perillas: {},
    motivo: n === null ? null : "m",
    publicadaEn: n === null ? null : new Date("2026-11-19T15:30:00Z"),
    publicadaPor: n === null ? null : "admin",
    version: 2,
    tenantsConLaVersion: 1,
    ...extra,
  });
  const ficha = (
    versiones: ReturnType<typeof version>[],
    estado: "ACTIVO" | "RETIRADO" = "ACTIVO",
  ) =>
    ({
      plan: { id: ID(5), codigo: "prueba", estado },
      versiones,
      tenantsConElPlan: 2,
    }) as unknown as Parameters<typeof fichaVista>[0];

  it("la última publicada es la base, el borrador va aparte y las publicadas salen la última primero; la fecha es de Argentina", () => {
    const v = fichaVista(
      ficha([version(1, "PUBLICADA"), version(2, "PUBLICADA"), version(null, "BORRADOR")]),
    );
    expect(v.publicadas.map((x) => x.numero)).toEqual([2, 1]);
    expect(v.ultima?.numero).toBe(2);
    expect(v.borrador).toMatchObject({
      borrador: true,
      numero: null,
      publicadaEn: null,
      version: 2,
    });
    expect(v.publicadas[0]?.publicadaEn).toMatch(/12:30/);
    expect(v).toMatchObject({ id: ID(5), codigo: "prueba", retirado: false });
  });

  it("sin publicadas ni borrador, y plan retirado", () => {
    expect(fichaVista(ficha([], "RETIRADO"))).toMatchObject({
      ultima: null,
      borrador: null,
      publicadas: [],
      retirado: true,
    });
  });

  it("la fila de la lista: última versión, borrador y clientes", () => {
    const plan = { id: ID(5), codigo: "p", estado: "ACTIVO" } as never;
    expect(filaDePlan({ plan, ultimaVersion: null, hayBorrador: true }, 3)).toEqual({
      id: ID(5),
      codigo: "p",
      retirado: false,
      ultima: null,
      hayBorrador: true,
      clientes: 3,
    });
    const retirado = { id: ID(6), codigo: "q", estado: "RETIRADO" } as never;
    expect(
      filaDePlan(
        {
          plan: retirado,
          ultimaVersion: { versionDePlanId: ID(1) as never, numero: 2, nombreComercial: "X" },
          hayBorrador: false,
        },
        0,
      ),
    ).toMatchObject({ retirado: true, ultima: { numero: 2, nombreComercial: "X" } });
  });
});
