import { describe, expect, it } from "vitest";
import {
  RUTA_DE_CLASIFICACION,
  armarElArbol,
  armarLaClasificacionDelProducto,
  elegirEnElNivel,
  nodoElegido,
  nodosVisibles,
  opcionesDeMover,
  selectoresDeNivel,
  seleccionVigente,
  type NodoDelArbol,
  type NodoParaElegir,
} from "../../apps/web/ui/plantillas/catalogo/modelo-de-clasificacion";

/**
 * El modelo de vista de la clasificación comercial (A14; maqueta `clasificacion.html`): el árbol con los rótulos de cada nivel, lo plegado, la lista de «Mover», la clasificación de un
 * producto en su ficha y los selectores encadenados de «Cambiar». Puro: sin React ni servidor.
 */
const nodo = (
  id: string,
  nombre: string,
  padreId: string | null,
  nivel: number,
  extra: Partial<NodoDelArbol> = {},
): NodoDelArbol => ({
  id,
  padreId,
  nombre,
  activo: true,
  version: 1,
  nivel,
  admiteHijos: true,
  destinos: [],
  ...extra,
});

// Desordenado a propósito: el modelo ordena los hermanos por nombre y deja cada nodo seguido de sus hijos.
const NODOS: readonly NodoDelArbol[] = [
  nodo("cafes", "Cafés", "bebidas", 3, { version: 7, destinos: ["rest"] }),
  nodo("zeta", "Zeta", null, 1),
  nodo("minutas", "Minutas", "comidas", 3, { activo: false }),
  nodo("rest", "Restaurante", null, 1, { version: 3 }),
  nodo("comidas", "Comidas", "rest", 2, { admiteHijos: false, destinos: ["zeta", "rest"] }),
  nodo("bebidas", "Bebidas", "rest", 2),
  nodo("arbol", "Árbol", null, 1),
];

describe("la ruta", () => {
  it("la pantalla vive en /catalogo/clasificacion", () => {
    expect(RUTA_DE_CLASIFICACION).toBe("/catalogo/clasificacion");
  });
});

describe("armar el árbol", () => {
  const armado = armarElArbol(NODOS);

  it("los textos son los aprobados el 12/11/2026", () => {
    expect(armado.titulo).toBe("Clasificación comercial");
    expect(armado.crear).toBe("Crear");
    expect(armado.renombrar).toBe("Renombrar");
    expect(armado.rotuloDelDepartamento).toBe("Departamento");
    expect(armado.rotuloDeLaCategoria).toBe("Categoría");
  });

  it("cada nodo va seguido de sus hijos y los hermanos por nombre (con acentos: «Árbol» antes que «Restaurante»)", () => {
    expect(armado.nodos.map((n) => n.id)).toEqual([
      "arbol",
      "rest",
      "bebidas",
      "cafes",
      "comidas",
      "minutas",
      "zeta",
    ]);
  });

  it("el nivel 1 es «Departamento» y los niveles 2 a 4, «Categoría» (dueño, 13/11/2026)", () => {
    expect(armado.nodos.map((n) => [n.id, n.nivel, n.rotulo])).toEqual([
      ["arbol", 1, "Departamento"],
      ["rest", 1, "Departamento"],
      ["bebidas", 2, "Categoría"],
      ["cafes", 3, "Categoría"],
      ["comidas", 2, "Categoría"],
      ["minutas", 3, "Categoría"],
      ["zeta", 1, "Departamento"],
    ]);
    const cuatro = armarElArbol([
      nodo("a", "A", null, 1),
      nodo("b", "B", "a", 2),
      nodo("c", "C", "b", 3),
      nodo("d", "D", "c", 4),
    ]);
    expect(cuatro.nodos.map((n) => n.rotulo)).toEqual([
      "Departamento",
      "Categoría",
      "Categoría",
      "Categoría",
    ]);
  });

  it("un nodo desactivado se marca «Desactivado»; uno activo, no", () => {
    expect(armado.nodos.find((n) => n.id === "minutas")).toMatchObject({
      activo: false,
      desactivado: "Desactivado",
    });
    expect(armado.nodos.find((n) => n.id === "rest")).toMatchObject({
      activo: true,
      desactivado: null,
    });
  });

  it("sabe quién tiene hijos (desactivados también) y que un departamento no se mueve", () => {
    const por = new Map(armado.nodos.map((n) => [n.id, n]));
    expect(por.get("rest")).toMatchObject({ tieneHijos: true, seMueve: false });
    expect(por.get("bebidas")).toMatchObject({ tieneHijos: true, seMueve: true });
    expect(por.get("comidas")).toMatchObject({ tieneHijos: true, seMueve: true });
    expect(por.get("cafes")).toMatchObject({ tieneHijos: false, seMueve: true });
    expect(por.get("zeta")).toMatchObject({ tieneHijos: false, seMueve: false });
  });

  it("trae la versión, lo que admite el servidor y los destinos tal cual; la pantalla no decide nada", () => {
    const por = new Map(armado.nodos.map((n) => [n.id, n]));
    expect(por.get("cafes")).toMatchObject({ version: 7, admiteHijos: true, destinos: ["rest"] });
    expect(por.get("comidas")).toMatchObject({ admiteHijos: false, destinos: ["zeta", "rest"] });
    expect(por.get("rest")?.version).toBe(3);
  });

  it("el camino del padre y el propio, del departamento hacia abajo", () => {
    const por = new Map(armado.nodos.map((n) => [n.id, n]));
    expect(por.get("rest")).toMatchObject({ caminoDelPadre: "", camino: "Restaurante" });
    expect(por.get("bebidas")).toMatchObject({
      caminoDelPadre: "Restaurante",
      camino: "Restaurante › Bebidas",
    });
    expect(por.get("cafes")).toMatchObject({
      caminoDelPadre: "Restaurante › Bebidas",
      camino: "Restaurante › Bebidas › Cafés",
    });
  });

  it("sin nodos, sin filas", () => {
    expect(armarElArbol([]).nodos).toEqual([]);
  });

  it("un nodo que no cuelga de ningún departamento (árbol dañado) no se dibuja", () => {
    const roto = armarElArbol([nodo("a", "A", null, 1), nodo("huerfano", "H", "no-esta", 2)]);
    expect(roto.nodos.map((n) => n.id)).toEqual(["a"]);
  });
});

