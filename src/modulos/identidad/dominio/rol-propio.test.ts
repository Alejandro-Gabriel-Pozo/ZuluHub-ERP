import { describe, expect, it } from "vitest";
import {
  decidirAltaDeRol,
  decidirArchivadoDeRol,
  decidirEdicionDeRol,
  decidirReactivacionDeRol,
  decidirTopeTecnicoDeRoles,
  MAXIMO_DE_ROLES_PROPIOS_ACTIVOS_POR_EMPRESA,
  type RolParaDecidir,
} from "./rol-propio";

const rol = (
  id: string,
  nombre: string,
  activo = true,
  acciones: string[] = [],
): RolParaDecidir => ({
  id,
  nombre,
  activo,
  acciones,
});

describe("alta de un rol propio", () => {
  it("sin rol con ese id ni con ese nombre: se crea", () => {
    expect(decidirAltaDeRol({ nombreClave: "cajero", porId: null, porNombre: null })).toEqual({
      ok: true,
      valor: { tipo: "CREAR" },
    });
  });

  it("el mismo id con el mismo nombre (sin distinguir mayúsculas) es el mismo pedido repetido: ya existía", () => {
    expect(
      decidirAltaDeRol({ nombreClave: "cajero", porId: rol("r1", "CAJERO"), porNombre: null }),
    ).toEqual({ ok: true, valor: { tipo: "YA_EXISTIA", rolId: "r1" } });
  });

  it("el mismo id con OTRO nombre: el id está en uso", () => {
    expect(
      decidirAltaDeRol({ nombreClave: "cajero", porId: rol("r1", "Encargado"), porNombre: null }),
    ).toEqual({ ok: false, error: "ID_DE_ROL_EN_USO" });
  });

  it("otro id con un nombre que ya tiene un rol ACTIVO: ya existía (devuelve ese)", () => {
    expect(
      decidirAltaDeRol({ nombreClave: "cajero", porId: null, porNombre: rol("r2", "Cajero") }),
    ).toEqual({ ok: true, valor: { tipo: "YA_EXISTIA", rolId: "r2" } });
  });

  it("otro id con un nombre de un rol ARCHIVADO: se lo reactiva, no se crea otro", () => {
    expect(
      decidirAltaDeRol({
        nombreClave: "cajero",
        porId: null,
        porNombre: rol("r2", "Cajero", false),
      }),
    ).toEqual({ ok: false, error: "ROL_INACTIVO_CON_ESE_NOMBRE" });
  });

  it("el id manda sobre el nombre: con id existente no se mira el rol del mismo nombre", () => {
    expect(
      decidirAltaDeRol({
        nombreClave: "cajero",
        porId: rol("r1", "Cajero"),
        porNombre: rol("r2", "Cajero", false),
      }),
    ).toEqual({ ok: true, valor: { tipo: "YA_EXISTIA", rolId: "r1" } });
  });
});

describe("tope técnico de roles", () => {
  it("el máximo es 100 y con 99 todavía entra uno; con 100 no", () => {
    expect(MAXIMO_DE_ROLES_PROPIOS_ACTIVOS_POR_EMPRESA).toBe(100);
    expect(decidirTopeTecnicoDeRoles(0)).toEqual({ ok: true, valor: null });
    expect(decidirTopeTecnicoDeRoles(99)).toEqual({ ok: true, valor: null });
    expect(decidirTopeTecnicoDeRoles(100)).toEqual({ ok: false, error: "LIMITE_TECNICO_DE_ROLES" });
    expect(decidirTopeTecnicoDeRoles(101)).toEqual({ ok: false, error: "LIMITE_TECNICO_DE_ROLES" });
  });
});

