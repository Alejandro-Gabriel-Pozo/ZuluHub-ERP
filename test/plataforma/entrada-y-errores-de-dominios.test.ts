import { describe, expect, it } from "vitest";
import {
  entradaDeAgregarDominio,
  entradaDeCambiarDominio,
  entradaDeRetirarDominio,
} from "../../apps/plataforma/logica/entrada-de-dominios";
import { errorParaLaPantalla } from "../../apps/plataforma/logica/errores-de-plataforma";
import { inicioDelDiaArgentino } from "../../apps/plataforma/logica/fecha-de-verificacion";
import { MENSAJES_DE_ERROR_DE_DOMINIOS } from "../../src/plataforma/casos-de-uso/mensajes-de-dominios";

/**
 * Lo puro de la consola «Dominios»: la forma de lo que manda el navegador (solo forma y listas cerradas; lo demás lo decide el caso de uso), la fecha de verificación por día de la
 * Argentina y la traducción de los errores de dominios.
 */

const CLAVE = "11111111-1111-4111-8111-111111111111";
const DOMINIO = "22222222-2222-4222-8222-222222222222";
const EMPRESA = "33333333-3333-4333-8333-333333333333";
const ALTA = {
  claveDeIdempotencia: CLAVE,
  empresaId: EMPRESA,
  host: "App.Hotel.com.ar",
  superficie: "APP",
  titular: "CLIENTE",
};

describe("entradaDeAgregarDominio", () => {
  it("acepta la forma completa y descarta lo que no está en la lista", () => {
    expect(
      entradaDeAgregarDominio({ ...ALTA, esCanonico: true, duenio: { tipo: "MARCA" } }),
    ).toEqual({
      ok: true,
      valor: ALTA,
    });
  });

  it("rechaza lo que no es de las listas cerradas: el sitio de la empresa, landing y consola no se dan de alta desde acá", () => {
    for (const superficie of ["SITIO", "LANDING", "CONSOLA", "app", "", 1, null]) {
      expect(entradaDeAgregarDominio({ ...ALTA, superficie }), String(superficie)).toEqual({
        ok: false,
      });
    }
    for (const titular of ["OTRO", "cliente", "", null]) {
      expect(entradaDeAgregarDominio({ ...ALTA, titular }), String(titular)).toEqual({ ok: false });
    }
  });

  it("rechaza claves, ids y nombres con otra forma, y lo que no es un objeto", () => {
    expect(entradaDeAgregarDominio({ ...ALTA, claveDeIdempotencia: "x" })).toEqual({ ok: false });
    expect(entradaDeAgregarDominio({ ...ALTA, empresaId: "no-es-uuid" })).toEqual({ ok: false });
    expect(entradaDeAgregarDominio({ ...ALTA, host: 5 })).toEqual({ ok: false });
    for (const raro of [null, undefined, "texto", 3, [], [ALTA]]) {
      expect(entradaDeAgregarDominio(raro)).toEqual({ ok: false });
    }
  });
});

describe("entradaDeCambiarDominio y entradaDeRetirarDominio", () => {
  it("piden clave y dominio con forma de uuid", () => {
    expect(
      entradaDeCambiarDominio({ claveDeIdempotencia: CLAVE, dominioId: DOMINIO, otra: 1 }),
    ).toEqual({
      ok: true,
      valor: { claveDeIdempotencia: CLAVE, dominioId: DOMINIO },
    });
    expect(entradaDeCambiarDominio({ claveDeIdempotencia: CLAVE, dominioId: "x" })).toEqual({
      ok: false,
    });
    expect(entradaDeCambiarDominio({ dominioId: DOMINIO })).toEqual({ ok: false });
  });

  it("retirar exige además un motivo de texto (el largo y que no esté vacío los decide el caso de uso)", () => {
    expect(
      entradaDeRetirarDominio({ claveDeIdempotencia: CLAVE, dominioId: DOMINIO, motivo: "se fue" }),
    ).toEqual({
      ok: true,
      valor: { claveDeIdempotencia: CLAVE, dominioId: DOMINIO, motivo: "se fue" },
    });
    expect(entradaDeRetirarDominio({ claveDeIdempotencia: CLAVE, dominioId: DOMINIO })).toEqual({
      ok: false,
    });
    expect(
      entradaDeRetirarDominio({ claveDeIdempotencia: CLAVE, dominioId: DOMINIO, motivo: 7 }),
    ).toEqual({ ok: false });
  });
});

