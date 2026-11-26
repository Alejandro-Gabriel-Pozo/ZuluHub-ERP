import { describe, expect, expectTypeOf, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import {
  AREAS_DEL_MENU,
  FILAS_DEL_MENU,
  GRUPOS_DEL_MENU,
  armarElMenu,
  type ClaveDeFila,
  type FilaDeAccion,
  type FilaDelMenu,
  type FilaDePantalla,
} from "../../apps/web/ui/navegacion/menu";
import { problemasDelMenu } from "../../apps/web/ui/navegacion/problemas-del-menu";

const fila = (clave: FilaDePantalla["clave"]): FilaDePantalla => {
  const f = FILAS_DEL_MENU.find((x) => x.clave === clave);
  if (f === undefined || f.tipo !== "pantalla") throw new Error(clave);
  return f;
};
const comprobantes = fila("comprobantes");
const ventaRapida = fila("venta-rapida");
const productos = fila("productos");
const secciones = fila("secciones");
const fiscal = fila("configuracion-fiscal");
const medios = fila("medios-de-pago");
const contacto = fila("contacto");
const salir = FILAS_DEL_MENU.find((x) => x.tipo === "accion") as FilaDeAccion;

const permisos = (
  acciones: readonly string[],
  activos: readonly string[] = [],
  enSoloLectura: readonly string[] = [],
) => ({ acciones, modulos: { activos, enSoloLectura } });

const claves = (areas: ReturnType<typeof armarElMenu>) =>
  areas.map((a) => [a.clave, a.grupos.map((g) => g.items.map((i) => i.clave))]);

describe("armarElMenu: todo nace cerrado", () => {
  it("sin permisos leídos no se muestra nada, ni siquiera las acciones", () => {
    expect(armarElMenu(FILAS_DEL_MENU, null, null)).toEqual([]);
  });

  it("una pantalla aparece solo con su módulo disponible y activo, y con su acción", () => {
    const a = permisos(["comprobantes.ver"], ["facturacion"]);
    expect(claves(armarElMenu([comprobantes], a, null))).toEqual([["ventas", [["comprobantes"]]]]);
    // sin la acción
    expect(armarElMenu([comprobantes], permisos([], ["facturacion"]), null)).toEqual([]);
    // sin el módulo, ni activo ni en solo lectura
    expect(armarElMenu([comprobantes], permisos(["comprobantes.ver"]), null)).toEqual([]);
    // con otra acción que no es la suya
    expect(
      armarElMenu([comprobantes], permisos(["comprobantes.emitir_manual"], ["facturacion"]), null),
    ).toEqual([]);
  });

  it("SUPUESTO (DEC-0059): con el módulo en solo lectura también aparece", () => {
    const a = permisos(["comprobantes.ver"], [], ["facturacion"]);
    expect(claves(armarElMenu([comprobantes], a, null))).toEqual([["ventas", [["comprobantes"]]]]);
  });

  it("catálogo y caja son disponibles (DEC-0463): aparecen solo con el módulo activo y la acción; sin cualquiera de las dos, nada", () => {
    const a = permisos(["productos.ver", "medios_de_pago.editar"], ["catalogo", "caja"]);
    const conTodo = claves(armarElMenu([productos, medios], a, null)).flatMap(([, grupos]) =>
      (grupos as string[][]).flat(),
    );
    expect(conTodo.sort()).toEqual(["medios-de-pago", "productos"]);
    const sinModulos = permisos(["productos.ver", "medios_de_pago.editar"]);
    expect(armarElMenu([productos, medios], sinModulos, null)).toEqual([]);
    const sinAcciones = permisos([], ["catalogo", "caja"]);
    expect(armarElMenu([productos, medios], sinAcciones, null)).toEqual([]);
  });

  it("las acciones («Cerrar sesión») aparecen siempre que se leyeron los permisos, sin ruta", () => {
    const areas = armarElMenu([salir], permisos([]), null);
    expect(areas).toHaveLength(1);
    expect(areas[0]?.grupos[0]?.items).toEqual([
      { tipo: "accion", clave: "cerrar-sesion", etiqueta: "cuenta.cerrar_sesion", href: null },
    ]);
  });

  it("agrupa por área y grupo, conserva el orden de las áreas y de las filas y no muestra lo vacío", () => {
    const todo = permisos(
      ["comprobantes.ver", "datos_fiscales.editar", "sucursales.editar"],
      ["facturacion", "administracion"],
    );
    const areas = armarElMenu([contacto, salir, fiscal, comprobantes], todo, null);
    expect(claves(areas)).toEqual([
      ["ventas", [["comprobantes"]]],
      ["cuenta", [["configuracion-fiscal"], ["contacto"], ["cerrar-sesion"]]],
    ]);
    // el orden de los grupos es el declarado, no el de las filas
    expect(areas[1]?.grupos.map((g) => g.clave)).toEqual(["empresa", "sucursal", "salir"]);
    expect(areas[0]).toMatchObject({
      etiqueta: "navegacion.area.ventas",
      icono: "comprobantes",
      fija: false,
    });
    expect(areas[1]).toMatchObject({ etiqueta: "navegacion.cuenta", fija: true });
    expect(areas[0]?.grupos[0]).toMatchObject({ clave: "comprobantes", etiqueta: null });
    expect(areas[1]?.grupos[0]).toMatchObject({ etiqueta: "navegacion.empresa" });
    expect(areas[0]?.grupos[0]?.items[0]).toEqual({
      tipo: "pantalla",
      clave: "comprobantes",
      etiqueta: "fiscal.pantalla.listado_titulo",
      href: comprobantes.href,
    });
  });

  it("un área solo aparece si le queda un grupo, y cada fila se decide por separado", () => {
    const a = permisos(["datos_fiscales.editar"], ["administracion"]);
    expect(claves(armarElMenu([comprobantes, fiscal, contacto], a, null))).toEqual([
      ["cuenta", [["configuracion-fiscal"]]],
    ]);
  });
});

describe("«Secciones»: la fila del grupo «Carta» de Catálogo (A8)", () => {
  it("exige el mismo módulo y la misma acción que «Productos» (las de su consulta, `productos.ver`)", () => {
    expect([secciones.modulo, secciones.accion, secciones.area]).toEqual([
      productos.modulo,
      productos.accion,
      productos.area,
    ]);
  });

  it("con el módulo disponible (simulado: hoy `catalogo` está en desarrollo y no se ve) el área Catálogo trae dos grupos: «Productos» sin encabezado y «Carta» con el suyo", () => {
    // El módulo `catalogo` sigue «en desarrollo» y no se ve; para mirar el armado se usa un módulo disponible con la acción de su consulta.
    const disponibles = [productos, secciones].map((f) => ({
      ...f,
      modulo: comprobantes.modulo,
      accion: comprobantes.accion,
    }));
    const areas = armarElMenu(disponibles, permisos(["comprobantes.ver"], ["facturacion"]), null);
    expect(areas.map((a) => a.clave)).toEqual(["catalogo"]);
    expect(areas[0]?.grupos.map((g) => [g.clave, g.etiqueta, g.items.map((i) => i.clave)])).toEqual(
      [
        ["productos", null, ["productos"]],
        ["carta", "navegacion.grupo.carta", ["secciones"]],
      ],
    );
  });

  it("un módulo «en desarrollo» no aparece aunque llegue la acción y figure activo (fila de prueba sobre `produccion`, que sigue en desarrollo)", () => {
    // Con catalogo, caja y ventas disponibles (DEC-0463) ninguna fila real del menú depende de un módulo en desarrollo: se prueba la regla con una fila armada.
    const enDesarrollo = { ...productos, modulo: "produccion" as const };
    expect(CATALOGO_DE_MODULOS.produccion.estado).toBe("en_desarrollo");
    expect(armarElMenu([enDesarrollo], permisos(["productos.ver"], ["produccion"]), null)).toEqual(
      [],
    );
    expect(
      armarElMenu([enDesarrollo], permisos(["productos.ver"], [], ["produccion"]), null),
    ).toEqual([]);
    // La misma fila con un módulo disponible sí se ve: lo que la oculta es el estado, no la forma de la fila.
    const disponible = { ...productos, modulo: "catalogo" as const };
    expect(armarElMenu([disponible], permisos(["productos.ver"], ["catalogo"]), null)).not.toEqual(
      [],
    );
  });

  it("con `catalogo` disponible (DEC-0463) se ve con la acción y el módulo activo; sin cualquiera de las dos, no", () => {
    const conTodo = armarElMenu([secciones], permisos(["productos.ver"], ["catalogo"]), null);
    expect(claves(conTodo)).toEqual([["catalogo", [["secciones"]]]]);
    expect(armarElMenu([secciones], permisos([], ["catalogo"]), null)).toEqual([]);
    expect(armarElMenu([secciones], permisos(["productos.ver"]), null)).toEqual([]);
  });
});

describe("la tabla real: lo declarado por pantalla", () => {
  it("cada fila lleva su área, grupo, módulo, acción, ruta y rótulo aprobados", () => {
    expect(
      FILAS_DEL_MENU.map((f) =>
        f.tipo === "pantalla"
          ? [f.clave, f.area, f.grupo, f.modulo, f.accion, f.href, f.etiqueta]
          : [f.clave, f.area, f.grupo, f.etiqueta],
      ),
    ).toEqual([
      [
        "venta-rapida",
        "ventas",
        "mostrador",
        "ventas",
        "ventas.ver",
        "/ventas/venta-rapida",
        "ventas.venta.menu",
      ],
      [
        "tickets-del-dia",
        "ventas",
        "mostrador",
        "ventas",
        "ventas.ver",
        "/ventas/tickets-del-dia",
        "ventas.tickets.menu",
      ],
      [
        "comprobantes",
        "ventas",
        "comprobantes",
        "facturacion",
        "comprobantes.ver",
        "/facturacion/comprobantes",
        "fiscal.pantalla.listado_titulo",
      ],
      ["caja", "ventas", "caja", "caja", "cajas.ver", "/caja", "caja.pantalla.titulo"],
      [
        "cierre-del-dia",
        "ventas",
        "caja",
        "cierre",
        "jornadas.ver",
        "/caja/cierre-del-dia",
        "cierre.titulo",
      ],
      ["salon", "ventas", "salon", "salon", "mesas.ver", "/salon", "salon.texto.grupo_salon"],
      ["mesas", "ventas", "salon", "salon", "mesas.ver", "/salon/mesas", "salon.texto.admin_mesas"],
      [
        "impresoras",
        "ventas",
        "salon",
        "comandas",
        "impresoras.ver",
        "/salon/impresoras",
        "comandas.texto.imprimir_impresoras",
      ],
      [
        "clientes",
        "ventas",
        "clientes",
        "clientes",
        "partes.ver",
        "/clientes?rol=cliente",
        "clientes.lista.clientes",
      ],
      [
        "productos",
        "catalogo",
        "productos",
        "catalogo",
        "productos.ver",
        "/catalogo/productos",
        "catalogo.lista.titulo",
      ],
      [
        "clasificacion",
        "catalogo",
        "productos",
        "catalogo",
        "productos.editar",
        "/catalogo/clasificacion",
        "catalogo.clasificacion.titulo",
      ],
      [
        "secciones",
        "catalogo",
        "carta",
        "catalogo",
        "productos.ver",
        "/catalogo/secciones",
        "catalogo.seccion.titulo",
      ],
      [
        "stock",
        "catalogo",
        "stock",
        "stock",
        "stock.ver",
        "/stock/existencias",
        "stock.pantalla.stock",
      ],
      [
        "produccion",
        "catalogo",
        "produccion",
        "produccion",
        "transformaciones.ver",
        "/catalogo/produccion",
        "produccion.pantalla.produccion",
      ],
      [
        "recetas",
        "catalogo",
        "produccion",
        "stock",
        "stock.ver",
        "/catalogo/recetas",
        "receta.pantalla.recetas",
      ],
      [
        "compras",
        "compras",
        "compras",
        "compras",
        "recepciones.ver",
        "/compras",
        "compras.compra.compras",
      ],
      [
        "nivel-de-compras",
        "compras",
        "compras",
        "compras",
        "compras.configurar",
        "/compras/nivel",
        "compras.nivel.titulo",
      ],
      [
        "recepciones",
        "compras",
        "compras",
        "compras",
        "recepciones.ver",
        "/compras/recepciones",
        "compras.recepcion.titulo_lista",
      ],
      [
        "facturas",
        "compras",
        "compras",
        "compras",
        "comprobantes_de_proveedor.ver",
        "/compras/facturas",
        "compras.factura.titulo_lista",
      ],
      [
        "proveedores",
        "compras",
        "proveedores",
        "clientes",
        "partes.ver",
        "/clientes?rol=proveedor",
        "clientes.lista.proveedores",
      ],
      [
        "configuracion-fiscal",
        "cuenta",
        "empresa",
        "administracion",
        "datos_fiscales.editar",
        "/configuracion-fiscal",
        "fiscal.pantalla.config_titulo",
      ],
      [
        "medios-de-pago",
        "cuenta",
        "empresa",
        "caja",
        "medios_de_pago.editar",
        "/caja/medios-de-pago",
        "caja.medios.titulo",
      ],
      [
        "usuarios",
        "cuenta",
        "empresa",
        "administracion",
        "usuarios.ver",
        "/cuenta/usuarios",
        "usuarios.lista.titulo",
      ],
      [
        "contacto",
        "cuenta",
        "sucursal",
        "administracion",
        "sucursales.editar",
        "/cuenta/contacto-de-la-sucursal",
        "sucursal.contacto_titulo",
      ],
      ["cerrar-sesion", "cuenta", "salir", "cuenta.cerrar_sesion"],
    ]);
  });
});

describe("armarElMenu: la columna de departamento (reservada)", () => {
  const ventasDe = (departamento: string | null): FilaDePantalla => ({
    ...comprobantes,
    departamento,
  });
  const a = permisos(["comprobantes.ver"], ["facturacion"]);
  const hay = (f: FilaDelMenu, elegido: string | null) => armarElMenu([f], a, elegido).length > 0;

  it("una fila sin departamento vale para todos, haya o no uno elegido", () => {
    expect(hay(ventasDe(null), null)).toBe(true);
    expect(hay(ventasDe(null), "d1")).toBe(true);
  });
  it("una fila con departamento se muestra solo si es el elegido; sin elegir no se asume «todos»", () => {
    expect(hay(ventasDe("d1"), "d1")).toBe(true);
    expect(hay(ventasDe("d1"), "d2")).toBe(false);
    expect(hay(ventasDe("d1"), null)).toBe(false);
  });
});

describe("problemasDelMenu: lo que la tabla real cumple y cada violación que se detecta", () => {
  const areas = AREAS_DEL_MENU;
  const grupos = GRUPOS_DEL_MENU;
  const tope = 3;
  const problemas = (
    filas: readonly FilaDelMenu[],
    a: readonly Readonly<{ clave: string; fija: boolean }>[] = areas,
    g: readonly Readonly<{ clave: string }>[] = grupos,
    t = tope,
  ) => problemasDelMenu(filas, a, g, t);

  it("la tabla real no tiene problemas", () => {
    expect(problemas(FILAS_DEL_MENU)).toEqual([]);
  });
  it("una fila con una función de otro módulo (violación inyectada)", () => {
    expect(problemas([{ ...productos, perilla: "salon" }])).toEqual([
      "productos: la función salon no es del módulo catalogo",
    ]);
  });
  it("sin filas es válida (reserva)", () => {
    expect(problemas([])).toEqual([]);
  });
  it("pasarse del tope de áreas en la barra", () => {
    const de = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ clave: `a${String(i)}`, fija: false }));
    expect(problemas([], de(3))).toEqual([]);
    expect(problemas([], de(4))).toEqual(["hay 4 áreas en la barra y el tope es 3"]);
    // el área fija no cuenta
    expect(problemas([], [...de(3), { clave: "z", fija: true }])).toEqual([]);
  });
  it("más de un área fija", () => {
    expect(
      problemas(
        [],
        [
          { clave: "a", fija: true },
          { clave: "b", fija: true },
        ],
      ),
    ).toEqual(["hay más de un área fija"]);
  });
  it("áreas, grupos y filas repetidos", () => {
    expect(
      problemas(
        [],
        [
          { clave: "a", fija: false },
          { clave: "a", fija: false },
        ],
      ),
    ).toEqual(["área repetido: a", "área repetido: a"]);
    expect(problemas([], areas, [{ clave: "g" }, { clave: "g" }])).toEqual([
      "grupo repetido: g",
      "grupo repetido: g",
    ]);
    expect(problemas([comprobantes, { ...comprobantes, href: "/otra" }])).toEqual([
      "fila repetido: comprobantes",
      "fila repetido: comprobantes",
    ]);
  });
  it("una fila con un área o un grupo sin declarar", () => {
    const sin = { ...comprobantes, area: "nada" } as unknown as FilaDelMenu;
    expect(problemas([sin])).toEqual(["comprobantes: el área nada no está declarada"]);
    const sinGrupo = { ...comprobantes, grupo: "nada" } as unknown as FilaDelMenu;
    expect(problemas([sinGrupo])).toEqual(["comprobantes: el grupo nada no está declarado"]);
  });
  it("solo Ventas puede llevar departamento", () => {
    expect(problemas([{ ...comprobantes, departamento: "d1" }])).toEqual([]);
    expect(problemas([{ ...fiscal, departamento: "d1" }])).toEqual([
      "configuracion-fiscal: solo Ventas puede llevar departamento",
    ]);
  });
  it("una acción que no es del módulo declarado, o un módulo inexistente", () => {
    expect(problemas([{ ...comprobantes, accion: "productos.ver" }])).toEqual([
      "comprobantes: la acción productos.ver no es del módulo facturacion",
    ]);
    const roto = { ...comprobantes, modulo: "constructor" } as unknown as FilaDelMenu;
    expect(problemas([roto])).toEqual([
      "comprobantes: la acción comprobantes.ver no es del módulo constructor",
    ]);
  });
  it("una ruta que no empieza con / o repetida", () => {
    expect(problemas([{ ...comprobantes, href: "x" }])).toEqual([
      "comprobantes: la ruta tiene que empezar con /",
    ]);
    expect(problemas([comprobantes, { ...productos, href: comprobantes.href }])).toEqual([
      "productos: la ruta /facturacion/comprobantes está repetida",
    ]);
  });
});

