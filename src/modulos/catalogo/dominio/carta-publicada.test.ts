import { describe, expect, it } from "vitest";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import {
  armarVidrieraPublicada,
  type CartaLeida,
  type GrupoLeido,
  type PrecioLeido,
  type ProductoLeido,
} from "./carta-publicada";

/**
 * La carta que ve el comensal, con los valores del ensayo de la carta real (§8.1 y §8.2): lo que sale, a qué precio, en qué orden y por qué lo que no sale no sale.
 * Pura: sin base. La base real la ejerce `test/integracion/carta-publica-lectura.test.ts` con el rol público verdadero.
 */
const S1 = sucursalId("00000000-0000-4000-8000-0000000000a1");
const S2 = sucursalId("00000000-0000-4000-8000-0000000000a2");
const MARCA = "00000000-0000-4000-8000-0000000000b1";
const empresa = (precio: string | null): PrecioLeido => ({ precio, sucursalId: null });
const sucursal = (precio: string | null, s = S1): PrecioLeido => ({ precio, sucursalId: s });

const producto = (
  id: string,
  nombre: string,
  seccionId: string,
  extra: Partial<ProductoLeido> = {},
): ProductoLeido => ({
  id,
  nombre,
  descripcion: null,
  seccionId,
  activo: true,
  precioBase: empresa("1000"),
  grupos: [],
  ...extra,
});

const GUARNICION: GrupoLeido = {
  titulo: "Guarnición",
  clase: "INCLUIDA",
  esObligatorio: true,
  opciones: ["Puré", "Ensalada", "Papas fritas"].map((nombre) => ({
    nombre,
    recargoDeLaVersion: "0",
    precio: null,
  })),
};
const EXTRAS: GrupoLeido = {
  titulo: "Extras",
  clase: "ADICIONAL",
  esObligatorio: false,
  opciones: [{ nombre: "Huevo frito", recargoDeLaVersion: "400", precio: null }],
};
const TAMANO: GrupoLeido = {
  titulo: "Tamaño",
  clase: "VARIANTE",
  esObligatorio: true,
  opciones: [
    { nombre: "Chico", recargoDeLaVersion: "0", precio: empresa("2000") },
    { nombre: "Mediano", recargoDeLaVersion: "0", precio: empresa("2500") },
    { nombre: "Grande", recargoDeLaVersion: "0", precio: empresa("3000") },
  ],
};

/** El ensayo de §8.1: secciones Entradas, Platos, Postres, Cafetería y los productos con su precio. */
function ensayo(cambios: Partial<CartaLeida> = {}): CartaLeida {
  return {
    carta: {
      id: "00000000-0000-4000-8000-0000000000c1",
      codigo: "Ab3dEf6hIj9lMn2pQr5tUv",
      nombre: "Parador El Ensayo",
      rubro: null,
      lugar: null,
      mensajeDePortada: null,
      estado: "EN_LINEA",
      sucursalId: S1,
    },
    sucursalActiva: true,
    marcaId: MARCA,
    estadoDeLaEmpresa: "ACTIVE",
    estadoDelTenant: "ACTIVE",
    secciones: [
      { id: "entradas", nombre: "Entradas", activa: true },
      { id: "platos", nombre: "Platos", activa: true },
      { id: "postres", nombre: "Postres", activa: true },
      { id: "cafeteria", nombre: "Cafetería", activa: true },
      { id: "meriendas", nombre: "Meriendas", activa: false },
    ],
    productos: [
      producto("p-cafe", "Café", "cafeteria", { precioBase: null, grupos: [TAMANO] }),
      producto("p-empanada", "Empanada de carne", "entradas", {
        precioBase: empresa("1500"),
        descripcion: "Frita o al horno",
      }),
      producto("p-flan", "Flan", "postres", { precioBase: empresa("4200.50") }),
      producto("p-helado", "Helado", "postres", { precioBase: null }),
      producto("p-milanesa", "Milanesa napolitana", "platos", {
        precioBase: empresa("9500"),
        grupos: [GUARNICION, EXTRAS],
      }),
      producto("p-budin", "Budín", "meriendas", { precioBase: empresa("2800") }),
      producto("p-sopa", "Sopa del día", "sin-seccion", { precioBase: empresa("3000") }),
      producto("p-tarta", "Tarta de ricota", "postres", {
        precioBase: empresa("3800"),
        activo: false,
      }),
    ],
    disponibilidad: [],
    ...cambios,
  };
}

const nombres = (v: ReturnType<typeof armarVidrieraPublicada>) =>
  v?.secciones.map((s) => [s.nombre, s.productos.map((p) => p.nombre)]);

