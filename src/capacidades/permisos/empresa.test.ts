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
 * (QF2) son solo del gerente, la opción recomendada, hasta que el dueño decida.
 */
const SOLO_DEL_GERENTE_DE_FACTURACION = [
  "puntos_de_venta.cambiar_ambiente",
  "series.resincronizar",
] as const;

/**
 * Catálogo, carta y stock (catalogo-y-stock §C, opciones A de F6, F7 e I.4): el operador mira, marca
 * «agotado», registra entradas y salidas, transfiere y cuenta, en sus sucursales.
 */
const DEL_OPERADOR_DE_CATALOGO_Y_STOCK = [
  "cartas.marcar_disponibilidad",
  "cartas.ver",
  "conteos.registrar",
  "productos.ver",
  "stock.registrar_entrada",
  "stock.registrar_salida",
  "stock.transferir",
  "stock.ver",
] as const;

const DEL_OPERADOR = [...DEL_OPERADOR_DE_EMPRESA, ...DEL_OPERADOR_DE_CATALOGO_Y_STOCK] as const;

/** Lo que el administrador puede de más que el operador en catálogo, carta y stock (29 acciones). */
const SOLO_DEL_ADMINISTRADOR_DE_CATALOGO_Y_STOCK = [
  "articulos.controlar",
  "articulos.dejar_de_controlar",
  "categorias.crear",
  "categorias.desactivar",
  "categorias.editar",
  "categorias.reactivar",
  "cartas.crear",
  "cartas.editar",
  "cartas.publicar",
  "cartas.publicar_en_linea",
  "cartas.renovar_enlace",
  "cartas.retirar",
  "cartas.retirar_de_linea",
  "conteos.abrir",
  "conteos.aplicar",
  "conteos.cancelar",
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
  "recetas.editar",
  "stock.ajustar",
  "stock.anular",
] as const;

/** Las 8 acciones de CE0 (catalogo-carta-niveles-y-elecciones §7.2): gerente y administrador. */
const DE_LA_ESCALERA_DE_ELECCIONES = [
  "combos.editar_contenido",
  "grupos_de_precio.asignar",
  "grupos_de_precio.crear",
  "grupos_de_precio.desactivar",
  "grupos_de_precio.editar",
  "grupos_de_precio.reactivar",
  "opciones.asignar",
  "variantes.editar",
] as const;

/** Estructura fiscal y verificación de saldos: solo el gerente. */
const SOLO_DEL_GERENTE_DE_CATALOGO_Y_STOCK = [
  "depositos.asignar_emisor",
  "productos.asignar_emisor",
  "stock.verificar_saldos",
] as const;

const SOLO_DEL_GERENTE = [
  "gerencia.cancelar_traspaso",
  "gerencia.proponer_traspaso",
  "sucursales.desactivar",
  "sucursales.reactivar",
  ...SOLO_DEL_GERENTE_DE_CATALOGO_Y_STOCK,
  ...SOLO_DEL_GERENTE_DE_FACTURACION,
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
  ...DE_LA_ESCALERA_DE_ELECCIONES,
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

  it("hay 74 acciones: 26 de empresa y facturación, 48 de catálogo, carta y stock (40 de T0 y 8 de CE0)", () => {
    const todas = Object.keys(PERMISOS_DE_EMPRESA);
    expect(todas).toHaveLength(74);
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
    ]).toEqual([6, 5, 5, 1, 1, 5, 1, 1, 1]);
    expect([
      porPrefijo("productos"),
      porPrefijo("categorias"),
      porPrefijo("opciones"),
      porPrefijo("variantes"),
      porPrefijo("grupos_de_precio"),
      porPrefijo("combos"),
      porPrefijo("cartas"),
      porPrefijo("stock"),
      porPrefijo("depositos"),
      porPrefijo("articulos"),
      porPrefijo("recetas"),
      porPrefijo("conteos"),
    ]).toEqual([7, 4, 2, 1, 5, 1, 9, 7, 5, 2, 1, 4]);
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

  it("CE0: las ocho acciones nuevas de la escalera de elecciones no las puede el operador", () => {
    expect(DE_LA_ESCALERA_DE_ELECCIONES).toHaveLength(8);
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
    expect([...activos]).toEqual(["administracion"]);
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

  it("emitir un comprobante da MODULO_EN_DESARROLLO a todos mientras la facturación no exista (H7, §D)", () => {
    // También con el módulo «activado» y «habilitado» por el plan, y también sin rol: el guard mira
    // primero el estado de construcción del módulo.
    const { modulosActivos } = estadoDeModulos(
      CATALOGO_DE_MODULOS,
      ["facturacion"],
      ["facturacion"],
    );
    for (const rol of [...ROLES_DE_EMPRESA, null]) {
      expect(
        evaluarGuard(REGLAS_DE_EMPRESA, "comprobantes.emitir", {
          rol,
          modulosActivos,
          capacidadesDeSucursal: null,
        }),
        `${rol}`,
      ).toEqual({ ok: false, error: "MODULO_EN_DESARROLLO" });
    }
  });

  it("las 48 acciones de catálogo, carta y stock dan MODULO_EN_DESARROLLO a todos los roles mientras no se cierre T12", () => {
    const { modulosActivos } = estadoDeModulos(
      CATALOGO_DE_MODULOS,
      ["catalogo", "carta", "stock"],
      ["catalogo", "carta", "stock"],
    );
    const nuevas = [
      ...Object.keys(CATALOGO_DE_MODULOS.catalogo.acciones),
      ...Object.keys(CATALOGO_DE_MODULOS.carta.acciones),
      ...Object.keys(CATALOGO_DE_MODULOS.stock.acciones),
    ] as (keyof typeof PERMISOS_DE_EMPRESA)[];
    expect(nuevas).toHaveLength(48);
    for (const rol of [...ROLES_DE_EMPRESA, null]) {
      for (const accion of nuevas) {
        expect(
          evaluarGuard(REGLAS_DE_EMPRESA, accion, {
            rol,
            modulosActivos,
            capacidadesDeSucursal: null,
          }),
          `${rol} ${accion}`,
        ).toEqual({ ok: false, error: "MODULO_EN_DESARROLLO" });
      }
    }
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

describe("el guard con catálogo, carta y stock como si ya estuvieran disponibles (lo que decidirá T12)", () => {
  const modulosNuevos = ["catalogo", "carta", "stock"] as const;
  const disponibles: ReglasDeEmpresa = {
    catalogo: {
      ...CATALOGO_DE_MODULOS,
      catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "disponible" },
      carta: { ...CATALOGO_DE_MODULOS.carta, estado: "disponible" },
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
