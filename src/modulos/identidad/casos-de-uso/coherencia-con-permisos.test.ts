import { describe, expect, it } from "vitest";
import { PERMISOS_DE_EMPRESA } from "../../../capacidades/permisos/empresa";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../../capacidades/permisos/roles";
import { empresaId, personaId } from "../../../primitivas/identificadores/marca";
import { decidirApagado, type Membresia } from "../dominio/membresia";
import { DECLARACIONES } from "./declaraciones";

/**
 * P4: el dominio de identidad tiene su propia definición de "admin" (el que no se puede dejar sin
 * reemplazo: `ULTIMO_ADMIN`). Tiene que coincidir con la matriz de permisos: una empresa nunca puede
 * quedar sin nadie que gestione usuarios.
 */

const ACCIONES_DE_USUARIOS = Object.values(DECLARACIONES).flatMap((d) =>
  "accion" in d ? [d.accion] : [],
);

/** ¿El rol puede TODAS las acciones de gestión de usuarios? */
const gestionaUsuarios = (rol: RolDeEmpresa): boolean =>
  ACCIONES_DE_USUARIOS.every((accion) => PERMISOS_DE_EMPRESA[accion].some((r) => r === rol));

const unico = (rol: RolDeEmpresa): Membresia => ({
  empresaId: empresaId("e-1"),
  personaId: personaId(`p-${rol}`),
  rol,
  activo: true,
  version: 1,
});

describe("los roles que cuentan como admin para ULTIMO_ADMIN son los que gestionan usuarios", () => {
  it("las acciones de gestión de usuarios son las tres declaradas por los casos de uso", () => {
    expect([...ACCIONES_DE_USUARIOS].sort()).toEqual([
      "usuarios.apagar",
      "usuarios.invitar",
      "usuarios.reenviar_invitacion",
    ]);
  });

  it("cada acción de usuarios la pueden exactamente los mismos roles (no hay un rol a medias)", () => {
    for (const rol of ROLES_DE_EMPRESA) {
      const cuantas = ACCIONES_DE_USUARIOS.filter((a) =>
        PERMISOS_DE_EMPRESA[a].some((r) => r === rol),
      ).length;
      expect([0, ACCIONES_DE_USUARIOS.length], rol).toContain(cuantas);
    }
  });

  for (const rol of ROLES_DE_EMPRESA.filter((r) => r !== "GERENTE")) {
    it(`${rol}: apagarlo siendo el único activo da ULTIMO_ADMIN ⇔ puede gestionar usuarios`, () => {
      const objetivo = unico(rol);
      const decision = decidirApagado(objetivo, [objetivo]);
      expect(decision.ok === false && decision.error === "ULTIMO_ADMIN").toBe(
        gestionaUsuarios(rol),
      );
    });
  }

  it("el gerente gestiona usuarios (y el dominio no deja apagarlo)", () => {
    expect(gestionaUsuarios("GERENTE")).toBe(true);
    const gerente = unico("GERENTE");
    expect(decidirApagado(gerente, [gerente])).toEqual({ ok: false, error: "ES_EL_GERENTE" });
  });
});