describe("L-1: lo que sale y en qué orden", () => {
  it("las secciones activas en su orden, con sus productos; sin precio, sin sección, desactivados o en sección apagada no salen", () => {
    const v = armarVidrieraPublicada(ensayo(), MARCA);
    expect(nombres(v)).toEqual([
      ["Entradas", ["Empanada de carne"]],
      ["Platos", ["Milanesa napolitana"]],
      ["Postres", ["Flan"]],
      ["Cafetería", ["Café"]],
    ]);
  });

  it("los datos de la carta pasan tal cual; el rubro y el lugar nulos pasan nulos; el mensaje de portada viaja; la letra es la normal; sin agotado ni foto", () => {
    const v = armarVidrieraPublicada(
      ensayo({
        carta: {
          ...ensayo().carta,
          rubro: "Parrilla",
          lugar: "Huinganco",
          mensajeDePortada: "Desliza para ver el menú",
        },
      }),
      MARCA,
    );
    expect(v).toMatchObject({
      id: "00000000-0000-4000-8000-0000000000c1",
      codigo: "Ab3dEf6hIj9lMn2pQr5tUv",
      nombre: "Parador El Ensayo",
      rubro: "Parrilla",
      lugar: "Huinganco",
      mensajeDePortada: "Desliza para ver el menú",
      letraBase: "NORMAL",
    });
    const sinNada = armarVidrieraPublicada(ensayo(), MARCA);
    expect([sinNada?.rubro, sinNada?.lugar, sinNada?.mensajeDePortada]).toEqual([null, null, null]);
    for (const p of sinNada?.secciones.flatMap((s) => s.productos) ?? []) {
      expect([p.agotado, p.foto]).toEqual([false, null]);
    }
  });

  it("el orden de la entrada se respeta: dos productos de una sección salen como llegaron (la base los ordena por nombre y id)", () => {
    const v = armarVidrieraPublicada(
      ensayo({
        productos: [
          producto("a", "Flan", "postres"),
          producto("b", "Helado", "postres"),
          producto("c", "Alfajor", "postres"),
        ],
      }),
      MARCA,
    );
    expect(v?.secciones[0]?.productos.map((p) => p.nombre)).toEqual(["Flan", "Helado", "Alfajor"]);
  });

  it("L-6: la descripción viaja y la ausencia es nula", () => {
    const v = armarVidrieraPublicada(ensayo(), MARCA);
    const todos = v?.secciones.flatMap((s) => s.productos) ?? [];
    expect(todos.find((p) => p.nombre === "Empanada de carne")?.descripcion).toBe(
      "Frita o al horno",
    );
    expect(todos.find((p) => p.nombre === "Flan")?.descripcion).toBeNull();
  });
});

