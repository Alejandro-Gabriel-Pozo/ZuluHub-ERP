import { describe, expect, it } from "vitest";
import { modulosActivosDe } from "./activos";
import { CATALOGO_DE_MODULOS } from "./catalogo";

/**
 * El catálogo comercial real, fijado a propósito: agregar o cambiar un módulo o una acción obliga a
 * actualizar esta prueba en el mismo cambio (y a pensar su matriz, sus cruces y su ficha).
 */
describe("el catálogo comercial de módulos", () => {
  it("tiene un solo módulo real: administracion, obligatorio y disponible", () => {
    expect(CATALOGO_DE_MODULOS).toEqual({
      administracion: {
        estado: "disponible",
        obligatorio: true,
        requiere: [],
        usaSiExiste: [],
        datosRequeridos: [],
        implementadoPor: ["modulos/identidad"],
        acciones: {
          "usuarios.invitar": { capacidad: null },
          "usuarios.reenviar_invitacion": { capacidad: null },
          "usuarios.apagar": { capacidad: null },
        },
      },
    });
  });

  it("administracion está activo sin guardar nada por empresa", () => {
    expect([...modulosActivosDe(CATALOGO_DE_MODULOS, [])]).toEqual(["administracion"]);
  });
});
