import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { estadoDeModulos } from "../modulos/activos";
import { CATALOGO_DE_MODULOS, type ClaveModulo } from "../modulos/catalogo";
import {
  PERMISOS_DE_EMPRESA,
  REGLAS_DE_EMPRESA,
  tablaDePermisos,
  type ReglasDeEmpresa,
} from "./empresa";
import { evaluarGuard } from "./guard";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "./roles";

/**
 * P2 y P4: la matriz REAL como tabla legible. Si alguien cambia un permiso, esta prueba falla y el
 * dueño lee la diferencia: es la única copia "a la vista" de quién puede qué.
 */

/** Las acciones que puede cada rol, escritas a mano desde la tabla de §B.4 de la especificación de H6. */
const DEL_OPERADOR_DE_EMPRESA = [
  "comprobantes.descartar",
  "comprobantes.emitir",
  "comprobantes.emitir_manual",
  "comprobantes.reintentar",
  "comprobantes.ver",
  "gerencia.aceptar_traspaso",
  "gerencia.rechazar_traspaso",
  "gerencia.ver_traspaso",
  "notas_de_credito.emitir",
  "permisos.ver_propios",
] as const;

/**
 * Facturación (H7 facturación §C, F5): resincronizar una serie (QF1) y cambiar el ambiente de un punto de venta
 * (QF2) son solo del gerente (DECIDIDO, dueño 2026-10-13).
 */
const SOLO_DEL_GERENTE_DE_FACTURACION = [
  "certificados.gestionar",
  "puntos_de_venta.cambiar_ambiente",
  "series.resincronizar",
] as const;

/**
 * Catálogo, carta y stock (catalogo-y-stock §C, opciones A de F6, F7 e I.4): el operador mira, marca
 * «agotado», registra entradas y salidas, transfiere y cuenta, en sus sucursales.
 */
const DEL_OPERADOR_DE_CATALOGO_Y_STOCK = [
  "conteos.registrar",
  "productos.ver",
  "stock.registrar_entrada",
  "stock.registrar_salida",
  "stock.transferir",
  "stock.ver",
  "vidrieras.marcar_disponibilidad",
  "vidrieras.ver",
] as const;

/** Lo que el administrador puede de más que el operador en catálogo, carta y stock (30 acciones). */
const SOLO_DEL_ADMINISTRADOR_DE_CATALOGO_Y_STOCK = [
  "articulos.controlar",
  "articulos.dejar_de_controlar",
  "categorias.crear",
  "categorias.desactivar",
  "categorias.editar",
  "categorias.reactivar",
  "composiciones.editar",
  "conteos.abrir",
  "conteos.aplicar",
  "conteos.cancelar",
  "costos.ver",
  "depositos.crear",
  "depositos.desactivar",
  "depositos.editar",
  "depositos.reactivar",
  "opciones.editar",
  "productos.cambiar_precio",
  "productos.crear",
  "productos.desactivar",
  "productos.editar",
  "productos.reactivar",
  "stock.ajustar",
  "stock.anular",
  "vidrieras.crear",
  "vidrieras.editar",
  "vidrieras.publicar",
  "vidrieras.publicar_en_linea",
  "vidrieras.renovar_enlace",
  "vidrieras.retirar",
  "vidrieras.retirar_de_linea",
] as const;

/**
 * Las 2 acciones que quedan de CE0 (catalogo-carta-niveles-y-elecciones §7.2): gerente y administrador. Las 6 de grupos de
 * precio y `opciones.asignar` se retiraron en E0-T1 (decisiones 138 y 133; «copiar de otro producto» es `opciones.editar`).
 */
const DE_LA_ESCALERA_DE_ELECCIONES = ["conjuntos.editar_contenido", "variantes.editar"] as const;

/**
 * Caja, cierre y ventas (E0-T1, e0-cimientos-especificacion §3.1): los tres módulos están `en_desarrollo`, así que esta tabla
 * no autoriza nada hoy; fija quién podrá cuando E3, E3b y E4 los construyan.
 */
const SOLO_DEL_GERENTE_DE_CAJA = ["cajas.crear", "cajas.desactivar", "cajas.reactivar"] as const;

/** Caja que pueden el gerente y el administrador pero no el operador (decisiones 123 y 124). */
const DEL_ADMINISTRADOR_DE_CAJA = [
  "cajas.editar",
  "cuentas_de_cobro.crear",
  "cuentas_de_cobro.desactivar",
  "cuentas_de_cobro.editar",
  "cuentas_de_cobro.reactivar",
  "medios_de_pago.crear",
  "medios_de_pago.desactivar",
  "medios_de_pago.editar",
  "medios_de_pago.reactivar",
  "movimientos_caja.ajustar",
  "movimientos_caja.anular_de_otros",
] as const;

