import { describe, expect, it } from "vitest";
import type { GrupoDeFicha } from "../modulos/catalogo/publico";
import { armarElConjunto, idDerivado } from "./conjunto-de-opciones";
import type { PedidoDeGrupo } from "./entradas-de-opciones";

const PRODUCTO = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const CLAVE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const GRUPO_A = "aaaaaaaa-0000-4000-8000-000000000001";
const GRUPO_B = "bbbbbbbb-0000-4000-8000-000000000002";
const GRUPO_V = "cccccccc-0000-4000-8000-000000000003";
const OPCION_1 = "11111111-0000-4000-8000-000000000001";
const OPCION_2 = "11111111-0000-4000-8000-000000000002";
const OPCION_3 = "11111111-0000-4000-8000-000000000003";

const opcion = (
  id: string,
  nombre: string,
  extra: Partial<GrupoDeFicha["opciones"][number]> = {},
): GrupoDeFicha["opciones"][number] => ({
  id,
  versionDeOpcionId: `v-${id}`,
  nombre,
  recargo: "0.000000",
  factorDeTamano: "1.000000",
  orden: 1,
  activa: true,
  consumo: [],
  ...extra,
});

const grupo = (id: string, nombre: string, extra: Partial<GrupoDeFicha> = {}): GrupoDeFicha => ({
  id,
  clase: "ADICIONAL",
  esTamano: false,
  nombre,
  esObligatorio: false,
  admiteVarias: true,
  seMuestraEnCarta: true,
  orden: 1,
  activo: true,
  opciones: [],
  ...extra,
});

const A = grupo(GRUPO_A, "Salsas", {
  orden: 1,
  opciones: [
    opcion(OPCION_1, "Mayonesa", { recargo: "50.500000", orden: 3 }),
    opcion(OPCION_2, "Ketchup", { orden: 7 }),
    opcion(OPCION_3, "Mostaza", { activa: false, orden: 9 }),
  ],
});
const B = grupo(GRUPO_B, "Panes", { orden: 4, clase: "INCLUIDA", seMuestraEnCarta: false });
const V = grupo(GRUPO_V, "Medida", {
  clase: "VARIANTE",
  esTamano: true,
  esObligatorio: true,
  admiteVarias: false,
  orden: 0,
  opciones: [opcion(OPCION_3, "Grande", { factorDeTamano: "1.500000" })],
});

const PEDIDO: PedidoDeGrupo = {
  productoId: PRODUCTO,
  versionDeOpciones: 1,
  claveDelCambio: CLAVE,
  grupoId: null,
  nombre: "Agregados",
  esVariante: false,
  esTamano: false,
  clase: "ADICIONAL",
  esObligatorio: true,
  admiteVarias: false,
  seMuestraEnCarta: true,
  opciones: [],
};

const armar = (existentes: readonly GrupoDeFicha[], pedido: PedidoDeGrupo) => {
  const r = armarElConjunto(existentes, pedido);
  if (r === "GRUPO_NO_EDITABLE") throw new Error("no editable");
  return r;
};

