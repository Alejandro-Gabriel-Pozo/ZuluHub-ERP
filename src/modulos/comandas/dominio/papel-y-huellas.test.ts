import { describe, expect, it } from "vitest";
import {
  cantidadParaPapel,
  documentoDeAnulacion,
  documentoDeComanda,
  documentoDeTicket,
  type AvisoParaElPapel,
  type EnvioParaElPapel,
  type RenglonDelPapel,
} from "./documento";
import { seleccionarParaElEnvio, rotuloDeEnvio } from "./envio";
import { huellaDeEnvio, huellaDeImpresion } from "./huella";
import { estadoDelTrabajo } from "./impresion";

/**
 * El papel línea por línea (estilo y texto), en los dos anchos, y lo que decide cada rama: una línea que falta, sobra o cambia de estilo en el papel
 * de la cocina es un error que nadie ve hasta que el plato sale mal. Las huellas fijas protegen lo guardado: una huella que cambia entre versiones
 * rompe el reintento de un envío o impresión ya hechos (D119).
 */
const papel = (m: Readonly<{ lineas: readonly Readonly<{ texto: string; estilo: string }>[] }>) =>
  m.lineas.map((l) => `${l.estilo} | ${l.texto}`);
const unwrap = <T>(r: { ok: true; valor: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`error inesperado ${String(r.error)}`);
  return r.valor;
};

const envio: EnvioParaElPapel = {
  numero: 3,
  tipo: "ENVIO",
  rotulo: "Mesa 5",
  enviadoEn: "09/11/2026 21:10",
  tomadoPor: "Ana",
};
const renglon = (parcial: Partial<RenglonDelPapel> = {}): RenglonDelPapel => ({
  cantidad: "2",
  unidadDeVenta: "UNIDAD",
  paso: "1",
  nombreDeCocina: "Milanesa",
  detalle: [],
  rol: "SALE",
  ...parcial,
});
const aviso: AvisoParaElPapel = {
  rotulo: "Mesa 5",
  envioNumero: 3,
  enviadoEn: "09/11/2026 21:10",
  anuladoPor: "Ana",
  cantidadAnulada: "1",
  quedan: "1",
  unidadDeVenta: "UNIDAD",
  paso: "1",
  nombreDeCocina: "Milanesa",
  detalle: ["Sin sal"],
  motivo: "Se cayó",
};

