import { describe, expect, it } from "vitest";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../../../contexto/estados";
import {
  empresaId,
  invitacionId,
  sucursalId,
  tenantId,
} from "../../../primitivas/identificadores/marca";
import {
  armarEnlaceDeInvitacion,
  armarMensajeDeInvitacion,
  decidirEnvioDeInvitacion,
} from "./envio";
import type { Email } from "./email";
import type { Invitacion } from "./invitacion";

const AHORA = new Date("2026-10-11T12:00:00.000Z");
const mas = (ms: number) => new Date(AHORA.getTime() + ms);

const invitacion = (cambios: Partial<Invitacion> = {}): Invitacion => ({
  id: invitacionId("inv-1"),
  tenantId: tenantId("t-1"),
  tipo: "USUARIO",
  email: "ana@x.com" as Email,
  estado: "PENDIENTE",
  emitidaEn: mas(-1_000),
  venceEn: mas(10_000),
  empresas: [{ empresaId: empresaId("e-1"), rol: "OPERADOR", sucursales: [sucursalId("s-1")] }],
  aceptadaPor: null,
  reemplazadaPor: null,
  version: 1,
  ...cambios,
});

const datos = (
  empresa: EstadoDeEmpresa = "ACTIVE",
  tenant: EstadoDeTenant = "ACTIVE",
  ahora: Date = AHORA,
) => ({ ahora, empresa, tenant });

describe("decidirEnvioDeInvitacion", () => {
  it("una invitación pendiente y vigente de una empresa que opera se envía", () => {
    expect(decidirEnvioDeInvitacion(invitacion(), datos())).toEqual({ tipo: "ENVIAR" });
  });

  it.each([
    ["REVOCADA", { estado: "REVOCADA" } as const],
    ["ACEPTADA", { estado: "ACEPTADA" } as const],
  ])("una invitación %s no se envía", (motivo, cambios) => {
    expect(decidirEnvioDeInvitacion(invitacion(cambios), datos())).toEqual({
      tipo: "OMITIR",
      motivo,
    });
  });

  it("una invitación reemplazada (revocada al reenviar) se omite como REEMPLAZADA", () => {
    const reemplazada = invitacion({
      estado: "REVOCADA",
      reemplazadaPor: invitacionId("inv-2"),
    });
    expect(decidirEnvioDeInvitacion(reemplazada, datos())).toEqual({
      tipo: "OMITIR",
      motivo: "REEMPLAZADA",
    });
  });

  it("la reemplazada gana sobre cualquier otro motivo", () => {
    const reemplazada = invitacion({
      estado: "ACEPTADA",
      reemplazadaPor: invitacionId("inv-2"),
      venceEn: mas(-1),
    });
    expect(decidirEnvioDeInvitacion(reemplazada, datos("SUSPENDED", "SUSPENDED")).tipo).toBe(
      "OMITIR",
    );
    expect(decidirEnvioDeInvitacion(reemplazada, datos("SUSPENDED", "SUSPENDED"))).toEqual({
      tipo: "OMITIR",
      motivo: "REEMPLAZADA",
    });
  });

  it("vence justo en `venceEn`: un milisegundo antes todavía se envía", () => {
    const i = invitacion({ venceEn: AHORA });
    expect(decidirEnvioDeInvitacion(i, datos("ACTIVE", "ACTIVE", mas(-1)))).toEqual({
      tipo: "ENVIAR",
    });
    expect(decidirEnvioDeInvitacion(i, datos("ACTIVE", "ACTIVE", AHORA))).toEqual({
      tipo: "OMITIR",
      motivo: "VENCIDA",
    });
  });

  it("revocada o aceptada gana sobre vencida, y vencida sobre empresa que no opera", () => {
    expect(
      decidirEnvioDeInvitacion(invitacion({ estado: "REVOCADA", venceEn: mas(-1) }), datos()),
    ).toEqual({ tipo: "OMITIR", motivo: "REVOCADA" });
    expect(
      decidirEnvioDeInvitacion(invitacion({ estado: "ACEPTADA", venceEn: mas(-1) }), datos()),
    ).toEqual({ tipo: "OMITIR", motivo: "ACEPTADA" });
    expect(decidirEnvioDeInvitacion(invitacion({ venceEn: mas(-1) }), datos("SUSPENDED"))).toEqual({
      tipo: "OMITIR",
      motivo: "VENCIDA",
    });
    expect(
      decidirEnvioDeInvitacion(invitacion({ estado: "REVOCADA" }), datos("SUSPENDED", "SUSPENDED")),
    ).toEqual({ tipo: "OMITIR", motivo: "REVOCADA" });
  });

  it.each<[EstadoDeEmpresa, EstadoDeTenant]>([
    ["SUSPENDED", "ACTIVE"],
    ["CANCELLED", "ACTIVE"],
    ["DELETING", "ACTIVE"],
    ["PROVISIONING", "ACTIVE"],
    ["ACTIVE", "SUSPENDED"],
  ])("una invitación de usuario a una empresa %s con tenant %s no se envía", (empresa, tenant) => {
    expect(decidirEnvioDeInvitacion(invitacion(), datos(empresa, tenant))).toEqual({
      tipo: "OMITIR",
      motivo: "EMPRESA_NO_OPERA",
    });
  });

  it("el alta del gerente se envía con la empresa en PROVISIONING (es cuando hay que mandarla)", () => {
    const alta = invitacion({ tipo: "ALTA_GERENTE" });
    expect(decidirEnvioDeInvitacion(alta, datos("PROVISIONING"))).toEqual({ tipo: "ENVIAR" });
  });

  it("el alta del gerente no se envía si el tenant está suspendido o la empresa cancelada o en baja", () => {
    const alta = invitacion({ tipo: "ALTA_GERENTE" });
    for (const [empresa, tenant] of [
      ["PROVISIONING", "SUSPENDED"],
      ["CANCELLED", "ACTIVE"],
      ["DELETING", "ACTIVE"],
    ] as const) {
      expect(decidirEnvioDeInvitacion(alta, datos(empresa, tenant))).toEqual({
        tipo: "OMITIR",
        motivo: "EMPRESA_NO_OPERA",
      });
    }
  });
});

