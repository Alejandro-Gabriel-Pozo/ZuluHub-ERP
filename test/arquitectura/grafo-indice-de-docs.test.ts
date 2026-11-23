import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARCHIVO_DEL_INDICE,
  REPOSITORIO_DE_DOCS,
  extraerDelBrief,
  tipoDeDocumento,
  VERSION_DEL_INDICE,
  type IndiceDeDocs,
} from "../../scripts/indice-de-docs";

/**
 * El índice versionado de lo que viene del repositorio de documentos (maquetas y briefs): del grafo, etapa 0 (ver `scripts/indice-de-docs.ts`). Acá se comprueba
 * su forma y la extracción con un brief de ejemplo; que sea la foto de un commit de docs no se puede comprobar desde el CI (el código no
 * depende del repositorio de documentos), por eso el índice lleva el commit del que salió.
 * Previene: un índice vacío o desordenado que haría medir «cero briefs» sin que nadie lo note.
 */

const RAIZ = join(import.meta.dirname, "../..");
const indice = JSON.parse(readFileSync(join(RAIZ, ARCHIVO_DEL_INDICE), "utf8")) as IndiceDeDocs;

describe("índice de docs del grafo", () => {
  it("tiene la versión esperada, dice de qué commit de docs es foto y no está vacío", () => {
    expect(indice.version).toBe(VERSION_DEL_INDICE);
    expect(indice.docs.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(indice.docs.repositorio).toBe(REPOSITORIO_DE_DOCS);
    expect(indice.maquetas.length).toBeGreaterThan(40);
    expect(indice.briefs.filter((b) => b.tipo === "brief").length).toBeGreaterThan(20);
  });

  it("cada brief dice de dónde sale: los de rama nombran su rama y esa rama figura con su commit; los de main no llevan ramas", () => {
    const ramasDelIndice = new Set(indice.docs.ramas.map((r) => r.nombre));
    for (const r of indice.docs.ramas) expect(r.commit, r.nombre).toMatch(/^[0-9a-f]{40}$/);
    for (const b of indice.briefs) {
      if (b.procedencia === "main") expect(b.ramas, b.id).toEqual([]);
      else {
        expect(b.ramas.length, b.id).toBeGreaterThan(0);
        for (const r of b.ramas) expect(ramasDelIndice.has(r), `${b.id} en ${r}`).toBe(true);
      }
    }
    expect(indice.briefs.some((b) => b.procedencia === "rama")).toBe(true);
  });

  it("los ids son únicos y están ordenados (regenerar no cambia el orden)", () => {
    for (const lista of [indice.maquetas.map((m) => m.id), indice.briefs.map((b) => b.id)]) {
      expect(new Set(lista).size).toBe(lista.length);
      expect(lista).toEqual([...lista].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    }
  });

  it("cada brief lleva sus listas ordenadas y sin repetidos", () => {
    for (const b of indice.briefs)
      for (const lista of [b.acciones, b.rutas, b.maquetas, b.funciones, b.tablas]) {
        expect(new Set(lista).size, b.id).toBe(lista.length);
        expect(lista, b.id).toEqual([...lista].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
      }
  });

  it("extrae de un brief lo que nombra entre comillas invertidas y descarta nombres de archivo", () => {
    const extraido = extraerDelBrief(
      [
        "# PR-9 · Título del brief",
        "Pide `cajas.ver`, `sesiones_caja.abrir` y toca `modulos.ts` y `publico.ts`.",
        "Ruta `/caja/cierre-del-dia/` y `/api/algo`; función `abrirSesion()` y `abrirSesion`; tabla `movimiento_de_dinero`.",
        "Se dibuja en caja.html y en medios.html.",
      ].join("\n"),
    );
    expect(extraido).toEqual({
      titulo: "PR-9 · Título del brief",
      acciones: ["cajas.ver", "sesiones_caja.abrir"],
      rutas: ["/caja/cierre-del-dia"],
      maquetas: ["caja.html", "medios.html"],
      funciones: ["abrirSesion"],
      tablas: ["movimiento_de_dinero"],
    });
  });

  it("separa los briefs de código de los de maqueta y de los documentos de apoyo por el nombre del archivo", () => {
    expect(tipoDeDocumento("PR-2-cobrar-servidor")).toBe("brief");
    expect(tipoDeDocumento("MAQUETA-hoja-de-mas")).toBe("maqueta");
    expect(tipoDeDocumento("PREGUNTAS-ventas")).toBe("otro");
    expect(tipoDeDocumento("DISENO-ingreso-y-salida")).toBe("otro");
    expect(tipoDeDocumento("ENMIENDA-PR-CC-centro-de-costo")).toBe("otro");
  });
});
