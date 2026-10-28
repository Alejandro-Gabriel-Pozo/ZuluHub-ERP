import { describe, expect, it } from "vitest";
import {
  BARBERIA,
  CAFETERIA,
  VIDRIERAS_DE_EJEMPLO,
  HOSTERIA,
  PANADERIA,
  type VidrieraDeEjemplo,
} from "../../../../test/fixtures/vidrieras";
import type { VidrieraPublicada } from "../../../puertos/vidriera-publica";
import { resolverProductoPorSegmento } from "./direccion";
import {
  GUARNICION_A_ELECCION,
  LARGO_MAXIMO_DE_LA_GUARNICION,
  armarVistaDeVidriera,
  formatearImporte,
  type VistaDeVidriera,
} from "./vista";

/** Una carta de ejemplo como la devolvería el puerto (el falso hace lo mismo con sus datos). */
function publicada(c: VidrieraDeEjemplo, lugar: string | null = null): VidrieraPublicada {
  return {
    id: c.id,
    codigo: c.codigo,
    nombre: c.nombre,
    rubro: c.rubro,
    lugar,
    letraBase: "NORMAL",
    secciones: c.secciones,
  };
}

const vista = (c: VidrieraDeEjemplo, ruta = `/${c.codigo}`): VistaDeVidriera =>
  armarVistaDeVidriera(publicada(c), ruta);

const productos = (v: VistaDeVidriera) => v.secciones.flatMap((s) => s.productos);
const producto = (v: VistaDeVidriera, nombre: string) => {
  const p = productos(v).find((x) => x.nombre === nombre);
  if (p === undefined) throw new Error(`falta ${nombre}`);
  return p;
};

describe("formatearImporte (es-AR, D3)", () => {
  const ars = (monto: string) => ({ moneda: "ARS", monto });

  it.each([
    ["0.00", "$ 0"],
    ["5.00", "$ 5"],
    ["99.00", "$ 99"],
    ["100.00", "$ 100"],
    ["999.00", "$ 999"],
    ["1000.00", "$ 1.000"],
    ["2500.00", "$ 2.500"],
    ["12345.00", "$ 12.345"],
    ["123456.00", "$ 123.456"],
    ["1234567.00", "$ 1.234.567"],
    ["24133.34", "$ 24.133,34"],
    ["2500.50", "$ 2.500,50"],
    ["0.05", "$ 0,05"],
    ["10.10", "$ 10,10"],
  ])("%s → %s (centavos solo si no son cero)", (monto, esperado) => {
    expect(formatearImporte(ars(monto))).toBe(esperado);
  });

  it("el texto de «a elección» es el del spec (§3.1)", () => {
    expect(GUARNICION_A_ELECCION).toBe("Con guarnición a elección");
  });

  it("sin parte decimal también anda", () => {
    expect(formatearImporte(ars("2500"))).toBe("$ 2.500");
  });

  it("otra moneda lleva su código en vez del signo", () => {
    expect(formatearImporte({ moneda: "USD", monto: "10.00" })).toBe("USD 10");
  });
});