describe("L-2 y L-3: precios, tamaños, guarnición y extras", () => {
  const delProducto = (nombre: string, cambios: Partial<CartaLeida> = {}) =>
    armarVidrieraPublicada(ensayo(cambios), MARCA)
      ?.secciones.flatMap((s) => s.productos)
      .find((p) => p.nombre === nombre);

  it("un producto sin tamaños sale con su precio base en texto exacto", () => {
    expect(delProducto("Flan")).toMatchObject({
      precioBase: "4200.50",
      tamanos: [],
      obligatorios: [],
      adicionales: [],
    });
  });

  it("con tamaños: precio base «0» y el precio FINAL de cada tamaño como recargo, en el orden del comerciante", () => {
    // El grupo de tamaño NO se repite entre los obligatorios ni los adicionales: ya está en `tamanos`.
    expect(delProducto("Café")).toMatchObject({
      obligatorios: [],
      adicionales: [],
      precioBase: "0",
      tamanos: [
        { nombre: "Chico", recargo: "2000" },
        { nombre: "Mediano", recargo: "2500" },
        { nombre: "Grande", recargo: "3000" },
      ],
    });
  });

  it("L-3: el Grande con precio propio de la sucursal (la fila que resolvió `precio_vigente`) sale a ese precio; los otros tamaños no cambian", () => {
    const cafe = producto("p-cafe", "Café", "cafeteria", {
      precioBase: null,
      grupos: [
        {
          ...TAMANO,
          opciones: TAMANO.opciones.map((o) =>
            o.nombre === "Grande" ? { ...o, precio: sucursal("3200") } : o,
          ),
        },
      ],
    });
    expect(
      delProducto("Café", { productos: [cafe] })?.tamanos.map((t) => [t.nombre, t.recargo]),
    ).toEqual([
      ["Chico", "2000"],
      ["Mediano", "2500"],
      ["Grande", "3200"],
    ]);
  });

  it("un tamaño sin precio no sale; si NINGUNO tiene precio, el producto no sale", () => {
    const sinGrande = producto("p-cafe", "Café", "cafeteria", {
      precioBase: null,
      grupos: [
        {
          ...TAMANO,
          opciones: TAMANO.opciones.map((o) =>
            o.nombre === "Grande" ? { ...o, precio: empresa(null) } : o,
          ),
        },
      ],
    });
    expect(delProducto("Café", { productos: [sinGrande] })?.tamanos.map((t) => t.nombre)).toEqual([
      "Chico",
      "Mediano",
    ]);
    const ninguno = producto("p-cafe", "Café", "cafeteria", {
      precioBase: null,
      grupos: [
        {
          ...TAMANO,
          opciones: TAMANO.opciones.map((o) => ({
            ...o,
            precio: o.nombre === "Chico" ? null : empresa(null),
          })),
        },
      ],
    });
    expect(delProducto("Café", { productos: [ninguno] })).toBeUndefined();
  });

  it("L-2: la guarnición incluida va como obligatoria con recargo 0 y el extra como adicional con el recargo de la empresa", () => {
    expect(delProducto("Milanesa napolitana")).toMatchObject({
      precioBase: "9500",
      obligatorios: [
        {
          titulo: "Guarnición",
          opciones: [
            { nombre: "Puré", recargo: "0" },
            { nombre: "Ensalada", recargo: "0" },
            { nombre: "Papas fritas", recargo: "0" },
          ],
        },
      ],
      adicionales: [{ titulo: "Extras", opciones: [{ nombre: "Huevo frito", recargo: "400" }] }],
    });
  });

  it("el recargo propio de la sucursal gana sobre el de la empresa; la fila de la empresa o con precio nulo no cuenta como propia", () => {
    const extras = (precio: PrecioLeido | null): GrupoLeido => ({
      ...EXTRAS,
      opciones: [{ nombre: "Huevo frito", recargoDeLaVersion: "400", precio }],
    });
    const con = (precio: PrecioLeido | null) =>
      delProducto("Milanesa napolitana", {
        productos: [
          producto("p-milanesa", "Milanesa napolitana", "platos", {
            grupos: [GUARNICION, extras(precio)],
          }),
        ],
      })?.adicionales[0]?.opciones[0]?.recargo;
    expect(con(sucursal("550"))).toBe("550");
    expect(con(sucursal(null))).toBe("400");
    expect(con(empresa("550"))).toBe("400");
    expect(con(null)).toBe("400");
  });

  it("un adicional OBLIGATORIO va con los obligatorios (con su recargo) y una incluida opcional va con los adicionales en 0; un grupo sin opciones se omite", () => {
    const extrasObligatorios: GrupoLeido = {
      ...EXTRAS,
      titulo: "Salsa",
      esObligatorio: true,
      opciones: [{ nombre: "Criolla", recargoDeLaVersion: "300", precio: null }],
    };
    const incluidaOpcional: GrupoLeido = {
      ...GUARNICION,
      titulo: "Aderezos",
      esObligatorio: false,
      opciones: [{ nombre: "Sal", recargoDeLaVersion: "0", precio: null }],
    };
    const vacio: GrupoLeido = { ...EXTRAS, titulo: "Vacío", opciones: [] };
    const p = delProducto("Milanesa napolitana", {
      productos: [
        producto("p-milanesa", "Milanesa napolitana", "platos", {
          grupos: [GUARNICION, extrasObligatorios, incluidaOpcional, vacio],
        }),
      ],
    });
    expect(p?.obligatorios.map((g) => [g.titulo, g.opciones.map((o) => o.recargo)])).toEqual([
      ["Guarnición", ["0", "0", "0"]],
      ["Salsa", ["300"]],
    ]);
    expect(p?.adicionales.map((g) => [g.titulo, g.opciones.map((o) => o.recargo)])).toEqual([
      ["Aderezos", ["0"]],
    ]);
  });

  it("una opción INCLUIDA va siempre con recargo 0, aunque su versión o una fila de la sucursal digan otra cosa; el grupo de tamaño, aunque no fuera obligatorio, no cae en los adicionales", () => {
    const conRecargo: GrupoLeido = {
      ...GUARNICION,
      opciones: [{ nombre: "Puré", recargoDeLaVersion: "50", precio: sucursal("70") }],
    };
    const noObligatoria: GrupoLeido = { ...TAMANO, esObligatorio: false };
    const p = delProducto("Café", {
      productos: [
        producto("p-cafe", "Café", "cafeteria", {
          precioBase: null,
          grupos: [noObligatoria, conRecargo],
        }),
      ],
    });
    expect(p?.obligatorios[0]?.opciones).toEqual([{ nombre: "Puré", recargo: "0" }]);
    expect(p?.adicionales).toEqual([]);
    const opcional = delProducto("Café", {
      productos: [
        producto("p-cafe", "Café", "cafeteria", {
          precioBase: null,
          grupos: [noObligatoria, { ...conRecargo, esObligatorio: false }],
        }),
      ],
    });
    expect(opcional?.adicionales[0]?.opciones).toEqual([{ nombre: "Puré", recargo: "0" }]);
    expect(opcional?.adicionales).toHaveLength(1);
  });

  it("L-4: el producto sin precio sale en cuanto tiene uno de la empresa o de la sucursal", () => {
    const helado = (precio: PrecioLeido | null) =>
      producto("p-helado", "Helado", "postres", { precioBase: precio });
    expect(delProducto("Helado", { productos: [helado(null)] })).toBeUndefined();
    expect(delProducto("Helado", { productos: [helado(empresa(null))] })).toBeUndefined();
    expect(delProducto("Helado", { productos: [helado(empresa("3500"))] })?.precioBase).toBe(
      "3500",
    );
    expect(delProducto("Helado", { productos: [helado(sucursal("3600"))] })?.precioBase).toBe(
      "3600",
    );
  });
});

