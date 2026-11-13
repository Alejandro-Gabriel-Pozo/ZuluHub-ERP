import { describe, expect, it } from "vitest";
import {
  AREAS_DEL_MENU,
  FILAS_DEL_MENU,
  GRUPOS_DEL_MENU,
  armarElMenu,
  problemasDelMenu,
  type FilaDeAccion,
  type FilaDelMenu,
  type FilaDePantalla,
} from "../../apps/web/ui/navegacion/menu";

const fila = (clave: FilaDePantalla["clave"]): FilaDePantalla => {
  const f = FILAS_DEL_MENU.find((x) => x.clave === clave);
  if (f === undefined || f.tipo !== "pantalla") throw new Error(clave);
  return f;
};
const comprobantes = fila("comprobantes");
const productos = fila("productos");
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

  it("un módulo «en desarrollo» no aparece aunque llegue la acción y figure activo", () => {
    const a = permisos(["productos.ver", "medios_de_pago.editar"], ["catalogo", "caja"]);
    expect(armarElMenu([productos, medios], a, null)).toEqual([]);
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
        "comprobantes",
        "ventas",
        "comprobantes",
        "facturacion",
        "comprobantes.ver",
        "/facturacion/comprobantes",
        "fiscal.pantalla.listado_titulo",
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
