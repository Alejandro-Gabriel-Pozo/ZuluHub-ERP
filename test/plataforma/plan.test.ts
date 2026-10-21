import { describe, expect, it } from "vitest";
import {
  rotuloDeEstadoDeModulo,
  rotuloDeModulo,
  rotuloDeOrigen,
  rotuloDePerilla,
  textoDeValor,
} from "../../apps/plataforma/logica/plan";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { CATALOGO_DE_PERILLAS } from "../../src/capacidades/planes/perillas";

describe("rotuloDePerilla", () => {
  it("empresas_por_tenant se llama «Empresas por cliente»", () => {
    expect(rotuloDePerilla("empresas_por_tenant")).toBe("Empresas por cliente");
  });
  it.each(Object.keys(CATALOGO_DE_PERILLAS))("la perilla real %s tiene rótulo propio", (clave) => {
    const rotulo = rotuloDePerilla(clave);
    expect(rotulo).not.toBe(clave);
    expect(rotulo).not.toContain("_");
  });
  it("una desconocida vuelve tal cual y no lanza", () => {
    expect(rotuloDePerilla("perilla_nueva")).toBe("perilla_nueva");
    expect(rotuloDePerilla("constructor")).toBe("constructor");
  });
});

describe("rotuloDeModulo", () => {
  it.each(Object.keys(CATALOGO_DE_MODULOS))("el módulo real %s tiene rótulo propio", (clave) => {
    expect(rotuloDeModulo(clave)).not.toBe(clave);
  });
  it("una desconocida vuelve tal cual", () => {
    expect(rotuloDeModulo("modulo_nuevo")).toBe("modulo_nuevo");
    expect(rotuloDeModulo("toString")).toBe("toString");
  });
});

describe("textoDeValor", () => {
  it("interruptores", () => {
    expect(textoDeValor({ tipo: "INTERRUPTOR", encendida: true })).toBe("Sí");
    expect(textoDeValor({ tipo: "INTERRUPTOR", encendida: false })).toBe("No");
  });
  it("límites con punto de miles", () => {
    expect(textoDeValor({ tipo: "LIMITE", limite: 0 })).toBe("0");
    expect(textoDeValor({ tipo: "LIMITE", limite: 999 })).toBe("999");
    expect(textoDeValor({ tipo: "LIMITE", limite: 1000 })).toBe("1.000");
    expect(textoDeValor({ tipo: "LIMITE", limite: 1234567 })).toBe("1.234.567");
    expect(textoDeValor({ tipo: "LIMITE", limite: "ILIMITADO" })).toBe("Sin límite");
  });
  it("formas desconocidas dan raya", () => {
    expect(textoDeValor(null as never)).toBe("—");
    expect(textoDeValor({ tipo: "OTRO" } as never)).toBe("—");
    expect(textoDeValor({ tipo: "LIMITE", limite: -1 })).toBe("—");
    expect(textoDeValor({ tipo: "INTERRUPTOR" } as never)).toBe("—");
  });
});

describe("rotuloDeOrigen", () => {
  it("traduce los tres orígenes", () => {
    expect(rotuloDeOrigen("BASE")).toBe("Valor base");
    expect(rotuloDeOrigen("PLAN")).toBe("Del plan");
    expect(rotuloDeOrigen("AJUSTE")).toBe("Ajuste manual");
  });
  it("otro da raya", () => {
    expect(rotuloDeOrigen("XX")).toBe("—");
    expect(rotuloDeOrigen("constructor")).toBe("—");
  });
});

describe("rotuloDeEstadoDeModulo", () => {
  it("traduce los tres estados", () => {
    expect(rotuloDeEstadoDeModulo("ACTIVO")).toEqual({ texto: "Activo", tono: "exito" });
    expect(rotuloDeEstadoDeModulo("SOLO_LECTURA")).toEqual({
      texto: "Solo lectura",
      tono: "aviso",
    });
    expect(rotuloDeEstadoDeModulo("NO_ACTIVO")).toEqual({ texto: "No activo", tono: "info" });
  });
  it("desconocido da raya", () => {
    expect(rotuloDeEstadoDeModulo("ZZ")).toEqual({ texto: "—", tono: "info" });
    expect(rotuloDeEstadoDeModulo("toString")).toEqual({ texto: "—", tono: "info" });
  });
});
