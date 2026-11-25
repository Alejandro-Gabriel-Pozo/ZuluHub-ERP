import { describe, expect, it } from "vitest";
import {
  declaracionDesdeTexto,
  planDeSincronizacion,
  type DeclaracionDeAcciones,
  type EstadoDeLasPlantillas,
} from "./sincronizar-plantillas";

const DECLARACION: DeclaracionDeAcciones = {
  "a.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "a.crear": ["GERENTE", "ADMINISTRADOR"],
  "b.config": ["GERENTE"],
  "c.nueva": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
};

function estado(sobre: Partial<EstadoDeLasPlantillas> = {}): EstadoDeLasPlantillas {
  return {
    introducidas: new Set(["a.ver", "a.crear", "b.config"]),
    vigentes: { ADMINISTRADOR: ["a.crear", "a.ver"], OPERADOR: ["a.ver"] },
    reservadasAlGerente: new Set(["b.config"]),
    ...sobre,
  };
}

describe("sincronizar plantillas: el plan", () => {
  it("sin acciones nuevas no hay nada que hacer (idempotente)", () => {
    const todo = estado({ introducidas: new Set(Object.keys(DECLARACION)) });
    expect(planDeSincronizacion(DECLARACION, todo)).toEqual({
      nuevasIntroducidas: [],
      versiones: [],
    });
  });

  it("una acción nueva se suma a las plantillas que el código dice y queda marcada", () => {
    expect(planDeSincronizacion(DECLARACION, estado())).toEqual({
      nuevasIntroducidas: ["c.nueva"],
      versiones: [
        {
          clave: "ADMINISTRADOR",
          acciones: ["a.crear", "a.ver", "c.nueva"],
          agregadas: ["c.nueva"],
        },
        { clave: "OPERADOR", acciones: ["a.ver", "c.nueva"], agregadas: ["c.nueva"] },
      ],
    });
  });

  it("solo emite la versión de la plantilla a la que aporta algo", () => {
    const d: DeclaracionDeAcciones = { ...DECLARACION, "c.nueva": ["GERENTE", "ADMINISTRADOR"] };
    const plan = planDeSincronizacion(d, estado());
    expect(plan.versiones.map((v) => v.clave)).toEqual(["ADMINISTRADOR"]);
  });

  it("una acción solo del gerente no entra a ninguna plantilla pero queda marcada", () => {
    const d: DeclaracionDeAcciones = { ...DECLARACION, "c.nueva": ["GERENTE"] };
    expect(planDeSincronizacion(d, estado())).toEqual({
      nuevasIntroducidas: ["c.nueva"],
      versiones: [],
    });
  });

  it("el piso gana: una acción reservada al gerente no se suma aunque el código la declare para el administrador", () => {
    const plan = planDeSincronizacion(
      DECLARACION,
      estado({ reservadasAlGerente: new Set(["b.config", "c.nueva"]) }),
    );
    expect(plan.nuevasIntroducidas).toEqual(["c.nueva"]);
    expect(plan.versiones).toEqual([]);
  });

  it("nunca repone lo que la plataforma sacó de una plantilla ya introducida", () => {
    const plan = planDeSincronizacion(
      DECLARACION,
      estado({ vigentes: { ADMINISTRADOR: ["a.crear"], OPERADOR: [] } }),
    );
    for (const version of plan.versiones) {
      expect(version.acciones).not.toContain("a.ver");
    }
    expect(plan.versiones.find((v) => v.clave === "OPERADOR")?.acciones).toEqual(["c.nueva"]);
  });

  it("conserva lo que la plantilla ya tiene aunque el código lo haya retirado, y no repite lo que ya tiene", () => {
    const plan = planDeSincronizacion(
      DECLARACION,
      estado({ vigentes: { ADMINISTRADOR: ["a.ver", "c.nueva", "vieja.x"], OPERADOR: ["a.ver"] } }),
    );
    expect(plan.versiones).toEqual([
      { clave: "OPERADOR", acciones: ["a.ver", "c.nueva"], agregadas: ["c.nueva"] },
    ]);
  });

  it("la versión nueva sale ordenada aunque la vigente tenga acciones que van después de la nueva", () => {
    const plan = planDeSincronizacion(
      DECLARACION,
      estado({ vigentes: { ADMINISTRADOR: ["z.vieja"], OPERADOR: ["z.vieja"] } }),
    );
    expect(plan.versiones.map((v) => v.acciones)).toEqual([
      ["c.nueva", "z.vieja"],
      ["c.nueva", "z.vieja"],
    ]);
  });

  it("varias acciones nuevas salen ordenadas, en el plan y en las versiones", () => {
    const d: DeclaracionDeAcciones = {
      ...DECLARACION,
      "z.ultima": ["GERENTE", "OPERADOR", "ADMINISTRADOR"],
      "b.primera": ["GERENTE", "OPERADOR", "ADMINISTRADOR"],
    };
    const plan = planDeSincronizacion(d, estado());
    expect(plan.nuevasIntroducidas).toEqual(["b.primera", "c.nueva", "z.ultima"]);
    expect(plan.versiones[0]?.agregadas).toEqual(["b.primera", "c.nueva", "z.ultima"]);
    expect(plan.versiones[0]?.acciones).toEqual([
      "a.crear",
      "a.ver",
      "b.primera",
      "c.nueva",
      "z.ultima",
    ]);
  });
});

