import { describe, expect, it } from "vitest";
import {
  ROLES_DE_EMPRESA,
  ROLES_DE_LA_MEMBRESIA,
  rolParaMostrar,
  type RolDeLaMembresia,
} from "./roles";

describe("roles de la membresía (T4 de H4b)", () => {
  it("los roles de la membresía son los tres base y PROPIO, en ese orden", () => {
    expect(ROLES_DE_LA_MEMBRESIA).toEqual([...ROLES_DE_EMPRESA, "PROPIO"]);
  });

  it.each(ROLES_DE_EMPRESA)("rolParaMostrar deja pasar el rol base %s", (rol) => {
    expect(rolParaMostrar(rol)).toBe(rol);
  });

  it("un rol propio no se muestra todavía: falla en voz alta en vez de parecer otro rol", () => {
    const propio: RolDeLaMembresia = "PROPIO";
    expect(() => rolParaMostrar(propio)).toThrow(RangeError);
    expect(() => rolParaMostrar(propio)).toThrow("el rol propio todavía no se muestra");
  });
});
