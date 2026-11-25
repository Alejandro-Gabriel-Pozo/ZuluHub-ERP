import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * H4b T3: todo actor de empresa que se arma en código de producción lleva `acciones` (el conjunto que decide el guard). Un objeto que junta
 * `rol` y `modulosActivados` sin `acciones` haría caer al guard a la matriz de roles: justo lo que T3 saca de producción. El camino
 * por matriz queda solo para fakes y pruebas (que esta prueba no mira) y para plataforma y grupo (otros actores, sin `modulosActivados`).
 * Previene: que un actor armado a mano en `src/` autorice por la matriz y no por la base. Chequeo: este archivo, con violaciones inyectadas.
 * Límites que NO ve: un actor armado por partes (`{ ...a, rol }`) o con las claves en variables, y un objeto con llaves anidadas entre las claves.
 */

const OBJETO_CON_ROL_Y_MODULOS: readonly RegExp[] = [
  /\{[^{}]*\brol\b[^{}]*\bmodulosActivados\s*:[^{}]*\}/g,
  /\{[^{}]*\bmodulosActivados\s*:[^{}]*\brol\b[^{}]*\}/g,
];

/** Los objetos que arman un actor (rol y módulos) y no traen `acciones`. */
export function actoresSinAcciones(texto: string): readonly string[] {
  return OBJETO_CON_ROL_Y_MODULOS.flatMap((forma) => texto.match(forma) ?? []).filter(
    (objeto) => !/\bacciones\b/.test(objeto),
  );
}

/** Dónde hoy se arma un actor así (la definición del tipo del puerto, la de `ActorCargado` y el actor «sin rol» del adaptador). */
const ARMAN_ACTORES = [
  "src/adaptadores/postgres/autorizacion.ts",
  "src/capacidades/permisos/exigir.ts",
  "src/puertos/autorizacion.ts",
];

const RAIZ = join(import.meta.dirname, "../..");

function codigoDe(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) return codigoDe(ruta);
    return /\.ts$/.test(entrada.name) && !/\.test\.ts$/.test(entrada.name) ? [ruta] : [];
  });
}

describe("todo actor de empresa armado en producción lleva `acciones`", () => {
  it("ningún archivo de src/ arma un actor sin `acciones`, y los que lo arman son exactamente estos", () => {
    const sin: string[] = [];
    const arman: string[] = [];
    for (const archivo of codigoDe(join(RAIZ, "src"))) {
      const texto = readFileSync(archivo, "utf8");
      const ruta = relative(RAIZ, archivo).split("\\").join("/");
      if (actoresSinAcciones(texto).length > 0) sin.push(ruta);
      if (OBJETO_CON_ROL_Y_MODULOS.some((forma) => (texto.match(forma) ?? []).length > 0))
        arman.push(ruta);
    }
    expect(sin).toEqual([]);
    expect(arman.sort()).toEqual(ARMAN_ACTORES);
  });

  describe("violaciones inyectadas", () => {
    it.each([
      "return { rol: 'GERENTE', modulosActivados: [], modulosHabilitados: [] };",
      "const a = { modulosActivados: [], modulosHabilitados: [], rol: null };",
    ])("%s", (codigo) => {
      expect(actoresSinAcciones(codigo)).toHaveLength(1);
    });

    it("con `acciones`, o sin las dos claves juntas, no cuenta", () => {
      expect(
        actoresSinAcciones(
          "{ rol: null, acciones: [], modulosActivados: [], modulosHabilitados: [] }",
        ),
      ).toEqual([]);
      expect(actoresSinAcciones("{ rol: 'GERENTE' }")).toEqual([]);
      expect(actoresSinAcciones("{ modulosActivados: [], modulosHabilitados: [] }")).toEqual([]);
    });
  });
});
