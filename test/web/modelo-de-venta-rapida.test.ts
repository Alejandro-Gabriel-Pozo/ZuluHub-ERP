import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DIEZMILESIMOS_POR_UNIDAD,
  MAXIMO_DE_DIEZMILESIMOS,
  aDiezmilesimos,
  agregarALaCuenta,
  cambiarCantidad,
  cantidadDelProductoEnLaCuenta,
  cantidadParaLeer,
  claveDeLinea,
  deDiezmilesimos,
  detalleDeLaLinea,
  esCantidadValida,
  formaDeCantidad,
  fraccionesOfrecidas,
  nombreDeLaUnidad,
  pedidoDeCotizacion,
  precioDeLaTarjeta,
  productosVisibles,
  quitarDeLaCuenta,
  rotuloDeFraccion,
  sePuedeAgregar,
  sumarCantidades,
  textosDeLaVenta,
  tieneOpciones,
  type LineaDeLaVenta,
  type ProductoDeLaVenta,
} from "../../apps/web/ui/plantillas/venta/modelo-de-venta-rapida";

const producto = (parcial: Partial<ProductoDeLaVenta> = {}): ProductoDeLaVenta => ({
  id: "p1",
  nombre: "Medialuna",
  seccionId: "s1",
  unidadDeVentaId: "UNIDAD",
  pasoMinimo: "1.0000",
  porcionesOfrecidas: [],
  precio: { tipo: "BASE", importe: "800.00" },
  variante: null,
  grupos: [],
  ...parcial,
});

describe("la cantidad: enteros de diezmilésimos, nunca decimales de coma flotante", () => {
  it("lee los decimales exactos y rechaza lo que no es una cantidad", () => {
    expect(aDiezmilesimos("1")).toBe(10000);
    expect(aDiezmilesimos("0.5")).toBe(5000);
    expect(aDiezmilesimos("0.1250")).toBe(1250);
    expect(aDiezmilesimos("0.3")).toBe(3000); // 0,1 + 0,2 no existe: es entero
    for (const malo of ["", "abc", "1,5", "-1", "1e3", " 1", "1.00001", "10000"]) {
      expect(aDiezmilesimos(malo), malo).toBeNull();
    }
    expect(aDiezmilesimos("9999")).toBe(MAXIMO_DE_DIEZMILESIMOS);
  });

  it("un error que no es de valor no se traga: sale tal cual", () => {
    expect(() => aDiezmilesimos(undefined as never)).toThrow();
  });

  it("escribe la cantidad canónica sin ceros de más", () => {
    expect(deDiezmilesimos(10000)).toBe("1");
    expect(deDiezmilesimos(15000)).toBe("1.5");
    expect(deDiezmilesimos(1250)).toBe("0.125");
    expect(deDiezmilesimos(10001)).toBe("1.0001");
    expect(deDiezmilesimos(MAXIMO_DE_DIEZMILESIMOS)).toBe("9999");
  });

  it("ida y vuelta: cualquier cantidad válida vuelve a ser la misma", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAXIMO_DE_DIEZMILESIMOS }), (n) => {
        expect(aDiezmilesimos(deDiezmilesimos(n))).toBe(n);
      }),
    );
  });

  it("es válida si es mayor que cero, hasta 9999 y múltiplo exacto del paso", () => {
    expect(esCantidadValida(10000, 10000)).toBe(true);
    expect(esCantidadValida(15000, 5000)).toBe(true);
    expect(esCantidadValida(1250 + 1250, 1250)).toBe(true);
    expect(esCantidadValida(0, 10000)).toBe(false);
    expect(esCantidadValida(-10000, 10000)).toBe(false);
    expect(esCantidadValida(15000, 10000)).toBe(false);
    expect(esCantidadValida(MAXIMO_DE_DIEZMILESIMOS + 10000, 10000)).toBe(false);
    expect(esCantidadValida(MAXIMO_DE_DIEZMILESIMOS, 10000)).toBe(true);
    expect(esCantidadValida(10000.5, 10000)).toBe(false);
    expect(esCantidadValida(10000, 0)).toBe(false);
    expect(esCantidadValida(10000, -5000)).toBe(false);
  });

  it("sumar nunca pasa del máximo", () => {
    expect(sumarCantidades(10000, 20000)).toBe(30000);
    expect(sumarCantidades(MAXIMO_DE_DIEZMILESIMOS, 10000)).toBe(MAXIMO_DE_DIEZMILESIMOS);
  });
});

