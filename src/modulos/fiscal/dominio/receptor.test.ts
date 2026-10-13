import { describe, expect, it } from "vitest";
import { CUIT_A, CUIT_B, CUIT_C } from "../../../../test/utilidades/fiscal";
import { CONDICIONES_DE_IVA_DEL_RECEPTOR } from "./condicion-iva-receptor";
import type { LetraDeComprobante } from "./comprobante-emitido";
import {
  LIMITES_DE_RECEPTOR,
  numeroDeDocumentoParaArca,
  validarReceptor,
  type DocumentoDelReceptor,
  type Receptor,
} from "./receptor";

const contexto = (letra: LetraDeComprobante) => ({ letra, cuitDelEmisor: CUIT_B });

const inscripto: Receptor = {
  nombre: "Distribuidora Sur SA",
  documento: { tipo: "CUIT", numero: CUIT_C },
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilio: "Av. Siempreviva 742",
};

const consumidorFinal: Receptor = {
  nombre: null,
  documento: { tipo: "SIN_IDENTIFICAR" },
  condicionIva: "CONSUMIDOR_FINAL",
  domicilio: null,
};

const conDocumento = (
  documento: DocumentoDelReceptor,
  cambios: Partial<Receptor> = {},
): Receptor => ({
  ...inscripto,
  condicionIva: "CONSUMIDOR_FINAL",
  documento,
  ...cambios,
});

const invalido = (campo: string) => ({
  ok: false,
  error: { codigo: "RECEPTOR_INVALIDO", campo },
});

describe("validarReceptor: lo que acepta", () => {
  it("un inscripto con CUIT en la clase A", () => {
    const r = validarReceptor(inscripto, contexto("A"));
    expect(r).toEqual({ ok: true, valor: inscripto });
  });

  it("el consumidor final sin datos en B y en C: documento sin identificar y nombre ausente", () => {
    for (const letra of ["B", "C"] as const) {
      expect(validarReceptor(consumidorFinal, contexto(letra))).toEqual({
        ok: true,
        valor: consumidorFinal,
      });
    }
  });

  it("sin identificar admite un nombre (se conserva recortado)", () => {
    const r = validarReceptor({ ...consumidorFinal, nombre: "  Mostrador  " }, contexto("B"));
    expect(r).toEqual({ ok: true, valor: { ...consumidorFinal, nombre: "Mostrador" } });
  });

  it("recorta los blancos y vuelve null los textos vacíos", () => {
    const r = validarReceptor(
      { ...inscripto, nombre: "  Distribuidora Sur SA  ", domicilio: "   " },
      contexto("A"),
    );
    expect(r).toEqual({
      ok: true,
      valor: { ...inscripto, nombre: "Distribuidora Sur SA", domicilio: null },
    });
    const sinDomicilio = validarReceptor({ ...inscripto, domicilio: null }, contexto("A"));
    expect(sinDomicilio).toEqual({ ok: true, valor: { ...inscripto, domicilio: null } });
  });

  it("un CUIT con guiones queda en su forma canónica", () => {
    const r = validarReceptor(
      { ...inscripto, documento: { tipo: "CUIT", numero: "30-71234567-1" } },
      contexto("A"),
    );
    expect(r).toEqual({ ok: true, valor: inscripto });
  });

  it("CUIL, CDI, DNI y pasaporte válidos en B", () => {
    for (const documento of [
      { tipo: "CUIL", numero: CUIT_A },
      { tipo: "CDI", numero: CUIT_A },
      { tipo: "DNI", numero: "12345678" },
      { tipo: "DNI", numero: "123456" },
      { tipo: "DNI", numero: "123456789" },
      { tipo: "PASAPORTE", numero: "12345678901" },
      { tipo: "PASAPORTE", numero: "0" },
    ] as const) {
      const r = validarReceptor(conDocumento(documento), contexto("B"));
      expect(r, JSON.stringify(documento)).toEqual({ ok: true, valor: conDocumento(documento) });
    }
  });

  it("el largo exacto de nombre y domicilio entra", () => {
    const nombre = "n".repeat(LIMITES_DE_RECEPTOR.nombre);
    const domicilio = "d".repeat(LIMITES_DE_RECEPTOR.domicilio);
    const r = validarReceptor({ ...inscripto, nombre, domicilio }, contexto("A"));
    expect(r).toEqual({ ok: true, valor: { ...inscripto, nombre, domicilio } });
  });
});