describe("D-1 a D-3: lo oculto, activo y desactivado", () => {
  const sale = (nombre: string, cambios: Partial<CartaLeida>) =>
    armarVidrieraPublicada(ensayo(cambios), MARCA)?.secciones.some((s) =>
      s.productos.some((p) => p.nombre === nombre),
    ) === true;
  const fila = (productoId: string, s: typeof S1 | null, oculto: boolean) => ({
    productoId: productoId as never,
    sucursalId: s,
    oculto,
  });

  it("oculto en el local o en toda la empresa no sale; oculto en OTRO local sí; la empresa vuelta a mostrar tampoco oculta", () => {
    expect(sale("Flan", { disponibilidad: [fila("p-flan", S1, true)] })).toBe(false);
    expect(sale("Flan", { disponibilidad: [fila("p-flan", null, true)] })).toBe(false);
    expect(sale("Flan", { disponibilidad: [fila("p-flan", S2, true)] })).toBe(true);
    expect(sale("Flan", { disponibilidad: [fila("p-flan", S1, false)] })).toBe(true);
    expect(
      sale("Flan", { disponibilidad: [fila("p-flan", null, false), fila("p-flan", S2, true)] }),
    ).toBe(true);
    // Un local no puede «mostrar» lo que la empresa oculta.
    expect(
      sale("Flan", { disponibilidad: [fila("p-flan", null, true), fila("p-flan", S1, false)] }),
    ).toBe(false);
    // Lo oculto de un producto no afecta a otro.
    expect(sale("Flan", { disponibilidad: [fila("p-empanada", S1, true)] })).toBe(true);
  });

  it("una sección que se queda sin productos no sale; el producto desactivado no sale aunque no esté oculto", () => {
    const v = armarVidrieraPublicada(
      ensayo({ disponibilidad: [fila("p-empanada", S1, true)] }),
      MARCA,
    );
    expect(v?.secciones.map((s) => s.nombre)).toEqual(["Platos", "Postres", "Cafetería"]);
    expect(sale("Tarta de ricota", {})).toBe(false);
  });

  it("L-7: sin sección apagada ni productos de esa sección, vuelve cuando la sección se prende", () => {
    const apagada = ensayo({
      secciones: ensayo().secciones.map((s) => (s.id === "postres" ? { ...s, activa: false } : s)),
    });
    expect(sale("Flan", apagada)).toBe(false);
    expect(sale("Flan", ensayo())).toBe(true);
  });
});

describe("la carta no se sirve: una sola respuesta, `null`", () => {
  it("retirada, sucursal cerrada, de otra marca o con la empresa o el tenant sin operar", () => {
    const sirve = (cambios: Partial<CartaLeida>, marca = MARCA) =>
      armarVidrieraPublicada(ensayo(cambios), marca) !== null;
    expect(sirve({})).toBe(true);
    expect(sirve({ carta: { ...ensayo().carta, estado: "FUERA_DE_LINEA" } })).toBe(false);
    expect(sirve({ sucursalActiva: false })).toBe(false);
    expect(sirve({}, "00000000-0000-4000-8000-0000000000b2")).toBe(false);
    for (const estadoDeLaEmpresa of [
      "PROVISIONING",
      "SUSPENDED",
      "CANCELLED",
      "DELETING",
    ] as const) {
      expect(sirve({ estadoDeLaEmpresa }), estadoDeLaEmpresa).toBe(false);
    }
    expect(sirve({ estadoDelTenant: "SUSPENDED" })).toBe(false);
  });

  it("una carta sin ningún producto que salga se sirve igual, vacía (poner en línea lo impide en la acción, no acá)", () => {
    expect(armarVidrieraPublicada(ensayo({ productos: [] }), MARCA)?.secciones).toEqual([]);
  });
});