/** Los tres roles: caja del turno (decisiones 123, 145 y 161), cierre del día y ventas (decisiones 155 y 161). */
const DEL_OPERADOR_DE_CAJA_CIERRE_Y_VENTAS = [
  "cajas.ver",
  "cobros.corregir_medio",
  "cuentas.abrir",
  "cuentas.agregar_linea",
  "cuentas.anular",
  "cuentas.anular_linea",
  "cuentas.cerrar",
  "declaraciones_de_total.registrar",
  "jornadas.cancelar_auditoria",
  "jornadas.cerrar",
  "jornadas.iniciar_auditoria",
  "jornadas.ver",
  "movimientos_caja.anular",
  "movimientos_caja.registrar_manual",
  "sesiones_caja.abrir",
  "sesiones_caja.cancelar_cierre",
  "sesiones_caja.cerrar",
  "sesiones_caja.iniciar_cierre",
  "tickets.cobrar",
  "tickets.corregir",
  "ventas.ver",
] as const;

/**
 * Clientes y compras (E9-T1; F1 del directorio y P-3 de compras, decidida por el padre el 10/11/2026): el operador busca, da de
 * alta y edita partes, pide puntos de venta o comprobantes y carga la compra y la factura. Los dos módulos están `en_desarrollo`.
 */
const DEL_OPERADOR_DE_CLIENTES_Y_COMPRAS = [
  "comprobantes_de_proveedor.registrar",
  "comprobantes_de_proveedor.ver",
  "partes.cambiar_roles",
  "partes.crear",
  "partes.desvincular_contacto",
  "partes.editar",
  "partes.ver",
  "partes.vincular_contacto",
  "proveedores.pedir_ficha",
  "recepciones.registrar",
  "recepciones.ver",
] as const;

/** Lo que de clientes y compras pueden el gerente y el administrador pero no el operador: desactivar y reactivar, aprobar la ficha, pagar, anular y corregir. */
const DEL_ADMINISTRADOR_DE_CLIENTES_Y_COMPRAS = [
  "comprobantes_de_proveedor.anular_pago",
  "comprobantes_de_proveedor.pagar",
  "partes.desactivar",
  "partes.reactivar",
  "proveedores.editar_ficha",
  "recepciones.anular",
] as const;

/** El nivel de operación de las compras es solo del gerente. */
const SOLO_DEL_GERENTE_DE_COMPRAS = ["compras.configurar"] as const;

/** E6-T7 (P-2): lotes y calidad. Mirar lo ven los tres roles; el resto, gerente y administrador. */
const DEL_OPERADOR_DE_LOTES = ["lotes.ver"] as const;
const SOLO_DEL_ADMINISTRADOR_DE_LOTES = [
  "lotes.controlar",
  "lotes.dejar_de_controlar",
  "lotes.cambiar_calidad",
  "lotes.corregir",
  "lotes.reasignar",
] as const;

/** E6-T8 (DEC-0101): producción. Ver, abrir y cerrar una orden, los tres roles; cancelar y anular, gerente y administrador. */
const DEL_OPERADOR_DE_PRODUCCION = [
  "transformaciones.ver",
  "transformaciones.abrir",
  "transformaciones.cerrar",
] as const;
const SOLO_DEL_ADMINISTRADOR_DE_PRODUCCION = [
  "transformaciones.cancelar",
  "transformaciones.anular",
] as const;

const DEL_OPERADOR = [
  ...DEL_OPERADOR_DE_EMPRESA,
  ...DEL_OPERADOR_DE_CLIENTES_Y_COMPRAS,
  ...DEL_OPERADOR_DE_CATALOGO_Y_STOCK,
  ...DEL_OPERADOR_DE_LOTES,
  ...DEL_OPERADOR_DE_PRODUCCION,
  ...DEL_OPERADOR_DE_CAJA_CIERRE_Y_VENTAS,
] as const;

/** Estructura fiscal y verificación de saldos: solo el gerente. */
const SOLO_DEL_GERENTE_DE_CATALOGO_Y_STOCK = [
  "productos.asignar_emisor",
  "stock.verificar_saldos",
] as const;

/**
 * Configuración fiscal (H7 fiscal §C, T5; C11): confirmar datos fiscales, activar un punto de venta y confirmar
 * la regla del emisor son solo del gerente: el administrador y el operador quedan afuera.
 */
const SOLO_DEL_GERENTE_DE_CONFIGURACION_FISCAL = [
  "datos_fiscales.confirmar",
  "datos_fiscales.editar",
  "emisores.confirmar_regla",
  "puntos_de_venta.activar",
  "puntos_de_venta.crear",
  "puntos_de_venta.desactivar",
  "puntos_de_venta.editar",
] as const;

const SOLO_DEL_GERENTE = [
  "gerencia.cancelar_traspaso",
  "gerencia.proponer_traspaso",
  "sucursales.desactivar",
  "sucursales.reactivar",
  ...SOLO_DEL_GERENTE_DE_CATALOGO_Y_STOCK,
  ...SOLO_DEL_GERENTE_DE_FACTURACION,
  ...SOLO_DEL_GERENTE_DE_CONFIGURACION_FISCAL,
  ...SOLO_DEL_GERENTE_DE_CAJA,
  ...SOLO_DEL_GERENTE_DE_COMPRAS,
] as const;

