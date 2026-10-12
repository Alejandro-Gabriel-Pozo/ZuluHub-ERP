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
        implementadoPor: ["modulos/identidad", "modulos/empresas"],
        acciones: {
          "usuarios.invitar": { capacidad: null },
          "usuarios.reenviar_invitacion": { capacidad: null },
          "usuarios.apagar": { capacidad: null },
          "usuarios.ver": { capacidad: null },
          "usuarios.asignar_sucursales": { capacidad: null },
          "usuarios.revocar_invitacion": { capacidad: null },
          "sucursales.ver": { capacidad: null },
          "sucursales.crear": { capacidad: null },
          "sucursales.editar": { capacidad: null },
          "sucursales.desactivar": { capacidad: null },
          "sucursales.reactivar": { capacidad: null },
          "gerencia.proponer_traspaso": { capacidad: null },
          "gerencia.cancelar_traspaso": { capacidad: null },
          "gerencia.ver_traspaso": { capacidad: null },
          "gerencia.aceptar_traspaso": { capacidad: null },
          "gerencia.rechazar_traspaso": { capacidad: null },
          "modulos.ver": { capacidad: null },
          "permisos.ver_propios": { capacidad: null },
        },
      },
    });
  });

  it("administracion está activo sin guardar nada por empresa", () => {
    expect([...modulosActivosDe(CATALOGO_DE_MODULOS, [])]).toEqual(["administracion"]);
  });
});
