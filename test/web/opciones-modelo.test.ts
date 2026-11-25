import { describe, expect, it } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";
import {
  armarElGrupo,
  armarLaVariante,
  rutaDeLaVariante,
  armarLaCopia,
  armarLasOpciones,
  rutaDeLaCopia,
  rutaDeLasOpciones,
  rutaDeUnGrupo,
  rutaDeUnGrupoNuevo,
  textoDelError,
  type CopiaDeLaPantalla,
  type GrupoDeLaPantalla,
  type GrupoParaEditarDeLaPantalla,
  type OpcionesDeLaPantalla,
} from "../../apps/web/ui/plantillas/catalogo/modelo-de-opciones";

/**
 * El modelo de vista de las opciones de un producto (A13, tramo Opciones): lo que se ve, en el orden de la maqueta `productos.html`, con los textos del catálogo. Los recargos son texto
 * decimal: nunca pasan por `Number`.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const GRUPO = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";

const SALSAS: GrupoDeLaPantalla = {
  id: GRUPO,
  nombre: "Salsas",
  clase: "ADICIONAL",
  esTamano: false,
  esObligatorio: false,
  admiteVarias: true,
  seMuestraEnCarta: true,
  opciones: [
    { id: "o1", nombre: "Mayonesa", recargo: "500.000000" },
    { id: "o2", nombre: "Ketchup", recargo: "0.000000" },
  ],
};
const PUNTO: GrupoDeLaPantalla = {
  id: "g2",
  nombre: "Punto de la carne",
  clase: "INCLUIDA",
  esTamano: false,
  esObligatorio: true,
  admiteVarias: false,
  seMuestraEnCarta: false,
  opciones: [{ id: "o3", nombre: "Jugoso", recargo: "0.00" }],
};
const OPCIONES: OpcionesDeLaPantalla = {
  id: ID,
  nombre: "Milanesa",
  versionDeOpciones: 4,
  grupos: [SALSAS, PUNTO],
  variante: null,
  claveDelCambio: "clave",
};

describe("las rutas", () => {
  it("cuelgan de la ficha del producto", () => {
    expect(rutaDeLasOpciones(ID)).toBe(`/catalogo/productos/${ID}/opciones`);
    expect(rutaDeUnGrupoNuevo(ID)).toBe(`/catalogo/productos/${ID}/opciones/nuevo`);
    expect(rutaDeUnGrupo(ID, GRUPO)).toBe(`/catalogo/productos/${ID}/opciones/${GRUPO}`);
    expect(rutaDeLaCopia(ID)).toBe(`/catalogo/productos/${ID}/opciones?copiar=1`);
    expect(rutaDeLaCopia(ID, GRUPO)).toBe(`/catalogo/productos/${ID}/opciones?copiar=${GRUPO}`);
    expect(rutaDeLaCopia(ID, "a b&c")).toBe(`/catalogo/productos/${ID}/opciones?copiar=a%20b%26c`);
  });
});

describe("armarLasOpciones", () => {
  it("arma las tarjetas con los textos de la maqueta; el recargo solo si lo hay; «no figura en la carta» solo si no figura", () => {
    expect(armarLasOpciones(OPCIONES, true)).toEqual({
      id: ID,
      titulo: "Milanesa",
      variantes: {
        titulo: "Variantes",
        tarjeta: null,
        editar: null,
        agregar: {
          href: `/catalogo/productos/${ID}/opciones/variante`,
          texto: "Agregar variante",
          apagado: false,
        },
      },
      grupos: {
        titulo: "Grupos de opciones",
        tarjetas: [
          {
            id: GRUPO,
            nombre: "Salsas",
            clase: "Adicional",
            reglas: "(opcional)",
            opciones: ["Mayonesa + $ 500,00", "Ketchup"],
            editar: {
              href: `/catalogo/productos/${ID}/opciones/${GRUPO}`,
              texto: "Editar",
              apagado: false,
            },
            consumo: {
              href: `/catalogo/productos/${ID}/opciones/${GRUPO}/consumo`,
              texto: "Qué consume",
              apagado: false,
            },
          },
          {
            id: "g2",
            nombre: "Punto de la carne",
            clase: "Incluida",
            reglas: "(obligatorio) · no figura en la carta",
            opciones: ["Jugoso"],
            editar: {
              href: `/catalogo/productos/${ID}/opciones/g2`,
              texto: "Editar",
              apagado: false,
            },
            consumo: {
              href: `/catalogo/productos/${ID}/opciones/g2/consumo`,
              texto: "Qué consume",
              apagado: false,
            },
          },
        ],
      },
      agregar: {
        href: `/catalogo/productos/${ID}/opciones/nuevo`,
        texto: "Agregar grupo",
        apagado: false,
      },
      copiar: {
        href: `/catalogo/productos/${ID}/opciones?copiar=1`,
        texto: "Copiar de otro producto",
        apagado: false,
      },
    });
  });

  it("sin permiso de editar los botones de escribir siguen, pero APAGADOS (maqueta: dis()): nace cerrado y se ve lo mismo", () => {
    const armadas = armarLasOpciones(OPCIONES, false);
    expect(armadas.agregar).toMatchObject({ texto: "Agregar grupo", apagado: true });
    expect(armadas.copiar).toMatchObject({ texto: "Copiar de otro producto", apagado: true });
    expect(armadas.grupos.tarjetas.map((t) => t.editar)).toMatchObject([
      { texto: "Editar", apagado: true },
      { texto: "Editar", apagado: true },
    ]);
    expect(armadas.grupos.tarjetas.map((t) => t.consumo)).toMatchObject([
      { texto: "Qué consume", apagado: true },
      { texto: "Qué consume", apagado: true },
    ]);
    expect(armadas.grupos.tarjetas.map((t) => t.nombre)).toEqual(["Salsas", "Punto de la carne"]);
  });

  it("un recargo es cero si no tiene ningún dígito distinto de 0, con cualquier cantidad de decimales; uno con decimales sí se muestra", () => {
    const con = (recargo: string) =>
      armarLasOpciones(
        { ...OPCIONES, grupos: [{ ...SALSAS, opciones: [{ id: "o", nombre: "X", recargo }] }] },
        false,
      ).grupos.tarjetas[0]?.opciones[0];
    expect(con("0")).toBe("X");
    expect(con("0.00")).toBe("X");
    expect(con("0.000000")).toBe("X");
    expect(con("0.000001")).toBe("X + $ 0,000001");
    expect(con("10")).toBe("X + $ 10,00");
    expect(con("28333.333333")).toBe("X + $ 28.333,333333");
  });

  it("un producto sin grupos tiene la lista vacía", () => {
    expect(armarLasOpciones({ ...OPCIONES, grupos: [] }, true).grupos.tarjetas).toEqual([]);
  });
});

describe("armarElGrupo", () => {
  const EXISTENTE: GrupoParaEditarDeLaPantalla = {
    id: ID,
    nombre: "Milanesa",
    versionDeOpciones: 4,
    grupo: SALSAS,
    claveDelCambio: "clave",
  };
  const NUEVO: GrupoParaEditarDeLaPantalla = { ...EXISTENTE, grupo: null };

  const OPCIONES_DE_CLASE = [
    { valor: "INCLUIDA", etiqueta: "Incluida" },
    { valor: "ADICIONAL", etiqueta: "Adicional" },
  ];

  it("un grupo que existe: el título «Editar», lo guardado, «Incluida / Adicional» con su valor y apagado, y cada opción con su clave de fila (sin «Quitar»)", () => {
    expect(armarElGrupo(EXISTENTE)).toEqual({
      id: ID,
      esVariante: false,
      esTamano: { etiqueta: "Es la medida", valor: false },
      titulo: "Editar",
      esNuevo: false,
      nombre: { etiqueta: "Nombre", valor: "Salsas" },
      clase: { valor: "ADICIONAL", opciones: OPCIONES_DE_CLASE, apagado: true },
      obligatorio: { etiqueta: "Obligatorio", valor: false },
      varias: { etiqueta: "Se puede elegir más de una", valor: true },
      fueraDeLaCarta: { etiqueta: "No figura en la carta", valor: false },
      opciones: {
        nombreDelCampo: "Nombre",
        recargoDelCampo: "Recargo",
        filas: [
          { clave: "e0", nombre: "Mayonesa", recargo: "500.00" },
          { clave: "e1", nombre: "Ketchup", recargo: "0.00" },
        ],
        nuevaFila: { clave: "n", nombre: "", recargo: "0.00" },
        agregar: "Agregar opción",
      },
      guardar: "Guardar",
    });
  });

  it("un grupo nuevo (maqueta, «Agregar grupo»): nace en «Incluida», obligatorio, con dos filas vacías y la clase sin apagar", () => {
    expect(armarElGrupo(NUEVO)).toMatchObject({
      titulo: "Agregar grupo",
      esNuevo: true,
      nombre: { valor: "" },
      clase: { valor: "INCLUIDA", opciones: OPCIONES_DE_CLASE, apagado: false },
      obligatorio: { valor: true },
      varias: { valor: false },
      fueraDeLaCarta: { valor: false },
      opciones: {
        filas: [
          { clave: "n0", nombre: "", recargo: "0.00" },
          { clave: "n1", nombre: "", recargo: "0.00" },
        ],
      },
    });
  });

  it("las reglas guardadas se marcan: obligatorio, varias, y «No figura en la carta» cuando NO se muestra en la carta", () => {
    expect(armarElGrupo({ ...EXISTENTE, grupo: PUNTO })).toMatchObject({
      clase: { valor: "INCLUIDA", apagado: true },
      obligatorio: { valor: true },
      varias: { valor: false },
      fueraDeLaCarta: { valor: true },
    });
  });

  it("un recargo con más decimales que el campo sale vacío: no se muestra recortado", () => {
    const g = {
      ...SALSAS,
      opciones: [{ id: "o", nombre: "Caro", recargo: "28333.333333" }],
    };
    expect(armarElGrupo({ ...EXISTENTE, grupo: g }).opciones.filas).toEqual([
      { clave: "e0", nombre: "Caro", recargo: "" },
    ]);
  });
});

describe("armarLaCopia", () => {
  const COPIA: CopiaDeLaPantalla = {
    id: ID,
    nombre: "Milanesa",
    versionDeOpciones: 4,
    candidatos: [
      { id: "a", nombre: "Hamburguesa" },
      { id: "b", nombre: "Pizza" },
    ],
    origen: "a",
    vistaPrevia: [
      {
        nombre: "Guarnición",
        clase: "INCLUIDA",
        opciones: [
          { nombre: "Papas fritas", recargo: null },
          { nombre: "Ensalada", recargo: null },
        ],
      },
      {
        nombre: "Salsas",
        clase: "ADICIONAL",
        opciones: [
          { nombre: "Mayonesa", recargo: "500.00" },
          { nombre: "Ketchup", recargo: null },
        ],
      },
    ],
    claveDeLaCopia: "clave",
  };

  it("el título, el selector con el origen elegido, la vista previa en el formato de la maqueta, «Cancelar» y «Copiar»", () => {
    expect(armarLaCopia(COPIA, true)).toEqual({
      id: ID,
      titulo: "Copiar de otro producto",
      producto: {
        etiqueta: "Producto",
        valor: "a",
        opciones: [
          { valor: "a", etiqueta: "Hamburguesa" },
          { valor: "b", etiqueta: "Pizza" },
        ],
      },
      vistaPrevia: [
        {
          titulo: "Grupos de opciones",
          lineas: ["Guarnición: Papas fritas · Ensalada", "Salsas: Mayonesa + $ 500,00 · Ketchup"],
        },
      ],
      cancelar: "Cancelar",
      copiar: "Copiar",
      copiarApagado: false,
      hrefDeCierre: `/catalogo/productos/${ID}/opciones`,
      cerrar: "Cerrar",
    });
  });

  it("si la copia trae la variante, su bloque «Variantes» va primero, con los nombres de las opciones y sin recargo", () => {
    const armada = armarLaCopia(
      {
        ...COPIA,
        vistaPrevia: [
          ...COPIA.vistaPrevia,
          {
            nombre: "Tamaño",
            clase: "VARIANTE",
            opciones: [
              { nombre: "Chica", recargo: null },
              { nombre: "Grande", recargo: "100.00" },
            ],
          },
        ],
      },
      true,
    );
    expect(armada.vistaPrevia.map((b) => b.titulo)).toEqual(["Variantes", "Grupos de opciones"]);
    expect(armada.vistaPrevia[0]?.lineas).toEqual(["Tamaño: Chica · Grande"]);
    // La variante no se repite entre los grupos comunes (y la variante sola no abre un bloque de grupos).
    expect(armada.vistaPrevia[1]?.lineas).toEqual([
      "Guarnición: Papas fritas · Ensalada",
      "Salsas: Mayonesa + $ 500,00 · Ketchup",
    ]);
    const solo = armarLaCopia(
      {
        ...COPIA,
        vistaPrevia: [
          { nombre: "Tamaño", clase: "VARIANTE", opciones: [{ nombre: "Chica", recargo: null }] },
        ],
      },
      true,
    );
    expect(solo.vistaPrevia).toEqual([{ titulo: "Variantes", lineas: ["Tamaño: Chica"] }]);
  });

  it("«Copiar» sale apagado si no hay nada para traer o si la persona no puede editar; encendido solo con las dos", () => {
    expect(armarLaCopia({ ...COPIA, vistaPrevia: [] }, true)).toMatchObject({
      vistaPrevia: [],
      copiarApagado: true,
    });
    expect(armarLaCopia(COPIA, false).copiarApagado).toBe(true);
    expect(armarLaCopia(COPIA, true).copiarApagado).toBe(false);
  });

  it("sin productos de dónde copiar la hoja igual se arma: selector vacío y «Copiar» apagado", () => {
    expect(
      armarLaCopia({ ...COPIA, candidatos: [], origen: null, vistaPrevia: [] }, true),
    ).toMatchObject({
      producto: { etiqueta: "Producto", valor: "", opciones: [] },
      copiarApagado: true,
    });
  });
});

describe("textoDelError", () => {
  it("es el texto del catálogo de la clave del error", () => {
    expect(textoDelError(errorDeCodigo("CATALOGO_FALTA_EL_NOMBRE"))).toBe("Falta el nombre");
    expect(textoDelError(errorDeCodigo("CATALOGO_INCLUIDA_CON_RECARGO"))).toBe(
      "Una opción incluida no lleva recargo",
    );
    expect(textoDelError(errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA"))).toBe(
      "Esta acción no está permitida",
    );
  });
});

describe("la variante", () => {
  const V: GrupoDeLaPantalla = {
    id: "v1",
    nombre: "Tamaño",
    clase: "VARIANTE",
    esTamano: true,
    esObligatorio: true,
    admiteVarias: false,
    seMuestraEnCarta: true,
    opciones: [
      { id: "a", nombre: "Chico", recargo: "0.000000" },
      { id: "b", nombre: "Grande", recargo: "0.000000" },
    ],
  };
  const lista = (variante: GrupoDeLaPantalla | null, puede = true) =>
    armarLasOpciones({ ...OPCIONES, variante }, puede).variantes;

  it("la ruta cuelga de las opciones", () => {
    expect(rutaDeLaVariante(ID)).toBe(`/catalogo/productos/${ID}/opciones/variante`);
  });

  it("con variante: la tarjeta con «Es la medida» y «Editar»; sin «Agregar variante»", () => {
    expect(lista(V)).toEqual({
      titulo: "Variantes",
      tarjeta: {
        id: "v1",
        nombre: "Tamaño",
        esLaMedida: "Es la medida",
        opciones: ["Chico", "Grande"],
      },
      editar: {
        href: `/catalogo/productos/${ID}/opciones/variante`,
        texto: "Editar",
        apagado: false,
      },
      agregar: null,
    });
  });

  it("una variante que no es la medida no lleva la marca; sin variante, «Agregar variante»; sin permiso, apagados (no ausentes)", () => {
    expect(lista({ ...V, esTamano: false }).tarjeta?.esLaMedida).toBeNull();
    expect(lista(null)).toEqual({
      titulo: "Variantes",
      tarjeta: null,
      editar: null,
      agregar: {
        href: `/catalogo/productos/${ID}/opciones/variante`,
        texto: "Agregar variante",
        apagado: false,
      },
    });
    expect(lista(V, false)).toMatchObject({ editar: { apagado: true }, agregar: null });
    expect(lista(null, false).agregar).toMatchObject({ apagado: true });
  });

  it("armar la variante: «Agregar variante» si es nueva, «Editar» si existe; la medida marcada según lo guardado", () => {
    const base = { id: ID, nombre: "Latte", versionDeOpciones: 1, claveDelCambio: "c" };
    expect(armarLaVariante({ ...base, grupo: null })).toMatchObject({
      esVariante: true,
      titulo: "Agregar variante",
      esTamano: { etiqueta: "Es la medida", valor: false },
    });
    expect(armarLaVariante({ ...base, grupo: V })).toMatchObject({
      esVariante: true,
      titulo: "Editar",
      // La variante guardada no lleva una clase de la lista: el valor es uno válido y no cuenta.
      clase: { valor: "INCLUIDA" },
      esTamano: { valor: true },
    });
    expect(armarElGrupo({ ...base, grupo: null }).esVariante).toBe(false);
  });
});
