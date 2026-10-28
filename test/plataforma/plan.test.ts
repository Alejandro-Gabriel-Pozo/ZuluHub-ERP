import { describe, expect, it } from "vitest";
import {
  ROTULO_DE_MODULO,
  ROTULO_DE_PERILLA,
  rotuloDeEstadoDeModulo,
  rotuloDeModulo,
  rotuloDeOrigen,
  rotuloDePerilla,
  textoDeEmpresasDelCliente,
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
  it("las perillas con nombres neutros tienen su rótulo exacto", () => {
    expect(rotuloDePerilla("composiciones_con_perdida")).toBe("Composiciones con pérdida");
    expect(rotuloDePerilla("subcomposiciones")).toBe("Subcomposiciones");
    expect(rotuloDePerilla("conjuntos")).toBe("Conjuntos");
    expect(rotuloDePerilla("composiciones_por_tamano")).toBe("Composiciones por tamaño");
  });
  it("todo rótulo corresponde a una perilla real (no quedan rótulos viejos)", () => {
    for (const clave of Object.keys(ROTULO_DE_PERILLA)) {
      expect(Object.keys(CATALOGO_DE_PERILLAS), clave).toContain(clave);
    }
    expect(Object.keys(ROTULO_DE_PERILLA)).toHaveLength(Object.keys(CATALOGO_DE_PERILLAS).length);
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
  it("todo rótulo corresponde a un módulo real (no quedan rótulos viejos)", () => {
    for (const clave of Object.keys(ROTULO_DE_MODULO)) {
      expect(Object.keys(CATALOGO_DE_MODULOS), clave).toContain(clave);
    }
    expect(Object.keys(ROTULO_DE_MODULO)).toHaveLength(Object.keys(CATALOGO_DE_MODULOS).length);
  });
  it("vidriera se llama «Vidriera»", () => {
    expect(rotuloDeModulo("vidriera")).toBe("Vidriera");
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

describe("textoDeEmpresasDelCliente", () => {
  it("con tope, ilimitado y sin tope conocido", () => {
    expect(textoDeEmpresasDelCliente({ enUso: 2, limite: 3 })).toBe(
      "Empresas del cliente: 2 en uso, tope 3.",
    );
    expect(textoDeEmpresasDelCliente({ enUso: 2, limite: "ILIMITADO" })).toBe(
      "Empresas del cliente: 2 en uso, tope sin límite.",
    );
    expect(textoDeEmpresasDelCliente({ enUso: 2, limite: null })).toBe(
      "Empresas del cliente: 2 en uso; el tope es dato no disponible.",
    );
  });
  it("si no se pudo leer el cliente, lo dice en vez de omitir la línea", () => {
    expect(textoDeEmpresasDelCliente(null)).toBe("Empresas del cliente: dato no disponible.");
  });
});
