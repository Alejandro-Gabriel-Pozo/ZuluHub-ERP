import { describe, expect, it } from "vitest";
import {
  DESTINOS_DE_ARCA,
  ESPERA_TRAS_ACCESO_YA_EMITIDO_EN_MS,
  MARGEN_DEL_TICKET_EN_MS,
  MAXIMO_DE_RESPUESTA_EN_BYTES,
  SERVICIO_DE_ARCA,
  TIEMPO_LIMITE_DE_CONEXION_EN_MS,
  TIEMPO_LIMITE_DE_LOGIN_EN_MS,
  TIEMPO_LIMITE_DE_WSFE_EN_MS,
} from "./constantes";

describe("direcciones de ARCA", () => {
  it("homologación: wsaahomo y wswhomo en afip.gov.ar", () => {
    expect(DESTINOS_DE_ARCA.HOMOLOGACION).toEqual({
      wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
      wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
    });
  });

  it("producción: wsaa y servicios1 en afip.gov.ar", () => {
    expect(DESTINOS_DE_ARCA.PRODUCCION).toEqual({
      wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
      wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
    });
  });

  it("todas son https y ninguna usa arca.gob.ar (el certificado TLS no las cubre)", () => {
    for (const ambiente of Object.values(DESTINOS_DE_ARCA)) {
      for (const direccion of Object.values(ambiente)) {
        const url = new URL(direccion);
        expect(url.protocol).toBe("https:");
        expect(url.hostname.endsWith(".afip.gov.ar")).toBe(true);
        expect(direccion).not.toContain("arca.gob.ar");
      }
    }
  });

  it("homologación y producción no comparten ninguna dirección", () => {
    const todas = Object.values(DESTINOS_DE_ARCA).flatMap((a) => Object.values(a));
    expect(new Set(todas).size).toBe(4);
  });
});

describe("tiempos y márgenes (medidos por el espía en homologación real, 2026-10-14)", () => {
  it("WSFE 15 s y loginCms 20 s, conexión 5 s", () => {
    expect(TIEMPO_LIMITE_DE_WSFE_EN_MS).toBe(15_000);
    expect(TIEMPO_LIMITE_DE_LOGIN_EN_MS).toBe(20_000);
    expect(TIEMPO_LIMITE_DE_CONEXION_EN_MS).toBe(5_000);
  });

  it("el ticket se descarta 5 minutos antes de vencer y tras alreadyAuthenticated se espera 3 s", () => {
    expect(MARGEN_DEL_TICKET_EN_MS).toBe(300_000);
    expect(ESPERA_TRAS_ACCESO_YA_EMITIDO_EN_MS).toBe(3_000);
  });

  it("la conexión se abre antes que el tiempo total, y el de loginCms es mayor que el de WSFE", () => {
    expect(TIEMPO_LIMITE_DE_CONEXION_EN_MS).toBeLessThan(TIEMPO_LIMITE_DE_WSFE_EN_MS);
    expect(TIEMPO_LIMITE_DE_LOGIN_EN_MS).toBeGreaterThan(TIEMPO_LIMITE_DE_WSFE_EN_MS);
  });

  it("la respuesta se lee hasta 2 MiB y el servicio es wsfe", () => {
    expect(MAXIMO_DE_RESPUESTA_EN_BYTES).toBe(2_097_152);
    expect(SERVICIO_DE_ARCA).toBe("wsfe");
  });
});
