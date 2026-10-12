import { describe, expect, it } from "vitest";
import { estadoDeModulos } from "./activos";
import { CATALOGO_DE_MODULOS, EFECTOS_DE_ACCION, type EfectoDeAccion } from "./catalogo";

/**
 * El catálogo comercial real, fijado a propósito: agregar o cambiar un módulo o una acción obliga a
 * actualizar esta prueba en el mismo cambio (y a pensar su matriz, sus cruces y su ficha).
 */
describe("el catálogo comercial de módulos", () => {
  it("tiene dos módulos: administracion (obligatorio y disponible) y facturacion (en desarrollo)", () => {
    expect(CATALOGO_DE_MODULOS).toEqual({
      administracion: {
        estado: "disponible",
        obligatorio: true,
        requiere: [],
        usaSiExiste: [],
        datosRequeridos: [],
        implementadoPor: ["modulos/identidad", "modulos/empresas"],
        acciones: {
          "usuarios.invitar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "usuarios.reenviar_invitacion": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "usuarios.apagar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "usuarios.ver": { capacidad: null, efecto: "LECTURA" },
          "usuarios.asignar_sucursales": { capacidad: null, efecto: "CREA_AMPLIA" },
          "usuarios.revocar_invitacion": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "sucursales.ver": { capacidad: null, efecto: "LECTURA" },
          "sucursales.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "sucursales.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "sucursales.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "sucursales.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "gerencia.proponer_traspaso": { capacidad: null, efecto: "CREA_AMPLIA" },
          "gerencia.cancelar_traspaso": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "gerencia.ver_traspaso": { capacidad: null, efecto: "LECTURA" },
          "gerencia.aceptar_traspaso": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "gerencia.rechazar_traspaso": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "modulos.ver": { capacidad: null, efecto: "LECTURA" },
          "permisos.ver_propios": { capacidad: null, efecto: "LECTURA" },
        },
      },
      facturacion: {
        estado: "en_desarrollo",
        obligatorio: false,
        requiere: ["administracion"],
        usaSiExiste: [],
        datosRequeridos: ["emisor_principal.datos_fiscales_confirmados", "punto_de_venta.activo"],
        implementadoPor: ["modulos/fiscal"],
        acciones: {
          "comprobantes.emitir": { capacidad: null, efecto: "COMPLETA_CIERRA" },
        },
      },
    });
  });

  it("administracion está activo sin guardar nada por empresa", () => {
    expect([...estadoDeModulos(CATALOGO_DE_MODULOS, [], []).modulosActivos]).toEqual([
      "administracion",
    ]);
  });

  it("facturacion no se puede activar mientras esté en desarrollo, ni aunque el plan la incluya", () => {
    const estado = estadoDeModulos(CATALOGO_DE_MODULOS, ["facturacion"], ["facturacion"]);
    expect([...estado.modulosActivos]).toEqual(["administracion"]);
    expect([...estado.modulosEnSoloLectura]).toEqual([]);
  });
});

/** Las acciones de cada efecto, ordenadas, leídas del catálogo. */
function accionesPorEfecto(
  catalogo: Readonly<
    Record<string, Readonly<{ acciones: Readonly<Record<string, { efecto: EfectoDeAccion }>> }>>
  >,
): Record<EfectoDeAccion, string[]> {
  const todas = Object.values(catalogo).flatMap((m) => Object.entries(m.acciones));
  const de = (efecto: EfectoDeAccion) =>
    todas
      .filter(([, definicion]) => definicion.efecto === efecto)
      .map(([nombre]) => nombre)
      .sort();
  return {
    LECTURA: de("LECTURA"),
    CREA_AMPLIA: de("CREA_AMPLIA"),
    COMPLETA_CIERRA: de("COMPLETA_CIERRA"),
  };
}

/**
 * La clasificación de cada acción de empresa para la SOLO LECTURA (corrección 16, reglas
 * transversales §7.9), fijada a propósito: una acción nueva, o una que cambia de efecto, obliga a
 * tocar esta tabla en el mismo cambio. Los criterios no obvios:
 *  - Apagar, revocar y desactivar RESTRINGEN: nunca pueden quedar bloqueados por una baja de plan.
 *  - Reenviar una invitación retoma una ya iniciada (la anterior queda sin efecto): no suma gente.
 *  - Cancelar, aceptar y rechazar un traspaso CIERRAN un proceso iniciado.
 *  - Reactivar una sucursal vuelve a consumir capacidad del plan: CREA_AMPLIA.
 *  - Editar una sucursal y asignar sucursales a una persona cambian o amplían lo que hay: CREA_AMPLIA.
 *  - Emitir un comprobante completa algo ya vendido o cobrado (§C de H7): COMPLETA_CIERRA.
 */
const EFECTOS_DE_EMPRESA = {
  LECTURA: [
    "gerencia.ver_traspaso",
    "modulos.ver",
    "permisos.ver_propios",
    "sucursales.ver",
    "usuarios.ver",
  ],
  CREA_AMPLIA: [
    "gerencia.proponer_traspaso",
    "sucursales.crear",
    "sucursales.editar",
    "sucursales.reactivar",
    "usuarios.asignar_sucursales",
    "usuarios.invitar",
  ],
  COMPLETA_CIERRA: [
    "comprobantes.emitir",
    "gerencia.aceptar_traspaso",
    "gerencia.cancelar_traspaso",
    "gerencia.rechazar_traspaso",
    "sucursales.desactivar",
    "usuarios.apagar",
    "usuarios.reenviar_invitacion",
    "usuarios.revocar_invitacion",
  ],
} as const;

describe("el efecto de cada acción (solo lectura, corrección 16)", () => {
  it("los efectos posibles son exactamente tres", () => {
    expect(EFECTOS_DE_ACCION).toEqual(["LECTURA", "CREA_AMPLIA", "COMPLETA_CIERRA"]);
  });

  it("tabla de efectos: qué acción de empresa mira, crea o amplía, o completa y cierra", () => {
    expect(accionesPorEfecto(CATALOGO_DE_MODULOS)).toEqual(EFECTOS_DE_EMPRESA);
  });

  it("toda acción tiene exactamente un efecto, y ninguna queda sin clasificar", () => {
    const clasificadas = Object.values(EFECTOS_DE_EMPRESA).flat().sort();
    const delCatalogo = Object.values(CATALOGO_DE_MODULOS)
      .flatMap((m) => Object.keys(m.acciones))
      .sort();
    expect(clasificadas).toEqual(delCatalogo);
    expect(new Set(clasificadas).size).toBe(delCatalogo.length);
  });

  it("accionesPorEfecto separa las acciones de un catálogo de prueba por su efecto", () => {
    expect(
      accionesPorEfecto({
        m: {
          acciones: {
            "z.crear": { efecto: "CREA_AMPLIA" },
            "a.crear": { efecto: "CREA_AMPLIA" },
            "m.ver": { efecto: "LECTURA" },
          },
        },
        n: { acciones: { "n.cerrar": { efecto: "COMPLETA_CIERRA" } } },
      }),
    ).toEqual({
      LECTURA: ["m.ver"],
      CREA_AMPLIA: ["a.crear", "z.crear"],
      COMPLETA_CIERRA: ["n.cerrar"],
    });
  });
});
