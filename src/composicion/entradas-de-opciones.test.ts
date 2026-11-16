import { describe, expect, it } from "vitest";
import {
  leerElPedidoDeCopia,
  leerElPedidoDeGrupo,
  leerLasFilasDeOpciones,
  nombreDeCampoDeOpcion,
} from "./entradas-de-opciones";

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const CLAVE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OTRO = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";

const PEDIDO = {
  productoId: ID,
  versionDeOpciones: 3,
  claveDelCambio: CLAVE,
  grupoId: null,
  nombre: "Agregados",
  esVariante: false,
  esTamano: false,
  esAdicional: true,
  esObligatorio: false,
  admiteVarias: true,
  seMuestraEnCarta: true,
  opciones: [
    { clave: "e0", id: OTRO, nombre: "Queso", recargo: "500.00" },
    { clave: "n1", id: null, nombre: "Huevo", recargo: "300.00" },
  ],
};

describe("leerElPedidoDeGrupo", () => {
  it("lee todo lo que declara y el recargo sigue siendo texto", () => {
    expect(leerElPedidoDeGrupo(PEDIDO)).toEqual({ ok: true, valor: PEDIDO });
  });

  it("el grupo puede ser uno que ya existe", () => {
    expect(leerElPedidoDeGrupo({ ...PEDIDO, grupoId: OTRO })).toMatchObject({
      ok: true,
      valor: { grupoId: OTRO },
    });
  });

  it("un grupo sin opciones tiene la forma pedida: lo rechaza el dominio", () => {
    expect(leerElPedidoDeGrupo({ ...PEDIDO, opciones: [] })).toMatchObject({ ok: true });
  });

  it("un nombre o un recargo que no valen igual pasan: los rechaza el dominio", () => {
    const opciones = [{ clave: "n0", id: null, nombre: "", recargo: "abc" }];
    expect(leerElPedidoDeGrupo({ ...PEDIDO, nombre: "", opciones })).toMatchObject({ ok: true });
  });

  it("descarta lo que el pedido no declara: la empresa, la persona, el orden y el estado no se pueden mandar", () => {
    const r = leerElPedidoDeGrupo({
      ...PEDIDO,
      empresaId: "otra",
      personaId: "x",
      orden: 99,
      activo: false,
      opciones: [{ ...PEDIDO.opciones[0], orden: 5, activa: false, consumo: [] }],
    });
    expect(r).toEqual({ ok: true, valor: { ...PEDIDO, opciones: [PEDIDO.opciones[0]] } });
  });

  it.each([
    ["sin producto", { ...PEDIDO, productoId: undefined }],
    ["producto que no es un id", { ...PEDIDO, productoId: "no-es-un-id" }],
    ["versión negativa", { ...PEDIDO, versionDeOpciones: -1 }],
    ["versión que no es un entero", { ...PEDIDO, versionDeOpciones: 1.5 }],
    ["versión ausente", { ...PEDIDO, versionDeOpciones: undefined }],
    ["sin clave del cambio", { ...PEDIDO, claveDelCambio: undefined }],
    ["clave que no es un id", { ...PEDIDO, claveDelCambio: "1" }],
    ["grupo que no es un id", { ...PEDIDO, grupoId: "x" }],
    ["grupo ausente", { ...PEDIDO, grupoId: undefined }],
    ["nombre que no es texto", { ...PEDIDO, nombre: 5 }],
    ["nombre sin fin", { ...PEDIDO, nombre: "a".repeat(1001) }],
    ["variante que no es sí o no", { ...PEDIDO, esVariante: "no" }],
    ["medida que no es sí o no", { ...PEDIDO, esTamano: 0 }],
    ["adicional que no es sí o no", { ...PEDIDO, esAdicional: "on" }],
    ["obligatorio que no es sí o no", { ...PEDIDO, esObligatorio: 1 }],
    ["varias que no es sí o no", { ...PEDIDO, admiteVarias: "si" }],
    ["carta que no es sí o no", { ...PEDIDO, seMuestraEnCarta: null }],
    ["opciones que no es una lista", { ...PEDIDO, opciones: {} }],
    [
      "opción sin clave de fila",
      { ...PEDIDO, opciones: [{ id: null, nombre: "a", recargo: "1" }] },
    ],
    [
      "clave de fila mal escrita",
      { ...PEDIDO, opciones: [{ ...PEDIDO.opciones[1], clave: "x1" }] },
    ],
    ["clave de fila sin número", { ...PEDIDO, opciones: [{ ...PEDIDO.opciones[1], clave: "n" }] }],
    [
      "clave de fila con algo antes",
      { ...PEDIDO, opciones: [{ ...PEDIDO.opciones[1], clave: "xe1" }] },
    ],
    ["clave de fila enorme", { ...PEDIDO, opciones: [{ ...PEDIDO.opciones[1], clave: "n1234" }] }],
    [
      "opción con id que no es un id",
      { ...PEDIDO, opciones: [{ ...PEDIDO.opciones[0], id: "x" }] },
    ],
    [
      "opción con recargo que no es texto",
      { ...PEDIDO, opciones: [{ ...PEDIDO.opciones[0], recargo: 5 }] },
    ],
    [
      "opción con recargo sin fin",
      { ...PEDIDO, opciones: [{ ...PEDIDO.opciones[0], recargo: "1".repeat(41) }] },
    ],
    ["nada", null],
    ["un texto", "x"],
  ])("%s: PEDIDO_INVALIDO, sin decir cuál campo", (_caso, pedido) => {
    expect(leerElPedidoDeGrupo(pedido)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });

  it("100 opciones todavía es la forma pedida y 101 no", () => {
    const filas = (n: number) =>
      Array.from({ length: n }, (_x, i) => ({
        clave: `n${String(i)}`,
        id: null,
        nombre: "a",
        recargo: "1",
      }));
    expect(leerElPedidoDeGrupo({ ...PEDIDO, opciones: filas(100) })).toMatchObject({ ok: true });
    expect(leerElPedidoDeGrupo({ ...PEDIDO, opciones: filas(101) })).toEqual({
      ok: false,
      error: "PEDIDO_INVALIDO",
    });
  });

  it("la clave de fila admite tres dígitos y no cuatro; 1000 caracteres de nombre todavía es la forma pedida", () => {
    expect(
      leerElPedidoDeGrupo({
        ...PEDIDO,
        nombre: "a".repeat(1000),
        opciones: [{ ...PEDIDO.opciones[1], clave: "n123" }],
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("leerElPedidoDeCopia", () => {
  const COPIA = {
    productoDestinoId: ID,
    productoOrigenId: OTRO,
    versionDeOpciones: 0,
    claveDelCambio: CLAVE,
  };

  it("lee las cuatro cosas del pedido", () => {
    expect(leerElPedidoDeCopia(COPIA)).toEqual({ ok: true, valor: COPIA });
  });

  it("descarta lo que el pedido no declara", () => {
    expect(leerElPedidoDeCopia({ ...COPIA, empresaId: "otra", grupos: [] })).toEqual({
      ok: true,
      valor: COPIA,
    });
  });

  it.each([
    ["sin destino", { ...COPIA, productoDestinoId: undefined }],
    ["destino que no es un id", { ...COPIA, productoDestinoId: "x" }],
    ["sin origen", { ...COPIA, productoOrigenId: undefined }],
    ["origen que no es un id", { ...COPIA, productoOrigenId: "" }],
    ["versión negativa", { ...COPIA, versionDeOpciones: -1 }],
    ["sin clave", { ...COPIA, claveDelCambio: undefined }],
    ["clave que no es un id", { ...COPIA, claveDelCambio: "1" }],
    ["nada", null],
  ])("%s: PEDIDO_INVALIDO", (_caso, pedido) => {
    expect(leerElPedidoDeCopia(pedido)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });
});

describe("nombreDeCampoDeOpcion", () => {
  it("usa guion bajo (la forma de un campo de error) y dice la clave y el campo", () => {
    expect(nombreDeCampoDeOpcion("e0", "nombre")).toBe("opcion_e0_nombre");
    expect(nombreDeCampoDeOpcion("n12", "recargo")).toBe("opcion_n12_recargo");
  });
});

describe("leerLasFilasDeOpciones", () => {
  const IDS = [ID, OTRO];

  it("arma las filas en el orden del formulario, ligando las existentes a los ids que puso la página", () => {
    const filas = leerLasFilasDeOpciones(
      [
        ["opcion_e1_nombre", "Segunda"],
        ["opcion_e1_recargo", "20.00"],
        ["opcion_n0_nombre", "Nueva"],
        ["opcion_n0_recargo", "5.00"],
        ["opcion_e0_nombre", "Primera"],
        ["opcion_e0_recargo", "10.00"],
      ],
      IDS,
    );
    expect(filas).toEqual([
      { clave: "e1", id: OTRO, nombre: "Segunda", recargo: "20.00" },
      { clave: "n0", id: null, nombre: "Nueva", recargo: "5.00" },
      { clave: "e0", id: ID, nombre: "Primera", recargo: "10.00" },
    ]);
  });

  it("una existente que no apunta a ningún id ligado no existe y se descarta; las nuevas no necesitan id", () => {
    expect(
      leerLasFilasDeOpciones(
        [
          ["opcion_e2_nombre", "Fantasma"],
          ["opcion_e2_recargo", "1.00"],
          ["opcion_n7_nombre", "Nueva"],
          ["opcion_n7_recargo", "1.00"],
        ],
        IDS,
      ),
    ).toEqual([{ clave: "n7", id: null, nombre: "Nueva", recargo: "1.00" }]);
  });

  it("las claves de fila admiten hasta tres dígitos: e12 se liga al id número 12 y n123 es una nueva; n1234 no existe", () => {
    const ids = Array.from({ length: 13 }, (_x, i) => `id-${String(i)}`);
    expect(
      leerLasFilasDeOpciones(
        [
          ["opcion_e12_nombre", "Doce"],
          ["opcion_e12_recargo", "1.00"],
          ["opcion_n12_nombre", "N doce"],
          ["opcion_n123_nombre", "N ciento veintitrés"],
          ["opcion_n1234_nombre", "No"],
        ],
        ids,
      ),
    ).toEqual([
      { clave: "e12", id: "id-12", nombre: "Doce", recargo: "1.00" },
      { clave: "n12", id: null, nombre: "N doce", recargo: "" },
      { clave: "n123", id: null, nombre: "N ciento veintitrés", recargo: "" },
    ]);
  });

  it("sin ningún id ligado, ninguna existente", () => {
    expect(leerLasFilasDeOpciones([["opcion_e0_nombre", "x"]], [])).toEqual([]);
  });

  it("una fila sin recargo, o sin nombre, trae el texto vacío (lo rechaza el dominio)", () => {
    expect(leerLasFilasDeOpciones([["opcion_n0_nombre", "Solo nombre"]], [])).toEqual([
      { clave: "n0", id: null, nombre: "Solo nombre", recargo: "" },
    ]);
    expect(leerLasFilasDeOpciones([["opcion_n0_recargo", "1.00"]], [])).toEqual([
      { clave: "n0", id: null, nombre: "", recargo: "1.00" },
    ]);
  });

  it("lo que no es un campo de una fila, o no es texto, no se lee: lo que no se declara no existe", () => {
    expect(
      leerLasFilasDeOpciones(
        [
          ["nombre", "del grupo"],
          ["opcion_n0_orden", "5"],
          ["opcion_x0_nombre", "mal"],
          ["opcion_n_nombre", "sin número"],
          ["opcion_n1234_nombre", "enorme"],
          ["xopcion_n0_nombre", "prefijo"],
          ["opcion_n0_nombre_x", "sufijo"],
          ["opcion_n0_nombre", new Blob(["archivo"])],
          ["opcion_n3_nombre", "Bien"],
          ["opcion_n3_recargo", "2.00"],
        ],
        [],
      ),
    ).toEqual([{ clave: "n3", id: null, nombre: "Bien", recargo: "2.00" }]);
  });

  it("una fila repetida conserva el primer valor de cada campo", () => {
    expect(
      leerLasFilasDeOpciones(
        [
          ["opcion_n0_nombre", "Primero"],
          ["opcion_n0_nombre", "Segundo"],
          ["opcion_n0_recargo", "1.00"],
          ["opcion_n0_recargo", "2.00"],
        ],
        [],
      ),
    ).toEqual([{ clave: "n0", id: null, nombre: "Primero", recargo: "1.00" }]);
  });

  it("un valor vacío es un valor: no se lo reemplaza por el siguiente", () => {
    expect(
      leerLasFilasDeOpciones(
        [
          ["opcion_n0_nombre", ""],
          ["opcion_n0_nombre", "Otro"],
        ],
        [],
      ),
    ).toEqual([{ clave: "n0", id: null, nombre: "", recargo: "" }]);
  });

  it("sin campos, sin filas", () => {
    expect(leerLasFilasDeOpciones([], IDS)).toEqual([]);
  });
});