const VALIDO = JSON.stringify({
  formato: 1,
  acciones: { "a.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"], "a.crear": ["GERENTE"] },
});

describe("sincronizar plantillas: leer la declaración", () => {
  it("acepta la forma esperada", () => {
    expect(declaracionDesdeTexto(VALIDO)).toEqual({
      ok: true,
      declaracion: { "a.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"], "a.crear": ["GERENTE"] },
    });
  });

  it("rechaza lo que no es JSON o no tiene la forma", () => {
    expect(declaracionDesdeTexto("{")).toEqual({ ok: false, motivo: "no es JSON" });
    for (const malo of [
      "[]",
      "null",
      "1",
      '{"formato":1}',
      '{"acciones":{}}',
      '{"formato":1,"acciones":{},"x":1}',
    ]) {
      const r = declaracionDesdeTexto(malo);
      expect(r).toEqual({ ok: false, motivo: "tiene que ser { formato, acciones }" });
    }
  });

  it("rechaza otro formato y acciones que no son un objeto", () => {
    expect(declaracionDesdeTexto('{"formato":2,"acciones":{}}')).toEqual({
      ok: false,
      motivo: "el formato tiene que ser 1",
    });
    for (const acciones of ["[]", "null", '"x"']) {
      expect(declaracionDesdeTexto(`{"formato":1,"acciones":${acciones}}`)).toEqual({
        ok: false,
        motivo: "«acciones» tiene que ser un objeto",
      });
    }
  });

  it("rechaza una clave que la base no aceptaría", () => {
    for (const clave of [
      "sinpunto",
      "A.mayus",
      "a.b.c",
      "1a.b",
      "a.",
      ".b",
      `${"a".repeat(41)}.b`,
    ]) {
      const texto = JSON.stringify({ formato: 1, acciones: { [clave]: ["GERENTE"] } });
      expect(declaracionDesdeTexto(texto)).toEqual({
        ok: false,
        motivo: `clave inválida: ${clave}`,
      });
    }
  });

  it("acepta una clave en el límite de largo de la base", () => {
    const clave = `${"a".repeat(40)}.${"b".repeat(40)}`;
    const texto = JSON.stringify({ formato: 1, acciones: { [clave]: ["GERENTE"] } });
    expect(declaracionDesdeTexto(texto).ok).toBe(true);
  });

  it("rechaza roles ausentes, desconocidos, repetidos o que no son texto", () => {
    for (const roles of [
      [],
      ["JEFE"],
      ["GERENTE", "JEFE"],
      ["GERENTE", "GERENTE"],
      [1],
      "GERENTE",
      null,
    ]) {
      const texto = JSON.stringify({ formato: 1, acciones: { "a.ver": roles } });
      expect(declaracionDesdeTexto(texto)).toEqual({
        ok: false,
        motivo: "roles inválidos para a.ver",
      });
    }
  });
});