describe("cómo se carga la cantidad de cada producto", () => {
  it("por unidad (paso 1), por fracciones y por medida (peso)", () => {
    expect(formaDeCantidad(producto())).toEqual({ tipo: "UNIDAD", paso: 10000 });
    expect(formaDeCantidad(producto({ pasoMinimo: "0.2500", porcionesOfrecidas: [2, 4] }))).toEqual(
      { tipo: "FRACCIONES", paso: 2500, porciones: [2, 4] },
    );
    expect(
      formaDeCantidad(producto({ unidadDeVentaId: "KILOGRAMO", pasoMinimo: "0.0010" })),
    ).toEqual({ tipo: "MEDIDA", paso: 10, unidadDeVentaId: "KILOGRAMO" });
    // «Unidad» con un paso que no es 1 y sin porciones no es un entero: es una medida.
    expect(formaDeCantidad(producto({ pasoMinimo: "0.5000" }))?.tipo).toBe("MEDIDA");
    // Una unidad que no es «Unidad» con paso 1 también es una medida: se escribe en su unidad.
    expect(formaDeCantidad(producto({ unidadDeVentaId: "LITRO" }))?.tipo).toBe("MEDIDA");
  });

  it("un paso que no se puede leer cierra: no se puede agregar", () => {
    for (const pasoMinimo of ["", "0", "abc", "-1"]) {
      const p = producto({ pasoMinimo });
      expect(formaDeCantidad(p), pasoMinimo).toBeNull();
      expect(sePuedeAgregar(p), pasoMinimo).toBe(false);
    }
  });

  it("las fracciones se leen con sus rótulos y nunca se inventa una", () => {
    expect(rotuloDeFraccion(5000)).toBe("½");
    expect(rotuloDeFraccion(2500)).toBe("¼");
    expect(rotuloDeFraccion(7500)).toBe("¾");
    expect(rotuloDeFraccion(1250)).toBe("⅛");
    expect(rotuloDeFraccion(3750)).toBe("⅜");
    expect(rotuloDeFraccion(6250)).toBe("⅝");
    expect(rotuloDeFraccion(8750)).toBe("⅞");
    expect(rotuloDeFraccion(3333)).toBeNull();
    expect(fraccionesOfrecidas([8, 2])).toEqual([
      { valor: 5000, rotulo: "½" },
      { valor: 1250, rotulo: "⅛" },
    ]);
    expect(fraccionesOfrecidas([3])).toEqual([]);
    const fracciones = formaDeCantidad(producto({ pasoMinimo: "0.2500", porcionesOfrecidas: [4] }));
    expect(cantidadParaLeer(15000, fracciones)).toBe("1 ½");
    expect(cantidadParaLeer(5000, fracciones)).toBe("½");
    expect(cantidadParaLeer(40000, fracciones)).toBe("4");
    expect(cantidadParaLeer(10001, fracciones)).toBe("1,0001");
    expect(
      cantidadParaLeer(15000, { tipo: "MEDIDA", paso: 10, unidadDeVentaId: "KILOGRAMO" }),
    ).toBe("1,5");
    expect(cantidadParaLeer(20000, null)).toBe("2");
  });

  it("la unidad de venta usa el nombre ya aprobado y no inventa ninguno", () => {
    expect(nombreDeLaUnidad("KILOGRAMO")).toBe("Kilogramo");
    expect(nombreDeLaUnidad("GRAMO")).toBe("Gramo");
    expect(nombreDeLaUnidad("NO_EXISTE")).toBeNull();
    expect(nombreDeLaUnidad("toString")).toBeNull();
  });
});

