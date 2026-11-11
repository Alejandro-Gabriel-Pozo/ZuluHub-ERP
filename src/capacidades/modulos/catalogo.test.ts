import { describe, expect, it } from "vitest";
import { estadoDeModulos } from "./activos";
import { CATALOGO_DE_MODULOS, EFECTOS_DE_ACCION, type EfectoDeAccion } from "./catalogo";

/**
 * El catálogo comercial real, fijado a propósito: agregar o cambiar un módulo o una acción obliga a
 * actualizar esta prueba en el mismo cambio (y a pensar su matriz, sus cruces y su ficha).
 */
describe("el catálogo comercial de módulos", () => {
  it("ninguna acción declara una capacidad de sucursal: `accionesPermitidas` lo da por cierto (si algún día una la exige, hay que darle la sucursal a esa función)", () => {
    const conCapacidad = Object.entries(CATALOGO_DE_MODULOS).flatMap(([modulo, definicion]) =>
      Object.entries(definicion.acciones)
        .filter(([, accion]) => accion.capacidad !== null)
        .map(([accion]) => `${modulo}/${accion}`),
    );
    expect(conCapacidad).toEqual([]);
  });

  it("tiene once módulos: administracion (obligatorio y disponible), facturacion (disponible, sin activar para nadie), catalogo, carta, caja, ventas, compras (disponible desde E9-T12), cierre (disponible desde E3b), stock (disponible desde E5) y clientes (disponible y obligatorio desde E9-T4) y producción (en desarrollo hasta E6-T9)", () => {
    expect(CATALOGO_DE_MODULOS).toEqual({
      administracion: {
        estado: "disponible",
        obligatorio: true,
        requiere: [],
        usaSiExiste: [],
        datosRequeridos: [],
        implementadoPor: ["modulos/identidad", "modulos/empresas", "modulos/fiscal"],
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
          "datos_fiscales.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "datos_fiscales.confirmar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "puntos_de_venta.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "puntos_de_venta.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "puntos_de_venta.activar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "puntos_de_venta.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "emisores.confirmar_regla": { capacidad: null, efecto: "CREA_AMPLIA" },
        },
      },
      facturacion: {
        estado: "disponible",
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
          "conjuntos.editar_contenido": { capacidad: null, efecto: "CREA_AMPLIA" },
        },
      },
      vidriera: {
        estado: "en_desarrollo",
        obligatorio: false,
        requiere: ["catalogo"],
        usaSiExiste: [],
        datosRequeridos: [],
        implementadoPor: ["modulos/catalogo"],
        acciones: {
          "vidrieras.ver": { capacidad: null, efecto: "LECTURA" },
          "vidrieras.marcar_disponibilidad": { capacidad: null, efecto: "CREA_AMPLIA" },
          "vidrieras.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "vidrieras.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "vidrieras.publicar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "vidrieras.retirar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "vidrieras.publicar_en_linea": { capacidad: null, efecto: "CREA_AMPLIA" },
          "vidrieras.renovar_enlace": { capacidad: null, efecto: "CREA_AMPLIA" },
          "vidrieras.retirar_de_linea": { capacidad: null, efecto: "COMPLETA_CIERRA" },
        },
      },
      stock: {
        estado: "disponible",
        obligatorio: false,
        requiere: ["catalogo"],
        usaSiExiste: [],
        datosRequeridos: [],
        implementadoPor: ["modulos/stock"],
        acciones: {
          "stock.ver": { capacidad: null, efecto: "LECTURA" },
          "stock.verificar_saldos": { capacidad: null, efecto: "LECTURA" },
          "costos.ver": { capacidad: null, efecto: "LECTURA" },
          "stock.registrar_entrada": { capacidad: null, efecto: "CREA_AMPLIA" },
          "stock.registrar_salida": { capacidad: null, efecto: "CREA_AMPLIA" },
          "stock.transferir": { capacidad: null, efecto: "CREA_AMPLIA" },
          "stock.ajustar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "stock.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "depositos.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "depositos.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "depositos.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "depositos.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "articulos.controlar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "articulos.dejar_de_controlar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "composiciones.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "conteos.abrir": { capacidad: null, efecto: "CREA_AMPLIA" },
          "conteos.registrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "conteos.aplicar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "conteos.cancelar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "lotes.ver": { capacidad: null, efecto: "LECTURA" },
          "lotes.controlar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "lotes.dejar_de_controlar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "lotes.cambiar_calidad": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "lotes.corregir": { capacidad: null, efecto: "CREA_AMPLIA" },
          "lotes.reasignar": { capacidad: null, efecto: "CREA_AMPLIA" },
        },
      },
      caja: {
        estado: "en_desarrollo",
        obligatorio: false,
        requiere: ["administracion"],
        usaSiExiste: ["facturacion"],
        datosRequeridos: [],
        implementadoPor: ["modulos/caja"],
        acciones: {
          "cajas.ver": { capacidad: null, efecto: "LECTURA" },
          "cajas.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cajas.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cajas.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cajas.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "medios_de_pago.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "medios_de_pago.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "medios_de_pago.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "medios_de_pago.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "cuentas_de_cobro.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cuentas_de_cobro.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cuentas_de_cobro.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cuentas_de_cobro.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "sesiones_caja.abrir": { capacidad: null, efecto: "CREA_AMPLIA" },
          "sesiones_caja.iniciar_cierre": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "sesiones_caja.cancelar_cierre": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "sesiones_caja.cerrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "movimientos_caja.registrar_manual": { capacidad: null, efecto: "CREA_AMPLIA" },
          "movimientos_caja.ajustar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "movimientos_caja.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "movimientos_caja.anular_de_otros": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "cobros.corregir_medio": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "declaraciones_de_total.registrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
        },
      },
      cierre: {
        estado: "disponible",
        obligatorio: false,
        requiere: ["administracion"],
        usaSiExiste: [],
        datosRequeridos: [],
        implementadoPor: ["modulos/cierre"],
        acciones: {
          "jornadas.ver": { capacidad: null, efecto: "LECTURA" },
          "jornadas.iniciar_auditoria": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "jornadas.cancelar_auditoria": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "jornadas.cerrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
        },
      },
      ventas: {
        estado: "en_desarrollo",
        obligatorio: false,
        requiere: ["administracion", "catalogo", "caja"],
        usaSiExiste: ["facturacion", "stock"],
        datosRequeridos: [],
        implementadoPor: ["modulos/ventas"],
        acciones: {
          "ventas.ver": { capacidad: null, efecto: "LECTURA" },
          "cuentas.abrir": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cuentas.agregar_linea": { capacidad: null, efecto: "CREA_AMPLIA" },
          "cuentas.cerrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "cuentas.anular_linea": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "cuentas.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "tickets.cobrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "tickets.corregir": { capacidad: null, efecto: "COMPLETA_CIERRA" },
        },
      },
      clientes: {
        estado: "disponible",
        obligatorio: true,
        requiere: ["administracion"],
        usaSiExiste: [],
        datosRequeridos: [],
        implementadoPor: ["modulos/clientes"],
        acciones: {
          "partes.ver": { capacidad: null, efecto: "LECTURA" },
          "partes.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "partes.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "partes.cambiar_roles": { capacidad: null, efecto: "CREA_AMPLIA" },
          "partes.vincular_contacto": { capacidad: null, efecto: "CREA_AMPLIA" },
          "partes.desvincular_contacto": { capacidad: null, efecto: "CREA_AMPLIA" },
          "partes.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "partes.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
        },
      },
      compras: {
        estado: "disponible",
        obligatorio: false,
        requiere: ["administracion", "clientes", "catalogo"],
        usaSiExiste: ["stock"],
        datosRequeridos: [],
        implementadoPor: ["modulos/compras"],
        acciones: {
          "proveedores.editar_ficha": { capacidad: null, efecto: "CREA_AMPLIA" },
          "proveedores.pedir_ficha": { capacidad: null, efecto: "CREA_AMPLIA" },
          "recepciones.ver": { capacidad: null, efecto: "LECTURA" },
          "recepciones.registrar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "recepciones.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "comprobantes_de_proveedor.ver": { capacidad: null, efecto: "LECTURA" },
          "comprobantes_de_proveedor.registrar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "comprobantes_de_proveedor.pagar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "comprobantes_de_proveedor.anular_pago": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "compras.configurar": { capacidad: null, efecto: "CREA_AMPLIA" },
        },
      },
      produccion: {
        estado: "en_desarrollo",
        obligatorio: false,
        requiere: ["stock"],
        usaSiExiste: ["catalogo"],
        datosRequeridos: [],
        implementadoPor: ["modulos/produccion"],
        acciones: {
          "transformaciones.ver": { capacidad: null, efecto: "LECTURA" },
          "transformaciones.abrir": { capacidad: null, efecto: "CREA_AMPLIA" },
          "transformaciones.cerrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "transformaciones.cancelar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "transformaciones.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
        },
      },
    });
  });

  it("catalogo y carta los implementa la misma carpeta y stock otra: dos carpetas para tres módulos", () => {
    const carpetas = ["catalogo", "vidriera", "stock"].map(
      (m) => CATALOGO_DE_MODULOS[m as "catalogo" | "vidriera" | "stock"].implementadoPor,
    );
    expect(carpetas).toEqual([["modulos/catalogo"], ["modulos/catalogo"], ["modulos/stock"]]);
  });

  it("el catálogo tiene 48 acciones de catálogo, carta y stock (14 + 9 + 25), 35 de caja, cierre y ventas (23 + 4 + 8) y 18 de clientes y compras (8 + 10), sin repetir ninguna", () => {
    const cuantas = (
      m: "catalogo" | "vidriera" | "stock" | "caja" | "cierre" | "ventas" | "clientes" | "compras",
    ) => Object.keys(CATALOGO_DE_MODULOS[m].acciones).length;
    expect([cuantas("catalogo"), cuantas("vidriera"), cuantas("stock")]).toEqual([14, 9, 25]);
    expect([cuantas("caja"), cuantas("cierre"), cuantas("ventas")]).toEqual([23, 4, 8]);
    expect([cuantas("clientes"), cuantas("compras")]).toEqual([8, 10]);
    const todas = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    // 25 de administración (18 de usuarios, sucursales, gerencia y permisos, y 7 de la configuración fiscal de H7 T5),
    // 9 de facturación (2 de H7, 6 de F5 y 1 de F7), 48 de catálogo, carta y stock (54 menos las 6 retiradas por las
    // decisiones 138 y 133 y `depositos.asignar_emisor`, que E5 retiró: el piloto no exige emisor, D156, más `costos.ver`
    // de E5-T10), 35 de caja, cierre y ventas (E0-T1) y 18 de clientes y compras (E9-T1, sin `compras.corregir` hasta E9-T11) y 6 de lotes de E6-T7 y 5 de producción de E6-T8: 140 en total.
    expect(todas).toHaveLength(25 + 9 + 48 + 35 + 18 + 5);
    expect(new Set(todas).size).toBe(todas.length);
  });

  it("administracion y clientes (los obligatorios) están activos sin guardar nada por empresa", () => {
    expect([...estadoDeModulos(CATALOGO_DE_MODULOS, [], []).modulosActivos]).toEqual([
      "administracion",
      "clientes",
    ]);
  });

  it("facturacion es disponible pero NO nace activa: sin activarla la empresa no la tiene, ni aunque el plan la incluya", () => {
    const sinActivar = estadoDeModulos(CATALOGO_DE_MODULOS, [], ["facturacion"]);
    expect([...sinActivar.modulosActivos]).toEqual(["administracion", "clientes"]);
    expect([...sinActivar.modulosEnSoloLectura]).toEqual([]);
  });

  it("facturacion activada y dentro del plan opera; activada y fuera del plan queda en solo lectura", () => {
    const activa = estadoDeModulos(CATALOGO_DE_MODULOS, ["facturacion"], ["facturacion"]);
    expect([...activa.modulosActivos].sort()).toEqual([
      "administracion",
      "clientes",
      "facturacion",
    ]);
    const bajaDePlan = estadoDeModulos(CATALOGO_DE_MODULOS, ["facturacion"], []);
    expect([...bajaDePlan.modulosActivos]).toEqual(["administracion", "clientes"]);
    expect([...bajaDePlan.modulosEnSoloLectura]).toEqual(["facturacion"]);
  });

  it("catalogo, carta, caja y ventas siguen en desarrollo: no se activan ni aunque se activen todos y el plan los incluya", () => {
    const todos = ["catalogo", "vidriera", "caja", "ventas"];
    const estado = estadoDeModulos(CATALOGO_DE_MODULOS, todos, todos);
    expect([...estado.modulosActivos]).toEqual(["administracion", "clientes"]);
    expect([...estado.modulosEnSoloLectura]).toEqual([]);
  });

  it("stock es disponible desde E5 (D-E5-4) pero NO nace activo: sin activarlo la empresa no lo tiene, y activado y dentro del plan opera (fuera del plan, solo lectura)", () => {
    expect(CATALOGO_DE_MODULOS.stock.estado).toBe("disponible");
    expect([...estadoDeModulos(CATALOGO_DE_MODULOS, [], ["stock"]).modulosActivos]).toEqual([
      "administracion",
      "clientes",
    ]);
    expect(
      [...estadoDeModulos(CATALOGO_DE_MODULOS, ["stock"], ["stock"]).modulosActivos].sort(),
    ).toEqual(["administracion", "clientes", "stock"]);
    const bajaDePlan = estadoDeModulos(CATALOGO_DE_MODULOS, ["stock"], []);
    expect([...bajaDePlan.modulosActivos]).toEqual(["administracion", "clientes"]);
    expect([...bajaDePlan.modulosEnSoloLectura]).toEqual(["stock"]);
  });

  it("depositos.asignar_emisor ya no existe (E5-T8, S-5): el piloto no exige emisor y la tabla de depósitos no tiene la columna", () => {
    const todas = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    expect(todas).not.toContain("depositos.asignar_emisor");
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
 *  - Configuración fiscal del gerente (H7 fiscal §C, T5): guardar un borrador de datos fiscales, crear, editar y
 *    activar un punto de venta y confirmar la regla del emisor crean o amplían (CREA_AMPLIA); confirmar los
 *    datos fiscales y desactivar un punto de venta cierran lo ya iniciado (COMPLETA_CIERRA). Son de `administracion`,
 *    que es obligatoria: nunca quedan en solo lectura.
 *  - CE0 (§7.2): editar variantes y editar el contenido de un combo AMPLÍAN. No hay acciones de grupos de precio ni
 *    `opciones.asignar` (decisiones 138 y 133).
 *  - Caja, cierre y ventas (E0-T1, e0-cimientos-especificacion §3.1): alta, edición, reactivar, abrir una sesión,
 *    registrar o ajustar un movimiento y abrir o agregar a una cuenta CREAN o AMPLÍAN; desactivar, cerrar, anular,
 *    cobrar, corregir y declarar un total (de un cobro) CIERRAN lo ya iniciado; las lecturas miran.
 */
const EFECTOS_DE_EMPRESA = {
  LECTURA: [
    "cajas.ver",
    "comprobantes.ver",
    "comprobantes_de_proveedor.ver",
    "costos.ver",
    "gerencia.ver_traspaso",
    "jornadas.ver",
    "lotes.ver",
    "modulos.ver",
    "partes.ver",
    "permisos.ver_propios",
    "productos.ver",
    "recepciones.ver",
    "stock.ver",
    "stock.verificar_saldos",
    "sucursales.ver",
    "transformaciones.ver",
    "usuarios.ver",
    "ventas.ver",
    "vidrieras.ver",
  ],
  CREA_AMPLIA: [
    "articulos.controlar",
    "cajas.crear",
    "cajas.editar",
    "cajas.reactivar",
    "categorias.crear",
    "categorias.editar",
    "categorias.reactivar",
    "certificados.gestionar",
    "composiciones.editar",
    "compras.configurar",
    "comprobantes.emitir_manual",
    "comprobantes_de_proveedor.pagar",
    "comprobantes_de_proveedor.registrar",
    "conjuntos.editar_contenido",
    "conteos.abrir",
    "cuentas.abrir",
    "cuentas.agregar_linea",
    "cuentas_de_cobro.crear",
    "cuentas_de_cobro.editar",
    "cuentas_de_cobro.reactivar",
    "datos_fiscales.editar",
    "depositos.crear",
    "depositos.editar",
    "depositos.reactivar",
    "emisores.confirmar_regla",
    "gerencia.proponer_traspaso",
    "lotes.controlar",
    "lotes.corregir",
    "lotes.reasignar",
    "medios_de_pago.crear",
    "medios_de_pago.editar",
    "medios_de_pago.reactivar",
    "movimientos_caja.ajustar",
    "movimientos_caja.registrar_manual",
    "opciones.editar",
    "partes.cambiar_roles",
    "partes.crear",
    "partes.desvincular_contacto",
    "partes.editar",
    "partes.reactivar",
    "partes.vincular_contacto",
    "productos.asignar_emisor",
    "productos.cambiar_precio",
    "productos.crear",
    "productos.editar",
    "productos.reactivar",
    "proveedores.editar_ficha",
    "proveedores.pedir_ficha",
    "puntos_de_venta.activar",
    "puntos_de_venta.cambiar_ambiente",
    "puntos_de_venta.crear",
    "puntos_de_venta.editar",
    "recepciones.registrar",
    "sesiones_caja.abrir",
    "stock.ajustar",
    "stock.registrar_entrada",
    "stock.registrar_salida",
    "stock.transferir",
    "sucursales.crear",
    "sucursales.editar",
    "sucursales.reactivar",
    "transformaciones.abrir",
    "usuarios.asignar_sucursales",
    "usuarios.invitar",
    "variantes.editar",
    "vidrieras.crear",
    "vidrieras.editar",
    "vidrieras.marcar_disponibilidad",
    "vidrieras.publicar",
    "vidrieras.publicar_en_linea",
    "vidrieras.renovar_enlace",
  ],
  COMPLETA_CIERRA: [
    "articulos.dejar_de_controlar",
    "cajas.desactivar",
    "categorias.desactivar",
    "cobros.corregir_medio",
    "comprobantes.descartar",
    "comprobantes.emitir",
    "comprobantes.reintentar",
    "comprobantes_de_proveedor.anular_pago",
    "conteos.aplicar",
    "conteos.cancelar",
    "conteos.registrar",
    "cuentas.anular",
    "cuentas.anular_linea",
    "cuentas.cerrar",
    "cuentas_de_cobro.desactivar",
    "datos_fiscales.confirmar",
    "declaraciones_de_total.registrar",
    "depositos.desactivar",
    "gerencia.aceptar_traspaso",
    "gerencia.cancelar_traspaso",
    "gerencia.rechazar_traspaso",
    "jornadas.cancelar_auditoria",
    "jornadas.cerrar",
    "jornadas.iniciar_auditoria",
    "lotes.cambiar_calidad",
    "lotes.dejar_de_controlar",
    "medios_de_pago.desactivar",
    "movimientos_caja.anular",
    "movimientos_caja.anular_de_otros",
    "notas_de_credito.emitir",
    "partes.desactivar",
    "productos.desactivar",
    "puntos_de_venta.desactivar",
    "recepciones.anular",
    "series.resincronizar",
    "sesiones_caja.cancelar_cierre",
    "sesiones_caja.cerrar",
    "sesiones_caja.iniciar_cierre",
    "stock.anular",
    "sucursales.desactivar",
    "tickets.cobrar",
    "tickets.corregir",
    "transformaciones.anular",
    "transformaciones.cancelar",
    "transformaciones.cerrar",
    "usuarios.apagar",
    "usuarios.reenviar_invitacion",
    "usuarios.revocar_invitacion",
    "vidrieras.retirar",
    "vidrieras.retirar_de_linea",
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
