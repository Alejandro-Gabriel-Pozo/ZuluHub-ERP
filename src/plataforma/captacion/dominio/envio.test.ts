import { describe, expect, it } from "vitest";
import {
  ESPERA_ENTRE_ENVIOS_EN_MS,
  MAXIMO_DE_ENVIOS,
  decidirEnvio,
  type SolicitudAbierta,
  type UltimaCerrada,
} from "./envio";
import { RETENCION_DE_CERRADAS_EN_MS } from "./retencion";

const MINUTO = 60_000;
const DIA = 86_400_000;
const AHORA = new Date("2026-10-13T12:00:00.000Z");
const antes = (ms: number) => new Date(AHORA.getTime() - ms);

const nueva = (numeroDeEnvios: number, hace: number): SolicitudAbierta => ({
  estado: "NUEVA",
  numeroDeEnvios,
  ultimoEnvioEn: antes(hace),
});

describe("constantes del envío", () => {
  it("esperar 2 minutos entre correos y 5 correos como máximo", () => {
    expect(ESPERA_ENTRE_ENVIOS_EN_MS).toBe(2 * MINUTO);
    expect(ESPERA_ENTRE_ENVIOS_EN_MS).toBe(120_000);
    expect(MAXIMO_DE_ENVIOS).toBe(5);
  });
});

describe("decidirEnvio sin solicitud abierta", () => {
  it("sin nada previo, se crea", () => {
    expect(decidirEnvio(null, null, AHORA)).toEqual({ tipo: "CREAR" });
  });

  it("después de una rechazada o de un alta, el mismo correo puede volver a pedir", () => {
    for (const estado of ["RECHAZADA", "ALTA_CREADA"] as const) {
      const ultima: UltimaCerrada = { estado, decididaEn: antes(1) };
      expect(decidirEnvio(null, ultima, AHORA), estado).toEqual({ tipo: "CREAR" });
    }
  });

  it("un spam de hace menos de 90 días bloquea en silencio: no se crea nada", () => {
    for (const hace of [0, 1, DIA, 89 * DIA, 90 * DIA - 1]) {
      expect(
        decidirEnvio(null, { estado: "SPAM", decididaEn: antes(hace) }, AHORA),
        `${hace}`,
      ).toEqual({
        tipo: "NADA",
        motivo: "SPAM_RECIENTE",
      });
    }
  });

  it("a los 90 días exactos el spam deja de bloquear (es cuando la fila se anonimiza)", () => {
    expect(RETENCION_DE_CERRADAS_EN_MS).toBe(90 * DIA);
    for (const hace of [90 * DIA, 90 * DIA + 1, 1000 * DIA]) {
      expect(
        decidirEnvio(null, { estado: "SPAM", decididaEn: antes(hace) }, AHORA),
        `${hace}`,
      ).toEqual({
        tipo: "CREAR",
      });
    }
  });
});

describe("decidirEnvio con una solicitud abierta", () => {
  it("verificada o aprobada: el correo ya está confirmado, no se hace nada", () => {
    for (const estado of ["VERIFICADA", "APROBADA"] as const) {
      const abierta: SolicitudAbierta = { estado, numeroDeEnvios: 1, ultimoEnvioEn: antes(DIA) };
      expect(decidirEnvio(abierta, null, AHORA), estado).toEqual({
        tipo: "NADA",
        motivo: "YA_ABIERTA",
      });
    }
  });

  it("nueva con el último envío hace menos de 2 minutos: no se reenvía", () => {
    for (const hace of [0, 1, MINUTO, 2 * MINUTO - 1]) {
      expect(decidirEnvio(nueva(1, hace), null, AHORA), `${hace}`).toEqual({
        tipo: "NADA",
        motivo: "ENVIO_RECIENTE",
      });
    }
  });

  it("nueva con el último envío hace 2 minutos o más: se reenvía con el número siguiente", () => {
    expect(decidirEnvio(nueva(1, 2 * MINUTO), null, AHORA)).toEqual({
      tipo: "REENVIAR",
      numero: 2,
    });
    expect(decidirEnvio(nueva(1, 2 * MINUTO + 1), null, AHORA)).toEqual({
      tipo: "REENVIAR",
      numero: 2,
    });
    expect(decidirEnvio(nueva(2, DIA), null, AHORA)).toEqual({ tipo: "REENVIAR", numero: 3 });
    expect(decidirEnvio(nueva(4, DIA), null, AHORA)).toEqual({ tipo: "REENVIAR", numero: 5 });
  });

  it("con 5 envíos ya no se reenvía, por mucho que haya pasado", () => {
    expect(decidirEnvio(nueva(5, DIA), null, AHORA)).toEqual({
      tipo: "NADA",
      motivo: "TOPE_DE_ENVIOS",
    });
    expect(decidirEnvio(nueva(6, DIA), null, AHORA)).toEqual({
      tipo: "NADA",
      motivo: "TOPE_DE_ENVIOS",
    });
  });

  it("el tope gana sobre la espera: con 5 envíos y uno reciente, el motivo es el tope", () => {
    expect(decidirEnvio(nueva(5, 0), null, AHORA)).toEqual({
      tipo: "NADA",
      motivo: "TOPE_DE_ENVIOS",
    });
  });

  it("hay una abierta: la última cerrada no pesa, ni siquiera un spam", () => {
    const spam: UltimaCerrada = { estado: "SPAM", decididaEn: antes(1) };
    expect(decidirEnvio(nueva(1, DIA), spam, AHORA)).toEqual({ tipo: "REENVIAR", numero: 2 });
  });

  it("un último envío en el futuro (reloj corrido) cuenta como reciente", () => {
    expect(decidirEnvio(nueva(1, -MINUTO), null, AHORA)).toEqual({
      tipo: "NADA",
      motivo: "ENVIO_RECIENTE",
    });
  });
});