describe("edición de un rol propio", () => {
  const cajero = rol("r1", "Cajero", true, ["a.x", "b.y"]);

  it("un rol que no existe: ROL_NO_ENCONTRADO; archivado: ROL_ARCHIVADO", () => {
    expect(decidirEdicionDeRol({ rol: null, conEseNombre: null })).toEqual({
      ok: false,
      error: "ROL_NO_ENCONTRADO",
    });
    expect(decidirEdicionDeRol({ rol: rol("r1", "Cajero", false), conEseNombre: null })).toEqual({
      ok: false,
      error: "ROL_ARCHIVADO",
    });
  });

  it("sin cambios (mismo nombre, mismas acciones): no escribe nada", () => {
    expect(
      decidirEdicionDeRol({
        rol: cajero,
        nombre: "Cajero",
        conEseNombre: cajero,
        acciones: ["a.x", "b.y"],
      }),
    ).toEqual({ ok: true, valor: { cambiaElNombre: false, cambiaLasAcciones: false } });
    expect(decidirEdicionDeRol({ rol: cajero, conEseNombre: null })).toEqual({
      ok: true,
      valor: { cambiaElNombre: false, cambiaLasAcciones: false },
    });
  });

  it("cambia solo el nombre, solo las acciones, o las dos", () => {
    expect(decidirEdicionDeRol({ rol: cajero, nombre: "Cajera", conEseNombre: null })).toEqual({
      ok: true,
      valor: { cambiaElNombre: true, cambiaLasAcciones: false },
    });
    expect(decidirEdicionDeRol({ rol: cajero, conEseNombre: null, acciones: ["a.x"] })).toEqual({
      ok: true,
      valor: { cambiaElNombre: false, cambiaLasAcciones: true },
    });
    expect(
      decidirEdicionDeRol({
        rol: cajero,
        nombre: "CAJERO",
        conEseNombre: cajero,
        acciones: ["a.x", "b.y", "c.z"],
      }),
    ).toEqual({ ok: true, valor: { cambiaElNombre: true, cambiaLasAcciones: true } });
  });

  it("las mismas acciones pero más largas o en otro orden no son lo mismo", () => {
    expect(
      decidirEdicionDeRol({ rol: cajero, conEseNombre: null, acciones: ["a.x", "b.y", "c.z"] }),
    ).toMatchObject({ ok: true, valor: { cambiaLasAcciones: true } });
    expect(
      decidirEdicionDeRol({ rol: cajero, conEseNombre: null, acciones: ["b.y", "a.x"] }),
    ).toMatchObject({ ok: true, valor: { cambiaLasAcciones: true } });
  });

  it("el mismo largo con UNA acción distinta es un cambio", () => {
    expect(
      decidirEdicionDeRol({ rol: cajero, conEseNombre: null, acciones: ["a.x", "z.z"] }),
    ).toMatchObject({ ok: true, valor: { cambiaLasAcciones: true } });
  });

  it("el nombre de otro rol de la empresa: NOMBRE_DE_ROL_EN_USO; el del propio rol (otra grafía) no", () => {
    expect(
      decidirEdicionDeRol({
        rol: cajero,
        nombre: "Encargado",
        conEseNombre: rol("r2", "Encargado"),
      }),
    ).toEqual({ ok: false, error: "NOMBRE_DE_ROL_EN_USO" });
    expect(
      decidirEdicionDeRol({ rol: cajero, nombre: "CAJERO", conEseNombre: cajero }),
    ).toMatchObject({ ok: true });
  });
});

describe("archivado y reactivación", () => {
  it("archivar: sin rol, NO_ENCONTRADO; archivado, inocuo; con personas activas, ROL_CON_PERSONAS; sin personas, ARCHIVAR", () => {
    expect(decidirArchivadoDeRol(null, 0)).toEqual({ ok: false, error: "ROL_NO_ENCONTRADO" });
    expect(decidirArchivadoDeRol(rol("r1", "A", false), 3)).toEqual({
      ok: true,
      valor: "YA_ARCHIVADO",
    });
    expect(decidirArchivadoDeRol(rol("r1", "A"), 1)).toEqual({
      ok: false,
      error: "ROL_CON_PERSONAS",
    });
    expect(decidirArchivadoDeRol(rol("r1", "A"), 0)).toEqual({ ok: true, valor: "ARCHIVAR" });
  });

  it("reactivar: sin rol, NO_ENCONTRADO; activo, inocuo; archivado, REACTIVAR", () => {
    expect(decidirReactivacionDeRol(null)).toEqual({ ok: false, error: "ROL_NO_ENCONTRADO" });
    expect(decidirReactivacionDeRol(rol("r1", "A"))).toEqual({ ok: true, valor: "YA_ACTIVO" });
    expect(decidirReactivacionDeRol(rol("r1", "A", false))).toEqual({
      ok: true,
      valor: "REACTIVAR",
    });
  });
});