describe("inicioDelDiaArgentino", () => {
  it("es el inicio del día en la Argentina (UTC-3): cambia a las 03:00 UTC", () => {
    expect(inicioDelDiaArgentino(new Date("2026-11-25T02:59:59.999Z")).toISOString()).toBe(
      "2026-11-24T03:00:00.000Z",
    );
    expect(inicioDelDiaArgentino(new Date("2026-11-25T03:00:00.000Z")).toISOString()).toBe(
      "2026-11-25T03:00:00.000Z",
    );
    expect(inicioDelDiaArgentino(new Date("2026-11-26T01:30:00.000Z")).toISOString()).toBe(
      "2026-11-25T03:00:00.000Z",
    );
  });

  it("nunca es futura, es idempotente y dos instantes del mismo día dan lo mismo", () => {
    for (
      let t = Date.parse("2026-11-20T00:00:00Z");
      t < Date.parse("2026-11-23T00:00:00Z");
      t += 1_800_000
    ) {
      const ahora = new Date(t);
      const inicio = inicioDelDiaArgentino(ahora);
      expect(inicio.getTime()).toBeLessThanOrEqual(ahora.getTime());
      expect(ahora.getTime() - inicio.getTime()).toBeLessThan(86_400_000);
      expect(inicioDelDiaArgentino(inicio).getTime()).toBe(inicio.getTime());
    }
  });
});

describe("errorParaLaPantalla con el contexto de dominios", () => {
  it("el nombre del sitio y el motivo van debajo de su campo, con el texto del caso de uso", () => {
    expect(errorParaLaPantalla("HOST_DUPLICADO", "DOMINIO")).toEqual({
      tipo: "CAMPO",
      campo: "host",
      texto: MENSAJES_DE_ERROR_DE_DOMINIOS.HOST_DUPLICADO,
    });
    expect(errorParaLaPantalla("HOST_INVALIDO", "DOMINIO")).toMatchObject({
      tipo: "CAMPO",
      campo: "host",
    });
    expect(errorParaLaPantalla("MOTIVO_OBLIGATORIO", "DOMINIO")).toEqual({
      tipo: "CAMPO",
      campo: "motivo",
      texto: MENSAJES_DE_ERROR_DE_DOMINIOS.MOTIVO_OBLIGATORIO,
    });
  });

  it("lo demás sale como mensaje general con el texto del caso de uso", () => {
    expect(errorParaLaPantalla("TRANSICION_DE_DOMINIO_INVALIDA", "DOMINIO")).toEqual({
      tipo: "GENERAL",
      texto: MENSAJES_DE_ERROR_DE_DOMINIOS.TRANSICION_DE_DOMINIO_INVALIDA,
    });
    expect(errorParaLaPantalla("DOMINIO_SIN_VERIFICAR", "DOMINIO")).toMatchObject({
      tipo: "GENERAL",
    });
  });

  it("permiso, clave y segundo factor siguen siendo los generales de la consola", () => {
    expect(errorParaLaPantalla("SIN_PERMISO", "DOMINIO")).toEqual({ tipo: "OCULTAR_ACCION" });
    expect(errorParaLaPantalla("CLAVE_REUTILIZADA", "DOMINIO")).toMatchObject({
      tipo: "PANTALLA_VIEJA",
    });
    expect(errorParaLaPantalla("segundo_factor_reciente_requerido", "DOMINIO")).toEqual({
      tipo: "SEGUNDO_FACTOR",
    });
  });

  it("un código desconocido o un error de persistencia es inesperado y no muestra nada", () => {
    expect(errorParaLaPantalla("CODIGO_QUE_NO_EXISTE", "DOMINIO")).toEqual({ tipo: "INESPERADO" });
    expect(errorParaLaPantalla({ tipo: "ErrorDeBase" }, "DOMINIO")).toEqual({ tipo: "INESPERADO" });
  });

  it("los códigos de dominios no se traducen fuera de su contexto (no pisan los de otras pantallas)", () => {
    expect(errorParaLaPantalla("HOST_DUPLICADO")).toEqual({ tipo: "INESPERADO" });
  });
});
