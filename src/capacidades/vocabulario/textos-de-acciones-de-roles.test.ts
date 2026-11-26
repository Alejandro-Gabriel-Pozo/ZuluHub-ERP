import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import { CATALOGO_DE_TEXTOS } from "./catalogo";
import { TEXTOS_DE_ACCIONES_DE_ROLES } from "./textos-de-acciones-de-roles";
import { claveDelNombreDeLaAccion } from "./nombre-de-la-accion";

/** Todas las acciones del catálogo de módulos, con su id completo. */
const acciones = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
const clavesDeTextos = Object.keys(TEXTOS_DE_ACCIONES_DE_ROLES);

describe("los nombres de las acciones de los roles", () => {
  it("cada acción del catálogo tiene su nombre", () => {
    const sinNombre = acciones.filter((a) => !(claveDelNombreDeLaAccion(a) in CATALOGO_DE_TEXTOS));
    expect(sinNombre).toEqual([]);
  });

  it("ningún nombre es de una acción que no existe", () => {
    const delCatalogo = new Set(acciones.map(claveDelNombreDeLaAccion));
    expect(clavesDeTextos.filter((c) => !delCatalogo.has(c))).toEqual([]);
  });

  it("ningún nombre se repite entre acciones (la persona no distinguiría las casillas)", () => {
    const nombres = Object.values(TEXTOS_DE_ACCIONES_DE_ROLES).map((t) => t.porDefecto);
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it("las órdenes de producción y las recetas dicen lo que el dueño aprobó", () => {
    const t = TEXTOS_DE_ACCIONES_DE_ROLES;
    expect(t["roles.accion.transformaciones.anular"].porDefecto).toBe(
      "Anular una orden de producción",
    );
    expect(t["roles.accion.composiciones.editar"].porDefecto).toBe("Editar las recetas");
  });
});