describe("«Venta rápida»: la fila del grupo «Mostrador» del área Ventas (dueño, 13/11/2026)", () => {
  it("con `ventas.ver` y el módulo `ventas` activo, el área Ventas trae el grupo «Mostrador» con «Venta rápida»", () => {
    const areas = armarElMenu([ventaRapida], permisos(["ventas.ver"], ["ventas"]), null);
    expect(areas.map((a) => a.clave)).toEqual(["ventas"]);
    expect(areas[0]?.grupos.map((g) => [g.clave, g.etiqueta, g.items.map((i) => i.clave)])).toEqual(
      [["mostrador", "navegacion.grupo.mostrador", ["venta-rapida"]]],
    );
    expect(areas[0]?.grupos[0]?.items[0]).toMatchObject({ etiqueta: "ventas.venta.menu" });
  });

  it("sin el permiso o sin el módulo activo la entrada no aparece", () => {
    expect(armarElMenu([ventaRapida], permisos([], ["ventas"]), null)).toEqual([]);
    expect(armarElMenu([ventaRapida], permisos(["ventas.ver"]), null)).toEqual([]);
  });
});

describe("«Salón» (SAL-A): la fila del mapa nace cerrada", () => {
  const salon = fila("salon");
  const conFunciones = (
    acciones: readonly string[],
    modulos: readonly string[],
    funciones?: readonly string[],
  ) => ({
    ...permisos(acciones, modulos),
    ...(funciones === undefined ? {} : { funcionesEncendidas: funciones }),
  });

  it("apunta al mapa, con la acción de lectura de mesas y la perilla `salon`", () => {
    expect(salon).toMatchObject({
      href: "/salon",
      modulo: "salon",
      accion: "mesas.ver",
      perilla: "salon",
      etiqueta: "salon.texto.grupo_salon",
    });
  });
  it("con el módulo, `mesas.ver` y la perilla encendida aparece", () => {
    expect(
      claves(armarElMenu([salon], conFunciones(["mesas.ver"], ["salon"], ["salon"]), null)),
    ).toEqual([["ventas", [["salon"]]]]);
  });
  it("sin `mesas.ver`, con la perilla apagada, sin leer las funciones o con el módulo apagado no aparece", () => {
    expect(armarElMenu([salon], conFunciones([], ["salon"], ["salon"]), null)).toEqual([]);
    expect(armarElMenu([salon], conFunciones(["mesas.ver"], ["salon"], []), null)).toEqual([]);
    expect(armarElMenu([salon], conFunciones(["mesas.ver"], ["salon"]), null)).toEqual([]);
    expect(armarElMenu([salon], conFunciones(["mesas.ver"], [], ["salon"]), null)).toEqual([]);
  });
});

