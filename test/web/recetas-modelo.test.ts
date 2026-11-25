import { describe, expect, it } from "vitest";
import { leerLaEntradaDeLaListaDeRecetas } from "../../src/composicion/entradas-de-recetas";
import {
  FILTROS_DE_RECETAS,
  RUTA_DE_RECETAS,
  direccionDeLaListaDeRecetas,
  leerElFiltroDeRecetas,
  leerLaPaginaDeRecetas,
  rutaDeLaCocina,
  rutaDeLaReceta,
} from "../../apps/web/ui/plantillas/recetas/filtros-de-recetas";
import {
  armarLaCocina,
  armarLaReceta,
  type RecetaDeLaFicha,
} from "../../apps/web/ui/plantillas/recetas/modelo-de-receta";
import { armarLaListaDeRecetas } from "../../apps/web/ui/plantillas/recetas/modelo-de-recetas";

/**
 * El modelo de vista de Recetas (lista, ficha y ficha de cocina): lo que se ve en cada situación y nada más. Previene: un costo que pasa por `Number` (se pierde precisión), un cero donde
 * falta el costo, costos en una pantalla que no los trajo (el operador), una opción del filtro que la composición no acepta, y un texto armado a mano en lugar del aprobado.
 */

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";

describe("las direcciones y el filtro", () => {
  it("la lista, la ficha y la cocina", () => {
    expect(RUTA_DE_RECETAS).toBe("/catalogo/recetas");
    expect(rutaDeLaReceta(ID)).toBe(`/catalogo/recetas/${ID}`);
    expect(rutaDeLaCocina(ID)).toBe(`/catalogo/recetas/${ID}/cocina`);
  });

  it("sin filtro es la lista pelada; el filtro y la página viajan en la dirección", () => {
    expect(direccionDeLaListaDeRecetas("", null)).toBe("/catalogo/recetas");
    expect(direccionDeLaListaDeRecetas("sin", null)).toBe("/catalogo/recetas?receta=sin");
    expect(direccionDeLaListaDeRecetas("", "abc")).toBe("/catalogo/recetas?despues=abc");
    expect(direccionDeLaListaDeRecetas("sin", "a b")).toBe(
      "/catalogo/recetas?receta=sin&despues=a+b",
    );
  });

  it("lo que no es una opción conocida vuelve a «Todas» (también un valor repetido o raro)", () => {
    expect(leerElFiltroDeRecetas({ receta: "sin" })).toBe("sin");
    expect(leerElFiltroDeRecetas({ receta: ["sin", "con"] })).toBe("sin");
    expect(leerElFiltroDeRecetas({ receta: "con" })).toBe("");
    expect(leerElFiltroDeRecetas({ receta: "SIN" })).toBe("");
    expect(leerElFiltroDeRecetas({ receta: "'; drop table" })).toBe("");
    expect(leerElFiltroDeRecetas({})).toBe("");
  });

  it("la página es lo que dice la dirección (la valida el servidor); sin nada es la primera", () => {
    expect(leerLaPaginaDeRecetas({ despues: "xyz" })).toBe("xyz");
    expect(leerLaPaginaDeRecetas({ despues: ["uno", "dos"] })).toBe("uno");
    expect(leerLaPaginaDeRecetas({})).toBe("");
  });

  it("cada opción del filtro es una que la composición acepta y filtra «sin receta»", () => {
    for (const filtro of FILTROS_DE_RECETAS) {
      const entrada = leerLaEntradaDeLaListaDeRecetas({
        texto: "",
        conReceta: filtro,
        activo: "",
        despues: "",
      });
      expect(entrada).toEqual({ conReceta: false });
    }
  });
});

