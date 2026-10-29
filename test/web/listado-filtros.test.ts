import { describe, expect, it } from "vitest";
import { ESTADOS_DE_COMPROBANTE_ARCA } from "../../src/modulos/fiscal/publico";
import {
  armarLosFiltros,
  cantidadDeFiltrosActivos,
  conPuntoDeVentaDe,
  direccionDelDetalle,
  direccionDelListado,
  ESTADOS_DEL_FILTRO,
  FILTROS_POR_DEFECTO,
  leerLaPagina,
  leerLosFiltros,
  RUTA_DEL_LISTADO,
} from "../../apps/web/ui/plantillas/facturacion/filtros-del-listado";

/**
 * Los filtros del listado y cómo viajan por la dirección: lo inválido vuelve al valor por defecto, «Filtros (n)» cuenta lo que se
 * aparta del valor por defecto, «Limpiar» vuelve a «Este mes» y la dirección de la página siguiente conserva los filtros.
 */

describe("leer los filtros de la dirección", () => {
  it("sin nada: los valores por defecto, con «Este mes»", () => {
    expect(leerLosFiltros({})).toEqual(FILTROS_POR_DEFECTO);
    expect(FILTROS_POR_DEFECTO.periodo).toBe("mes");
  });

  it("lee cada filtro válido", () => {
    expect(
      leerLosFiltros({
        periodo: "personalizado",
        desde: "2026-10-01",
        hasta: "2026-10-14",
        estado: "RECHAZADO",
        letra: "A",
        puntoDeVenta: "12",
        texto: "  Sur  ",
      }),
    ).toEqual({
      periodo: "personalizado",
      desde: "2026-10-01",
      hasta: "2026-10-14",
      estado: "RECHAZADO",
      letra: "A",
      puntoDeVenta: "12",
      texto: "Sur",
    });
  });

  it.each([
    ["periodo", "ayer"],
    ["estado", "DESCARTADO"],
    ["estado", "PENDIENTE"],
    ["letra", "Z"],
    ["letra", "a"],
    ["puntoDeVenta", "1a"],
    ["puntoDeVenta", "123456"],
    ["puntoDeVenta", "-1"],
  ])("un %s inválido («%s») vuelve al valor por defecto", (nombre, valor) => {
    expect(leerLosFiltros({ [nombre]: valor })).toEqual(FILTROS_POR_DEFECTO);
  });

  it("las fechas solo valen con «Personalizado» y con forma de fecha", () => {
    expect(leerLosFiltros({ periodo: "hoy", desde: "2026-10-01", hasta: "2026-10-02" })).toEqual({
      ...FILTROS_POR_DEFECTO,
      periodo: "hoy",
    });
    expect(leerLosFiltros({ periodo: "personalizado", desde: "ayer", hasta: "2026-1-2" })).toEqual({
      ...FILTROS_POR_DEFECTO,
      periodo: "personalizado",
    });
  });

  it("si un parámetro viene repetido toma el primero", () => {
    expect(leerLosFiltros({ estado: ["AUTORIZADO", "RECHAZADO"] }).estado).toBe("AUTORIZADO");
  });

  it("la página que sigue: la clave tal cual, o ninguna", () => {
    expect(leerLaPagina({})).toBeNull();
    expect(leerLaPagina({ despues: "" })).toBeNull();
    expect(leerLaPagina({ despues: "abc|def" })).toBe("abc|def");
  });
});

describe("los estados del filtro son estados que la consulta conoce", () => {
  it("cada uno es un estado de la consulta (y no el descartado, que el listado oculta)", () => {
    for (const estado of ESTADOS_DEL_FILTRO) {
      expect(ESTADOS_DE_COMPROBANTE_ARCA as readonly string[]).toContain(estado);
    }
    expect(ESTADOS_DEL_FILTRO as readonly string[]).not.toContain("DESCARTADO");
  });
});