describe("«Mesas»: la fila declara la función de pago `salon` (X-1b)", () => {
  const mesas = fila("mesas");
  const conFunciones = (funciones?: readonly string[]) => ({
    ...permisos(["mesas.ver"], ["salon"]),
    ...(funciones === undefined ? {} : { funcionesEncendidas: funciones }),
  });

  it("lleva la función `salon` y es del mismo módulo", () => {
    expect(mesas.perilla).toBe("salon");
    expect(
      FILAS_DEL_MENU.filter((f) => f.tipo === "pantalla" && f.perilla === "salon").map(
        (f) => f.clave,
      ),
    ).toEqual(["salon", "mesas"]);
  });
  it("con el módulo, la acción y la función encendida aparece", () => {
    expect(claves(armarElMenu([mesas], conFunciones(["salon"]), null))).toEqual([
      ["ventas", [["mesas"]]],
    ]);
  });
  it("con la función apagada no aparece", () => {
    expect(armarElMenu([mesas], conFunciones([]), null)).toEqual([]);
  });
  it("con las funciones sin leer (sin definir) no aparece", () => {
    expect(armarElMenu([mesas], conFunciones(), null)).toEqual([]);
  });
  it("una fila sin función no depende de las funciones leídas", () => {
    expect(claves(armarElMenu([ventaRapida], permisos(["ventas.ver"], ["ventas"]), null))).toEqual([
      ["ventas", [["venta-rapida"]]],
    ]);
  });
});