describe("lo que se ve de cada producto", () => {
  const textos = textosDeLaVenta();

  it("todos los textos existen y ninguno queda vacío", () => {
    for (const [clave, valor] of Object.entries(textos)) expect(valor, clave).not.toBe("");
    expect(textos.cantidadNoValida).toBe("Cantidad no válida");
    expect(textos.noPermitido).toBe("Esta acción no está permitida");
  });

  it("el precio es el del servidor formateado, «Según medida» o «Sin precio»", () => {
    expect(precioDeLaTarjeta(producto(), textos)).toBe("$ 800,00");
    expect(precioDeLaTarjeta(producto({ precio: { tipo: "SEGUN_MEDIDA" } }), textos)).toBe(
      "Según medida",
    );
    expect(precioDeLaTarjeta(producto({ precio: { tipo: "SIN_PRECIO" } }), textos)).toBe(
      "Sin precio",
    );
  });

  it("un producto sin precio no se agrega; uno con precio sí", () => {
    expect(sePuedeAgregar(producto({ precio: { tipo: "SIN_PRECIO" } }))).toBe(false);
    expect(sePuedeAgregar(producto())).toBe(true);
    expect(sePuedeAgregar(producto({ precio: { tipo: "SEGUN_MEDIDA" } }))).toBe(true);
  });

  it("«Con opciones» si tiene medida u opciones", () => {
    expect(tieneOpciones(producto())).toBe(false);
    expect(
      tieneOpciones(
        producto({ variante: { grupoId: "g", nombre: "Medida", esTamano: true, opciones: [] } }),
      ),
    ).toBe(true);
    expect(
      tieneOpciones(
        producto({
          grupos: [
            {
              id: "g",
              clase: "ADICIONAL",
              nombre: "Extra",
              obligatorio: false,
              admiteVarias: true,
              opciones: [],
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe("la búsqueda y las secciones", () => {
  const secciones = [
    { id: "s1", nombre: "Cafés" },
    { id: "s2", nombre: "Pizzas" },
  ];
  const lista = [
    producto({ id: "a", nombre: "Café con leche", seccionId: "s1" }),
    producto({ id: "b", nombre: "Muzzarella", seccionId: "s2" }),
    producto({ id: "c", nombre: "Alfajor", seccionId: null }),
    producto({ id: "d", nombre: "Pastafrola", seccionId: "otra-que-no-existe" }),
  ];
  const ids = (g: ReturnType<typeof productosVisibles>) =>
    g.map((x) => [x.seccion?.id ?? null, x.productos.map((p) => p.id)]);

  it("sin búsqueda muestra todo por sección y los sin sección al final, sin título", () => {
    expect(ids(productosVisibles(lista, secciones, "", null))).toEqual([
      ["s1", ["a"]],
      ["s2", ["b"]],
      [null, ["c", "d"]],
    ]);
  });

  it("busca por nombre sin importar tildes, mayúsculas ni el orden de las palabras", () => {
    expect(ids(productosVisibles(lista, secciones, "LECHE CAFE", null))).toEqual([["s1", ["a"]]]);
    expect(ids(productosVisibles(lista, secciones, "  muzar", null))).toEqual([]);
    // Todas las palabras tienen que estar: una sola que coincida no alcanza.
    expect(ids(productosVisibles(lista, secciones, "cafe muzzarella", null))).toEqual([]);
    expect(ids(productosVisibles(lista, secciones, "muzza", null))).toEqual([["s2", ["b"]]]);
  });

  it("una sección elegida deja solo esa; no hay resultados es una lista vacía", () => {
    expect(ids(productosVisibles(lista, secciones, "", "s2"))).toEqual([["s2", ["b"]]]);
    expect(productosVisibles(lista, secciones, "zzz", null)).toEqual([]);
  });

  it("buscar el nombre exacto de un producto siempre lo encuentra", () => {
    fc.assert(
      fc.property(fc.constantFrom(...lista), (p) => {
        expect(
          productosVisibles(lista, secciones, p.nombre, null).flatMap((g) => g.productos),
        ).toContain(p);
      }),
    );
  });
});

describe("la cuenta local", () => {
  const nueva = (extra: Partial<Parameters<typeof agregarALaCuenta>[1]> = {}) => ({
    productoId: "p1",
    varianteId: null,
    opcionIds: [] as string[],
    cantidad: 10000,
    ...extra,
  });

  it("misma configuración suma la cantidad exacta y no duplica la línea", () => {
    const una = agregarALaCuenta([], nueva());
    const dos = agregarALaCuenta(una, nueva({ cantidad: 5000 }));
    expect(dos).toHaveLength(1);
    expect(dos[0]?.cantidad).toBe(15000);
    expect(dos[0]?.revision).toBe(1);
    expect(una[0]?.cantidad).toBe(10000); // no muta la anterior
  });

  it("el orden en que se tocaron las opciones no importa", () => {
    expect(claveDeLinea("p", "v", ["b", "a"])).toBe(claveDeLinea("p", "v", ["a", "b"]));
    const cuenta = agregarALaCuenta(
      agregarALaCuenta([], nueva({ opcionIds: ["b", "a"] })),
      nueva({ opcionIds: ["a", "b"] }),
    );
    expect(cuenta).toHaveLength(1);
    expect(cuenta[0]?.opcionIds).toEqual(["a", "b"]);
  });

  it("otra medida u otra opción es otra línea", () => {
    const cuenta = agregarALaCuenta(
      agregarALaCuenta([], nueva({ varianteId: "m1" })),
      nueva({ varianteId: "m2" }),
    );
    expect(cuenta).toHaveLength(2);
    expect(agregarALaCuenta(cuenta, nueva({ opcionIds: ["x"] }))).toHaveLength(3);
    // Misma medida y otra opción también es otra línea (y la clave distingue las opciones).
    const conOpcion = agregarALaCuenta(
      agregarALaCuenta([], nueva({ varianteId: "m1" })),
      nueva({ varianteId: "m1", opcionIds: ["x"] }),
    );
    expect(conOpcion).toHaveLength(2);
    expect(claveDeLinea("p", "v", ["a"])).not.toBe(claveDeLinea("p", "v", ["b"]));
  });

  it("al juntar con la segunda línea, la primera no se toca", () => {
    const cuenta = agregarALaCuenta(agregarALaCuenta([], nueva()), nueva({ productoId: "p2" }));
    const sumada = agregarALaCuenta(cuenta, nueva({ productoId: "p2", cantidad: 20000 }));
    expect(sumada.map((l) => [l.productoId, l.cantidad, l.revision])).toEqual([
      ["p1", 10000, 0],
      ["p2", 30000, 1],
    ]);
  });

  it("al sumar nunca pasa de 9999", () => {
    const cuenta = agregarALaCuenta(
      agregarALaCuenta([], nueva({ cantidad: MAXIMO_DE_DIEZMILESIMOS })),
      nueva(),
    );
    expect(cuenta[0]?.cantidad).toBe(MAXIMO_DE_DIEZMILESIMOS);
  });

  it("cambiar la cantidad y quitar solo tocan su línea", () => {
    const cuenta = agregarALaCuenta(agregarALaCuenta([], nueva()), nueva({ productoId: "p2" }));
    const clave = cuenta[0]?.clave ?? "";
    expect(cambiarCantidad(cuenta, clave, 30000).map((l) => l.cantidad)).toEqual([30000, 10000]);
    expect(quitarDeLaCuenta(cuenta, clave).map((l) => l.productoId)).toEqual(["p2"]);
    expect(quitarDeLaCuenta(cuenta, "no-existe")).toHaveLength(2);
  });

  it("cuánto hay de un producto en la cuenta, sumando sus configuraciones", () => {
    const cuenta = agregarALaCuenta(
      agregarALaCuenta(
        agregarALaCuenta([], nueva({ varianteId: "m1" })),
        nueva({ varianteId: "m2", cantidad: 20000 }),
      ),
      nueva({ productoId: "p2" }),
    );
    expect(cantidadDelProductoEnLaCuenta(cuenta, "p1")).toBe(30000);
    expect(cantidadDelProductoEnLaCuenta(cuenta, "p3")).toBe(0);
  });

  it("el pedido de cotización lleva solo lo elegido y las cantidades como texto", () => {
    const cuenta: readonly LineaDeLaVenta[] = [
      {
        clave: "k1",
        productoId: "p1",
        varianteId: null,
        opcionIds: [],
        cantidad: 15000,
        revision: 0,
      },
      {
        clave: "k2",
        productoId: "p2",
        varianteId: "m1",
        opcionIds: ["o1", "o2"],
        cantidad: 1250,
        revision: 3,
      },
    ];
    expect(pedidoDeCotizacion(cuenta)).toEqual({
      lineas: [
        { productoId: "p1", opcionIds: [], cantidad: "1.5" },
        { productoId: "p2", varianteId: "m1", opcionIds: ["o1", "o2"], cantidad: "0.125" },
      ],
    });
    expect(pedidoDeCotizacion([])).toEqual({ lineas: [] });
    expect(JSON.stringify(pedidoDeCotizacion(cuenta))).not.toMatch(
      /precio|total|importe|sucursal|empresa/i,
    );
  });

  it("el detalle de la línea nombra la medida y las opciones en el orden del producto", () => {
    const p = producto({
      variante: {
        grupoId: "g",
        nombre: "Medida",
        esTamano: true,
        opciones: [{ id: "m1", nombre: "Mediano", precio: "3800.00" }],
      },
      grupos: [
        {
          id: "g2",
          clase: "ADICIONAL",
          nombre: "Adicionales",
          obligatorio: false,
          admiteVarias: true,
          opciones: [
            { id: "o1", nombre: "Leche de almendras", recargo: "700.00" },
            { id: "o2", nombre: "Canela", recargo: "0.00" },
          ],
        },
      ],
    });
    const linea = (varianteId: string | null, opcionIds: string[]): LineaDeLaVenta => ({
      clave: "k",
      productoId: "p1",
      varianteId,
      opcionIds,
      cantidad: DIEZMILESIMOS_POR_UNIDAD,
      revision: 0,
    });
    expect(detalleDeLaLinea(p, linea("m1", ["o2", "o1"]))).toEqual([
      "Mediano",
      "Leche de almendras",
      "Canela",
    ]);
    expect(detalleDeLaLinea(p, linea(null, []))).toEqual([]);
    // Un producto sin medidas (variante nula) solo tiene opciones.
    expect(detalleDeLaLinea(producto(), linea(null, []))).toEqual([]);
    // Un id que el producto ya no ofrece no se muestra: nunca se inventa un nombre.
    expect(detalleDeLaLinea(p, linea("viejo", ["fantasma"]))).toEqual([]);
  });
});
