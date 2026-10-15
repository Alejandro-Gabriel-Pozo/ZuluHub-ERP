import { describe, expect, it } from "vitest";
import {
  datosDeLaDefinicion,
  definicionesIguales,
  paresDeVocabulario,
} from "../../src/plataforma/casos-de-uso/datos-de-marcas";
import {
  datosDelContenidoDeLaVersion,
  datosDelValorDePerilla,
  listaDePerillas,
} from "../../src/plataforma/casos-de-uso/datos-de-planes";
import {
  aplanarError,
  auditarEnLasEmpresas,
  datosIguales,
  esDato,
  instanteISO,
  type TxDeMarcasYPlanes,
} from "../../src/plataforma/casos-de-uso/marcas-y-planes-comun";
import { DEFINICION_VACIA, type DefinicionDeMarca } from "../../src/modulos/marcas/publico";
import { empresaId, planId } from "../../src/primitivas/identificadores/marca";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import { exigirSinSecretos } from "../../src/puertos/sin-secretos";
import type { RegistroDeAuditoria } from "../../src/puertos/auditoria";

/**
 * Las piezas chicas de los casos de uso de marcas y planes: cómo se aplanan los errores, qué es un dato
 * plano, cómo se comparan dos datos y cómo se ven las marcas y los planes en la auditoría (sin ningún campo
 * que parezca un secreto). Sin base de datos.
 */

describe("aplanarError: un error sin datos es su código; con datos, un objeto", () => {
  it("el éxito pasa tal cual", () => {
    expect(aplanarError(ok(3))).toEqual({ ok: true, valor: 3 });
  });

  it("un texto queda texto", () => {
    expect(aplanarError(err("SIN_PERMISO"))).toEqual({ ok: false, error: "SIN_PERMISO" });
  });

  it("{ codigo } sin más datos se vuelve el código", () => {
    expect(aplanarError(err({ codigo: "MOTIVO_OBLIGATORIO" }))).toEqual({
      ok: false,
      error: "MOTIVO_OBLIGATORIO",
    });
  });

  it("{ codigo, ...datos } conserva sus datos", () => {
    const error = { codigo: "TEMA_INVALIDO", token: "fondo" };
    expect(aplanarError(err(error))).toEqual({ ok: false, error });
    expect(aplanarError(err({ codigo: "DEFINICION_INCOMPLETA", faltan: ["logo"] }))).toEqual({
      ok: false,
      error: { codigo: "DEFINICION_INCOMPLETA", faltan: ["logo"] },
    });
  });

  it("los errores de la base ({ tipo }) y lo que no es un código pasan sin cambios", () => {
    const base = { tipo: "Unicidad", restriccion: "x" };
    expect(aplanarError(err(base))).toEqual({ ok: false, error: base });
    expect(aplanarError(err({ codigo: 3 }))).toEqual({ ok: false, error: { codigo: 3 } });
    expect(aplanarError(err(null))).toEqual({ ok: false, error: null });
    expect(aplanarError(err({ codigo: undefined }))).toEqual({
      ok: false,
      error: { codigo: undefined },
    });
  });
});

describe("esDato", () => {
  it.each([
    "texto",
    "",
    0,
    -1.5,
    true,
    false,
    null,
    [],
    [1, "a", null],
    {},
    { tipo: "LIMITE", limite: 3 },
    { a: { b: [1, { c: false }] } },
  ])("%j es un dato plano", (valor) => {
    expect(esDato(valor)).toBe(true);
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    () => 1,
    Symbol("x"),
    10n,
    new Date(),
    new Map(),
    new (class Clase {})(),
    [undefined],
    { a: undefined },
    { a: () => 1 },
    [new Date()],
    Object.create(null) as object,
  ])("%s no lo es", (valor) => {
    expect(esDato(valor)).toBe(false);
  });
});