describe("las claves de las filas salen de la tabla (E-5)", () => {
  // Copiadas de `main` ANTES del cambio: una fila perdida, renombrada o reordenada rompe esta lista.
  const CLAVES_DE_HOY = [
    "venta-rapida",
    "tickets-del-dia",
    "comprobantes",
    "caja",
    "cierre-del-dia",
    "salon",
    "mesas",
    "impresoras",
    "clientes",
    "productos",
    "clasificacion",
    "secciones",
    "stock",
    "produccion",
    "recetas",
    "compras",
    "nivel-de-compras",
    "recepciones",
    "facturas",
    "proveedores",
    "configuracion-fiscal",
    "medios-de-pago",
    "usuarios",
    "contacto",
    "cerrar-sesion",
  ];
  const MENU_DE_HOY = [
    [
      "ventas",
      [
        [
          "mostrador",
          [
            ["pantalla", "venta-rapida", "/ventas/venta-rapida", "ventas.venta.menu"],
            ["pantalla", "tickets-del-dia", "/ventas/tickets-del-dia", "ventas.tickets.menu"],
          ],
        ],
        [
          "comprobantes",
          [
            [
              "pantalla",
              "comprobantes",
              "/facturacion/comprobantes",
              "fiscal.pantalla.listado_titulo",
            ],
          ],
        ],
        [
          "caja",
          [
            ["pantalla", "caja", "/caja", "caja.pantalla.titulo"],
            ["pantalla", "cierre-del-dia", "/caja/cierre-del-dia", "cierre.titulo"],
          ],
        ],
        [
          "salon",
          [
            ["pantalla", "salon", "/salon", "salon.texto.grupo_salon"],
            ["pantalla", "mesas", "/salon/mesas", "salon.texto.admin_mesas"],
            ["pantalla", "impresoras", "/salon/impresoras", "comandas.texto.imprimir_impresoras"],
          ],
        ],
        [
          "clientes",
          [["pantalla", "clientes", "/clientes?rol=cliente", "clientes.lista.clientes"]],
        ],
      ],
    ],
    [
      "catalogo",
      [
        [
          "productos",
          [
            ["pantalla", "productos", "/catalogo/productos", "catalogo.lista.titulo"],
            [
              "pantalla",
              "clasificacion",
              "/catalogo/clasificacion",
              "catalogo.clasificacion.titulo",
            ],
          ],
        ],
        ["carta", [["pantalla", "secciones", "/catalogo/secciones", "catalogo.seccion.titulo"]]],
        ["stock", [["pantalla", "stock", "/stock/existencias", "stock.pantalla.stock"]]],
        ["produccion", [["pantalla", "recetas", "/catalogo/recetas", "receta.pantalla.recetas"]]],
      ],
    ],
    [
      "compras",
      [
        [
          "compras",
          [
            ["pantalla", "compras", "/compras", "compras.compra.compras"],
            ["pantalla", "nivel-de-compras", "/compras/nivel", "compras.nivel.titulo"],
          ],
        ],
        [
          "proveedores",
          [["pantalla", "proveedores", "/clientes?rol=proveedor", "clientes.lista.proveedores"]],
        ],
      ],
    ],
    [
      "cuenta",
      [
        [
          "empresa",
          [
            [
              "pantalla",
              "configuracion-fiscal",
              "/configuracion-fiscal",
              "fiscal.pantalla.config_titulo",
            ],
            ["pantalla", "medios-de-pago", "/caja/medios-de-pago", "caja.medios.titulo"],
            ["pantalla", "usuarios", "/cuenta/usuarios", "usuarios.lista.titulo"],
          ],
        ],
        [
          "sucursal",
          [["pantalla", "contacto", "/cuenta/contacto-de-la-sucursal", "sucursal.contacto_titulo"]],
        ],
        ["salir", [["accion", "cerrar-sesion", null, "cuenta.cerrar_sesion"]]],
      ],
    ],
  ];

  it("la tabla tiene los mismos nombres que antes, en el mismo orden", () => {
    expect(FILAS_DEL_MENU.map((f) => f.clave)).toEqual(CLAVES_DE_HOY);
  });
  it("`ClaveDeFila` sigue cerrada: un nombre mal escrito no compila", () => {
    expectTypeOf<ClaveDeFila>().not.toEqualTypeOf<string>();
    expectTypeOf<"venta-rapida">().toExtend<ClaveDeFila>();
    expectTypeOf<"pantalla-que-no-existe">().not.toExtend<ClaveDeFila>();
  });
  it("el menú armado con la tabla real es el mismo que antes", () => {
    const acciones = [
      ...new Set(Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones))),
    ];
    const todo = {
      acciones,
      modulos: { activos: Object.keys(CATALOGO_DE_MODULOS), enSoloLectura: [] },
      funcionesEncendidas: ["salon"],
    };
    const areas = armarElMenu(FILAS_DEL_MENU, todo, null).map((a) => [
      a.clave,
      a.grupos.map((g) => [g.clave, g.items.map((i) => [i.tipo, i.clave, i.href, i.etiqueta])]),
    ]);
    expect(areas).toEqual(MENU_DE_HOY);
    expect(armarElMenu(FILAS_DEL_MENU, null, null)).toEqual([]);
  });
  it("sigue aceptando filas de prueba con claves inventadas", () => {
    const rara = { ...productos, clave: "fila-de-prueba", href: "/x" } as const;
    const areas = armarElMenu([rara], permisos(["productos.ver"], ["catalogo"]), null);
    expect(areas[0]?.grupos[0]?.items[0]?.clave).toBe("fila-de-prueba");
    expect(
      problemasDelMenu([rara, rara], AREAS_DEL_MENU, GRUPOS_DEL_MENU, 3).some((p) =>
        p.includes("fila repetido"),
      ),
    ).toBe(true);
  });
});
