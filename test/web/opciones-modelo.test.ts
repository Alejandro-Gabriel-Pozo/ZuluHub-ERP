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
    expect(rutaDeLaCopia(ID)).toBe(`/catalogo/productos/${ID}/opciones/copiar`);
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
        agregar: { href: `/catalogo/productos/${ID}/opciones/variante`, texto: "Agregar variante" },
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
            editar: { href: `/catalogo/productos/${ID}/opciones/${GRUPO}`, texto: "Editar" },
            consumo: {
              href: `/catalogo/productos/${ID}/opciones/${GRUPO}/consumo`,
              texto: "Qué consume",
            },
          },
          {
            id: "g2",
            nombre: "Punto de la carne",
            clase: "Incluida",
            reglas: "(obligatorio) · no figura en la carta",
            opciones: ["Jugoso"],
            editar: { href: `/catalogo/productos/${ID}/opciones/g2`, texto: "Editar" },
            consumo: {
              href: `/catalogo/productos/${ID}/opciones/g2/consumo`,
              texto: "Qué consume",
            },
          },
        ],
      },
      agregar: { href: `/catalogo/productos/${ID}/opciones/nuevo`, texto: "Agregar grupo" },
      copiar: {
        href: `/catalogo/productos/${ID}/opciones/copiar`,
        texto: "Copiar de otro producto",
      },
    });
  });

  it("sin permiso de editar no hay ningún enlace de escribir (nace cerrado), pero sí lo que se ve", () => {
    const armadas = armarLasOpciones(OPCIONES, false);
    expect(armadas.agregar).toBeNull();
    expect(armadas.copiar).toBeNull();
    expect(armadas.grupos.tarjetas.map((t) => t.editar)).toEqual([null, null]);
    expect(armadas.grupos.tarjetas.map((t) => t.consumo)).toEqual([null, null]);
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

  it("un grupo que existe: el título «Editar», lo guardado, la clase solo para leer y cada opción con su clave de fila", () => {
    expect(armarElGrupo(EXISTENTE)).toEqual({
      id: ID,
      esVariante: false,
      esTamano: { etiqueta: "Es la medida", valor: false },
      titulo: "Editar",
      claseGuardada: "Adicional",
      esNuevo: false,
      nombre: { etiqueta: "Nombre", valor: "Salsas" },
      adicional: { etiqueta: "Adicional", valor: false },
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
        quitar: "Quitar",
      },
      guardar: "Guardar",
    });
  });

  it("un grupo nuevo: el título «Agregar grupo», sin clase guardada, todo sin marcar y una fila vacía para empezar", () => {
    expect(armarElGrupo(NUEVO)).toMatchObject({
      titulo: "Agregar grupo",
      claseGuardada: null,
      esNuevo: true,
      nombre: { valor: "" },
      adicional: { valor: false },
      obligatorio: { valor: false },
      varias: { valor: false },
      fueraDeLaCarta: { valor: false },
      opciones: { filas: [{ clave: "n0", nombre: "", recargo: "0.00" }] },
    });
  });

  it("las reglas guardadas se marcan: obligatorio, varias, y «No figura en la carta» cuando NO se muestra en la carta", () => {
    expect(armarElGrupo({ ...EXISTENTE, grupo: PUNTO })).toMatchObject({
      claseGuardada: "Incluida",
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
    claveDeLaCopia: "clave",
  };

  it("el título, el selector con los productos y «Copiar»", () => {
    expect(armarLaCopia(COPIA)).toEqual({
      id: ID,
      titulo: "Copiar de otro producto",
      producto: {
        etiqueta: "Producto",
        opciones: [
          { valor: "a", etiqueta: "Hamburguesa" },
          { valor: "b", etiqueta: "Pizza" },
        ],
      },
      copiar: "Copiar",
    });
  });

  it("sin productos de dónde copiar no hay selector", () => {
    expect(armarLaCopia({ ...COPIA, candidatos: [] }).producto).toBeNull();
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
      editar: { href: `/catalogo/productos/${ID}/opciones/variante`, texto: "Editar" },
      agregar: null,
    });
  });

  it("una variante que no es la medida no lleva la marca; sin variante, «Agregar variante»; sin permiso, ningún enlace", () => {
    expect(lista({ ...V, esTamano: false }).tarjeta?.esLaMedida).toBeNull();
    expect(lista(null)).toEqual({
      titulo: "Variantes",
      tarjeta: null,
      editar: null,
      agregar: { href: `/catalogo/productos/${ID}/opciones/variante`, texto: "Agregar variante" },
    });
    expect(lista(V, false)).toMatchObject({ editar: null, agregar: null });
    expect(lista(null, false).agregar).toBeNull();
  });

  it("armar la variante: «Agregar variante» si es nueva, «Editar» si existe; la medida marcada según lo guardado; sin clase para leer", () => {
    const base = { id: ID, nombre: "Latte", versionDeOpciones: 1, claveDelCambio: "c" };
    expect(armarLaVariante({ ...base, grupo: null })).toMatchObject({
      esVariante: true,
      titulo: "Agregar variante",
      esTamano: { etiqueta: "Es la medida", valor: false },
    });
    expect(armarLaVariante({ ...base, grupo: V })).toMatchObject({
      esVariante: true,
      titulo: "Editar",
      claseGuardada: null,
      esTamano: { valor: true },
    });
    expect(armarElGrupo({ ...base, grupo: null }).esVariante).toBe(false);
  });
});
