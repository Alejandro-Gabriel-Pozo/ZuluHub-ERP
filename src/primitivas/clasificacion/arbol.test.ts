import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  caminoDeNodo,
  destinosParaMover,
  MAXIMO_DE_NIVELES_DE_CLASIFICACION,
  nivelDeNodo,
  puedeCrearBajo,
  puedeDesactivar,
  puedeMover,
  puedeReactivar,
  type ArbolDeClasificacion,
  type NodoDeClasificacion,
} from "./arbol";

const arbolDe = (nodos: readonly NodoDeClasificacion[]): ArbolDeClasificacion =>
  new Map(nodos.map((n) => [n.id, n]));
const n = (id: string, padreId: string | null, activo = true): NodoDeClasificacion => ({
  id,
  padreId,
  activo,
});

// Restaurante > Bebidas > Gaseosas > Light (4 niveles: el tope) y Alojamiento > Habitaciones.
const ARBOL = arbolDe([
  n("rest", null),
  n("beb", "rest"),
  n("gas", "beb"),
  n("light", "gas"),
  n("aloj", null),
  n("hab", "aloj"),
]);

describe("tope de niveles", () => {
  it("es 4 y lo fija la plataforma una sola vez", () => {
    expect(MAXIMO_DE_NIVELES_DE_CLASIFICACION).toBe(4);
  });
});

describe("nivel y camino de un nodo", () => {
  it("el departamento es el nivel 1 y cada hijo suma uno", () => {
    expect(nivelDeNodo(ARBOL, "rest")).toEqual({ ok: true, valor: 1 });
    expect(nivelDeNodo(ARBOL, "beb")).toEqual({ ok: true, valor: 2 });
    expect(nivelDeNodo(ARBOL, "light")).toEqual({ ok: true, valor: 4 });
  });

  it("el camino va del departamento al nodo", () => {
    expect(caminoDeNodo(ARBOL, "light")).toEqual({
      ok: true,
      valor: ["rest", "beb", "gas", "light"],
    });
    expect(caminoDeNodo(ARBOL, "aloj")).toEqual({ ok: true, valor: ["aloj"] });
  });

  it("un nodo que no existe se rechaza", () => {
    expect(nivelDeNodo(ARBOL, "x")).toEqual({ ok: false, error: "NODO_INEXISTENTE" });
    expect(caminoDeNodo(ARBOL, "x")).toEqual({ ok: false, error: "NODO_INEXISTENTE" });
  });

  it("un árbol dañado no se interpreta: padre que falta, ciclo o más niveles que el tope", () => {
    const sinPadre = arbolDe([n("a", "fantasma")]);
    expect(nivelDeNodo(sinPadre, "a")).toEqual({ ok: false, error: "ARBOL_INCONSISTENTE" });
    const ciclo = arbolDe([n("a", "b"), n("b", "a")]);
    expect(nivelDeNodo(ciclo, "a")).toEqual({ ok: false, error: "ARBOL_INCONSISTENTE" });
    expect(caminoDeNodo(ciclo, "a")).toEqual({ ok: false, error: "ARBOL_INCONSISTENTE" });
    const hondo = arbolDe([n("1", null), n("2", "1"), n("3", "2"), n("4", "3"), n("5", "4")]);
    expect(nivelDeNodo(hondo, "4")).toEqual({ ok: true, valor: 4 });
    expect(nivelDeNodo(hondo, "5")).toEqual({ ok: false, error: "ARBOL_INCONSISTENTE" });
  });
});

describe("crear un nodo", () => {
  it("un departamento se puede crear siempre", () => {
    expect(puedeCrearBajo(ARBOL, null)).toEqual({ ok: true, valor: null });
    expect(puedeCrearBajo(new Map(), null)).toEqual({ ok: true, valor: null });
  });

  it("bajo un nodo activo que no está en el último nivel", () => {
    expect(puedeCrearBajo(ARBOL, "rest")).toEqual({ ok: true, valor: null });
    expect(puedeCrearBajo(ARBOL, "gas")).toEqual({ ok: true, valor: null });
  });

  it("no pasa el tope: bajo el último nivel se rechaza", () => {
    expect(puedeCrearBajo(ARBOL, "light")).toEqual({ ok: false, error: "TOPE_DE_NIVELES" });
  });

  it("bajo un padre que no existe o está desactivado se rechaza", () => {
    expect(puedeCrearBajo(ARBOL, "x")).toEqual({ ok: false, error: "PADRE_INEXISTENTE" });
    const conInactivo = arbolDe([n("d", null, false)]);
    expect(puedeCrearBajo(conInactivo, "d")).toEqual({ ok: false, error: "PADRE_DESACTIVADO" });
  });

  it("bajo un padre cuyo árbol está dañado se rechaza", () => {
    expect(puedeCrearBajo(arbolDe([n("a", "fantasma")]), "a")).toEqual({
      ok: false,
      error: "ARBOL_INCONSISTENTE",
    });
  });
});