describe("armarVistaDeVidriera: la cafetería", () => {
  const v = vista(CAFETERIA);

  it("conserva el nombre, el rubro, el lugar y el orden de las secciones", () => {
    const con = armarVistaDeVidriera(publicada(CAFETERIA, "Av. Belgrano 412"), "/x");
    expect(con.nombre).toBe("La Esquina Café");
    expect(con.rubro).toBe(CAFETERIA.rubro);
    expect(con.lugar).toBe("Av. Belgrano 412");
    expect(v.lugar).toBeNull();
    expect(v.secciones.map((s) => s.nombre)).toEqual(CAFETERIA.secciones.map((s) => s.nombre));
    expect(v.totalDeProductos).toBe(60);
    expect(v.letraBase).toBe("NORMAL");
  });

  it("la letra base de la carta pasa tal cual", () => {
    expect(
      armarVistaDeVidriera({ ...publicada(CAFETERIA), letraBase: "GRANDE" }, "/x").letraBase,
    ).toBe("GRANDE");
  });

  it("las secciones llevan un ancla con el slug del nombre", () => {
    expect(v.secciones.map((s) => s.id)).toEqual([
      "cafes",
      "infusiones",
      "bebidas-frias",
      "desayunos-y-meriendas",
      "salados",
      "pasteleria",
    ]);
  });

  it("con tamaños el precio de la lista es «desde» el menor", () => {
    const p = producto(v, "Capuchino");
    expect(p.precioEnLista).toBe("desde $ 3.300");
    expect(p.tamanos).toEqual([
      { nombre: "Chico", precio: "$ 3.300" },
      { nombre: "Mediano", precio: "$ 3.700" },
      { nombre: "Grande", precio: "$ 4.100" },
    ]);
  });

  it("sin variantes el precio es el de siempre, sin «desde»", () => {
    const p = producto(v, "Alfajor de maicena");
    expect(p.precioEnLista).toBe("$ 1.500");
    expect(p.tamanos).toEqual([]);
    expect(p.guarnicion).toBeNull();
  });

  it("la guarnición sin recargo sale como una línea bajo el nombre", () => {
    const con = productos(v).filter((p) => p.guarnicion !== null);
    expect(con.length).toBeGreaterThanOrEqual(4);
    expect(con.every((p) => p.guarnicion === "Con papas fritas, puré o ensalada")).toBe(true);
  });

  it("los adicionales con recargo salen con «+ $ …» y el que no cobra, solo con el nombre", () => {
    const p = producto(v, "Capuchino");
    expect(p.adicionales).toEqual([
      {
        titulo: "Para sumar",
        opciones: [
          { nombre: "Leche de almendras", recargo: "+ $ 600" },
          { nombre: "Shot extra", recargo: "+ $ 700" },
          { nombre: "Crema", recargo: null },
        ],
      },
    ]);
  });

  it("marca los agotados y conserva la descripción", () => {
    expect(producto(v, "Café helado").agotado).toBe(true);
    expect(producto(v, "Espresso").agotado).toBe(false);
    expect(producto(v, "Capuchino").descripcion).toBe("Espresso, leche espumada y cacao amargo.");
    expect(producto(v, "Espresso").descripcion).toBeNull();
  });

  it("los enlaces cuelgan de la ruta pública y resuelven al producto de origen", () => {
    const p = producto(v, "Capuchino");
    expect(p.href).toBe(`/ejemplo-cafeteria/${p.segmento}`);
    const todos = CAFETERIA.secciones.flatMap((s) => s.productos);
    const r = resolverProductoPorSegmento(
      CAFETERIA.id,
      todos.map((x) => ({ productoId: x.id, nombre: x.nombre })),
      p.segmento,
    );
    expect(r.ok && todos.find((x) => x.id === r.valor.productoId)?.nombre).toBe("Capuchino");
  });

  it("en el host dedicado la ruta es vacía: el enlace parte de la raíz y la carta es «/»", () => {
    const d = vista(CAFETERIA, "");
    expect(producto(d, "Capuchino").href).toBe(`/${producto(d, "Capuchino").segmento}`);
    expect(d.hrefDeLaVidriera).toBe("/");
    expect(v.hrefDeLaVidriera).toBe("/ejemplo-cafeteria");
  });

  it("cada producto sabe en qué sección está", () => {
    for (const s of v.secciones) for (const p of s.productos) expect(p.seccion).toBe(s.id);
  });

  it("la vista no deja salir ningún id interno ni dinero como número", () => {
    const json = JSON.stringify(v);
    const ids = VIDRIERAS_DE_EJEMPLO.flatMap((c) => [
      c.id,
      ...c.secciones.flatMap((s) => [s.id, ...s.productos.map((p) => p.id)]),
    ]);
    for (const id of ids) expect(json).not.toContain(id);
    expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-/);
    expect(JSON.parse(json)).toEqual(v);
  });
});

describe("armarVistaDeVidriera: fotos", () => {
  const v = vista(PANADERIA);

  it("solo las fotos VISIBLES salen, con el texto alternativo o «Foto de {nombre}»", () => {
    const origen = PANADERIA.secciones.flatMap((s) => s.productos);
    for (const o of origen) {
      const p = producto(v, o.nombre);
      if (o.foto?.estado === "VISIBLE") {
        expect(p.foto).toEqual({
          direccion: o.foto.direccion,
          alt: o.foto.alt ?? `Foto de ${o.nombre}`,
          ancho: o.foto.ancho,
          alto: o.foto.alto,
        });
      } else {
        expect(p.foto, o.nombre).toBeNull();
      }
    }
  });

  it("una foto oculta o rota no deja ni su dirección en la vista", () => {
    const json = JSON.stringify(v);
    for (const o of PANADERIA.secciones.flatMap((s) => s.productos)) {
      if (o.foto !== null && o.foto.estado !== "VISIBLE") {
        expect(json).not.toContain(o.foto.direccion);
      }
    }
  });

  it("hay productos con foto, con foto sin texto alternativo y sin foto", () => {
    const fotos = productos(v).map((p) => p.foto);
    expect(fotos.some((f) => f !== null)).toBe(true);
    expect(fotos.some((f) => f?.alt.startsWith("Foto de "))).toBe(true);
    expect(fotos.some((f) => f === null)).toBe(true);
  });
});