describe("idDerivado", () => {
  it("tiene la forma de un uuid de versión 5 y variante 8 a b", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(idDerivado(CLAVE, i)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("es el mismo para la misma clave y posición, y distinto si cambia cualquiera de las dos", () => {
    expect(idDerivado(CLAVE, 3)).toBe(idDerivado(CLAVE, 3));
    expect(idDerivado(CLAVE, 3)).not.toBe(idDerivado(CLAVE, 4));
    expect(idDerivado(CLAVE, 3)).not.toBe(idDerivado(OPCION_1, 3));
    expect(idDerivado(CLAVE, 1)).not.toBe(idDerivado(CLAVE, 11));
  });

  it("valor fijo: no cambia entre versiones (un reintento después de actualizar el servidor sigue siendo el mismo pedido)", () => {
    expect(idDerivado("clave", 0)).toBe("f36c7a72-298d-5a3e-a682-e8593dda0826");
  });
});

describe("armarElConjunto: un grupo nuevo", () => {
  it("lleva por id la clave del cambio, la clase pedida, el orden siguiente al más alto y las opciones nuevas con ids derivados", () => {
    const { grupos, grupoId } = armar([A, B, V], {
      ...PEDIDO,
      opciones: [
        { clave: "n0", id: null, nombre: "Queso", recargo: "500.00" },
        { clave: "n1", id: null, nombre: "Huevo", recargo: "300.00" },
      ],
    });
    expect(grupoId).toBe(CLAVE);
    expect(grupos).toHaveLength(4);
    expect(grupos.at(-1)).toEqual({
      id: CLAVE,
      clase: "ADICIONAL",
      nombre: "Agregados",
      esTamano: false,
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: true,
      orden: 5,
      activo: true,
      opciones: [
        { id: idDerivado(CLAVE, 0), nombre: "Queso", recargo: "500.00", orden: 1, activa: true },
        { id: idDerivado(CLAVE, 1), nombre: "Huevo", recargo: "300.00", orden: 2, activa: true },
      ],
    });
  });

  it("las reglas de un grupo nuevo salen de lo pedido: opcional y de varias elecciones, u obligatorio y de una", () => {
    const g = (extra: Partial<PedidoDeGrupo>) => armar([], { ...PEDIDO, ...extra }).grupos[0];
    expect(g({ esObligatorio: false, admiteVarias: true })).toMatchObject({
      esObligatorio: false,
      admiteVarias: true,
    });
    expect(g({ esObligatorio: true, admiteVarias: false })).toMatchObject({
      esObligatorio: true,
      admiteVarias: false,
    });
  });

  it("sin la casilla «Adicional» es un grupo incluido; sin grupos previos, el orden es 1", () => {
    const { grupos } = armar([], { ...PEDIDO, clase: "INCLUIDA", seMuestraEnCarta: false });
    expect(grupos).toEqual([
      expect.objectContaining({ clase: "INCLUIDA", orden: 1, seMuestraEnCarta: false }),
    ]);
  });

  it("lo que ya estaba sale tal cual, en su lugar y sin cambios (los grupos de todas las clases, también la variante)", () => {
    const { grupos } = armar([A, B, V], PEDIDO);
    expect(grupos.slice(0, 3)).toEqual([
      {
        id: GRUPO_A,
        clase: "ADICIONAL",
        nombre: "Salsas",
        esTamano: false,
        esObligatorio: false,
        admiteVarias: true,
        seMuestraEnCarta: true,
        orden: 1,
        activo: true,
        opciones: [
          {
            id: OPCION_1,
            nombre: "Mayonesa",
            recargo: "50.500000",
            orden: 3,
            activa: true,
            factorDeTamano: "1.000000",
          },
          {
            id: OPCION_2,
            nombre: "Ketchup",
            recargo: "0.000000",
            orden: 7,
            activa: true,
            factorDeTamano: "1.000000",
          },
          {
            id: OPCION_3,
            nombre: "Mostaza",
            recargo: "0.000000",
            orden: 9,
            activa: false,
            factorDeTamano: "1.000000",
          },
        ],
      },
      expect.objectContaining({
        id: GRUPO_B,
        clase: "INCLUIDA",
        seMuestraEnCarta: false,
        activo: true,
      }),
      expect.objectContaining({
        id: GRUPO_V,
        clase: "VARIANTE",
        esTamano: true,
        opciones: [expect.objectContaining({ factorDeTamano: "1.500000" })],
      }),
    ]);
  });

  it("si el grupo ya existe con esa clave (el mismo pedido repetido) se lo trata como el que es: mismas opciones, mismo orden, la clase guardada", () => {
    const primero = armar([A], {
      ...PEDIDO,
      opciones: [
        { clave: "n0", id: null, nombre: "Queso", recargo: "500.00" },
        { clave: "n1", id: null, nombre: "Huevo", recargo: "300.00" },
      ],
    });
    const guardado: GrupoDeFicha = grupo(CLAVE, "Agregados", {
      orden: 2,
      esObligatorio: true,
      admiteVarias: false,
      opciones: [
        opcion(idDerivado(CLAVE, 0), "Queso", { recargo: "500.000000", orden: 1 }),
        opcion(idDerivado(CLAVE, 1), "Huevo", { recargo: "300.000000", orden: 2 }),
      ],
    });
    const otraVez = armar([A, guardado], {
      ...PEDIDO,
      clase: "INCLUIDA",
      opciones: [
        { clave: "n0", id: null, nombre: "Queso", recargo: "500.00" },
        { clave: "n1", id: null, nombre: "Huevo", recargo: "300.00" },
      ],
    });
    expect(primero.grupoId).toBe(CLAVE);
    expect(otraVez.grupos).toHaveLength(2);
    expect(otraVez.grupos[1]).toMatchObject({
      id: CLAVE,
      clase: "ADICIONAL",
      orden: 2,
      opciones: [
        { id: idDerivado(CLAVE, 0), orden: 1, activa: true },
        { id: idDerivado(CLAVE, 1), orden: 2, activa: true },
      ],
    });
  });
});

describe("armarElConjunto: un grupo que ya existe", () => {
  const EDITA: PedidoDeGrupo = { ...PEDIDO, grupoId: GRUPO_A, nombre: "Salsas caseras" };

  it("cambia el nombre y las reglas; conserva la clase, el orden, lo demás y la posición entre los grupos", () => {
    const { grupos, grupoId } = armar([V, A, B], {
      ...EDITA,
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: false,
      opciones: [
        { clave: "e0", id: OPCION_1, nombre: "Mayonesa", recargo: "50.50" },
        { clave: "e1", id: OPCION_2, nombre: "Ketchup", recargo: "0.00" },
      ],
    });
    expect(grupoId).toBe(GRUPO_A);
    expect(grupos.map((g) => g.id)).toEqual([GRUPO_V, GRUPO_A, GRUPO_B]);
    expect(grupos[1]).toEqual({
      id: GRUPO_A,
      clase: "ADICIONAL",
      nombre: "Salsas caseras",
      esTamano: false,
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: false,
      orden: 1,
      activo: true,
      opciones: [
        {
          id: OPCION_1,
          nombre: "Mayonesa",
          recargo: "50.50",
          orden: 3,
          activa: true,
          factorDeTamano: "1.000000",
        },
        {
          id: OPCION_2,
          nombre: "Ketchup",
          recargo: "0.00",
          orden: 7,
          activa: true,
          factorDeTamano: "1.000000",
        },
      ],
    });
  });

  it("una opción que la pantalla ya no manda se quita del grupo (el caso de uso la desactiva); una desactivada que no se reactiva queda afuera", () => {
    const { grupos } = armar([A], {
      ...EDITA,
      opciones: [{ clave: "e1", id: OPCION_2, nombre: "Ketchup", recargo: "0.00" }],
    });
    expect(grupos[0]?.opciones.map((o) => o.id)).toEqual([OPCION_2]);
  });

  it("una opción que la pantalla manda con un id que no es del grupo se descarta (no se puede traer una de otro lado)", () => {
    const { grupos } = armar([A, B], {
      ...EDITA,
      opciones: [
        {
          clave: "e0",
          id: "99999999-0000-4000-8000-000000000009",
          nombre: "Ajena",
          recargo: "1.00",
        },
        { clave: "e1", id: OPCION_2, nombre: "Ketchup", recargo: "0.00" },
      ],
    });
    expect(grupos[0]?.opciones.map((o) => o.nombre)).toEqual(["Ketchup"]);
  });

  it("una opción nueva va al final (el orden siguiente al más alto del grupo, también entre las desactivadas) con un id derivado de la clave y su posición", () => {
    const { grupos } = armar([A], {
      ...EDITA,
      opciones: [
        { clave: "e0", id: OPCION_1, nombre: "Mayonesa", recargo: "50.50" },
        { clave: "n0", id: null, nombre: "Alioli", recargo: "10.00" },
        { clave: "n1", id: null, nombre: "Barbacoa", recargo: "10.00" },
      ],
    });
    expect(grupos[0]?.opciones).toEqual([
      expect.objectContaining({ id: OPCION_1, orden: 3 }),
      { id: idDerivado(CLAVE, 1), nombre: "Alioli", recargo: "10.00", orden: 10, activa: true },
      { id: idDerivado(CLAVE, 2), nombre: "Barbacoa", recargo: "10.00", orden: 11, activa: true },
    ]);
  });

  it("una opción nueva con el nombre de una desactivada del grupo la reactiva (mismo id, mismo orden), sin mirar mayúsculas ni espacios de los costados", () => {
    const { grupos } = armar([A], {
      ...EDITA,
      opciones: [{ clave: "n0", id: null, nombre: "  mostaza ", recargo: "15.00" }],
    });
    expect(grupos[0]?.opciones).toEqual([
      {
        id: OPCION_3,
        nombre: "  mostaza ",
        recargo: "15.00",
        orden: 9,
        activa: true,
        factorDeTamano: "1.000000",
      },
    ]);
  });

  it("una opción nueva con el nombre de una ACTIVA no la toma: va como nueva y el dominio rechaza el nombre repetido", () => {
    const { grupos } = armar([A], {
      ...EDITA,
      opciones: [
        { clave: "e0", id: OPCION_1, nombre: "Mayonesa", recargo: "50.50" },
        { clave: "n0", id: null, nombre: "mayonesa", recargo: "1.00" },
      ],
    });
    expect(grupos[0]?.opciones.map((o) => o.id)).toEqual([OPCION_1, idDerivado(CLAVE, 1)]);
  });

  it("dos filas que apuntan a la misma opción cuentan una sola vez", () => {
    const { grupos } = armar([A], {
      ...EDITA,
      opciones: [
        { clave: "e0", id: OPCION_1, nombre: "Mayonesa", recargo: "50.50" },
        { clave: "e1", id: OPCION_1, nombre: "Otra vez", recargo: "1.00" },
        { clave: "n0", id: null, nombre: "Mostaza", recargo: "1.00" },
        { clave: "n1", id: null, nombre: "MOSTAZA", recargo: "2.00" },
      ],
    });
    expect(grupos[0]?.opciones.map((o) => [o.id, o.nombre])).toEqual([
      [OPCION_1, "Mayonesa"],
      [OPCION_3, "Mostaza"],
    ]);
  });

  it.each([
    ["un grupo que no existe", { ...EDITA, grupoId: "dddddddd-0000-4000-8000-000000000004" }],
    ["la variante", { ...EDITA, grupoId: GRUPO_V }],
  ])("%s no se puede editar", (_caso, pedido) => {
    expect(armarElConjunto([A, B, V], pedido)).toBe("GRUPO_NO_EDITABLE");
  });

  it("un grupo desactivado no se puede editar (ni reintentando uno nuevo con su clave)", () => {
    const apagado = grupo(GRUPO_B, "Apagado", { activo: false });
    expect(armarElConjunto([A, apagado], { ...EDITA, grupoId: GRUPO_B })).toBe("GRUPO_NO_EDITABLE");
    expect(armarElConjunto([A, apagado], { ...PEDIDO, claveDelCambio: GRUPO_B })).toBe(
      "GRUPO_NO_EDITABLE",
    );
  });

  it("si la clave de un grupo nuevo coincide con la variante, tampoco", () => {
    expect(armarElConjunto([V], { ...PEDIDO, claveDelCambio: GRUPO_V })).toBe("GRUPO_NO_EDITABLE");
  });
});

describe("armarElConjunto: la variante", () => {
  const VARIANTE: PedidoDeGrupo = {
    ...PEDIDO,
    esVariante: true,
    esTamano: true,
    clase: "ADICIONAL",
    esObligatorio: false,
    admiteVarias: true,
    seMuestraEnCarta: false,
    nombre: "Tamaño",
    opciones: [
      { clave: "n0", id: null, nombre: "Chico", recargo: "99.00" },
      { clave: "n1", id: null, nombre: "Grande", recargo: "" },
    ],
  };

  it("una variante nueva es obligatoria, de una sola elección, se muestra en la carta, puede ser la medida y sus opciones no llevan recargo", () => {
    const { grupos } = armar([A], VARIANTE);
    expect(grupos.at(-1)).toEqual({
      id: CLAVE,
      clase: "VARIANTE",
      nombre: "Tamaño",
      esTamano: true,
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: true,
      orden: 2,
      activo: true,
      opciones: [
        { id: idDerivado(CLAVE, 0), nombre: "Chico", recargo: "0.00", orden: 1, activa: true },
        { id: idDerivado(CLAVE, 1), nombre: "Grande", recargo: "0.00", orden: 2, activa: true },
      ],
    });
    expect(armar([A], { ...VARIANTE, esTamano: false }).grupos.at(-1)).toMatchObject({
      esTamano: false,
    });
  });

  it("una variante que existe cambia el nombre y si es la medida, conserva el factor de sus opciones y no toca las reglas", () => {
    const { grupos } = armar([V, A], {
      ...VARIANTE,
      grupoId: GRUPO_V,
      esTamano: false,
      opciones: [{ clave: "e0", id: OPCION_3, nombre: "Gigante", recargo: "" }],
    });
    expect(grupos[0]).toMatchObject({
      id: GRUPO_V,
      clase: "VARIANTE",
      nombre: "Tamaño",
      esTamano: false,
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: true,
      opciones: [
        { id: OPCION_3, nombre: "Gigante", recargo: "0.00", factorDeTamano: "1.500000", orden: 1 },
      ],
    });
    expect(grupos[1]).toMatchObject({ id: GRUPO_A });
  });

  it("la variante y un grupo no se confunden: cada pantalla edita lo suyo", () => {
    expect(armarElConjunto([V, A], { ...VARIANTE, grupoId: GRUPO_A })).toBe("GRUPO_NO_EDITABLE");
    expect(armarElConjunto([V, A], { ...PEDIDO, grupoId: GRUPO_V })).toBe("GRUPO_NO_EDITABLE");
  });
});