const DEL_ADMINISTRADOR = [
  ...DEL_OPERADOR,
  "modulos.ver",
  "sucursales.crear",
  "sucursales.editar",
  "sucursales.ver",
  "usuarios.apagar",
  "usuarios.asignar_sucursales",
  "usuarios.invitar",
  "usuarios.reenviar_invitacion",
  "usuarios.revocar_invitacion",
  "usuarios.ver",
  ...SOLO_DEL_ADMINISTRADOR_DE_CATALOGO_Y_STOCK,
  ...SOLO_DEL_ADMINISTRADOR_DE_LOTES,
  ...SOLO_DEL_ADMINISTRADOR_DE_PRODUCCION,
  ...DE_LA_ESCALERA_DE_ELECCIONES,
  ...DEL_ADMINISTRADOR_DE_CAJA,
  ...DEL_ADMINISTRADOR_DE_CLIENTES_Y_COMPRAS,
].sort();

const ACCIONES_DE_USUARIOS = [
  "usuarios.apagar",
  "usuarios.asignar_sucursales",
  "usuarios.invitar",
  "usuarios.reenviar_invitacion",
  "usuarios.revocar_invitacion",
  "usuarios.ver",
] as const;

describe("la matriz rol → acciones (roles fijos, decisión 18)", () => {
  it("tabla de permisos: qué puede cada rol (§B.4 de la especificación de H6)", () => {
    expect(tablaDePermisos(PERMISOS_DE_EMPRESA)).toEqual({
      GERENTE: [...DEL_ADMINISTRADOR, ...SOLO_DEL_GERENTE].sort(),
      ADMINISTRADOR: DEL_ADMINISTRADOR,
      OPERADOR: [...DEL_OPERADOR].sort(),
    });
  });

  it("hay 140 acciones: 34 de empresa, configuración fiscal y facturación, 48 de catálogo, carta y stock (39 de T0, 2 de CE0 y 6 de lotes de E6), 35 de caja, cierre y ventas, 18 de clientes y compras y 5 de producción de E6-T8", () => {
    const todas = Object.keys(PERMISOS_DE_EMPRESA);
    expect(todas).toHaveLength(140);
    const porPrefijo = (prefijo: string) => todas.filter((a) => a.startsWith(`${prefijo}.`)).length;
    expect([
      porPrefijo("usuarios"),
      porPrefijo("sucursales"),
      porPrefijo("gerencia"),
      porPrefijo("modulos"),
      porPrefijo("permisos"),
      porPrefijo("comprobantes"),
      porPrefijo("notas_de_credito"),
      porPrefijo("series"),
      porPrefijo("puntos_de_venta"),
      porPrefijo("certificados"),
      porPrefijo("datos_fiscales"),
      porPrefijo("emisores"),
    ]).toEqual([6, 5, 5, 1, 1, 5, 1, 1, 5, 1, 2, 1]);
    expect([
      porPrefijo("productos"),
      porPrefijo("categorias"),
      porPrefijo("opciones"),
      porPrefijo("variantes"),
      porPrefijo("grupos_de_precio"),
      porPrefijo("conjuntos"),
      porPrefijo("vidrieras"),
      porPrefijo("stock"),
      porPrefijo("depositos"),
      porPrefijo("articulos"),
      porPrefijo("composiciones"),
      porPrefijo("conteos"),
      porPrefijo("costos"),
    ]).toEqual([7, 4, 1, 1, 0, 1, 9, 7, 4, 2, 1, 4, 1]);
    expect([
      porPrefijo("cajas"),
      porPrefijo("medios_de_pago"),
      porPrefijo("cuentas_de_cobro"),
      porPrefijo("sesiones_caja"),
      porPrefijo("movimientos_caja"),
      porPrefijo("cobros"),
      porPrefijo("declaraciones_de_total"),
      porPrefijo("jornadas"),
      porPrefijo("ventas"),
      porPrefijo("cuentas"),
      porPrefijo("tickets"),
    ]).toEqual([5, 4, 4, 4, 4, 1, 1, 4, 1, 5, 2]);
    expect([
      porPrefijo("partes"),
      porPrefijo("proveedores"),
      porPrefijo("recepciones"),
      porPrefijo("comprobantes_de_proveedor"),
      porPrefijo("compras"),
    ]).toEqual([8, 2, 3, 4, 1]);
  });

  it("las acciones retiradas por las decisiones 138 y 133 ya no existen: ni en la matriz ni en el catálogo", () => {
    const retiradas = [
      "grupos_de_precio.crear",
      "grupos_de_precio.editar",
      "grupos_de_precio.asignar",
      "grupos_de_precio.reactivar",
      "grupos_de_precio.desactivar",
      "opciones.asignar",
    ];
    const delCatalogo = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    for (const accion of retiradas) {
      expect(Object.keys(PERMISOS_DE_EMPRESA), accion).not.toContain(accion);
      expect(delCatalogo, accion).not.toContain(accion);
    }
  });

  it("las acciones de usuarios son seis y las tienen exactamente el gerente y el administrador", () => {
    const deUsuarios = Object.keys(PERMISOS_DE_EMPRESA)
      .filter((a) => a.startsWith("usuarios."))
      .sort();
    expect(deUsuarios).toEqual([...ACCIONES_DE_USUARIOS]);
    for (const accion of ACCIONES_DE_USUARIOS) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE", "ADMINISTRADOR"]);
    }
  });

  it("las siete acciones de la configuración fiscal son solo del gerente: administrador y operador no pueden ninguna", () => {
    expect(SOLO_DEL_GERENTE_DE_CONFIGURACION_FISCAL).toHaveLength(7);
    for (const accion of SOLO_DEL_GERENTE_DE_CONFIGURACION_FISCAL) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE"]);
    }
  });

  it("desactivar y reactivar una sucursal, y proponer o cancelar el traspaso, son solo del gerente (F4)", () => {
    for (const accion of SOLO_DEL_GERENTE.slice(0, 4)) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE"]);
    }
  });

  it("resincronizar una serie (QF1) y cambiar el ambiente de un punto de venta (QF2) son solo del gerente", () => {
    for (const accion of SOLO_DEL_GERENTE_DE_FACTURACION) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE"]);
    }
  });

  it("asignar un emisor a un producto o a un depósito y verificar los saldos son solo del gerente (estructura fiscal y control)", () => {
    for (const accion of SOLO_DEL_GERENTE_DE_CATALOGO_Y_STOCK) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE"]);
    }
  });

  it("ver, aceptar y rechazar un traspaso, ver los permisos propios y emitir un comprobante son de los tres roles", () => {
    for (const accion of DEL_OPERADOR_DE_EMPRESA) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE", "ADMINISTRADOR", "OPERADOR"]);
    }
  });

  it("el operador ve el catálogo, la carta y el stock, marca «agotado», mueve stock y cuenta: exactamente esas ocho (F7, opción A)", () => {
    expect(DEL_OPERADOR_DE_CATALOGO_Y_STOCK).toHaveLength(8);
    for (const accion of DEL_OPERADOR_DE_CATALOGO_Y_STOCK) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE", "ADMINISTRADOR", "OPERADOR"]);
    }
    expect(tablaDePermisos(PERMISOS_DE_EMPRESA).OPERADOR).toEqual([...DEL_OPERADOR].sort());
  });

  it("definir el catálogo, los precios, las opciones y la carta, corregir el stock y exponer la carta a internet son de gerente y administrador (F6 e I.4, opción A)", () => {
    for (const accion of [
      ...SOLO_DEL_ADMINISTRADOR_DE_CATALOGO_Y_STOCK,
      ...DE_LA_ESCALERA_DE_ELECCIONES,
    ]) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE", "ADMINISTRADOR"]);
    }
  });

  it("CE0: las dos acciones que quedan de la escalera de elecciones no las puede el operador", () => {
    expect(DE_LA_ESCALERA_DE_ELECCIONES).toHaveLength(2);
    const operador = tablaDePermisos(PERMISOS_DE_EMPRESA).OPERADOR as readonly string[];
    for (const accion of DE_LA_ESCALERA_DE_ELECCIONES) {
      expect(operador, accion).not.toContain(accion);
    }
  });

  it("emitir un comprobante lo pueden los tres roles: quien cobra emite en el mismo acto (H7, §C)", () => {
    expect(PERMISOS_DE_EMPRESA["comprobantes.emitir"]).toEqual([
      "GERENTE",
      "ADMINISTRADOR",
      "OPERADOR",
    ]);
  });

  it("el operador no puede ninguna acción de usuarios (decisión 2) ni de sucursales ni de módulos", () => {
    const tabla = tablaDePermisos(PERMISOS_DE_EMPRESA);
    expect(tabla.OPERADOR.filter((a) => /^(usuarios|sucursales|modulos)\./.test(a))).toEqual([]);
  });

  it("los roles son exactamente estos tres, en este orden", () => {
    expect(ROLES_DE_EMPRESA).toEqual(["GERENTE", "ADMINISTRADOR", "OPERADOR"]);
  });

  it("cada acción del catálogo tiene su fila en la matriz, y no hay filas de más", () => {
    const delCatalogo = Object.values(CATALOGO_DE_MODULOS)
      .flatMap((m) => Object.keys(m.acciones))
      .sort();
    expect(Object.keys(PERMISOS_DE_EMPRESA).sort()).toEqual(delCatalogo);
  });

  it("P4: piso jerárquico: lo que puede el operador lo puede el administrador, y lo del administrador, el gerente", () => {
    const tabla = tablaDePermisos(PERMISOS_DE_EMPRESA);
    for (const accion of tabla.OPERADOR) expect(tabla.ADMINISTRADOR).toContain(accion);
    for (const accion of tabla.ADMINISTRADOR) expect(tabla.GERENTE).toContain(accion);
  });

  it("E0-T1: caja, cierre y ventas dan lo que dice la especificación, rol por rol (35 acciones)", () => {
    const de = (modulo: "caja" | "cierre" | "ventas") =>
      Object.keys(CATALOGO_DE_MODULOS[modulo].acciones) as (keyof typeof PERMISOS_DE_EMPRESA)[];
    const nuevas = [...de("caja"), ...de("cierre"), ...de("ventas")];
    expect(nuevas).toHaveLength(35);
    expect([...nuevas].sort()).toEqual(
      [
        ...SOLO_DEL_GERENTE_DE_CAJA,
        ...DEL_ADMINISTRADOR_DE_CAJA,
        ...DEL_OPERADOR_DE_CAJA_CIERRE_Y_VENTAS,
      ].sort(),
    );
    for (const accion of SOLO_DEL_GERENTE_DE_CAJA) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE"]);
    }
    for (const accion of DEL_ADMINISTRADOR_DE_CAJA) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE", "ADMINISTRADOR"]);
    }
    for (const accion of DEL_OPERADOR_DE_CAJA_CIERRE_Y_VENTAS) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE", "ADMINISTRADOR", "OPERADOR"]);
    }
  });

  it("E0-T1: piso jerárquico de las 35 acciones nuevas (lo del operador lo puede el administrador, y lo del administrador, el gerente)", () => {
    const nuevas = (["caja", "cierre", "ventas"] as const).flatMap(
      (m) => Object.keys(CATALOGO_DE_MODULOS[m].acciones) as (keyof typeof PERMISOS_DE_EMPRESA)[],
    );
    for (const accion of nuevas) {
      const roles = PERMISOS_DE_EMPRESA[accion] as readonly RolDeEmpresa[];
      if (roles.includes("OPERADOR")) expect(roles, accion).toContain("ADMINISTRADOR");
      if (roles.includes("ADMINISTRADOR")) expect(roles, accion).toContain("GERENTE");
    }
  });

  it("coherencia de caja: quien puede anular movimientos de otros puede anular los propios", () => {
    for (const rol of ROLES_DE_EMPRESA) {
      const roles = PERMISOS_DE_EMPRESA[
        "movimientos_caja.anular_de_otros"
      ] as readonly RolDeEmpresa[];
      if (roles.includes(rol)) {
        expect(PERMISOS_DE_EMPRESA["movimientos_caja.anular"], rol).toContain(rol);
      }
    }
  });

  it("coherencia de ventas: todo rol con tickets.cobrar puede abrir cuenta, agregar línea y cerrar, y emitir el comprobante", () => {
    for (const rol of ROLES_DE_EMPRESA) {
      if (!(PERMISOS_DE_EMPRESA["tickets.cobrar"] as readonly RolDeEmpresa[]).includes(rol))
        continue;
      for (const accion of [
        "cuentas.abrir",
        "cuentas.agregar_linea",
        "cuentas.cerrar",
        "comprobantes.emitir",
      ] as const) {
        expect(
          PERMISOS_DE_EMPRESA[accion] as readonly RolDeEmpresa[],
          `${rol} ${accion}`,
        ).toContain(rol);
      }
    }
  });

  it("cobrar un ticket es únicamente tickets.cobrar: ninguna otra acción de ningún módulo cobra", () => {
    const quePareceCobrar = Object.values(CATALOGO_DE_MODULOS)
      .flatMap((m) => Object.keys(m.acciones))
      .filter((a) => /(^|[._])cobrar($|[._])/.test(a));
    expect(quePareceCobrar).toEqual(["tickets.cobrar"]);
  });

  it("no existen sesiones_caja.reabrir, arqueos.revisar ni acciones de plataforma para crear cajas (decisiones del dueño)", () => {
    const todas = Object.keys(PERMISOS_DE_EMPRESA);
    expect(todas).not.toContain("sesiones_caja.reabrir");
    expect(todas.filter((a) => a.startsWith("arqueos."))).toEqual([]);
  });

  it("las reglas de empresa son el catálogo y la matriz reales", () => {
    expect(REGLAS_DE_EMPRESA.catalogo).toBe(CATALOGO_DE_MODULOS);
    expect(REGLAS_DE_EMPRESA.permisos).toBe(PERMISOS_DE_EMPRESA);
  });
});