describe("mover un nodo", () => {
  it("mueve una categoría a otro departamento", () => {
    expect(puedeMover(ARBOL, "hab", "rest")).toEqual({ ok: true, valor: null });
  });

  it("mover bajo el padre que ya tiene es válido", () => {
    expect(puedeMover(ARBOL, "hab", "aloj")).toEqual({ ok: true, valor: null });
  });

  it("un departamento no se mueve", () => {
    expect(puedeMover(ARBOL, "aloj", "rest")).toEqual({
      ok: false,
      error: "DEPARTAMENTO_NO_SE_MUEVE",
    });
  });

  it("un nodo inexistente o un destino inexistente se rechazan", () => {
    expect(puedeMover(ARBOL, "x", "rest")).toEqual({ ok: false, error: "NODO_INEXISTENTE" });
    expect(puedeMover(ARBOL, "hab", "x")).toEqual({ ok: false, error: "PADRE_INEXISTENTE" });
  });

  it("un destino desactivado se rechaza", () => {
    const arbol = arbolDe([n("a", null), n("b", null, false), n("c", "a")]);
    expect(puedeMover(arbol, "c", "b")).toEqual({ ok: false, error: "PADRE_DESACTIVADO" });
  });

  it("no puede quedar debajo de sí mismo ni de un descendiente", () => {
    expect(puedeMover(ARBOL, "beb", "beb")).toEqual({ ok: false, error: "CICLO" });
    expect(puedeMover(ARBOL, "beb", "gas")).toEqual({ ok: false, error: "CICLO" });
    expect(puedeMover(ARBOL, "beb", "light")).toEqual({ ok: false, error: "CICLO" });
  });

  it("el subárbol que se mueve cuenta entero contra el tope", () => {
    // beb (con gas y light: altura 3) bajo hab (nivel 2) llegaría al nivel 5.
    expect(puedeMover(ARBOL, "beb", "hab")).toEqual({ ok: false, error: "TOPE_DE_NIVELES" });
    // gas (con light: altura 2) bajo hab (nivel 2) llega justo al nivel 4.
    expect(puedeMover(ARBOL, "gas", "hab")).toEqual({ ok: true, valor: null });
    // light solo (altura 1) bajo hab: nivel 3.
    expect(puedeMover(ARBOL, "light", "hab")).toEqual({ ok: true, valor: null });
    // gas bajo light (nivel 4) sería ciclo; light bajo sí mismo también.
    expect(puedeMover(ARBOL, "light", "light")).toEqual({ ok: false, error: "CICLO" });
  });

  it("un árbol dañado se rechaza", () => {
    const hondo = arbolDe([n("a", null), n("x", "a"), n("fantasma-hijo", "fantasma")]);
    expect(puedeMover(hondo, "x", "fantasma-hijo")).toEqual({
      ok: false,
      error: "ARBOL_INCONSISTENTE",
    });
    const ciclo = arbolDe([n("a", null), n("x", "a"), n("p", "q"), n("q", "p")]);
    expect(puedeMover(ciclo, "x", "p")).toEqual({ ok: false, error: "ARBOL_INCONSISTENTE" });
    // Una cadena de 6 niveles ya no cumple el tope: lo que cuelga del nivel 2 mide 5 y no se interpreta.
    const profundo = arbolDe([
      n("1", null),
      n("2", "1"),
      n("3", "2"),
      n("4", "3"),
      n("5", "4"),
      n("6", "5"),
      n("m", "1"),
    ]);
    expect(puedeMover(profundo, "2", "m")).toEqual({ ok: false, error: "ARBOL_INCONSISTENTE" });
    expect(puedeMover(profundo, "m", "2")).toEqual({ ok: true, valor: null });
    // Una cadena de 5 niveles cuenta entera contra el tope sin ser inconsistente.
    const cinco = arbolDe([
      n("1", null),
      n("2", "1"),
      n("3", "2"),
      n("4", "3"),
      n("5", "4"),
      n("m", "1"),
    ]);
    expect(puedeMover(cinco, "2", "m")).toEqual({ ok: false, error: "TOPE_DE_NIVELES" });
    expect(puedeMover(cinco, "2", "m")).not.toEqual({ ok: false, error: "CICLO" });
  });

  it("los destinos de la pantalla son exactamente los que el servidor acepta", () => {
    // gas (con light) puede ir bajo rest, beb (ya está ahí), aloj y hab: justo hasta el tope; no bajo sí mismo ni su hijo.
    expect([...destinosParaMover(ARBOL, "gas")].sort()).toEqual(["aloj", "beb", "hab", "rest"]);
    expect([...destinosParaMover(ARBOL, "aloj")]).toEqual([]);
  });
});

