import { describe, expect, it } from "vitest";
import { estadoDeModulos } from "./activos";
import { CATALOGO_DE_MODULOS, EFECTOS_DE_ACCION, type EfectoDeAccion } from "./catalogo";

/**
 * El catálogo comercial real, fijado a propósito: agregar o cambiar un módulo o una acción obliga a
 * actualizar esta prueba en el mismo cambio (y a pensar su matriz, sus cruces y su ficha).
 */
describe("el catálogo comercial de módulos", () => {
  it("tiene cinco módulos: administracion (obligatorio y disponible) y facturacion, catalogo, carta y stock (en desarrollo)", () => {
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
          "comprobantes.ver": { capacidad: null, efecto: "LECTURA" },
          "comprobantes.emitir_manual": { capacidad: null, efecto: "CREA_AMPLIA" },
          "notas_de_credito.emitir": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "comprobantes.descartar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "comprobantes.reintentar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "series.resincronizar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "puntos_de_venta.cambiar_ambiente": { capacidad: null, efecto: "CREA_AMPLIA" },
          "certificados.gestionar": { capacidad: null, efecto: "CREA_AMPLIA" },
        },
      },
      catalogo: {
        estado: "en_desarrollo",
        obligatorio: false,
        requiere: ["administracion"],
        usaSiExiste: [],
        datosRequeridos: [],
        implementadoPor: ["modulos/catalogo"],
        acciones: {
          "productos.ver": { capacidad: null, efecto: "LECTURA" },
          "productos.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "productos.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "productos.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "productos.cambiar_precio": { capacidad: null, efecto: "CREA_AMPLIA" },
          "productos.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "productos.asignar_emisor": { capacidad: null, efecto: "CREA_AMPLIA" },
          "opciones.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "categorias.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "categorias.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "categorias.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "categorias.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "variantes.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "opciones.asignar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "grupos_de_precio.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "grupos_de_precio.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "grupos_de_precio.asignar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "grupos_de_precio.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "grupos_de_precio.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "combos.editar_contenido": { capacidad: null, efecto: "CREA_AMPLIA" },
        },
      },
      carta: {
        estado: "en_desarrollo",
        obligatorio: false,
        requiere: ["catalogo"],
        usaSiExiste: [],
        datosRequeridos: [],
        implementadoPor: ["modulos/catalogo"],
        acciones: {
          "cartas.ver": { capacidad: null, efecto: "LECTURA" },
          "cartas.marcar_disponibilidad": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cartas.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cartas.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cartas.publicar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cartas.retirar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "cartas.publicar_en_linea": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cartas.renovar_enlace": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cartas.retirar_de_linea": { capacidad: null, efecto: "COMPLETA_CIERRA" },
        },
      },
      stock: {
        estado: "en_desarrollo",
        obligatorio: false,
        requiere: ["catalogo"],
        usaSiExiste: [],
        datosRequeridos: [],
        implementadoPor: ["modulos/stock"],
        acciones: {
          "stock.ver": { capacidad: null, efecto: "LECTURA" },
          "stock.verificar_saldos": { capacidad: null, efecto: "LECTURA" },
          "stock.registrar_entrada": { capacidad: null, efecto: "CREA_AMPLIA" },
          "stock.registrar_salida": { capacidad: null, efecto: "CREA_AMPLIA" },
          "stock.transferir": { capacidad: null, efecto: "CREA_AMPLIA" },
          "stock.ajustar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "stock.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "depositos.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "depositos.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "depositos.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "depositos.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "depositos.asignar_emisor": { capacidad: null, efecto: "CREA_AMPLIA" },
          "articulos.controlar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "articulos.dejar_de_controlar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "recetas.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "conteos.abrir": { capacidad: null, efecto: "CREA_AMPLIA" },
          "conteos.registrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "conteos.aplicar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "conteos.cancelar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
        },
      },
    });
  });

  it("catalogo y carta los implementa la misma carpeta y stock otra: dos carpetas para tres módulos", () => {
    const carpetas = ["catalogo", "carta", "stock"].map(
      (m) => CATALOGO_DE_MODULOS[m as "catalogo" | "carta" | "stock"].implementadoPor,
    );
    expect(carpetas).toEqual([["modulos/catalogo"], ["modulos/catalogo"], ["modulos/stock"]]);
  });

  it("el catálogo tiene 48 acciones nuevas de catálogo, carta y stock: 20 + 9 + 19, sin repetir ninguna", () => {
    const cuantas = (m: "catalogo" | "carta" | "stock") =>
      Object.keys(CATALOGO_DE_MODULOS[m].acciones).length;
    expect([cuantas("catalogo"), cuantas("carta"), cuantas("stock")]).toEqual([20, 9, 19]);
    const todas = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    // 18 de administración, 9 de facturación (2 de H7, 6 de F5 y 1 de F7) y 48 de catálogo, carta y stock.
    expect(todas).toHaveLength(18 + 9 + 48);
    expect(new Set(todas).size).toBe(todas.length);
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

  it("catalogo, carta y stock nacen en desarrollo: no se activan ni aunque se activen todos y el plan los incluya (el cierre es T12)", () => {
    const todos = ["catalogo", "carta", "stock"];
    const estado = estadoDeModulos(CATALOGO_DE_MODULOS, todos, todos);
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
 *  - Facturación F5 (§C de la facturación): emitir a mano crea un cargo nuevo (CREA_AMPLIA, no en solo lectura);
 *    la nota de crédito, descartar, reintentar y resincronizar cierran lo existente; cambiar el ambiente de un
 *    punto de venta habilita a emitir con valor fiscal: CREA_AMPLIA.
 *  - Catálogo, carta y stock (§C de catalogo-y-stock): desactivar, retirar, anular, aplicar o cancelar
 *    un conteo CIERRAN algo iniciado; registrar un conteo completa uno ya abierto, así que también.
 *    Cambiar un precio, publicar, mover stock, controlar un artículo o asignar un emisor AMPLÍAN.
 *  - CE0 (§7.2): editar variantes, asignar elecciones, crear, editar, asignar y reactivar un grupo de
 *    precio y editar el contenido de un combo AMPLÍAN; desactivar un grupo de precio CIERRA.
 */
const EFECTOS_DE_EMPRESA = {
  LECTURA: [
    "cartas.ver",
    "comprobantes.ver",
    "gerencia.ver_traspaso",
    "modulos.ver",
    "permisos.ver_propios",
    "productos.ver",
    "stock.ver",
    "stock.verificar_saldos",
    "sucursales.ver",
    "usuarios.ver",
  ],
  CREA_AMPLIA: [
    "articulos.controlar",
    "cartas.crear",
    "cartas.editar",
    "cartas.marcar_disponibilidad",
    "cartas.publicar",
    "cartas.publicar_en_linea",
    "cartas.renovar_enlace",
    "categorias.crear",
    "categorias.editar",
    "categorias.reactivar",
    "certificados.gestionar",
    "combos.editar_contenido",
    "comprobantes.emitir_manual",
    "conteos.abrir",
    "depositos.asignar_emisor",
    "depositos.crear",
    "depositos.editar",
    "depositos.reactivar",
    "gerencia.proponer_traspaso",
    "grupos_de_precio.asignar",
    "grupos_de_precio.crear",
    "grupos_de_precio.editar",
    "grupos_de_precio.reactivar",
    "opciones.asignar",
    "opciones.editar",
    "productos.asignar_emisor",
    "productos.cambiar_precio",
    "productos.crear",
    "productos.editar",
    "productos.reactivar",
    "puntos_de_venta.cambiar_ambiente",
    "recetas.editar",
    "stock.ajustar",
    "stock.registrar_entrada",
    "stock.registrar_salida",
    "stock.transferir",
    "sucursales.crear",
    "sucursales.editar",
    "sucursales.reactivar",
    "usuarios.asignar_sucursales",
    "usuarios.invitar",
    "variantes.editar",
  ],
  COMPLETA_CIERRA: [
    "articulos.dejar_de_controlar",
    "cartas.retirar",
    "cartas.retirar_de_linea",
    "categorias.desactivar",
    "comprobantes.descartar",
    "comprobantes.emitir",
    "comprobantes.reintentar",
    "conteos.aplicar",
    "conteos.cancelar",
    "conteos.registrar",
    "depositos.desactivar",
    "gerencia.aceptar_traspaso",
    "gerencia.cancelar_traspaso",
    "gerencia.rechazar_traspaso",
    "grupos_de_precio.desactivar",
    "notas_de_credito.emitir",
    "productos.desactivar",
    "series.resincronizar",
    "stock.anular",
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
