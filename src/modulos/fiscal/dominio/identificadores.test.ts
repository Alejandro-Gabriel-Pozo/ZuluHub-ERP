import { describe, expect, it } from "vitest";
import {
  certificadoId,
  comprobanteId,
  domicilioId,
  emisorId,
  esUuid,
  intentoId,
  origenId,
  puntoDeVentaId,
  solicitudId,
  versionId,
} from "./identificadores";

const constructores = [
  ["EmisorId", emisorId],
  ["PuntoDeVentaId", puntoDeVentaId],
  ["DomicilioId", domicilioId],
  ["VersionId", versionId],
  ["SolicitudId", solicitudId],
  ["OrigenId", origenId],
  ["ComprobanteId", comprobanteId],
  ["CertificadoId", certificadoId],
  ["IntentoId", intentoId],
] as const;

describe.each(constructores)("%s", (nombre, crear) => {
  it("acepta un texto no vacío y lo devuelve igual", () => {
    expect(crear("abc-1")).toBe("abc-1");
    expect(crear("a b")).toBe("a b");
  });

  it.each(["", " ", " x", "x ", "\tx", "x\n"])("rechaza %j", (valor) => {
    expect(() => crear(valor)).toThrow(new RangeError(`${nombre} inválido`));
  });
});

describe("esUuid", () => {
  const UUID = "0b3a0c5e-8f7d-4c1b-9a2e-1d2c3b4a5f60";

  it("acepta un uuid en minúscula", () => {
    expect(esUuid(UUID)).toBe(true);
    expect(esUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(esUuid("abcdef01-2345-6789-abcd-ef0123456789")).toBe(true);
  });

  it.each([
    ["vacío", ""],
    ["en mayúscula", UUID.toUpperCase()],
    ["sin guiones", UUID.replaceAll("-", "")],
    ["con un blanco al principio", ` ${UUID}`],
    ["con un blanco al final", `${UUID} `],
    ["con un salto de línea al final", `${UUID}\n`],
    ["con un carácter de más al principio", `0${UUID}`],
    ["con un carácter de más al final", `${UUID}0`],
    ["con una letra fuera de hexadecimal", UUID.replace("0b3a", "0g3a")],
    ["con el primer grupo corto", UUID.slice(1)],
    ["con el último grupo corto", UUID.slice(0, -1)],
    ["con los grupos en otro lugar", "0b3a0c5e8-f7d-4c1b-9a2e-1d2c3b4a5f60"],
  ])("rechaza uno %s", (_nombre, texto) => {
    expect(esUuid(texto)).toBe(false);
  });
});
