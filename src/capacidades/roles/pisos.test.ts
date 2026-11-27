import { describe, expect, it } from "vitest";
import {
  accionesConPiso,
  accionesObligatorias,
  accionesReservadasAlGerente,
  TIPOS_DE_PISO,
  type PisosDeAcciones,
} from "./pisos";

const PISOS: PisosDeAcciones = {
  "cajas.crear": "SOLO_GERENTE",
  "permisos.ver_propios": "TODOS_LOS_ROLES",
  "certificados.gestionar": "SOLO_GERENTE",
  "gerencia.ver_traspaso": "TODOS_LOS_ROLES",
};

describe("pisos", () => {
  it("hay dos tipos de piso, y solo esos", () => {
    expect([...TIPOS_DE_PISO]).toEqual(["SOLO_GERENTE", "TODOS_LOS_ROLES"]);
  });

  it("las acciones de cada tipo salen ordenadas y sin mezclarse", () => {
    expect(accionesReservadasAlGerente(PISOS)).toEqual(["cajas.crear", "certificados.gestionar"]);
    expect(accionesObligatorias(PISOS)).toEqual(["gerencia.ver_traspaso", "permisos.ver_propios"]);
    expect(accionesConPiso(PISOS, "SOLO_GERENTE")).toEqual(accionesReservadasAlGerente(PISOS));
  });

  it("sin pisos no hay acciones de ningún tipo", () => {
    expect(accionesObligatorias({})).toEqual([]);
    expect(accionesReservadasAlGerente({})).toEqual([]);
  });
});