describe("datosIguales: sin importar el orden de los campos", () => {
  it("objetos con los mismos campos en otro orden son iguales; con otro valor, no", () => {
    expect(datosIguales({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(datosIguales({ a: 1 }, { a: 2 })).toBe(false);
    expect(datosIguales({ a: 1 }, { a: 1, b: null })).toBe(false);
  });

  it("el orden de una lista sí importa, y null no es lo mismo que ausente ni que vacío", () => {
    expect(datosIguales([1, 2], [2, 1])).toBe(false);
    expect(datosIguales({ a: null }, {})).toBe(false);
    expect(datosIguales([], null)).toBe(false);
    expect(datosIguales("1", 1)).toBe(false);
  });

  it("anida", () => {
    expect(
      datosIguales({ x: { b: 1, a: [{ d: 1, c: 2 }] } }, { x: { a: [{ c: 2, d: 1 }], b: 1 } }),
    ).toBe(true);
  });
});

describe("instanteISO", () => {
  it("es ISO 8601 en UTC", () => {
    expect(instanteISO(new Date("2026-10-11T12:00:00.123Z"))).toBe("2026-10-11T12:00:00.123Z");
  });
});

describe("auditarEnLasEmpresas", () => {
  it("deja la misma constancia en CADA empresa, sin persona (actor nulo), en orden", async () => {
    const registros: RegistroDeAuditoria[] = [];
    const tx = {
      auditoriaDeEmpresa: {
        registrar: (r: RegistroDeAuditoria) => {
          registros.push(r);
          return Promise.resolve();
        },
      },
    } as unknown as TxDeMarcasYPlanes;
    const constancia = {
      accion: "PLAN_ASIGNADO",
      entidad: "plan_de_tenant",
      entidadId: "x",
      antes: null,
      despues: { numero: 1 },
    } as const;
    await auditarEnLasEmpresas(tx, [empresaId("e1"), empresaId("e2")], constancia);
    expect(registros).toEqual([
      { empresaId: "e1", actorPersonaId: null, ...constancia },
      { empresaId: "e2", actorPersonaId: null, ...constancia },
    ]);
  });

  it("sin empresas no deja nada", async () => {
    const tx = {
      auditoriaDeEmpresa: {
        registrar: () => {
          throw new Error("no debía registrar");
        },
      },
    } as unknown as TxDeMarcasYPlanes;
    await auditarEnLasEmpresas(tx, [], {
      accion: "PLAN_ASIGNADO",
      entidad: "x",
      entidadId: "y",
      antes: null,
      despues: null,
    });
  });
});

describe("la auditoría de una marca", () => {
  const definicion: DefinicionDeMarca = {
    ...DEFINICION_VACIA,
    nombreVisible: "Mi marca",
    tema: { primary: "#1d4ed8", "on-primary": "#ffffff" },
    logo: "/marcas/mc/logo.png",
    vocabulario: { "rol.gerente.nombre": "Jefe", "rol.operador.nombre": "Mozo" },
    modulosIniciales: ["caja"],
    planPorDefectoId: planId("p1"),
  };

  it("los datos de la definición no llevan el vocabulario, y el tema va como objeto de sus tokens", () => {
    expect(datosDeLaDefinicion(definicion)).toEqual({
      nombreVisible: "Mi marca",
      tema: { primary: "#1d4ed8", "on-primary": "#ffffff" },
      logo: "/marcas/mc/logo.png",
      modulosIniciales: ["caja"],
      planPorDefectoId: "p1",
    });
    expect(datosDeLaDefinicion(DEFINICION_VACIA)).toEqual({
      nombreVisible: null,
      tema: {},
      logo: null,
      modulosIniciales: null,
      planPorDefectoId: null,
    });
  });

  it("el vocabulario va como lista de pares texto, antes, después; vacía si no cambió nada", () => {
    expect(paresDeVocabulario(null, definicion)).toEqual([
      { texto: "rol.gerente.nombre", antes: null, despues: "Jefe" },
      { texto: "rol.operador.nombre", antes: null, despues: "Mozo" },
    ]);
    expect(
      paresDeVocabulario(
        {
          ...definicion,
          vocabulario: { "rol.gerente.nombre": "Encargado", "rol.operador.nombre": "Mozo" },
        },
        definicion,
      ),
    ).toEqual([{ texto: "rol.gerente.nombre", antes: "Encargado", despues: "Jefe" }]);
    expect(paresDeVocabulario(definicion, definicion)).toEqual([]);
  });

  it("lo que va a la auditoría pasa el control de secretos", () => {
    exigirSinSecretos(datosDeLaDefinicion(definicion), "definición");
    exigirSinSecretos({ vocabulario: paresDeVocabulario(null, definicion) }, "vocabulario");
  });

  it("dos definiciones son iguales si dicen lo mismo, aunque se hayan armado en otro orden; cualquier campo que cambie las distingue", () => {
    const otro: DefinicionDeMarca = {
      ...definicion,
      vocabulario: { "rol.operador.nombre": "Mozo", "rol.gerente.nombre": "Jefe" },
      tema: { "on-primary": "#ffffff", primary: "#1d4ed8" },
    };
    expect(definicionesIguales(definicion, otro)).toBe(true);
    for (const cambio of [
      { nombreVisible: "Otra" },
      { tema: { primary: "#000000" } },
      { logo: null },
      { vocabulario: {} },
      { modulosIniciales: [] },
      { modulosIniciales: null },
      { planPorDefectoId: planId("p2") },
    ] as Partial<DefinicionDeMarca>[]) {
      expect(
        definicionesIguales(definicion, { ...definicion, ...cambio }),
        JSON.stringify(cambio),
      ).toBe(false);
    }
  });
});

describe("la auditoría de un plan", () => {
  it("el valor de una perilla trae siempre los mismos cuatro campos", () => {
    expect(datosDelValorDePerilla({ tipo: "INTERRUPTOR", encendida: true })).toEqual({
      tipo: "INTERRUPTOR",
      encendida: true,
      limite: null,
    });
    expect(datosDelValorDePerilla({ tipo: "LIMITE", limite: 3 })).toEqual({
      tipo: "LIMITE",
      encendida: null,
      limite: 3,
    });
    expect(datosDelValorDePerilla({ tipo: "LIMITE", limite: "ILIMITADO" })).toMatchObject({
      limite: "ILIMITADO",
    });
  });

  it("las perillas van como lista ordenada por nombre, nunca como un objeto cuyos campos son los nombres", () => {
    const lista = listaDePerillas({
      carta_por_qr: { tipo: "INTERRUPTOR", encendida: false },
      cajas_por_sucursal: { tipo: "LIMITE", limite: 2 },
    });
    expect(lista.map((p) => p["perilla"])).toEqual(["cajas_por_sucursal", "carta_por_qr"]);
    expect(listaDePerillas({})).toEqual([]);
  });

  it("el contenido de una versión: nombre, módulos y perillas, y pasa el control de secretos", () => {
    const datos = datosDelContenidoDeLaVersion({
      nombreComercial: "Plan",
      modulos: ["caja", "ventas"],
      perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 2 } },
    });
    expect(datos).toEqual({
      nombreComercial: "Plan",
      modulos: ["caja", "ventas"],
      perillas: [{ perilla: "cajas_por_sucursal", tipo: "LIMITE", encendida: null, limite: 2 }],
    });
    exigirSinSecretos(datos, "plan");
  });
});
