import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  adminPlataformaId,
  dominioId,
  empresaId,
  esTextoDeIdentificador,
  invitacionId,
  marcaComercialId,
  personaId,
  planId,
  sucursalId,
  tenantId,
  traspasoId,
  versionDePlanId,
} from "./marca";
import "../../../test/propiedades/configuracion";

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

/** Los cuatro identificadores de marcas y planes (M0): cada uno con su constructor y su nombre. */
const DE_MARCAS_Y_PLANES = [
  ["MarcaComercialId", marcaComercialId],
  ["DominioId", dominioId],
  ["PlanId", planId],
  ["VersionDePlanId", versionDePlanId],
] as const;

describe.each(DE_MARCAS_Y_PLANES)("%s (marcas y planes)", (nombre, crear) => {
  it("acepta texto no vacío y lo devuelve tal cual", () => {
    expect(crear("0b9f2c1e-7a53-4e0a-9c1d-2f6a8d3e4b51")).toBe(
      "0b9f2c1e-7a53-4e0a-9c1d-2f6a8d3e4b51",
    );
    expect(crear("x")).toBe("x");
  });

  it("rechaza vacío y espacios en los extremos, y el error lo nombra", () => {
    for (const malo of ["", " x", "x ", "\tx", "x\n", " "]) {
      expect(() => crear(malo), JSON.stringify(malo)).toThrow(new RangeError(`${nombre} inválido`));
    }
  });

  it("propiedad: acepta exactamente el texto que acepta esTextoDeIdentificador", () => {
    fc.assert(
      fc.property(fc.string(), (texto) => {
        if (esTextoDeIdentificador(texto)) expect(crear(texto)).toBe(texto);
        else expect(() => crear(texto)).toThrow(RangeError);
      }),
    );
  });
});

describe("identificadores de marcas y planes: tipos distintos", () => {
  it("no se mezclan entre sí ni con los de empresa", () => {
    const marca = marcaComercialId("m1");
    // @ts-expect-error una marca comercial no es un dominio
    const comoDominio: ReturnType<typeof dominioId> = marca;
    // @ts-expect-error una marca comercial no es un tenant
    const comoTenant: ReturnType<typeof tenantId> = marca;
    const plan = planId("p1");
    // @ts-expect-error un plan no es una versión de plan
    const comoVersion: ReturnType<typeof versionDePlanId> = plan;
    const version = versionDePlanId("v1");
    // @ts-expect-error y una versión de plan no es un plan
    const comoPlan: ReturnType<typeof planId> = version;
    // @ts-expect-error un dominio no es una empresa
    const comoEmpresa: ReturnType<typeof empresaId> = dominioId("d1");
    expect([comoDominio, comoTenant, comoVersion, comoPlan, comoEmpresa]).toEqual([
      "m1",
      "m1",
      "p1",
      "v1",
      "d1",
    ]);
  });
});

describe("TraspasoId (traspaso de gerencia)", () => {
  it("acepta texto no vacío y lo devuelve tal cual", () => {
    expect(traspasoId("0b9f2c1e-7a53-4e0a-9c1d-2f6a8d3e4b51")).toBe(
      "0b9f2c1e-7a53-4e0a-9c1d-2f6a8d3e4b51",
    );
  });

  it("rechaza vacío y espacios en los extremos, y el error lo nombra", () => {
    for (const malo of ["", " x", "x ", "\tx", "x\n", " "]) {
      expect(() => traspasoId(malo), JSON.stringify(malo)).toThrow(
        new RangeError("TraspasoId inválido"),
      );
    }
  });

  it("no se mezcla con otros identificadores", () => {
    const traspaso = traspasoId("t1");
    // @ts-expect-error un traspaso no es una invitación
    const comoInvitacion: ReturnType<typeof invitacionId> = traspaso;
    // @ts-expect-error y una invitación no es un traspaso
    const comoTraspaso: ReturnType<typeof traspasoId> = invitacionId("i1");
    expect([comoInvitacion, comoTraspaso]).toEqual(["t1", "i1"]);
  });
});