describe("la lista de recetas", () => {
  const lista = {
    recetas: [
      { productoId: ID, nombre: "Pizza", version: 3, costoPorUnidad: "1234.565000" },
      { productoId: "b", nombre: "Tarta", version: 1, costoPorUnidad: null },
      { productoId: "c", nombre: "Flan", version: null, costoPorUnidad: undefined },
    ],
    siguiente: null,
  };

  it("filtros «Todas» y «Sin receta» como enlaces; el actual se marca", () => {
    expect(armarLaListaDeRecetas(lista, "").filtros).toEqual([
      { href: "/catalogo/recetas", texto: "Todas", actual: true },
      { href: "/catalogo/recetas?receta=sin", texto: "Sin receta", actual: false },
    ]);
    expect(armarLaListaDeRecetas(lista, "sin").filtros.map((f) => f.actual)).toEqual([false, true]);
  });

  it("una fila por producto: el costo a 2 decimales (mitad hacia arriba), «Sin costo» si falta y «Sin receta» si no tiene", () => {
    const armada = armarLaListaDeRecetas(lista, "");
    expect(armada.filas).toEqual([
      {
        id: ID,
        href: `/catalogo/recetas/${ID}`,
        nombre: "Pizza",
        costo: "$ 1.234,57",
        sinReceta: null,
      },
      {
        id: "b",
        href: "/catalogo/recetas/b",
        nombre: "Tarta",
        costo: "Sin costo",
        sinReceta: null,
      },
      {
        id: "c",
        href: "/catalogo/recetas/c",
        nombre: "Flan",
        costo: null,
        sinReceta: "Sin receta",
      },
    ]);
    expect(armada.vacio).toBeNull();
  });

  it("sin receta con costos (un gerente: la consulta trae null) dice «Sin receta», sin «Sin costo» ni cero; y sin otra página no hay «Página siguiente»", () => {
    const armada = armarLaListaDeRecetas(
      {
        recetas: [{ productoId: ID, nombre: "Flan", version: null, costoPorUnidad: null }],
        siguiente: null,
      },
      "",
    );
    expect(armada.filas[0]).toMatchObject({ costo: null, sinReceta: "Sin receta" });
    expect(armada.siguiente).toBeNull();
  });

  it("sin costos en la consulta (un operador) no hay costo ni hueco: nunca cero", () => {
    const armada = armarLaListaDeRecetas(
      { recetas: [{ productoId: ID, nombre: "Pizza", version: 3 }], siguiente: null },
      "",
    );
    expect(armada.filas[0]?.costo).toBeNull();
    expect(JSON.stringify(armada)).not.toContain("$ 0");
  });

  it("el costo es exacto: no pasa por Number (un importe grande no pierde dígitos)", () => {
    const armada = armarLaListaDeRecetas(
      {
        recetas: [
          { productoId: ID, nombre: "Pizza", version: 1, costoPorUnidad: "123456789012.345678" },
        ],
        siguiente: null,
      },
      "",
    );
    expect(armada.filas[0]?.costo).toBe("$ 123.456.789.012,35");
  });

  it("sin recetas dice «Sin resultados»; con página siguiente ofrece «Página siguiente» con el filtro", () => {
    expect(armarLaListaDeRecetas({ recetas: [], siguiente: null }, "").vacio).toBe(
      "Sin resultados",
    );
    expect(armarLaListaDeRecetas({ ...lista, siguiente: "k" }, "sin").siguiente).toEqual({
      href: "/catalogo/recetas?receta=sin&despues=k",
      texto: "Página siguiente",
    });
  });
});

const receta = (cambios: Partial<NonNullable<RecetaDeLaFicha["ficha"]>> = {}): RecetaDeLaFicha => ({
  producto: { id: ID, nombre: "Pizza muzzarella" },
  ficha: {
    version: 3,
    esLaVigente: true,
    rinde: "10.0000",
    pasos: "Amasar, dejar levar y hornear.",
    componentes: [
      {
        numero: 1,
        nombre: "Harina",
        clase: "MATERIA_PRIMA",
        bruto: "2.5000",
        unidadId: "KILOGRAMO",
        merma: "0.0000",
        neto: "2.5000",
        costo: "1500.000000",
      },
      {
        numero: 2,
        nombre: "Tomate",
        clase: "MATERIA_PRIMA",
        bruto: "1.0000",
        unidadId: "KILOGRAMO",
        merma: "12.5000",
        neto: "0.8750",
        costo: null,
      },
    ],
    costos: { porUnidad: "300.500000", incompleto: false },
    ...cambios,
  },
});

