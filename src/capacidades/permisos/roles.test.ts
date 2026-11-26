import { describe, expect, it } from "vitest";
import {
  ROLES_DE_EMPRESA,
  ROLES_DE_LA_MEMBRESIA,
  rolBaseParaMostrar,
  type RolDeLaMembresia,
} from "./roles";

describe("roles de la membresía (T4 de H4b)", () => {
  it("los roles de la membresía son los tres base y PROPIO, en ese orden", () => {
    expect(ROLES_DE_LA_MEMBRESIA).toEqual([...ROLES_DE_EMPRESA, "PROPIO"]);
  });

  it.each(ROLES_DE_EMPRESA)("rolBaseParaMostrar deja pasar el rol base %s", (rol) => {
    expect(rolBaseParaMostrar(rol)).toBe(rol);
  });

  it("un rol propio no tiene texto de marca: devuelve null y no parece otro rol", () => {
    const propio: RolDeLaMembresia = "PROPIO";
    expect(rolBaseParaMostrar(propio)).toBeNull();
  });
});