describe("lo plegado", () => {
  const nodos = armarElArbol(NODOS).nodos;
  const ids = (plegados: string[]) => nodosVisibles(nodos, new Set(plegados)).map((n) => n.id);

  it("el árbol arranca desplegado entero", () => {
    expect(ids([])).toHaveLength(7);
  });

  it("plegar un nodo esconde todo lo que tiene adentro, a todos los niveles", () => {
    expect(ids(["rest"])).toEqual(["arbol", "rest", "zeta"]);
    expect(ids(["bebidas"])).toEqual(["arbol", "rest", "bebidas", "comidas", "minutas", "zeta"]);
  });

  it("un nodo plegado dentro de otro plegado no cambia lo que se ve", () => {
    expect(ids(["rest", "bebidas"])).toEqual(["arbol", "rest", "zeta"]);
  });
});

describe("la lista de «Mover»", () => {
  const nodos = armarElArbol(NODOS).nodos;

  it("trae todo el árbol, cada nodo con su camino, y apaga lo que el servidor no admite como destino", () => {
    expect(opcionesDeMover(nodos, "comidas")).toEqual([
      { valor: "arbol", etiqueta: "Árbol", apagada: true },
      { valor: "rest", etiqueta: "Restaurante", apagada: false },
      { valor: "bebidas", etiqueta: "Restaurante › Bebidas", apagada: true },
      { valor: "cafes", etiqueta: "Restaurante › Bebidas › Cafés", apagada: true },
      { valor: "comidas", etiqueta: "Restaurante › Comidas", apagada: true },
      { valor: "minutas", etiqueta: "Restaurante › Comidas › Minutas", apagada: true },
      { valor: "zeta", etiqueta: "Zeta", apagada: false },
    ]);
  });

  it("un nodo que no está: todo apagado (nunca se ofrece lo que nadie declaró)", () => {
    expect(opcionesDeMover(nodos, "no-esta").every((o) => o.apagada)).toBe(true);
  });
});