describe("tablaDePermisos con otras matrices", () => {
  it("ordena las acciones de cada rol y deja vacío al rol sin acciones", () => {
    const tabla = tablaDePermisos({
      "z.ultima": ["GERENTE", "OPERADOR"],
      "a.primera": ["GERENTE"],
      "m.media": ["OPERADOR"],
    });
    expect(tabla).toEqual({
      GERENTE: ["a.primera", "z.ultima"],
      ADMINISTRADOR: [],
      OPERADOR: ["m.media", "z.ultima"],
    });
  });

  it("una matriz vacía da una tabla vacía por rol", () => {
    expect(tablaDePermisos({})).toEqual({ GERENTE: [], ADMINISTRADOR: [], OPERADOR: [] });
  });

  it("no cambia la matriz que recibe", () => {
    const matriz: Record<string, readonly RolDeEmpresa[]> = { b: ["GERENTE"], a: ["GERENTE"] };
    tablaDePermisos(matriz);
    expect(Object.keys(matriz)).toEqual(["b", "a"]);
  });
});

/** Las acciones del núcleo (`administracion`), el único módulo disponible. */
const ACCIONES_DE_ADMINISTRACION = Object.keys(
  CATALOGO_DE_MODULOS.administracion.acciones,
) as (keyof typeof CATALOGO_DE_MODULOS.administracion.acciones)[];