describe("armarVistaDeVidriera: casos de borde", () => {
  const base = publicada(CAFETERIA);
  const uno = CAFETERIA.secciones[0]?.productos[0] as NonNullable<
    (typeof CAFETERIA.secciones)[number]["productos"][number]
  >;

  it("un producto sin precio calculable no se muestra, y la sección que queda vacía tampoco", () => {
    const malo = {
      ...uno,
      id: "00000000-0000-4000-8000-0000000000aa",
      precioBase: "no es un precio",
    };
    const v = armarVistaDeVidriera(
      {
        ...base,
        secciones: [
          { id: "s1", nombre: "Rotos", productos: [malo] },
          { id: "s2", nombre: "Sanos", productos: [malo, uno] },
        ],
      },
      "/x",
    );
    expect(v.secciones.map((s) => s.nombre)).toEqual(["Sanos"]);
    expect(v.secciones[0]?.productos.map((p) => p.nombre)).toEqual([uno.nombre]);
    expect(v.totalDeProductos).toBe(1);
  });

  it("dejar de mostrar un producto no cambia la dirección de los demás", () => {
    const malo = { ...uno, id: "00000000-0000-4000-8000-0000000000aa", precioBase: "x" };
    const sano = { ...uno, id: "00000000-0000-4000-8000-0000000000bb", nombre: "Otro" };
    const con = armarVistaDeVidriera(
      { ...base, secciones: [{ id: "s", nombre: "A", productos: [malo, sano] }] },
      "/x",
    );
    const sin = armarVistaDeVidriera(
      {
        ...base,
        secciones: [{ id: "s", nombre: "A", productos: [{ ...malo, precioBase: "1" }, sano] }],
      },
      "/x",
    );
    expect(con.secciones[0]?.productos[0]?.segmento).toBe(sin.secciones[0]?.productos[1]?.segmento);
  });

  it("una carta sin productos queda sin secciones", () => {
    const v = armarVistaDeVidriera({ ...base, secciones: [] }, "/x");
    expect(v.secciones).toEqual([]);
    expect(v.totalDeProductos).toBe(0);
  });

  it("dos secciones con el mismo nombre no comparten ancla", () => {
    const v = armarVistaDeVidriera(
      {
        ...base,
        secciones: [
          { id: "a", nombre: "Postres", productos: [uno] },
          {
            id: "b",
            nombre: "Postres",
            productos: [{ ...uno, id: "00000000-0000-4000-8000-0000000000cc" }],
          },
          {
            id: "c",
            nombre: "Postres",
            productos: [{ ...uno, id: "00000000-0000-4000-8000-0000000000dd" }],
          },
          {
            id: "d",
            nombre: "Postres 2",
            productos: [{ ...uno, id: "00000000-0000-4000-8000-0000000000ee" }],
          },
        ],
      },
      "/x",
    );
    expect(v.secciones.map((s) => s.id)).toEqual([
      "postres",
      "postres-2",
      "postres-3",
      "postres-2-2",
    ]);
  });

  it("un nombre sin letras ni números usa el ancla por defecto de las direcciones", () => {
    const v = armarVistaDeVidriera(
      { ...base, secciones: [{ id: "a", nombre: "★★★", productos: [uno] }] },
      "/x",
    );
    expect(v.secciones[0]?.id).toBe("producto");
  });
});

