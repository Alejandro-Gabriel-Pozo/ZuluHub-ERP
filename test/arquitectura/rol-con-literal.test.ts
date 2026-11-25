import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * H4b T3, regla «el rol no autoriza»: una decisión de permiso sale del CONJUNTO DE ACCIONES del actor (plantilla o rol propio), no de
 * comparar el rol con un literal (`rol === "GERENTE"`). Un rol propio (`PROPIO`) no es ninguno de los tres literales: todo `if` que decide
 * por el nombre del rol lo deja afuera sin avisar. Esta prueba cuenta, por archivo, las comparaciones de un rol con un literal en el código
 * de `src/` y `apps/` (sin pruebas) y exige que coincidan EXACTAMENTE con la lista de abajo: un archivo nuevo, o una comparación más, falla.
 *
 * Tres grupos, a propósito separados:
 *  (a) LEGÍTIMAS: es donde el rol se traduce a conjunto (`conjuntoEfectivo`) o a alcance de sucursales (fail closed para otro rol).
 *  (b) DEUDA, reglas de estructura de la identidad (hay un solo gerente, no se apaga al gerente, el traspaso): comparan con «GERENTE» por la
 *      forma de la empresa, no por un permiso; se pasan a «es el gerente de esta empresa» ligado a la membresía en el tramo de roles propios (T4).
 *  (c) DEUDA, composición y pantallas que muestran u ocultan por el nombre del rol: se pasan a leer las acciones del actor (T5).
 * Previene: que un rol propio quede afuera de una regla escrita para los tres roles de siempre, o reciba un permiso que el conjunto le negaba.
 * Chequeo: este archivo, con una violación inyectada por cada forma que la regla detecta. Los presupuestos de (b) y (c) solo bajan.
 * Límites que NO ve: la comparación por una variable (`const G = "GERENTE"; rol === G`), un `switch` sobre un alias y un literal armado por partes.
 */

const LITERAL = String.raw`"(?:GERENTE|ADMINISTRADOR|OPERADOR)"`;
const ROL = String.raw`\brol\b`;
const FORMAS: readonly RegExp[] = [
  new RegExp(String.raw`${ROL}\s*(?:===|!==|==|!=)\s*${LITERAL}`, "g"),
  new RegExp(String.raw`${LITERAL}\s*(?:===|!==|==|!=)\s*[\w.]*${ROL}`, "g"),
  new RegExp(String.raw`\bcase\s+${LITERAL}\s*:`, "g"),
];

/** Cuántas comparaciones de un rol con un literal hay en el texto. */
export function comparacionesDeRolConLiteral(texto: string): number {
  return FORMAS.reduce((suma, forma) => suma + (texto.match(forma)?.length ?? 0), 0);
}

const LEGITIMAS: Readonly<Record<string, number>> = {
  "src/adaptadores/postgres/autorizacion.ts": 2,
  "src/capacidades/roles/conjunto-efectivo.ts": 3,
};
const DEUDA_DE_ESTRUCTURA_DE_IDENTIDAD: Readonly<Record<string, number>> = {
  "src/modulos/identidad/casos-de-uso/aceptar-traspaso.ts": 1,
  "src/modulos/identidad/consultas/traspaso-en-curso.ts": 1,
  "src/modulos/identidad/dominio/invitacion.ts": 2,
  "src/modulos/identidad/dominio/membresia.ts": 3,
  "src/modulos/identidad/dominio/traspaso.ts": 2,
};
const DEUDA_DE_COMPOSICION_Y_PANTALLAS: Readonly<Record<string, number>> = {
  "apps/web/app/s/app/(operacion)/cuenta/usuarios/invitar/page.tsx": 1,
  "apps/web/ui/plantillas/usuarios/modelo-de-usuarios.ts": 2,
  "src/composicion/entradas-de-usuarios.ts": 1,
  "src/composicion/usuarios-desactivar-y-reactivar-web.ts": 2,
  "src/composicion/usuarios-web.ts": 1,
};

const RAIZ = join(import.meta.dirname, "../..");
const ESPERADO: Readonly<Record<string, number>> = {
  ...LEGITIMAS,
  ...DEUDA_DE_ESTRUCTURA_DE_IDENTIDAD,
  ...DEUDA_DE_COMPOSICION_Y_PANTALLAS,
};

function codigoDe(carpeta: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    if (entrada.name === "node_modules" || entrada.name === ".next") continue;
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) salida.push(...codigoDe(ruta));
    else if (/\.(ts|tsx)$/.test(entrada.name) && !/\.test\.(ts|tsx)$/.test(entrada.name))
      salida.push(ruta);
  }
  return salida;
}

describe("el rol no autoriza: comparaciones de un rol con un literal", () => {
  it("la lista exacta de archivos y cuántas comparaciones tiene cada uno", () => {
    const real: Record<string, number> = {};
    for (const carpeta of ["src", "apps"]) {
      for (const archivo of codigoDe(join(RAIZ, carpeta))) {
        const cuantas = comparacionesDeRolConLiteral(readFileSync(archivo, "utf8"));
        if (cuantas > 0) real[relative(RAIZ, archivo).split("\\").join("/")] = cuantas;
      }
    }
    expect(Object.fromEntries(Object.entries(real).sort())).toEqual(
      Object.fromEntries(Object.entries(ESPERADO).sort()),
    );
  });

  describe("violaciones inyectadas: cada forma se detecta", () => {
    it.each([
      ['if (actor.rol === "GERENTE") return;', 1],
      ['if (rol !== "ADMINISTRADOR") return;', 1],
      ['if ("OPERADOR" == miembro.rol) return;', 1],
      ['switch (x) { case "GERENTE": break; }', 1],
      ['if (rol === "GERENTE" || rol === "OPERADOR") return;', 2],
    ])("%s", (codigo, esperadas) => {
      expect(comparacionesDeRolConLiteral(codigo)).toBe(esperadas);
    });

    it("lo que no es una comparación de un rol con un literal no cuenta", () => {
      expect(
        comparacionesDeRolConLiteral('const roles = ["GERENTE"]; rolDe(x) === "GERENTE2";'),
      ).toBe(0);
      expect(comparacionesDeRolConLiteral('if (estado === "GERENTE") return;')).toBe(0);
    });
  });
});
