import { describe, expect, it } from "vitest";
import { listaDePreciosDelProducto, type ProductoParaPrecios } from "./precios";

const ARS = (monto: string) => ({ moneda: "ARS", monto });

function producto(
  parcial: Partial<ProductoParaPrecios> & { precioBase: string },
): ProductoParaPrecios {
  return { tamanos: [], obligatorios: [], adicionales: [], ...parcial };
}

function lista(p: ProductoParaPrecios) {
  const r = listaDePreciosDelProducto(p);
  if (!r.ok) throw new Error(`se esperaba ok, vino ${JSON.stringify(r.error)}`);
  return r.valor;
}

describe("listaDePreciosDelProducto: sin variantes", () => {
  it("un producto sin grupos muestra su precio base, sin «desde»", () => {
    expect(lista(producto({ precioBase: "2200.50" }))).toEqual({
      precioDeLista: ARS("2200.50"),
      desde: false,
      tamanos: [],
      obligatorios: [],
      adicionales: [],
    });
  });

  it("el precio sale siempre con dos decimales y la moneda explícita", () => {
    expect(lista(producto({ precioBase: "2300" })).precioDeLista).toEqual(ARS("2300.00"));
    expect(lista(producto({ precioBase: "0" })).precioDeLista).toEqual(ARS("0.00"));
  });
});

describe("listaDePreciosDelProducto: tamaños", () => {
  const cafe = producto({
    precioBase: "2300",
    tamanos: [
      { nombre: "Chico", recargo: "0" },
      { nombre: "Mediano", recargo: "400" },
      { nombre: "Grande", recargo: "800" },
    ],
  });

  it("lista de precios finales (base + recargo) y «desde» el menor", () => {
    expect(lista(cafe)).toEqual({
      precioDeLista: ARS("2300.00"),
      desde: true,
      tamanos: [
        { nombre: "Chico", precio: ARS("2300.00") },
        { nombre: "Mediano", precio: ARS("2700.00") },
        { nombre: "Grande", precio: ARS("3100.00") },
      ],
      obligatorios: [],
      adicionales: [],
    });
  });

  it("el «desde» es el mínimo aunque no sea el primero", () => {
    const l = lista(
      producto({
        precioBase: "1000",
        tamanos: [
          { nombre: "Grande", recargo: "500" },
          { nombre: "Chico", recargo: "0" },
          { nombre: "Mediano", recargo: "200" },
        ],
      }),
    );
    expect(l.precioDeLista).toEqual(ARS("1000.00"));
    expect(l.tamanos.map((t) => t.nombre)).toEqual(["Grande", "Chico", "Mediano"]);
  });

  it("el mínimo no tiene por qué ser el recargo cero", () => {
    const l = lista(
      producto({
        precioBase: "1000",
        tamanos: [
          { nombre: "Mediano", recargo: "300" },
          { nombre: "Grande", recargo: "500" },
        ],
      }),
    );
    expect(l.precioDeLista).toEqual(ARS("1300.00"));
    expect(l.desde).toBe(true);
  });

  it("tamaños con el mismo precio: no hay «desde»", () => {
    const l = lista(
      producto({
        precioBase: "1000",
        tamanos: [
          { nombre: "Vaso", recargo: "0" },
          { nombre: "Jarra", recargo: "0" },
        ],
      }),
    );
    expect(l.desde).toBe(false);
    expect(l.precioDeLista).toEqual(ARS("1000.00"));
  });

  it("un solo tamaño no es «desde»", () => {
    const l = lista(
      producto({ precioBase: "1000", tamanos: [{ nombre: "Único", recargo: "250" }] }),
    );
    expect(l.desde).toBe(false);
    expect(l.precioDeLista).toEqual(ARS("1250.00"));
  });

  it("recargos que difieren menos de un centavo y se ven igual: no hay «desde»", () => {
    const l = lista(
      producto({
        precioBase: "100",
        tamanos: [
          { nombre: "A", recargo: "0.001" },
          { nombre: "B", recargo: "0.002" },
        ],
      }),
    );
    expect(l.tamanos.map((t) => t.precio.monto)).toEqual(["100.00", "100.00"]);
    expect(l.desde).toBe(false);
  });

  it("respeta el orden que llegó, también con precios iguales (no ordena por precio)", () => {
    const l = lista(
      producto({
        precioBase: "10",
        tamanos: [
          { nombre: "C", recargo: "5" },
          { nombre: "A", recargo: "5" },
          { nombre: "B", recargo: "1" },
        ],
      }),
    );
    expect(l.tamanos.map((t) => t.nombre)).toEqual(["C", "A", "B"]);
  });
});