describe("desactivar y reactivar", () => {
  it("no se desactiva con hijos activos; con hijos ya desactivados sí", () => {
    expect(puedeDesactivar(ARBOL, "rest")).toEqual({ ok: false, error: "TIENE_HIJOS_ACTIVOS" });
    expect(puedeDesactivar(ARBOL, "light")).toEqual({ ok: true, valor: null });
    const arbol = arbolDe([n("a", null), n("b", "a", false)]);
    expect(puedeDesactivar(arbol, "a")).toEqual({ ok: true, valor: null });
    expect(puedeDesactivar(ARBOL, "x")).toEqual({ ok: false, error: "NODO_INEXISTENTE" });
  });

  it("no se reactiva con el padre desactivado", () => {
    const arbol = arbolDe([n("a", null, false), n("b", "a", false), n("c", null, false)]);
    expect(puedeReactivar(arbol, "b")).toEqual({ ok: false, error: "PADRE_DESACTIVADO" });
    expect(puedeReactivar(arbol, "a")).toEqual({ ok: true, valor: null });
    expect(puedeReactivar(arbol, "c")).toEqual({ ok: true, valor: null });
    expect(puedeReactivar(arbolDe([n("b", "a", false), n("a", null)]), "b")).toEqual({
      ok: true,
      valor: null,
    });
    expect(puedeReactivar(arbolDe([n("b", "fantasma", false)]), "b")).toEqual({
      ok: false,
      error: "ARBOL_INCONSISTENTE",
    });
    expect(puedeReactivar(arbol, "x")).toEqual({ ok: false, error: "NODO_INEXISTENTE" });
  });
});

/**
 * Propiedad central: contra un oráculo independiente (aplicar el movimiento y revisar que TODO el árbol siga siendo válido), `puedeMover` acepta exactamente
 * lo que deja un árbol válido (sin ciclos, con todos los nodos dentro del tope), y los destinos de la pantalla son los mismos.
 */
describe("propiedades del movimiento", () => {
  const arbolesValidos = fc
    .array(fc.tuple(fc.nat(), fc.boolean(), fc.boolean()), { minLength: 1, maxLength: 10 })
    .map((filas) => {
      const nodos: NodoDeClasificacion[] = [];
      const nivel: number[] = [];
      filas.forEach(([eleccion, esRaiz, activo], i) => {
        const candidatos = nodos.filter(
          (_, j) => (nivel[j] ?? 0) < MAXIMO_DE_NIVELES_DE_CLASIFICACION,
        );
        const padre =
          esRaiz || candidatos.length === 0 ? null : candidatos[eleccion % candidatos.length];
        nodos.push({ id: `n${i}`, padreId: padre?.id ?? null, activo });
        nivel.push(
          padre === null || padre === undefined ? 1 : (nivel[nodos.indexOf(padre)] ?? 0) + 1,
        );
      });
      return arbolDe(nodos);
    });

  const arbolEsValido = (arbol: ArbolDeClasificacion): boolean =>
    [...arbol.keys()].every((id) => nivelDeNodo(arbol, id).ok);

  it("puedeMover acepta justo lo que deja un árbol válido (y activo el padre, y no es un departamento)", () => {
    fc.assert(
      fc.property(arbolesValidos, fc.nat(), fc.nat(), (arbol, a, b) => {
        const ids = [...arbol.keys()];
        const id = ids[a % ids.length] as string;
        const destino = ids[b % ids.length] as string;
        const nodo = arbol.get(id) as NodoDeClasificacion;
        const padre = arbol.get(destino) as NodoDeClasificacion;
        const movido = new Map(arbol);
        movido.set(id, { ...nodo, padreId: destino });
        const esperado = nodo.padreId !== null && padre.activo && arbolEsValido(movido);
        expect(puedeMover(arbol, id, destino).ok).toBe(esperado);
      }),
      { numRuns: 300 },
    );
  });

  it("los destinos de la pantalla son los que puedeMover acepta, y mover a cualquiera de ellos nunca rompe el árbol", () => {
    fc.assert(
      fc.property(arbolesValidos, fc.nat(), (arbol, a) => {
        const ids = [...arbol.keys()];
        const id = ids[a % ids.length] as string;
        const destinos = destinosParaMover(arbol, id);
        for (const candidato of ids) {
          expect(destinos.has(candidato)).toBe(puedeMover(arbol, id, candidato).ok);
        }
        for (const destino of destinos) {
          const movido = new Map(arbol);
          movido.set(id, { ...(arbol.get(id) as NodoDeClasificacion), padreId: destino });
          expect(arbolEsValido(movido)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("crear bajo un padre acepta justo lo que deja un árbol válido (padre activo)", () => {
    fc.assert(
      fc.property(arbolesValidos, fc.nat(), (arbol, a) => {
        const ids = [...arbol.keys()];
        const padre = ids[a % ids.length] as string;
        const nuevo = new Map(arbol);
        nuevo.set("nuevo", { id: "nuevo", padreId: padre, activo: true });
        const esperado = (arbol.get(padre) as NodoDeClasificacion).activo && arbolEsValido(nuevo);
        expect(puedeCrearBajo(arbol, padre).ok).toBe(esperado);
      }),
      { numRuns: 200 },
    );
  });
});
