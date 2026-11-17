import { describe, expect, it } from "vitest";
import { CLASES_DE_USO } from "../../src/modulos/catalogo/publico";
import type { ClaveDeTexto } from "../../src/capacidades/vocabulario/catalogo";
import { texto } from "../../src/capacidades/vocabulario/vocabulario";

// Nombres y descripciones de la maqueta aprobada `productos.html`, constante `CLASES` (línea 423), en el orden de `CLASES_DE_USO`.
const DE_LA_MAQUETA = [
  ["Materia prima", "Se compra y es componente de lo que se elabora y se vende."],
  ["Insumo", "Se compra y se consume para operar, sin ser parte del producto."],
  ["Reventa", "Se compra y se vende tal cual."],
  ["Elaborado", "Se produce en el negocio y se usa como componente."],
  ["Producto vendible", "Se arma o se produce y se vende; tiene composición."],
] as const;

describe("clases de uso del producto: nombre y descripción", () => {
  it("cada clase tiene su nombre y su descripción corta, los de la maqueta, en la clave `catalogo.clase[.descripcion].<codigo>`", () => {
    expect(CLASES_DE_USO).toHaveLength(DE_LA_MAQUETA.length);
    CLASES_DE_USO.forEach((clase, i) => {
      const codigo = clase.toLowerCase();
      expect(texto({}, `catalogo.clase.${codigo}` as ClaveDeTexto), clase).toBe(
        DE_LA_MAQUETA[i]?.[0],
      );
      expect(texto({}, `catalogo.clase.descripcion.${codigo}` as ClaveDeTexto), clase).toBe(
        DE_LA_MAQUETA[i]?.[1],
      );
    });
  });

  it("la clave «Nuevo producto» de la lista ya existe y es la de la maqueta", () => {
    expect(texto({}, "catalogo.lista.nuevo")).toBe("Nuevo producto");
  });
});