describe("la ficha de una receta", () => {
  it("versión vigente, rinde, costo de la comida y cada ingrediente con su clase, bruto y, si hay merma, merma y neto", () => {
    const armada = armarLaReceta(receta());
    expect(armada.titulo).toBe("Pizza muzzarella");
    expect(armada.sinReceta).toBeNull();
    expect(armada.version).toBe("Versión 3 · vigente");
    expect(armada.datos).toEqual([
      { rotulo: "Rinde", valor: "10", fuerte: false },
      { rotulo: "Costo de la comida", valor: "$ 300,50", fuerte: true },
    ]);
    expect(armada.ingredientes?.titulo).toBe("Ingredientes");
    expect(armada.ingredientes?.filas).toEqual([
      {
        clave: "1",
        nombre: "Harina",
        costo: "$ 1.500,00",
        detalle: "Materia prima · Bruto 2,5 Kilogramo",
      },
      {
        clave: "2",
        nombre: "Tomate",
        costo: "Sin costo",
        detalle: "Materia prima · Bruto 1 Kilogramo · Merma 12,5 % · Neto 0,875 Kilogramo",
      },
    ]);
    expect(armada.pasos).toEqual({ titulo: "Pasos", texto: "Amasar, dejar levar y hornear." });
    expect(armada.cocina).toEqual({
      href: `/catalogo/recetas/${ID}/cocina`,
      texto: "Ficha de cocina",
    });
  });

  it("un costo incompleto dice «Sin costo» (nunca cero ni un parcial)", () => {
    const armada = armarLaReceta(receta({ costos: { porUnidad: "10.000000", incompleto: true } }));
    expect(armada.datos[1]).toEqual({
      rotulo: "Costo de la comida",
      valor: "Sin costo",
      fuerte: true,
    });
  });

  it("sin costos en la consulta (un operador): ni «Costo de la comida» ni costo por línea ni huecos", () => {
    const sinCostos = receta();
    const ficha = sinCostos.ficha!;
    const armada = armarLaReceta({
      ...sinCostos,
      ficha: {
        ...ficha,
        costos: undefined,
        componentes: ficha.componentes.map((l) => ({ ...l, costo: undefined })),
      },
    });
    expect(armada.datos.map((d) => d.rotulo)).toEqual(["Rinde"]);
    expect(armada.ingredientes?.filas.map((f) => f.costo)).toEqual([null, null]);
    expect(JSON.stringify(armada)).not.toMatch(/\$|Sin costo/);
  });

  it("una versión vieja no dice «vigente»; sin pasos no hay sección", () => {
    const armada = armarLaReceta(receta({ esLaVigente: false, pasos: null }));
    expect(armada.version).toBe("Versión 3");
    expect(armada.pasos).toBeNull();
  });

  it("un producto sin receta dice «Este producto no tiene receta» y nada más", () => {
    const armada = armarLaReceta({ producto: { id: ID, nombre: "Flan" }, ficha: null });
    expect(armada).toEqual({
      titulo: "Flan",
      sinReceta: "Este producto no tiene receta",
      version: null,
      datos: [],
      ingredientes: null,
      pasos: null,
      cocina: null,
    });
  });

  it("una clase o una unidad que la pantalla no conoce se dicen con el propio valor (no se esconde el ingrediente)", () => {
    const ficha = receta().ficha!;
    const armada = armarLaReceta({
      producto: { id: ID, nombre: "X" },
      ficha: {
        ...ficha,
        componentes: [{ ...ficha.componentes[0]!, clase: "RARA", unidadId: "PARSEC" }],
      },
    });
    expect(armada.ingredientes?.filas[0]?.detalle).toBe("RARA · Bruto 2,5 PARSEC");
  });
});

describe("la ficha de cocina", () => {
  const cocina = {
    version: 3,
    rinde: "10.0000",
    pasos: "Hornear.",
    componentes: [
      { productoId: "p1", nombre: "Harina", cantidad: "2.5000", unidadId: "KILOGRAMO" },
      { productoId: "p2", nombre: "Agua", cantidad: "1.0000", unidadId: "LITRO" },
    ],
  };

  it("el nombre, «Rinde N · Versión V», cada ingrediente con su cantidad bruta y los pasos", () => {
    expect(armarLaCocina("Pizza", cocina)).toEqual({
      titulo: "Pizza",
      encabezado: "Rinde 10 · Versión 3",
      filas: [
        { clave: "0-p1", nombre: "Harina", cantidad: "2,5 Kilogramo" },
        { clave: "1-p2", nombre: "Agua", cantidad: "1 Litro" },
      ],
      pasos: "Hornear.",
    });
  });

  it("sin pasos no hay pasos; nunca lleva costos ni precios", () => {
    const armada = armarLaCocina("Pizza", { ...cocina, pasos: null });
    expect(armada.pasos).toBeNull();
    expect(JSON.stringify(armada)).not.toMatch(/\$|costo|precio/i);
  });
});