describe("validarReceptor: forma", () => {
  it("un documento identificado exige nombre", () => {
    for (const nombre of [null, "", "   "]) {
      expect(validarReceptor({ ...inscripto, nombre }, contexto("A"))).toEqual(invalido("nombre"));
    }
  });

  it("el nombre y el domicilio no pasan de su límite", () => {
    expect(
      validarReceptor(
        { ...inscripto, nombre: "n".repeat(LIMITES_DE_RECEPTOR.nombre + 1) },
        contexto("A"),
      ),
    ).toEqual(invalido("nombre"));
    expect(
      validarReceptor(
        { ...consumidorFinal, nombre: "n".repeat(LIMITES_DE_RECEPTOR.nombre + 1) },
        contexto("B"),
      ),
    ).toEqual(invalido("nombre"));
    expect(
      validarReceptor(
        { ...inscripto, domicilio: "d".repeat(LIMITES_DE_RECEPTOR.domicilio + 1) },
        contexto("A"),
      ),
    ).toEqual(invalido("domicilio"));
  });

  it("CUIT, CUIL y CDI con dígito verificador inválido o mal formados", () => {
    for (const tipo of ["CUIT", "CUIL", "CDI"] as const) {
      for (const numero of ["30712345672", "123", "", "3071234567a", " 30712345671"]) {
        expect(validarReceptor(conDocumento({ tipo, numero }), contexto("B"))).toEqual(
          invalido("documento"),
        );
      }
    }
  });

  it("DNI: de 6 a 9 dígitos y sin ceros a la izquierda", () => {
    for (const numero of ["12345", "1234567890", "012345678", "1234567a", "", "12 345 678"]) {
      expect(validarReceptor(conDocumento({ tipo: "DNI", numero }), contexto("B"))).toEqual(
        invalido("documento"),
      );
    }
  });

  it("pasaporte: solo dígitos, de 1 a 11 (DocNro es un Long de 11)", () => {
    for (const numero of ["", "123456789012", "AAB123456", "-1", "1.5"]) {
      expect(validarReceptor(conDocumento({ tipo: "PASAPORTE", numero }), contexto("B"))).toEqual(
        invalido("documento"),
      );
    }
  });
});

