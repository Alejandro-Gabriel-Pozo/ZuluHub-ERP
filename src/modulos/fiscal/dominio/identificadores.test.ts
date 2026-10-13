import { describe, expect, it } from "vitest";
import {
  certificadoId,
  comprobanteId,
  domicilioId,
  emisorId,
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