describe("la clasificación de un producto en su ficha", () => {
  const NODOS_ACTIVOS: readonly NodoParaElegir[] = [
    { id: "rest", padreId: null, nombre: "Restaurante" },
    { id: "comidas", padreId: "rest", nombre: "Comidas" },
  ];
  const vigente = (
    camino: { id: string; nombre: string; activo: boolean }[],
    desde = "2026-11-02",
  ) => ({ productoId: "p1", vigente: { desde, camino }, nodos: NODOS_ACTIVOS });

  it("una fila por nivel del camino, con «Vigente desde» en DD/MM/AAAA", () => {
    const a = armarLaClasificacionDelProducto(
      vigente([
        { id: "rest", nombre: "Restaurante", activo: true },
        { id: "comidas", nombre: "Comidas", activo: true },
      ]),
    );
    expect(a.filas).toEqual([
      { rotulo: "Departamento", valor: "Restaurante", nombreAccesible: undefined },
      { rotulo: "Categoría", valor: "Comidas", nombreAccesible: "Categoría de Restaurante" },
    ]);
    expect(a.vigenteDesde).toEqual({ rotulo: "Vigente desde", valor: "02/11/2026" });
    expect(a.desactivado).toBeNull();
    expect(a.nodoVigente).toBe("comidas");
    expect(a.seleccionInicial).toEqual(["rest", "comidas"]);
    expect(a.cambiar).toBe("Cambiar");
    expect(a.guardar).toBe("Guardar");
    expect(a.cancelar).toBe("Cancelar");
    expect(a.sinElegir).toBe("Sin elegir");
    expect(a.productoId).toBe("p1");
    expect(a.nodos).toBe(NODOS_ACTIVOS);
  });

  it("con tres niveles, el nodo vigente es el último del camino y «Desactivado» mira solo a ese", () => {
    const a = armarLaClasificacionDelProducto(
      vigente([
        { id: "rest", nombre: "Restaurante", activo: true },
        { id: "comidas", nombre: "Comidas", activo: true },
        { id: "postres", nombre: "Postres", activo: false },
      ]),
    );
    expect(a.nodoVigente).toBe("postres");
    expect(a.desactivado).toBe("Desactivado");
    expect(a.filas.map((f) => f.rotulo)).toEqual(["Departamento", "Categoría", "Categoría"]);
  });

  it("sin clasificar: «Departamento: Sin elegir», sin «Vigente desde» y sin nodo vigente", () => {
    const a = armarLaClasificacionDelProducto({
      productoId: "p1",
      vigente: null,
      nodos: NODOS_ACTIVOS,
    });
    expect(a.filas).toEqual([{ rotulo: "Departamento", valor: "Sin elegir" }]);
    expect(a.vigenteDesde).toBeNull();
    expect(a.nodoVigente).toBeNull();
    expect(a.seleccionInicial).toEqual([]);
    expect(a.desactivado).toBeNull();
  });

  it("si se volvió a «Sin elegir» (camino vacío) se ve «Sin elegir» pero con «Vigente desde»", () => {
    const a = armarLaClasificacionDelProducto(vigente([]));
    expect(a.filas).toEqual([{ rotulo: "Departamento", valor: "Sin elegir" }]);
    expect(a.vigenteDesde).toEqual({ rotulo: "Vigente desde", valor: "02/11/2026" });
    expect(a.nodoVigente).toBeNull();
  });

  it("el último nodo desactivado se conserva a la vista con «Desactivado» y no arranca elegido en la hoja", () => {
    const a = armarLaClasificacionDelProducto(
      vigente([
        { id: "rest", nombre: "Restaurante", activo: true },
        { id: "comidas", nombre: "Comidas", activo: false },
      ]),
    );
    expect(a.desactivado).toBe("Desactivado");
    expect(a.filas.at(-1)).toEqual({
      rotulo: "Categoría",
      valor: "Comidas",
      nombreAccesible: "Categoría de Restaurante",
    });
    expect(a.nodoVigente).toBe("comidas");
    expect(a.seleccionInicial).toEqual(["rest"]);
  });

  it("un nodo desactivado en el medio del camino no marca «Desactivado» (solo el último)", () => {
    const a = armarLaClasificacionDelProducto(
      vigente([
        { id: "rest", nombre: "Restaurante", activo: false },
        { id: "comidas", nombre: "Comidas", activo: true },
      ]),
    );
    expect(a.desactivado).toBeNull();
  });

  it("«Cambiar» tiene qué elegir solo si hay nodos activos", () => {
    expect(armarLaClasificacionDelProducto(vigente([])).hayQueElegir).toBe(true);
    expect(
      armarLaClasificacionDelProducto({ productoId: "p1", vigente: null, nodos: [] }).hayQueElegir,
    ).toBe(false);
  });
});