describe("guarnición", () => {
  const base = publicada(CAFETERIA);
  const uno = CAFETERIA.secciones[0]?.productos[0] as NonNullable<
    (typeof CAFETERIA.secciones)[number]["productos"][number]
  >;
  const conGuarniciones = (opciones: { nombre: string; recargo: string }[]) =>
    armarVistaDeVidriera(
      {
        ...base,
        secciones: [
          {
            id: "a",
            nombre: "A",
            productos: [{ ...uno, obligatorios: [{ titulo: "Guarnición", opciones }] }],
          },
        ],
      },
      "/x",
    ).secciones[0]?.productos[0];

  it("una sola opción: «Con puré»", () => {
    expect(conGuarniciones([{ nombre: "Puré", recargo: "0" }])?.guarnicion).toBe("Con puré");
  });

  it("dos opciones: «Con puré o ensalada»", () => {
    expect(
      conGuarniciones([
        { nombre: "Puré", recargo: "0" },
        { nombre: "Ensalada", recargo: "0" },
      ])?.guarnicion,
    ).toBe("Con puré o ensalada");
  });

  it("tres o más: las separa con coma y la última con «o»", () => {
    expect(
      conGuarniciones([
        { nombre: "Papas fritas", recargo: "0" },
        { nombre: "Puré", recargo: "0" },
        { nombre: "Ensalada", recargo: "0" },
        { nombre: "Arroz", recargo: "0" },
      ])?.guarnicion,
    ).toBe("Con papas fritas, puré, ensalada o arroz");
  });

  it("solo baja la inicial de cada opción: el resto del nombre queda como lo escribió el comerciante", () => {
    expect(conGuarniciones([{ nombre: "Papas BRAVAS", recargo: "0" }])?.guarnicion).toBe(
      "Con papas BRAVAS",
    );
  });

  it(`si la línea pasa de ${LARGO_MAXIMO_DE_LA_GUARNICION} caracteres cae a «a elección»`, () => {
    const justo = "a".repeat(LARGO_MAXIMO_DE_LA_GUARNICION - "Con ".length);
    expect(conGuarniciones([{ nombre: justo, recargo: "0" }])?.guarnicion).toBe(`Con ${justo}`);
    expect(conGuarniciones([{ nombre: `${justo}a`, recargo: "0" }])?.guarnicion).toBe(
      GUARNICION_A_ELECCION,
    );
  });

  it("con recargo no es una guarnición de la lista: va en la tarjeta con su «+ $ …»", () => {
    const p = conGuarniciones([
      { nombre: "Puré", recargo: "0" },
      { nombre: "Papas con cheddar", recargo: "800" },
    ]);
    expect(p?.guarnicion).toBeNull();
    expect(p?.obligatorios[0]?.opciones[1]).toEqual({
      nombre: "Papas con cheddar",
      recargo: "+ $ 800",
    });
  });

  it("la primera guarnición sin recargo se usa aunque haya otro grupo obligatorio antes", () => {
    const v = armarVistaDeVidriera(
      {
        ...base,
        secciones: [
          {
            id: "a",
            nombre: "A",
            productos: [
              {
                ...uno,
                obligatorios: [
                  { titulo: "Punto", opciones: [{ nombre: "Jugoso", recargo: "100" }] },
                  { titulo: "Guarnición", opciones: [{ nombre: "Puré", recargo: "0" }] },
                ],
              },
            ],
          },
        ],
      },
      "/x",
    );
    expect(v.secciones[0]?.productos[0]?.guarnicion).toBe("Con puré");
  });
});

describe("las otras cartas de ejemplo", () => {
  it("la hostería muestra la botella con redondeo a centavos, con coma", () => {
    const v = vista(HOSTERIA);
    const malbec = producto(v, "Malbec reserva");
    expect(malbec.tamanos.map((t) => t.precio)).toEqual(["$ 6.800", "$ 24.133,34"]);
    expect(malbec.precioEnLista).toBe("desde $ 6.800");
  });

  it("la barbería arma todos sus servicios", () => {
    const v = vista(BARBERIA);
    expect(v.totalDeProductos).toBe(BARBERIA.secciones.reduce((n, s) => n + s.productos.length, 0));
  });

  it("ninguna carta de ejemplo pierde productos y todas arman direcciones distintas", () => {
    for (const c of VIDRIERAS_DE_EJEMPLO) {
      const v = vista(c);
      expect(v.totalDeProductos, c.codigo).toBe(
        c.secciones.reduce((n, s) => n + s.productos.length, 0),
      );
      const hrefs = productos(v).map((p) => p.href);
      expect(new Set(hrefs).size, c.codigo).toBe(hrefs.length);
    }
  });
});
