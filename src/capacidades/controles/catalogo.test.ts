import { describe, expect, it } from "vitest";
import {
  CATALOGO_DE_CONTROLES,
  FORMA_DE_CLAVE_DE_CONTROL,
  type CatalogoDeControles,
} from "./catalogo";

describe("FORMA_DE_CLAVE_DE_CONTROL", () => {
  it.each([
    "caja.cierre_con_diferencia",
    "stock.existencia_negativa",
    "a.b",
    "reservas.capacidad_excedida",
  ])("acepta %s", (clave) => {
    expect(FORMA_DE_CLAVE_DE_CONTROL.test(clave)).toBe(true);
  });

  it.each([
    "",
    "caja",
    "caja.",
    ".cierre",
    "Caja.cierre",
    "caja.Cierre",
    "caja.cierre-con-diferencia",
    "caja.cierre.con_diferencia",
    "caja2.cierre",
    "caja.cierre2",
    "caja.cierre\n",
    " caja.cierre",
    "caja_x.cierre",
  ])("rechaza %j", (clave) => {
    expect(FORMA_DE_CLAVE_DE_CONTROL.test(clave)).toBe(false);
  });
});

describe("CATALOGO_DE_CONTROLES", () => {
  it("cada clave tiene la forma que la base exige (si no, su nivel nunca podría guardarse)", () => {
    for (const clave of Object.keys(CATALOGO_DE_CONTROLES)) {
      expect(FORMA_DE_CLAVE_DE_CONTROL.test(clave), clave).toBe(true);
    }
  });

  it("cada control dice qué vigila", () => {
    const catalogo: CatalogoDeControles = CATALOGO_DE_CONTROLES;
    for (const [clave, definicion] of Object.entries(catalogo)) {
      expect(definicion.descripcion.trim().length, clave).toBeGreaterThan(0);
    }
  });
});