describe("validarReceptor: reglas de ARCA", () => {
  it("la condición tiene que admitir la letra (rechazos 10242 y 10243)", () => {
    // un consumidor final no recibe una A; un inscripto no recibe una B
    expect(
      validarReceptor({ ...inscripto, condicionIva: "CONSUMIDOR_FINAL" }, contexto("A")),
    ).toEqual(invalido("condicionIva"));
    expect(validarReceptor(inscripto, contexto("B"))).toEqual(invalido("condicionIva"));
    // en C todas las condiciones entran
    for (const condicionIva of CONDICIONES_DE_IVA_DEL_RECEPTOR) {
      const r = validarReceptor({ ...inscripto, condicionIva }, contexto("C"));
      expect(r.ok, condicionIva).toBe(true);
    }
  });

  it("la clase A exige documento CUIT (error 10013), no CUIL, CDI ni DNI ni sin identificar", () => {
    for (const documento of [
      { tipo: "CUIL", numero: CUIT_C },
      { tipo: "CDI", numero: CUIT_C },
      { tipo: "DNI", numero: "12345678" },
      { tipo: "SIN_IDENTIFICAR" },
    ] as const) {
      const r = validarReceptor({ ...inscripto, documento }, contexto("A"));
      expect(r, documento.tipo).toEqual({
        ok: false,
        error: { codigo: "RECEPTOR_INVALIDO_PARA_A" },
      });
    }
  });

  it("el documento no puede ser el CUIT del emisor (error 10069), con cualquier tipo identificado", () => {
    for (const tipo of ["CUIT", "CUIL", "CDI"] as const) {
      const r = validarReceptor(conDocumento({ tipo, numero: CUIT_B }), contexto("B"));
      expect(r).toEqual({ ok: false, error: { codigo: "RECEPTOR_IGUAL_AL_EMISOR" } });
    }
    // con un guion también: se compara la forma canónica
    const conGuiones = validarReceptor(
      conDocumento({ tipo: "CUIT", numero: "30-70853393-5" }),
      contexto("B"),
    );
    expect(conGuiones).toEqual({ ok: false, error: { codigo: "RECEPTOR_IGUAL_AL_EMISOR" } });
    // otro CUIT sí
    expect(validarReceptor(conDocumento({ tipo: "CUIT", numero: CUIT_A }), contexto("B")).ok).toBe(
      true,
    );
  });

  it("sujeto no categorizado en B se rechaza (error 10067 de ARCA); en C se admite", () => {
    const noCategorizado: Receptor = { ...inscripto, condicionIva: "NO_CATEGORIZADO" };
    expect(validarReceptor(noCategorizado, contexto("B"))).toEqual({
      ok: false,
      error: { codigo: "RECEPTOR_NO_CATEGORIZADO_NO_SOPORTADO" },
    });
    expect(validarReceptor(noCategorizado, contexto("C"))).toEqual({
      ok: true,
      valor: noCategorizado,
    });
  });

  it("devuelve el primer error: documento, nombre, domicilio, condición, A, emisor, no categorizado", () => {
    const todoMal: Receptor = {
      nombre: null,
      documento: { tipo: "CUIT", numero: "1" },
      condicionIva: "CONSUMIDOR_FINAL",
      domicilio: "d".repeat(LIMITES_DE_RECEPTOR.domicilio + 1),
    };
    expect(validarReceptor(todoMal, contexto("A"))).toEqual(invalido("documento"));
    const sinNombre = { ...todoMal, documento: { tipo: "CUIT", numero: CUIT_B } } as const;
    expect(validarReceptor(sinNombre, contexto("A"))).toEqual(invalido("nombre"));
    const sinDomicilioValido = { ...sinNombre, nombre: "X" };
    expect(validarReceptor(sinDomicilioValido, contexto("A"))).toEqual(invalido("domicilio"));
    const condicion = { ...sinDomicilioValido, domicilio: null };
    expect(validarReceptor(condicion, contexto("A"))).toEqual(invalido("condicionIva"));
    const para = { ...condicion, condicionIva: "RESPONSABLE_INSCRIPTO" } as const;
    expect(
      validarReceptor({ ...para, documento: { tipo: "DNI", numero: "12345678" } }, contexto("A")),
    ).toEqual({
      ok: false,
      error: { codigo: "RECEPTOR_INVALIDO_PARA_A" },
    });
    expect(validarReceptor(para, contexto("A"))).toEqual({
      ok: false,
      error: { codigo: "RECEPTOR_IGUAL_AL_EMISOR" },
    });
  });
});

describe("numeroDeDocumentoParaArca", () => {
  it("es el número como entero, o cero sin identificar", () => {
    expect(numeroDeDocumentoParaArca({ tipo: "SIN_IDENTIFICAR" })).toBe(0n);
    expect(numeroDeDocumentoParaArca({ tipo: "CUIT", numero: CUIT_C })).toBe(30712345671n);
    expect(numeroDeDocumentoParaArca({ tipo: "DNI", numero: "12345678" })).toBe(12345678n);
    expect(numeroDeDocumentoParaArca({ tipo: "PASAPORTE", numero: "007" })).toBe(7n);
  });
});
