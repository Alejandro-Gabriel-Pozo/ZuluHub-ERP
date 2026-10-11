import { describe, expect, it } from "vitest";
import { empresaId, esTextoDeIdentificador, invitacionId, personaId, tenantId } from "./marca";

describe("identificadores con marca", () => {
  it("acepta texto no vacío", () => {
    expect(empresaId("emp_1")).toBe("emp_1");
    expect(tenantId("ten_1")).toBe("ten_1");
    expect(personaId("per_1")).toBe("per_1");
    expect(invitacionId("inv_1")).toBe("inv_1");
  });

  it("rechaza vacío y espacios en los extremos", () => {
    expect(() => empresaId("")).toThrow(RangeError);
    expect(() => tenantId(" x")).toThrow(RangeError);
    expect(() => personaId("x ")).toThrow(RangeError);
    expect(() => invitacionId("")).toThrow(RangeError);
    expect(() => invitacionId(" x")).toThrow(RangeError);
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
  });
});