describe("la comanda en el papel", () => {
  it("de 58 mm, con un plato que sale, otro que espera y un detalle", () => {
    const m = unwrap(
      documentoDeComanda(
        envio,
        [
          renglon({ detalle: ["Sin aceitunas"] }),
          renglon({ nombreDeCocina: "Flan", rol: "ESPERA" }),
        ],
        { copia: false, ancho: 58 },
      ),
    );
    expect(m.ancho).toBe(58);
    expect(papel(m)).toMatchInlineSnapshot(`
      [
        "NEGRITA | COMANDA · COCINA",
        "GRANDE | Mesa 5",
        "NEGRITA | Envío 3",
        "NORMAL | 09/11/2026 21:10",
        "NORMAL | Tomó: Ana",
        "SEPARADOR | ",
        "NEGRITA | 2 Milanesa",
        "NORMAL |   Sin aceitunas",
        "NEGRITA | 2 Flan",
        "NORMAL |   Sale después",
      ]
    `);
  });
  it("«piden que salga» y copia llevan su línea; el envío común no", () => {
    const m = unwrap(
      documentoDeComanda({ ...envio, tipo: "SALIDA_PEDIDA" }, [renglon()], {
        copia: true,
        ancho: 80,
      }),
    );
    expect(m.ancho).toBe(80);
    expect(papel(m)).toMatchInlineSnapshot(`
      [
        "NEGRITA | Copia",
        "NEGRITA | COMANDA · COCINA",
        "GRANDE | Mesa 5",
        "NEGRITA | Envío 3",
        "NEGRITA | Piden que salga",
        "NORMAL | 09/11/2026 21:10",
        "NORMAL | Tomó: Ana",
        "SEPARADOR | ",
        "NEGRITA | 2 Milanesa",
      ]
    `);
  });
  it("un rótulo largo se parte en renglones grandes de la mitad del ancho", () => {
    const rotulo = "Salón principal terraza norte esquina";
    expect(
      papel(
        unwrap(documentoDeComanda({ ...envio, rotulo }, [renglon()], { copia: false, ancho: 58 })),
      ),
    ).toMatchInlineSnapshot(`
      [
        "NEGRITA | COMANDA · COCINA",
        "GRANDE | Salón principal",
        "GRANDE | terraza norte",
        "GRANDE | esquina",
        "NEGRITA | Envío 3",
        "NORMAL | 09/11/2026 21:10",
        "NORMAL | Tomó: Ana",
        "SEPARADOR | ",
        "NEGRITA | 2 Milanesa",
      ]
    `);
    expect(
      papel(
        unwrap(documentoDeComanda({ ...envio, rotulo }, [renglon()], { copia: false, ancho: 80 })),
      ),
    ).toMatchInlineSnapshot(`
      [
        "NEGRITA | COMANDA · COCINA",
        "GRANDE | Salón principal terraza",
        "GRANDE | norte esquina",
        "NEGRITA | Envío 3",
        "NORMAL | 09/11/2026 21:10",
        "NORMAL | Tomó: Ana",
        "SEPARADOR | ",
        "NEGRITA | 2 Milanesa",
      ]
    `);
  });
  it("un detalle largo se parte con sangrado dentro de dos columnas menos", () => {
    const detalle = ["Con mucho queso rallado y salsa aparte sin cebolla ni morrón por favor"];
    expect(
      papel(unwrap(documentoDeComanda(envio, [renglon({ detalle })], { copia: false, ancho: 58 }))),
    ).toMatchInlineSnapshot(`
      [
        "NEGRITA | COMANDA · COCINA",
        "GRANDE | Mesa 5",
        "NEGRITA | Envío 3",
        "NORMAL | 09/11/2026 21:10",
        "NORMAL | Tomó: Ana",
        "SEPARADOR | ",
        "NEGRITA | 2 Milanesa",
        "NORMAL |   Con mucho queso rallado y",
        "NORMAL |   salsa aparte sin cebolla ni",
        "NORMAL |   morrón por favor",
      ]
    `);
    expect(
      papel(unwrap(documentoDeComanda(envio, [renglon({ detalle })], { copia: false, ancho: 80 }))),
    ).toMatchInlineSnapshot(`
      [
        "NEGRITA | COMANDA · COCINA",
        "GRANDE | Mesa 5",
        "NEGRITA | Envío 3",
        "NORMAL | 09/11/2026 21:10",
        "NORMAL | Tomó: Ana",
        "SEPARADOR | ",
        "NEGRITA | 2 Milanesa",
        "NORMAL |   Con mucho queso rallado y salsa aparte sin",
        "NORMAL |   cebolla ni morrón por favor",
      ]
    `);
  });
  it("las palabras se juntan hasta llenar el renglón y no más; los espacios de más no cuentan; una palabra larga se corta", () => {
    const m = (nombreDeCocina: string) =>
      papel(
        unwrap(
          documentoDeComanda(envio, [renglon({ nombreDeCocina, cantidad: "1" })], {
            copia: false,
            ancho: 58,
          }),
        ),
      ).slice(6);
    // 32 columnas: «1 » + 29 = 31 y la palabra siguiente no entra
    expect(m("aaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbb")).toMatchInlineSnapshot(`
      [
        "NEGRITA | 1 aaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "NEGRITA | bbb",
      ]
    `);
    // justo 32: entra entero
    expect(m("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toMatchInlineSnapshot(`
      [
        "NEGRITA | 1 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ]
    `);
    // dos palabras que suman exactamente 32 con su espacio
    expect(m("aaaaaaaaaaaaaaa bbbbbbbbbbbbb")).toMatchInlineSnapshot(`
      [
        "NEGRITA | 1 aaaaaaaaaaaaaaa bbbbbbbbbbbbb",
      ]
    `);
    // doble espacio y espacios en los bordes
    expect(m("  uno   dos  ")).toMatchInlineSnapshot(`
      [
        "NEGRITA | 1 uno dos",
      ]
    `);
    // una palabra de 70 letras: dos renglones llenos y el resto; la siguiente se pega al resto
    expect(m(`${"x".repeat(70)} fin`)).toMatchInlineSnapshot(`
      [
        "NEGRITA | 1",
        "NEGRITA | xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "NEGRITA | xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "NEGRITA | xxxxxx fin",
      ]
    `);
    // una palabra de exactamente el ancho (y de dos veces el ancho): sin renglones vacíos de más
    expect(m("z".repeat(32))).toMatchInlineSnapshot(`
      [
        "NEGRITA | 1",
        "NEGRITA | zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
      ]
    `);
    expect(m("w".repeat(64))).toMatchInlineSnapshot(`
      [
        "NEGRITA | 1",
        "NEGRITA | wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
        "NEGRITA | wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
      ]
    `);
    // una palabra exactamente del ancho y otra detrás
    expect(m(`${"y".repeat(30)} z`)).toMatchInlineSnapshot(`
      [
        "NEGRITA | 1 yyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
        "NEGRITA | z",
      ]
    `);
  });
  it("una cantidad que no se puede imprimir corta el documento", () => {
    expect(
      documentoDeComanda(envio, [renglon({ cantidad: "0" })], { copia: false, ancho: 58 }),
    ).toEqual({
      ok: false,
      error: "CANTIDAD_NO_IMPRIMIBLE",
    });
  });
});

describe("el aviso de anulación en el papel", () => {
  it("con copia y lo que queda", () => {
    expect(papel(unwrap(documentoDeAnulacion(aviso, { copia: true, ancho: 58 }))))
      .toMatchInlineSnapshot(`
      [
        "NEGRITA | Copia",
        "NEGRITA | ANULACIÓN · NO PREPARAR",
        "GRANDE | Mesa 5",
        "NEGRITA | Envío 3",
        "NORMAL | 09/11/2026 21:10",
        "NORMAL | Tomó: Ana",
        "SEPARADOR | ",
        "NEGRITA | 1 Milanesa",
        "NORMAL |   Sin sal",
        "NORMAL | Quedan: 1",
        "NORMAL | Motivo: Se cayó",
      ]
    `);
  });
  it("sin copia, anulada entera (quedan 0) y en 80 mm", () => {
    const m = unwrap(
      documentoDeAnulacion({ ...aviso, quedan: "0", detalle: [] }, { copia: false, ancho: 80 }),
    );
    expect(m.ancho).toBe(80);
    expect(papel(m)).toMatchInlineSnapshot(`
      [
        "NEGRITA | ANULACIÓN · NO PREPARAR",
        "GRANDE | Mesa 5",
        "NEGRITA | Envío 3",
        "NORMAL | 09/11/2026 21:10",
        "NORMAL | Tomó: Ana",
        "SEPARADOR | ",
        "NEGRITA | 1 Milanesa",
        "NORMAL | Quedan: 0",
        "NORMAL | Motivo: Se cayó",
      ]
    `);
  });
  it("lo que no se puede imprimir se rechaza con su código", () => {
    const no = { ok: false, error: "CANTIDAD_NO_IMPRIMIBLE" };
    expect(
      documentoDeAnulacion({ ...aviso, cantidadAnulada: "0" }, { copia: false, ancho: 58 }),
    ).toEqual(no);
    expect(documentoDeAnulacion({ ...aviso, quedan: "x" }, { copia: false, ancho: 58 })).toEqual(
      no,
    );
    expect(
      documentoDeAnulacion(
        { ...aviso, quedan: "0.3333", paso: "0.0001" },
        { copia: false, ancho: 58 },
      ),
    ).toEqual(no);
  });
});

describe("el ticket del cliente en el papel", () => {
  const ficha = {
    numero: 12,
    fecha: "09/11/2026 22:30",
    lineas: [
      { cantidad: "2", descripcion: "Milanesa", importe: "3000.00" },
      {
        cantidad: "1",
        descripcion: "Gaseosa de litro y medio sabor pomelo light",
        importe: "1500.00",
      },
    ],
    total: "4500.00",
  };
  it("descripción a la izquierda e importe a la derecha, en los dos anchos", () => {
    expect(papel(documentoDeTicket(ficha, { ancho: 58 }))).toMatchInlineSnapshot(`
      [
        "NEGRITA | Ticket N.º 12",
        "NORMAL | 09/11/2026 22:30",
        "SEPARADOR | ",
        "NORMAL | 2 Milanesa               3000.00",
        "NORMAL | 1 Gaseosa de litro y medio sabor",
        "NORMAL | pomelo light",
        "NORMAL | 1500.00",
        "SEPARADOR | ",
        "NEGRITA | Total                    4500.00",
      ]
    `);
    expect(papel(documentoDeTicket(ficha, { ancho: 80 }))).toMatchInlineSnapshot(`
      [
        "NEGRITA | Ticket N.º 12",
        "NORMAL | 09/11/2026 22:30",
        "SEPARADOR | ",
        "NORMAL | 2 Milanesa                               3000.00",
        "NORMAL | 1 Gaseosa de litro y medio sabor pomelo light",
        "NORMAL | 1500.00",
        "SEPARADOR | ",
        "NEGRITA | Total                                    4500.00",
      ]
    `);
  });
  it("el borde: la descripción llena justo el lugar, y un lugar de una sola columna", () => {
    const una = (descripcion: string, importe: string) =>
      papel(
        documentoDeTicket(
          {
            numero: 1,
            fecha: "f",
            lineas: [{ cantidad: "1", descripcion, importe }],
            total: "1.00",
          },
          { ancho: 58 },
        ),
      ).slice(3, -2);
    // importe de 6 → lugar = 32 − 6 − 1 = 25; «1 » + 23 = 25: justo
    expect(una("a".repeat(23), "100.00")).toMatchInlineSnapshot(`
      [
        "NORMAL | 1 aaaaaaaaaaaaaaaaaaaaaaa 100.00",
      ]
    `);
    // un carácter más: no entra y se parte en dos renglones
    expect(una("a".repeat(24), "100.00")).toMatchInlineSnapshot(`
      [
        "NORMAL | 1 aaaaaaaaaaaaaaaaaaaaaaaa",
        "NORMAL | 100.00",
      ]
    `);
    // importe de 30 → lugar = 1: «1 a» no entra y se parte en dos renglones
    expect(una("a", "9".repeat(30))).toMatchInlineSnapshot(`
      [
        "NORMAL | 1 a",
        "NORMAL | 999999999999999999999999999999",
      ]
    `);
    // importe de 29 → lugar = 2: «1 » (2) entra justo con descripción vacía
    expect(una("", "9".repeat(29))).toMatchInlineSnapshot(`
      [
        "NORMAL | 1  99999999999999999999999999999",
      ]
    `);
    // importe de 31 → lugar = 0: no hay lugar y se parte
    expect(una("a", "9".repeat(31))).toMatchInlineSnapshot(`
      [
        "NORMAL | 1 a",
        "NORMAL | 9999999999999999999999999999999",
      ]
    `);
  });
});

describe("cantidad para el papel: lo que rechaza cada condición", () => {
  const no = { ok: false, error: "CANTIDAD_NO_IMPRIMIBLE" };
  const u = (cantidad: string, paso = "1") =>
    cantidadParaPapel(cantidad, { unidadDeVenta: "UNIDAD", paso });
  it("cantidad cero, negativa o ilegible; paso ilegible, cero o negativo", () => {
    expect(u("0")).toEqual(no);
    expect(u("-1")).toEqual(no);
    expect(u("x")).toEqual(no);
    expect(u("1", "x")).toEqual(no);
    expect(u("1", "0")).toEqual(no);
    expect(u("1", "-1")).toEqual(no);
  });
  it("un error ajeno al dato no se toma por cantidad ilegible", () => {
    const explota = {
      toString(): string {
        throw new RangeError("ajeno");
      },
    } as unknown as string;
    expect(() => u(explota)).toThrow(RangeError);
  });
  it("por peso: los ceros de la derecha sobran y los de la izquierda del decimal no", () => {
    const k = (c: string) => cantidadParaPapel(c, { unidadDeVenta: "KILOGRAMO", paso: "0.01" });
    expect(k("0.05")).toEqual({ ok: true, valor: "0,05 kg" });
    expect(k("10.01")).toEqual({ ok: true, valor: "10,01 kg" });
    expect(k("2.5")).toEqual({ ok: true, valor: "2,5 kg" });
    expect(k("100")).toEqual({ ok: true, valor: "100 kg" });
    expect(k("0.4")).toEqual({ ok: true, valor: "0,4 kg" });
  });
});

describe("envío: lo que toma «pedir que salga» y el rótulo", () => {
  const lineas = [
    { lineaId: "a", vigente: true, envioId: null, salida: "DESPUES" as const },
    { lineaId: "b", vigente: true, envioId: null, salida: "DESPUES" as const },
    { lineaId: "c", vigente: true, envioId: null, salida: "AHORA" as const },
  ];
  it("sin lista pedida salen todas las que esperan", () => {
    expect(seleccionarParaElEnvio("SALIDA_PEDIDA", lineas)).toEqual({
      salen: ["a", "b"],
      esperan: [],
      ignoradas: [],
    });
  });
  it("un rótulo sin letras (solo número) se acepta", () => {
    expect(rotuloDeEnvio("12")).toEqual({ ok: true, valor: "12" });
  });
});

describe("huellas: fijas y sensibles a cada dato", () => {
  it("el envío: valores fijos (lo guardado no cambia entre versiones), con y sin lista", () => {
    expect(
      huellaDeEnvio({ cuentaId: "c1", tipo: "ENVIO", lineaIds: "TODAS" }),
    ).toMatchInlineSnapshot(`"7f5345cbb7764bb694e9a5804756f6f9d09d2230787c42b98aa06c2950f17692"`);
    expect(
      huellaDeEnvio({ cuentaId: "c1", tipo: "SALIDA_PEDIDA", lineaIds: ["b", "a"] }),
    ).toMatchInlineSnapshot(`"299c33bba0af9b3ce41752b2fd75e171bc45d3c51ec9953878540ec4bab56328"`);
  });
  it("el envío: el orden de las líneas no cuenta y las líneas distintas, sí", () => {
    const h = (lineaIds: string[]) =>
      huellaDeEnvio({ cuentaId: "c1", tipo: "SALIDA_PEDIDA", lineaIds });
    expect(h(["b", "a", "c"])).toBe(h(["a", "b", "c"]));
    expect(h(["a", "b"])).not.toBe(h(["a", "c"]));
    expect(h(["a"])).not.toBe(
      huellaDeEnvio({ cuentaId: "c1", tipo: "SALIDA_PEDIDA", lineaIds: "TODAS" }),
    );
  });
  it("la impresión: valor fijo y cada dato cuenta", () => {
    const base = {
      documentoTipo: "COMANDA",
      documentoId: "d1",
      impresoraId: "i1",
      esCopia: false,
    } as const;
    expect(huellaDeImpresion(base)).toMatchInlineSnapshot(
      `"509d4b7860945a483cb2ce8ee9a9fbb75754a5b4a99e04a69e2cdaca50e219b8"`,
    );
    expect(huellaDeImpresion({ ...base, documentoTipo: "TICKET" })).not.toBe(
      huellaDeImpresion(base),
    );
    expect(huellaDeImpresion({ ...base, documentoId: "d2" })).not.toBe(huellaDeImpresion(base));
    expect(huellaDeImpresion({ ...base, impresoraId: null })).not.toBe(huellaDeImpresion(base));
    expect(huellaDeImpresion({ ...base, esCopia: true })).not.toBe(huellaDeImpresion(base));
  });
});

describe("estado del trabajo: el último intento por número, en cualquier orden", () => {
  it("el de mayor número gana aunque llegue después; con el mismo número, el primero", () => {
    expect(
      estadoDelTrabajo([
        { numero: 1, resultado: "FALLIDA" },
        { numero: 2, resultado: "IMPRESA" },
      ]),
    ).toBe("IMPRESA");
    expect(
      estadoDelTrabajo([
        { numero: 1, resultado: "FALLIDA" },
        { numero: 1, resultado: "IMPRESA" },
      ]),
    ).toBe("FALLIDA");
  });
});