describe("«Filtros (n)» y «Limpiar»", () => {
  it("cuenta los filtros del panel que se apartan del valor por defecto (la búsqueda no cuenta)", () => {
    expect(cantidadDeFiltrosActivos(FILTROS_POR_DEFECTO)).toBe(0);
    expect(cantidadDeFiltrosActivos({ ...FILTROS_POR_DEFECTO, texto: "Sur" })).toBe(0);
    expect(cantidadDeFiltrosActivos({ ...FILTROS_POR_DEFECTO, periodo: "hoy" })).toBe(1);
    expect(
      cantidadDeFiltrosActivos({ ...FILTROS_POR_DEFECTO, periodo: "mes", estado: "RECHAZADO" }),
    ).toBe(1);
    expect(
      cantidadDeFiltrosActivos({
        ...FILTROS_POR_DEFECTO,
        periodo: "todo",
        estado: "INCIERTO",
        letra: "B",
        puntoDeVenta: "3",
      }),
    ).toBe(4);
  });

  it("«Limpiar» lleva al listado sin parámetros, que es «Este mes» sin otros filtros", () => {
    const armados = armarLosFiltros({ ...FILTROS_POR_DEFECTO, estado: "RECHAZADO" }, []);
    expect(armados.direccionDeLimpiar).toBe(RUTA_DEL_LISTADO);
    expect(leerLosFiltros({})).toEqual(FILTROS_POR_DEFECTO);
  });
});

describe("la dirección del listado", () => {
  it("sin filtros ni página es la ruta sola", () => {
    expect(direccionDelListado(FILTROS_POR_DEFECTO, null)).toBe("/facturacion/comprobantes");
  });

  it("conserva los filtros y suma la página, con la clave bien codificada", () => {
    const filtros = {
      ...FILTROS_POR_DEFECTO,
      periodo: "hoy",
      estado: "AUTORIZADO",
      texto: "Sur & Cía",
    } as const;
    const direccion = direccionDelListado(filtros, "2026-10-12T10:00:00.000000Z|abc");
    const url = new URL(direccion, "https://app.ejemplo.test");
    expect(url.pathname).toBe(RUTA_DEL_LISTADO);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      periodo: "hoy",
      estado: "AUTORIZADO",
      texto: "Sur & Cía",
      despues: "2026-10-12T10:00:00.000000Z|abc",
    });
  });

  it("lo que se escribe se lee igual (ida y vuelta)", () => {
    const filtros = {
      periodo: "personalizado",
      desde: "2026-09-30",
      hasta: "2026-10-14",
      estado: "INCIERTO",
      letra: "C",
      puntoDeVenta: "7",
      texto: "30-71234567-8",
    } as const;
    const url = new URL(direccionDelListado(filtros, null), "https://app.ejemplo.test");
    expect(leerLosFiltros(Object.fromEntries(url.searchParams))).toEqual(filtros);
  });

  it("el detalle es la ruta del listado más el id", () => {
    expect(direccionDelDetalle("abc")).toBe("/facturacion/comprobantes/abc");
  });
});

describe("el punto de venta de otra sucursal", () => {
  it("si no es uno de los de la sucursal se descarta: se ve «Todos» y no se filtra", () => {
    const filtros = { ...FILTROS_POR_DEFECTO, puntoDeVenta: "3" };
    expect(conPuntoDeVentaDe(filtros, [1, 2]).puntoDeVenta).toBe("");
    expect(conPuntoDeVentaDe(filtros, []).puntoDeVenta).toBe("");
    expect(conPuntoDeVentaDe(filtros, [1, 3]).puntoDeVenta).toBe("3");
  });
});

describe("los filtros armados para el formulario", () => {
  it("los textos y las opciones salen del catálogo", () => {
    const f = armarLosFiltros({ ...FILTROS_POR_DEFECTO, estado: "RECHAZADO" }, [1, 12]);
    expect(f.textos).toEqual({
      filtros: "Filtros (1)",
      periodo: "Período",
      desde: "Desde",
      hasta: "Hasta",
      estado: "Estado",
      letra: "Letra",
      puntoDeVenta: "Punto de venta",
      buscar: "Nombre o CUIT",
      aplicar: "Ver comprobantes",
      limpiar: "Limpiar",
      todos: "Todos",
      todas: "Todas",
    });
    expect(f.periodos.map((o) => o.etiqueta)).toEqual([
      "Hoy",
      "Últimos 7 días",
      "Este mes",
      "Todo",
      "Personalizado",
    ]);
    expect(f.estados.map((o) => o.etiqueta)).toEqual([
      "Autorizada",
      "Validando",
      "Confirmando",
      "Rechazada",
    ]);
    expect(f.letras.map((o) => o.etiqueta)).toEqual(["Factura A", "Factura B", "Factura C"]);
    expect(f.puntosDeVenta).toEqual([
      { valor: "1", etiqueta: "00001" },
      { valor: "12", etiqueta: "00012" },
    ]);
  });
});
