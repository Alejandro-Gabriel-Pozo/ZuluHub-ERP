import { describe, expect, it } from "vitest";
import {
  ACCIONES_DE_CAPTACION,
  ACCIONES_DE_PLATAFORMA,
  ACTOR_DE_AUDITORIA_DE_CAPTACION,
  CLAVES_DE_AUDITORIA,
  ENTIDAD_DE_AUDITORIA,
  clavesNoPermitidas,
  valorDeAuditoriaSeguro,
} from "./auditoria";

describe("lista blanca de la auditoría de solicitudes (R-C3)", () => {
  it("la entidad, el actor de la landing y las acciones son los de §2.2", () => {
    expect(ENTIDAD_DE_AUDITORIA).toBe("solicitud_de_alta");
    expect(ACTOR_DE_AUDITORIA_DE_CAPTACION).toBe("captacion");
    expect(ACCIONES_DE_CAPTACION).toEqual([
      "SOLICITUD_RECIBIDA",
      "SOLICITUD_REENVIO",
      "SOLICITUD_VERIFICADA",
    ]);
    expect(ACCIONES_DE_PLATAFORMA).toEqual([
      "SOLICITUD_APROBADA",
      "SOLICITUD_RECHAZADA",
      "SOLICITUD_SPAM",
      "SOLICITUD_ALTA_CREADA",
      "SOLICITUD_VENCIDA",
      "SOLICITUD_ANONIMIZADA",
    ]);
  });

  it("las claves permitidas son estas trece, y ninguna es un dato personal", () => {
    expect(CLAVES_DE_AUDITORIA).toEqual([
      "estado",
      "motivo",
      "marcaId",
      "rubro",
      "provincia",
      "campania",
      "empresaId",
      "numeroDeEnvio",
      "medicionConsentida",
      "versionDeTerminos",
      "versionDePrivacidad",
      "versionDeAvisoDeMedicion",
      "correoDelGerenteEsElVerificado",
    ]);
    for (const dato of [
      "email",
      "correo",
      "nombre",
      "nombreContacto",
      "nombreNegocio",
      "telefono",
      "cuit",
      "notaInterna",
      "idDeMedicion",
      "fbclid",
    ]) {
      expect(CLAVES_DE_AUDITORIA as readonly string[], dato).not.toContain(dato);
    }
  });

  it("clavesNoPermitidas: datos con solo claves de la lista y valores seguros no tienen nada que objetar", () => {
    expect(clavesNoPermitidas({})).toEqual([]);
    expect(
      clavesNoPermitidas({
        estado: "VERIFICADA",
        motivo: "NO_VERIFICADA",
        marcaId: "8f1a6c3e-2b4d-4e5f-9a7b-1c2d3e4f5a6b",
        rubro: "almacen_o_comercio",
        provincia: "AR-B",
        campania: "verano.2026_v-1~a",
        empresaId: "8f1a6c3e-2b4d-4e5f-9a7b-1c2d3e4f5a6b",
        numeroDeEnvio: 3,
        medicionConsentida: false,
        versionDeTerminos: "2026-10-13",
        versionDePrivacidad: "2026-10-13.1",
        versionDeAvisoDeMedicion: null,
        correoDelGerenteEsElVerificado: true,
      }),
    ).toEqual([]);
  });

  it("clavesNoPermitidas: señala las claves que no son de la lista (el correo, el nombre...), en el orden en que vienen", () => {
    expect(
      clavesNoPermitidas({ email: "ana@x.com", estado: "NUEVA", nombreContacto: "Ana", cuit: "1" }),
    ).toEqual(["email", "nombreContacto", "cuit"]);
    expect(clavesNoPermitidas({ Estado: "NUEVA", estados: "x", " estado": "x" })).toEqual([
      "Estado",
      "estados",
      " estado",
    ]);
  });

  it("clavesNoPermitidas: una clave de la lista con un valor que podría ser un dato personal tampoco pasa", () => {
    expect(
      clavesNoPermitidas({
        estado: "ana@x.com",
        motivo: "Ana Pérez",
        rubro: "un texto libre",
        provincia: { dentro: "AR-B" },
        campania: ["a"],
        numeroDeEnvio: Number.NaN,
        marcaId: undefined,
        empresaId: 5n,
      }),
    ).toEqual([
      "estado",
      "motivo",
      "rubro",
      "provincia",
      "campania",
      "numeroDeEnvio",
      "marcaId",
      "empresaId",
    ]);
  });

  it("clavesNoPermitidas: una clave __proto__ propia se detecta", () => {
    const datos = JSON.parse('{"__proto__": "x", "estado": "NUEVA"}') as Record<string, unknown>;
    expect(clavesNoPermitidas(datos)).toEqual(["__proto__"]);
  });

  it("valorDeAuditoriaSeguro: identificadores, números finitos, booleanos y null", () => {
    for (const bien of [
      "NUEVA",
      "a",
      "AR-B",
      "2026-10-13.1",
      "a_b.c~d:e-f",
      "x".repeat(200),
      0,
      -1,
      3.5,
      true,
      false,
      null,
    ]) {
      expect(valorDeAuditoriaSeguro(bien), String(bien)).toBe(true);
    }
    for (const mal of [
      "",
      "x".repeat(201),
      "a b",
      "a@b",
      "a\nb",
      "ñ",
      "a,b",
      "a'b",
      '"',
      "a/b",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      undefined,
      {},
      [],
      5n,
      Symbol("x"),
      () => 1,
    ]) {
      expect(valorDeAuditoriaSeguro(mal), String(typeof mal)).toBe(false);
    }
  });
});