describe("los selectores encadenados de «Cambiar»", () => {
  const NODOS_ACTIVOS: readonly NodoParaElegir[] = [
    { id: "zeta", padreId: null, nombre: "Zeta" },
    { id: "rest", padreId: null, nombre: "Restaurante" },
    { id: "bebidas", padreId: "rest", nombre: "Bebidas" },
    { id: "comidas", padreId: "rest", nombre: "Comidas" },
    { id: "cafes", padreId: "bebidas", nombre: "Cafés" },
    { id: "especial", padreId: "cafes", nombre: "De especialidad" },
  ];

  it("sin nada elegido, un solo selector: los departamentos por nombre, con el valor vacío", () => {
    expect(selectoresDeNivel(NODOS_ACTIVOS, [])).toEqual([
      {
        nivel: 1,
        rotulo: "Departamento",
        valor: "",
        opciones: [
          { valor: "rest", etiqueta: "Restaurante" },
          { valor: "zeta", etiqueta: "Zeta" },
        ],
      },
    ]);
  });

  it("cada nivel aparece solo si el de arriba tiene algo elegido y ese nodo tiene hijos; del 2 al 4, «Categoría»", () => {
    const todo = selectoresDeNivel(NODOS_ACTIVOS, ["rest", "bebidas", "cafes", "especial"]);
    expect(todo.map((s) => [s.nivel, s.rotulo, s.valor])).toEqual([
      [1, "Departamento", "rest"],
      [2, "Categoría", "bebidas"],
      [3, "Categoría", "cafes"],
      [4, "Categoría", "especial"],
    ]);
    expect(todo[1]?.opciones).toEqual([
      { valor: "bebidas", etiqueta: "Bebidas" },
      { valor: "comidas", etiqueta: "Comidas" },
    ]);
    // «Zeta» no tiene hijos: no hay segundo selector.
    expect(selectoresDeNivel(NODOS_ACTIVOS, ["zeta"]).map((s) => s.nivel)).toEqual([1]);
    // «Comidas» tampoco.
    expect(selectoresDeNivel(NODOS_ACTIVOS, ["rest", "comidas"]).map((s) => s.nivel)).toEqual([
      1, 2,
    ]);
  });

  it("una elección que no cuelga de lo de arriba se descarta, y lo que sigue también", () => {
    expect(
      selectoresDeNivel(NODOS_ACTIVOS, ["rest", "cafes"]).map((s) => [s.nivel, s.valor]),
    ).toEqual([
      [1, "rest"],
      [2, ""],
    ]);
    expect(
      selectoresDeNivel(NODOS_ACTIVOS, ["no-existe", "bebidas"]).map((s) => [s.nivel, s.valor]),
    ).toEqual([[1, ""]]);
  });

  it("sin nodos, ningún selector", () => {
    expect(selectoresDeNivel([], [])).toEqual([]);
  });

  it("el nombre accesible de cada categoría lleva el nombre del nodo elegido arriba; el departamento no lo lleva", () => {
    const todo = selectoresDeNivel(NODOS_ACTIVOS, ["rest", "bebidas", "cafes", "especial"]);
    expect(todo.map((s) => s.nombreAccesible)).toEqual([
      undefined,
      "Categoría de Restaurante",
      "Categoría de Bebidas",
      "Categoría de Cafés",
    ]);
    const filas = armarLaClasificacionDelProducto({
      productoId: "p1",
      vigente: {
        desde: "2026-11-02",
        camino: [
          { id: "rest", nombre: "Restaurante", activo: true },
          { id: "bebidas", nombre: "Bebidas", activo: true },
          { id: "cafes", nombre: "Cafés", activo: true },
        ],
      },
      nodos: NODOS_ACTIVOS,
    }).filas;
    expect(filas.map((f) => f.nombreAccesible)).toEqual([
      undefined,
      "Categoría de Restaurante",
      "Categoría de Bebidas",
    ]);
  });

  it("lo elegido válido, de arriba hacia abajo, hasta el último nivel con algo elegido", () => {
    expect(seleccionVigente(NODOS_ACTIVOS, ["rest", "bebidas"])).toEqual(["rest", "bebidas"]);
    expect(seleccionVigente(NODOS_ACTIVOS, ["rest", "cafes", "especial"])).toEqual(["rest"]);
    expect(seleccionVigente(NODOS_ACTIVOS, [])).toEqual([]);
    expect(seleccionVigente(NODOS_ACTIVOS, ["no-existe"])).toEqual([]);
  });

  it("elegir en un nivel descarta lo que estaba más abajo; «Sin elegir» (vacío) también", () => {
    expect(elegirEnElNivel([], 1, "rest")).toEqual(["rest"]);
    expect(elegirEnElNivel(["rest", "bebidas"], 1, "zeta")).toEqual(["zeta"]);
    expect(elegirEnElNivel(["rest", "bebidas", "cafes"], 2, "comidas")).toEqual([
      "rest",
      "comidas",
    ]);
    expect(elegirEnElNivel(["rest", "bebidas", "cafes"], 2, "")).toEqual(["rest"]);
    expect(elegirEnElNivel(["rest", "bebidas"], 1, "")).toEqual([]);
  });

  it("el nodo elegido es el último; sin nada, «Sin elegir» (nulo)", () => {
    expect(nodoElegido(["rest", "bebidas"])).toBe("bebidas");
    expect(nodoElegido(["rest"])).toBe("rest");
    expect(nodoElegido([])).toBeNull();
  });
});