describe("armarEnlaceDeInvitacion", () => {
  it("une la URL base, la ruta de invitaciones y el token", () => {
    expect(armarEnlaceDeInvitacion("https://app.ejemplo.test", "abc_DEF-123")).toBe(
      "https://app.ejemplo.test/invitaciones/abc_DEF-123",
    );
  });

  it("conserva una ruta base y no duplica barras", () => {
    expect(armarEnlaceDeInvitacion("https://app.ejemplo.test/zulu/", "t")).toBe(
      "https://app.ejemplo.test/zulu/invitaciones/t",
    );
    expect(armarEnlaceDeInvitacion("https://app.ejemplo.test///", "t")).toBe(
      "https://app.ejemplo.test/invitaciones/t",
    );
  });

  it("escapa lo que no sea seguro en una URL", () => {
    expect(armarEnlaceDeInvitacion("https://a.test", "a b/c?d#e")).toBe(
      "https://a.test/invitaciones/a%20b%2Fc%3Fd%23e",
    );
  });
});

describe("armarMensajeDeInvitacion", () => {
  it("arma el asunto y el texto con la empresa y el enlace", () => {
    const m = armarMensajeDeInvitacion("Panadería Sol", "https://app.ejemplo.test/invitaciones/t");
    expect(m.asunto).toBe("Te invitaron a Panadería Sol en ZuluHub");
    expect(m.texto).toBe(
      [
        "Hola,",
        "",
        "Te invitaron a sumarte a Panadería Sol en ZuluHub.",
        "",
        "Para aceptar la invitación, abrí este enlace e iniciá sesión con este mismo email:",
        "https://app.ejemplo.test/invitaciones/t",
        "",
        "El enlace es personal: no lo compartas. Si no esperabas esta invitación, ignorá este mensaje.",
        "",
      ].join("\n"),
    );
  });

  it("normaliza los blancos de la razón social (nada de saltos de línea en el asunto)", () => {
    const m = armarMensajeDeInvitacion("  Panadería \n\r Sol\t S.A. ", "https://x.test/i/t");
    expect(m.asunto).toBe("Te invitaron a Panadería Sol S.A. en ZuluHub");
    expect(m.texto).toContain("sumarte a Panadería Sol S.A. en ZuluHub.");
  });

  it("es determinista: el mismo enlace y la misma empresa dan el mismo mensaje", () => {
    const a = armarMensajeDeInvitacion("Sol", "https://x.test/i/t");
    const b = armarMensajeDeInvitacion("Sol", "https://x.test/i/t");
    expect(b).toEqual(a);
  });
});
