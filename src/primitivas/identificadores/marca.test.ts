import { describe, expect, it } from "vitest";
import {
  adminPlataformaId,
  empresaId,
  esTextoDeIdentificador,
  invitacionId,
  personaId,
  sucursalId,
  tenantId,
} from "./marca";

describe("identificadores con marca", () => {
  it("acepta texto no vacío", () => {
    expect(empresaId("emp_1")).toBe("emp_1");
    expect(tenantId("ten_1")).toBe("ten_1");
    expect(personaId("per_1")).toBe("per_1");
    expect(invitacionId("inv_1")).toBe("inv_1");
    expect(adminPlataformaId("adm_1")).toBe("adm_1");
  });

  it("rechaza vacío y espacios en los extremos", () => {
    expect(() => empresaId("")).toThrow(RangeError);
    expect(() => tenantId(" x")).toThrow(RangeError);
    expect(() => personaId("x ")).toThrow(RangeError);
    expect(() => invitacionId("")).toThrow(RangeError);
    expect(() => invitacionId(" x")).toThrow(RangeError);
    expect(() => adminPlataformaId("")).toThrow(RangeError);
    expect(() => adminPlataformaId(" x")).toThrow(RangeError);
    expect(() => adminPlataformaId("x ")).toThrow(RangeError);
  });

  it("el error nombra al identificador que falló", () => {
    expect(() => empresaId("")).toThrow("EmpresaId inválido");
    expect(() => tenantId("")).toThrow("TenantId inválido");
    expect(() => personaId("")).toThrow("PersonaId inválido");
    expect(() => sucursalId("")).toThrow("SucursalId inválido");
    expect(() => invitacionId("")).toThrow("InvitacionId inválido");
    expect(() => adminPlataformaId("")).toThrow("AdminPlataformaId inválido");
    expect(sucursalId("suc_1")).toBe("suc_1");
  });

  it("esTextoDeIdentificador no deja pasar texto con espacios en los extremos", () => {
    expect(esTextoDeIdentificador("a b")).toBe(true);
    expect(esTextoDeIdentificador("\tab")).toBe(false);
  });

  it("no mezcla identificadores de tipos distintos", () => {
    const tenant = tenantId("t1");
    // @ts-expect-error un TenantId no es un EmpresaId
    const empresa: ReturnType<typeof empresaId> = tenant;
    expect(empresa).toBe("t1");
    const invitacion = invitacionId("i1");
    // @ts-expect-error un InvitacionId no es un PersonaId
    const persona: ReturnType<typeof personaId> = invitacion;
    expect(persona).toBe("i1");
    const admin = adminPlataformaId("a1");
    // @ts-expect-error un administrador de plataforma no es una persona de empresa
    const comoPersona: ReturnType<typeof personaId> = admin;
    expect(comoPersona).toBe("a1");
    const persona2 = personaId("p1");
    // @ts-expect-error y una persona de empresa no es un administrador de plataforma
    const comoAdmin: ReturnType<typeof adminPlataformaId> = persona2;
    expect(comoAdmin).toBe("p1");
  });
});