describe("el guard con las reglas reales", () => {
  const activos = estadoDeModulos(CATALOGO_DE_MODULOS, [], []).modulosActivos;
  const acciones = ACCIONES_DE_ADMINISTRACION;

  it("administracion es obligatorio: está activo aunque no se haya activado nada", () => {
    expect([...activos]).toEqual(["administracion", "clientes"]);
  });

  it("cada rol puede exactamente lo que dice la tabla, y no puede, SIN_PERMISO", () => {
    const tabla = tablaDePermisos(PERMISOS_DE_EMPRESA);
    for (const rol of ROLES_DE_EMPRESA) {
      for (const accion of acciones) {
        const resultado = evaluarGuard(REGLAS_DE_EMPRESA, accion, {
          rol,
          modulosActivos: activos,
          capacidadesDeSucursal: null,
        });
        const puede = (tabla[rol] as readonly string[]).includes(accion);
        expect(resultado, `${rol} ${accion}`).toEqual(
          puede ? { ok: true, valor: null } : { ok: false, error: "SIN_PERMISO" },
        );
      }
    }
  });

  it("sin rol (sin persona, sin membresía activa o suspendida) no puede ninguna acción", () => {
    for (const accion of acciones) {
      expect(
        evaluarGuard(REGLAS_DE_EMPRESA, accion, {
          rol: null,
          modulosActivos: activos,
          capacidadesDeSucursal: null,
        }),
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
    }
  });

  // `facturacion` es `disponible` (dueño, 2026-11-04) pero no nace activa: la empresa la tiene que activar (la plataforma) y la acción
  // tiene que estar en su rol. Estas tres pruebas fijan que ser «disponible» no abre nada por sí solo.
  const accionesDeFacturacion = Object.keys(
    CATALOGO_DE_MODULOS.facturacion.acciones,
  ) as (keyof typeof CATALOGO_DE_MODULOS.facturacion.acciones)[];

  it("facturacion sin activar da MODULO_NO_ACTIVO a todos, también al gerente, también sin rol y también si el plan la incluye", () => {
    // El plan solo fija el techo: sin la activación de la empresa `estadoDeModulos` no la deja activa.
    const { modulosActivos } = estadoDeModulos(CATALOGO_DE_MODULOS, [], ["facturacion"]);
    expect(modulosActivos.has("facturacion")).toBe(false);
    for (const rol of [...ROLES_DE_EMPRESA, null]) {
      for (const accion of accionesDeFacturacion) {
        expect(
          evaluarGuard(REGLAS_DE_EMPRESA, accion, {
            rol,
            modulosActivos,
            capacidadesDeSucursal: null,
          }),
          `${rol} ${accion}`,
        ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
      }
    }
  });

  it("facturacion activa: cada rol puede exactamente lo que dice la tabla y no puede, SIN_PERMISO (sin rol, tampoco)", () => {
    const { modulosActivos } = estadoDeModulos(
      CATALOGO_DE_MODULOS,
      ["facturacion"],
      ["facturacion"],
    );
    const tabla = tablaDePermisos(PERMISOS_DE_EMPRESA);
    for (const rol of ROLES_DE_EMPRESA) {
      for (const accion of accionesDeFacturacion) {
        const puede = (tabla[rol] as readonly string[]).includes(accion);
        expect(
          evaluarGuard(REGLAS_DE_EMPRESA, accion, {
            rol,
            modulosActivos,
            capacidadesDeSucursal: null,
          }),
          `${rol} ${accion}`,
        ).toEqual(puede ? { ok: true, valor: null } : { ok: false, error: "SIN_PERMISO" });
      }
    }
    for (const accion of accionesDeFacturacion) {
      expect(
        evaluarGuard(REGLAS_DE_EMPRESA, accion, {
          rol: null,
          modulosActivos,
          capacidadesDeSucursal: null,
        }),
        `sin rol ${accion}`,
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
    }
  });

  it("facturacion en solo lectura (baja de plan): el gerente pierde lo que crea o amplía y conserva lo que mira o cierra", () => {
    const estado = estadoDeModulos(CATALOGO_DE_MODULOS, ["facturacion"], []);
    expect([...estado.modulosEnSoloLectura]).toEqual(["facturacion"]);
    for (const accion of accionesDeFacturacion) {
      const { efecto } = CATALOGO_DE_MODULOS.facturacion.acciones[accion];
      expect(
        evaluarGuard(REGLAS_DE_EMPRESA, accion, {
          rol: "GERENTE",
          modulosActivos: estado.modulosActivos,
          modulosEnSoloLectura: estado.modulosEnSoloLectura,
          capacidadesDeSucursal: null,
        }),
        `${accion} (${efecto})`,
      ).toEqual(
        efecto === "CREA_AMPLIA"
          ? { ok: false, error: "MODULO_EN_SOLO_LECTURA" }
          : { ok: true, valor: null },
      );
    }
  });

  // «Nadie puede usar lo que no está construido» (E0-T1, §5): recorre TODO el catálogo, no una lista escrita a mano,
  // para que un módulo `en_desarrollo` agregado después y olvidado no quede sin cubrir. El módulo se marca activo a
  // propósito (el guard rechaza por «en desarrollo» antes de mirar si está activo o qué rol tiene).
  const ENDESARROLLO = (Object.keys(CATALOGO_DE_MODULOS) as ClaveModulo[]).filter(
    (m) => CATALOGO_DE_MODULOS[m].estado === "en_desarrollo",
  );

  it("todo módulo en desarrollo del catálogo incluye catalogo, vidriera, caja, ventas y produccion (cierre ya es disponible desde E3b, stock desde E5, clientes desde E9-T4 y compras desde E9-T12)", () => {
    expect([...ENDESARROLLO].sort()).toEqual(
      ["caja", "catalogo", "produccion", "ventas", "vidriera"].sort(),
    );
  });

  it("las 59 acciones sin construir (23 de catálogo y carta, 31 de caja y ventas y 5 de producción) dan MODULO_EN_DESARROLLO a todos los roles, también sin rol, con el módulo activado", () => {
    const todosActivos = new Set<ClaveModulo>(Object.keys(CATALOGO_DE_MODULOS) as ClaveModulo[]);
    const sinConstruir = ENDESARROLLO.flatMap(
      (m) => Object.keys(CATALOGO_DE_MODULOS[m].acciones) as (keyof typeof PERMISOS_DE_EMPRESA)[],
    );
    expect(sinConstruir).toHaveLength(59);
    for (const rol of [...ROLES_DE_EMPRESA, null]) {
      for (const accion of sinConstruir) {
        expect(
          evaluarGuard(REGLAS_DE_EMPRESA, accion, {
            rol,
            modulosActivos: todosActivos,
            capacidadesDeSucursal: null,
          }),
          `${rol} ${accion}`,
        ).toEqual({ ok: false, error: "MODULO_EN_DESARROLLO" });
      }
    }
  });

  it("propiedad: para cualquier subconjunto de módulos activos y cualquier rol, un módulo en desarrollo siempre rechaza igual (no depende del rol)", () => {
    const claves = Object.keys(CATALOGO_DE_MODULOS) as ClaveModulo[];
    const sinConstruir = ENDESARROLLO.flatMap(
      (m) => Object.keys(CATALOGO_DE_MODULOS[m].acciones) as (keyof typeof PERMISOS_DE_EMPRESA)[],
    );
    fc.assert(
      fc.property(
        fc.subarray(claves),
        fc.subarray(claves),
        fc.constantFrom<RolDeEmpresa | null>(...ROLES_DE_EMPRESA, null),
        fc.constantFrom(...sinConstruir),
        (activos, enSoloLectura, rol, accion) => {
          expect(
            evaluarGuard(REGLAS_DE_EMPRESA, accion, {
              rol,
              modulosActivos: new Set(activos),
              modulosEnSoloLectura: new Set(enSoloLectura),
              capacidadesDeSucursal: null,
            }),
          ).toEqual({ ok: false, error: "MODULO_EN_DESARROLLO" });
        },
      ),
    );
  });

  it("activar caja o ventas por empresa y plan no los deja activos: sigue sin habilitarse nada", () => {
    const todos = ["caja", "ventas", "catalogo"];
    const estado = estadoDeModulos(CATALOGO_DE_MODULOS, todos, todos);
    expect([...estado.modulosActivos]).toEqual(["administracion", "clientes"]);
  });

  it("si el módulo no figura entre los activos, MODULO_NO_ACTIVO (el guard no lo da por hecho)", () => {
    expect(
      evaluarGuard(REGLAS_DE_EMPRESA, "usuarios.invitar", {
        rol: "GERENTE",
        modulosActivos: new Set<ClaveModulo>(),
        capacidadesDeSucursal: null,
      }),
    ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
  });
});

describe("el guard con las reglas reales y la solo lectura (corrección 16)", () => {
  const acciones = ACCIONES_DE_ADMINISTRACION;
  const enSoloLectura = new Set<ClaveModulo>(["administracion"]);
  const activos = estadoDeModulos(CATALOGO_DE_MODULOS, [], []).modulosActivos;

  it("el núcleo no depende de un plan: marcarlo en solo lectura no cambia ninguna decisión", () => {
    for (const rol of ROLES_DE_EMPRESA) {
      for (const accion of acciones) {
        const datos = { rol, modulosActivos: activos, capacidadesDeSucursal: null } as const;
        expect(
          evaluarGuard(REGLAS_DE_EMPRESA, accion, {
            ...datos,
            modulosEnSoloLectura: enSoloLectura,
          }),
          `${rol} ${accion}`,
        ).toEqual(evaluarGuard(REGLAS_DE_EMPRESA, accion, datos));
      }
    }
  });

  it("si un día el módulo fuera activable y quedara en solo lectura, el gerente solo perdería lo que crea o amplía", () => {
    const activable: ReglasDeEmpresa = {
      catalogo: {
        ...CATALOGO_DE_MODULOS,
        administracion: { ...CATALOGO_DE_MODULOS.administracion, obligatorio: false },
      },
      permisos: PERMISOS_DE_EMPRESA,
    };
    for (const accion of acciones) {
      const efecto = CATALOGO_DE_MODULOS.administracion.acciones[accion].efecto;
      expect(
        evaluarGuard(activable, accion, {
          rol: "GERENTE",
          modulosActivos: new Set<ClaveModulo>(),
          modulosEnSoloLectura: enSoloLectura,
          capacidadesDeSucursal: null,
        }),
        `${accion} (${efecto})`,
      ).toEqual(
        efecto === "CREA_AMPLIA"
          ? { ok: false, error: "MODULO_EN_SOLO_LECTURA" }
          : { ok: true, valor: null },
      );
    }
  });
});

describe("el guard con catálogo, carta y stock como si estuvieran disponibles (stock lo está desde E5; catálogo y carta, lo que decidirá su cierre)", () => {
  const modulosNuevos = ["catalogo", "vidriera", "stock"] as const;
  const disponibles: ReglasDeEmpresa = {
    catalogo: {
      ...CATALOGO_DE_MODULOS,
      catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "disponible" },
      vidriera: { ...CATALOGO_DE_MODULOS.vidriera, estado: "disponible" },
      stock: { ...CATALOGO_DE_MODULOS.stock, estado: "disponible" },
    },
    permisos: PERMISOS_DE_EMPRESA,
  };
  const accionesDe = (modulo: (typeof modulosNuevos)[number]) =>
    Object.keys(CATALOGO_DE_MODULOS[modulo].acciones) as (keyof typeof PERMISOS_DE_EMPRESA)[];
  const todas = modulosNuevos.flatMap(accionesDe);
  const activos = new Set<ClaveModulo>(["administracion", ...modulosNuevos]);
  const efectoDe = (accion: string) =>
    Object.values(CATALOGO_DE_MODULOS)
      .flatMap((m) => Object.entries(m.acciones))
      .find(([nombre]) => nombre === accion)?.[1].efecto;

  it("activos, cada rol puede exactamente lo que dice la matriz, y no puede, SIN_PERMISO", () => {
    const tabla = tablaDePermisos(PERMISOS_DE_EMPRESA);
    for (const rol of ROLES_DE_EMPRESA) {
      for (const accion of todas) {
        const puede = (tabla[rol] as readonly string[]).includes(accion);
        expect(
          evaluarGuard(disponibles, accion, {
            rol,
            modulosActivos: activos,
            capacidadesDeSucursal: null,
          }),
          `${rol} ${accion}`,
        ).toEqual(puede ? { ok: true, valor: null } : { ok: false, error: "SIN_PERMISO" });
      }
    }
  });

  it("sin el módulo activo, MODULO_NO_ACTIVO para todos, también sin rol", () => {
    for (const rol of [...ROLES_DE_EMPRESA, null]) {
      for (const accion of todas) {
        expect(
          evaluarGuard(disponibles, accion, {
            rol,
            modulosActivos: new Set<ClaveModulo>(["administracion"]),
            capacidadesDeSucursal: null,
          }),
          `${rol} ${accion}`,
        ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
      }
    }
  });

  it("en solo lectura solo se rechaza lo que crea o amplía (también al operador y sin rol); mirar y cerrar siguen según la matriz", () => {
    const tabla = tablaDePermisos(PERMISOS_DE_EMPRESA);
    for (const rol of [...ROLES_DE_EMPRESA, null]) {
      for (const accion of todas) {
        const efecto = efectoDe(accion);
        const puede = rol !== null && (tabla[rol] as readonly string[]).includes(accion);
        const esperado =
          efecto === "CREA_AMPLIA"
            ? { ok: false, error: "MODULO_EN_SOLO_LECTURA" }
            : puede
              ? { ok: true, valor: null }
              : { ok: false, error: "SIN_PERMISO" };
        expect(
          evaluarGuard(disponibles, accion, {
            rol,
            modulosActivos: new Set<ClaveModulo>(["administracion"]),
            modulosEnSoloLectura: new Set<ClaveModulo>(modulosNuevos),
            capacidadesDeSucursal: null,
          }),
          `${rol} ${accion} (${efecto})`,
        ).toEqual(esperado);
      }
    }
  });
});