describe("listaDePreciosDelProducto: redondeo (se suma exacto y se redondea una vez)", () => {
  it.each([
    ["100.004999", "0", "100.00"],
    ["100.005", "0", "100.01"],
    ["100.005000", "0", "100.01"],
    ["0.004", "0.004", "0.01"],
    ["0.002", "0.002", "0.00"],
    ["1234.565", "0", "1234.57"],
    ["1234.564999", "0.000001", "1234.57"],
    ["24500.250000", "0", "24500.25"],
  ])("base %s + recargo %s = %s", (base, recargo, esperado) => {
    const l = lista(producto({ precioBase: base, tamanos: [{ nombre: "T", recargo }] }));
    expect(l.tamanos[0]?.precio).toEqual(ARS(esperado));
  });

  it("el mínimo también se suma exacto: base + recargos del grupo antes de redondear", () => {
    const l = lista(
      producto({
        precioBase: "0.004",
        tamanos: [
          { nombre: "A", recargo: "0.004" },
          { nombre: "B", recargo: "9" },
        ],
      }),
    );
    expect(l.precioDeLista).toEqual(ARS("0.01"));
  });

  it("importes grandes no pierden ni un centavo (sin coma flotante)", () => {
    const l = lista(
      producto({
        precioBase: "999999999999.994999",
        tamanos: [{ nombre: "T", recargo: "0.000001" }],
      }),
    );
    expect(l.tamanos[0]?.precio).toEqual(ARS("1000000000000.00"));
    expect(lista(producto({ precioBase: "123456789012.345678" })).precioDeLista).toEqual(
      ARS("123456789012.35"),
    );
  });
});

describe("listaDePreciosDelProducto: otros obligatorios y adicionales", () => {
  const guarnicion = {
    titulo: "Guarnición",
    opciones: [
      { nombre: "Papas", recargo: "0" },
      { nombre: "Puré", recargo: "0" },
    ],
  };

  it("una guarnición sin recargo se muestra solo por nombre y no mueve el precio ni el «desde»", () => {
    const l = lista(producto({ precioBase: "8900", obligatorios: [guarnicion] }));
    expect(l.precioDeLista).toEqual(ARS("8900.00"));
    expect(l.desde).toBe(false);
    expect(l.obligatorios).toEqual([
      {
        titulo: "Guarnición",
        opciones: [
          { nombre: "Papas", recargo: null },
          { nombre: "Puré", recargo: null },
        ],
      },
    ]);
  });

  it("un obligatorio con recargos distintos suma su menor al mínimo y habilita el «desde»", () => {
    const l = lista(
      producto({
        precioBase: "26500",
        obligatorios: [
          {
            titulo: "Guarnición",
            opciones: [
              { nombre: "Papas", recargo: "0" },
              { nombre: "Risotto", recargo: "2500.505" },
            ],
          },
        ],
      }),
    );
    expect(l.precioDeLista).toEqual(ARS("26500.00"));
    expect(l.desde).toBe(true);
    expect(l.obligatorios[0]?.opciones[1]).toEqual({ nombre: "Risotto", recargo: ARS("2500.51") });
  });

  it("si TODAS las opciones de un obligatorio cobran, el mínimo las incluye", () => {
    const l = lista(
      producto({
        precioBase: "1000",
        obligatorios: [
          {
            titulo: "Salsa",
            opciones: [
              { nombre: "Blanca", recargo: "200" },
              { nombre: "Roja", recargo: "300" },
            ],
          },
        ],
      }),
    );
    expect(l.precioDeLista).toEqual(ARS("1200.00"));
    expect(l.desde).toBe(true);
  });

  it("el mínimo suma el piso de cada grupo obligatorio y los tamaños", () => {
    const l = lista(
      producto({
        precioBase: "1000",
        tamanos: [
          { nombre: "Chico", recargo: "100" },
          { nombre: "Grande", recargo: "400" },
        ],
        obligatorios: [
          {
            titulo: "Salsa",
            opciones: [
              { nombre: "Blanca", recargo: "200" },
              { nombre: "Roja", recargo: "300" },
            ],
          },
          { titulo: "Pan", opciones: [{ nombre: "Común", recargo: "50" }] },
        ],
      }),
    );
    expect(l.precioDeLista).toEqual(ARS("1350.00"));
    expect(l.tamanos.map((t) => t.precio.monto)).toEqual(["1100.00", "1400.00"]);
  });

  it("los adicionales muestran «+ recargo» y, sin recargo, solo el nombre; no mueven el precio", () => {
    const l = lista(
      producto({
        precioBase: "2300",
        adicionales: [
          {
            titulo: "Para sumar",
            opciones: [
              { nombre: "Leche de almendras", recargo: "600" },
              { nombre: "Crema", recargo: "0" },
              { nombre: "Canela", recargo: "0.004" },
              { nombre: "Miel", recargo: "0.005" },
            ],
          },
        ],
      }),
    );
    expect(l.precioDeLista).toEqual(ARS("2300.00"));
    expect(l.desde).toBe(false);
    expect(l.adicionales[0]?.opciones).toEqual([
      { nombre: "Leche de almendras", recargo: ARS("600.00") },
      { nombre: "Crema", recargo: null },
      { nombre: "Canela", recargo: null },
      { nombre: "Miel", recargo: ARS("0.01") },
    ]);
  });

  it("el orden de grupos y opciones es el que llegó", () => {
    const l = lista(
      producto({
        precioBase: "1",
        adicionales: [
          {
            titulo: "Z",
            opciones: [
              { nombre: "b", recargo: "2" },
              { nombre: "a", recargo: "1" },
            ],
          },
          { titulo: "A", opciones: [{ nombre: "c", recargo: "0" }] },
        ],
      }),
    );
    expect(l.adicionales.map((g) => g.titulo)).toEqual(["Z", "A"]);
    expect(l.adicionales[0]?.opciones.map((o) => o.nombre)).toEqual(["b", "a"]);
  });
});

describe("listaDePreciosDelProducto: errores tipados, nunca excepciones", () => {
  it.each([
    "",
    "abc",
    "-1",
    "+5",
    "1,5",
    "1e3",
    " 5",
    "5 ",
    "1.0000001",
    "007",
    ".5",
    "5.",
    "NaN",
    "1".repeat(41),
  ])("precio base %j → PRECIO_INVALIDO en precioBase", (precioBase) => {
    expect(listaDePreciosDelProducto(producto({ precioBase }))).toEqual({
      ok: false,
      error: { codigo: "PRECIO_INVALIDO", ubicacion: "precioBase" },
    });
  });

  it("un precio base fuera de rango (más de 18 dígitos) es inválido", () => {
    expect(listaDePreciosDelProducto(producto({ precioBase: "1000000000000" }))).toEqual({
      ok: false,
      error: { codigo: "PRECIO_INVALIDO", ubicacion: "precioBase" },
    });
  });

  it("un recargo negativo no existe (I.2: el recargo es ≥ 0)", () => {
    expect(
      listaDePreciosDelProducto(
        producto({
          precioBase: "100",
          tamanos: [
            { nombre: "A", recargo: "0" },
            { nombre: "B", recargo: "-5" },
          ],
        }),
      ),
    ).toEqual({ ok: false, error: { codigo: "PRECIO_INVALIDO", ubicacion: "tamanos.1" } });
  });

  it("dice dónde está el dato malo: obligatorios y adicionales", () => {
    expect(
      listaDePreciosDelProducto(
        producto({
          precioBase: "100",
          obligatorios: [
            { titulo: "G0", opciones: [{ nombre: "a", recargo: "0" }] },
            {
              titulo: "G1",
              opciones: [
                { nombre: "a", recargo: "0" },
                { nombre: "b", recargo: "x" },
              ],
            },
          ],
        }),
      ),
    ).toEqual({
      ok: false,
      error: { codigo: "PRECIO_INVALIDO", ubicacion: "obligatorios.1.opciones.1" },
    });
    expect(
      listaDePreciosDelProducto(
        producto({
          precioBase: "100",
          adicionales: [{ titulo: "G0", opciones: [{ nombre: "a", recargo: "1.0000001" }] }],
        }),
      ),
    ).toEqual({
      ok: false,
      error: { codigo: "PRECIO_INVALIDO", ubicacion: "adicionales.0.opciones.0" },
    });
  });

  it("un grupo sin opciones es un dato defectuoso, no un grupo mudo", () => {
    expect(
      listaDePreciosDelProducto(
        producto({ precioBase: "100", obligatorios: [{ titulo: "G", opciones: [] }] }),
      ),
    ).toEqual({ ok: false, error: { codigo: "GRUPO_SIN_OPCIONES", ubicacion: "obligatorios.0" } });
    expect(
      listaDePreciosDelProducto(
        producto({
          precioBase: "100",
          adicionales: [
            { titulo: "bien", opciones: [{ nombre: "a", recargo: "0" }] },
            { titulo: "G", opciones: [] },
          ],
        }),
      ),
    ).toEqual({ ok: false, error: { codigo: "GRUPO_SIN_OPCIONES", ubicacion: "adicionales.1" } });
  });

  it("informa el primer error en el orden base, tamaños, obligatorios, adicionales", () => {
    const mal = [{ nombre: "x", recargo: "?" }];
    const grupoMal = [{ titulo: "g", opciones: mal }];
    expect(
      listaDePreciosDelProducto({
        precioBase: "?",
        tamanos: mal,
        obligatorios: grupoMal,
        adicionales: grupoMal,
      }),
    ).toMatchObject({ error: { ubicacion: "precioBase" } });
    expect(
      listaDePreciosDelProducto({
        precioBase: "1",
        tamanos: mal,
        obligatorios: grupoMal,
        adicionales: grupoMal,
      }),
    ).toMatchObject({ error: { ubicacion: "tamanos.0" } });
    expect(
      listaDePreciosDelProducto({
        precioBase: "1",
        tamanos: [],
        obligatorios: grupoMal,
        adicionales: grupoMal,
      }),
    ).toMatchObject({ error: { ubicacion: "obligatorios.0.opciones.0" } });
    expect(
      listaDePreciosDelProducto({
        precioBase: "1",
        tamanos: [],
        obligatorios: [],
        adicionales: grupoMal,
      }),
    ).toMatchObject({ error: { ubicacion: "adicionales.0.opciones.0" } });
  });

  it("lo que no es un rechazo del parser (un defecto) se lanza, no se esconde como dato malo", () => {
    expect(() =>
      listaDePreciosDelProducto(producto({ precioBase: null as unknown as string })),
    ).toThrow(TypeError);
  });
});
