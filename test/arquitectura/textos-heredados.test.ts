import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import type { DefinicionDeTexto } from "../../src/capacidades/vocabulario/catalogo";

/**
 * LÍNEA BASE de textos heredados (tramo D5 de `Pedernal-docs/11-especificaciones/plan-de-construccion-de-declaraciones.md`; decisión del
 * dueño, fila 173 de `decisiones-del-dueno-2026-11.md`). `fuente: "HEREDADO"` marca un texto que ya existía cuando se creó el inventario y
 * solo puede estar en la lista `arquitectura/deuda/textos-heredados/*.json` (una por catálogo, para que dos módulos no se pisen). Un texto
 * nuevo marcado `HEREDADO` sin estar en la lista, o una clave de la lista que ya no es `HEREDADO` (se le asignó su fuente: se saca de la
 * lista) o que no existe, falla. Previene: marcar un texto nuevo como heredado para esquivar la exigencia de fuente. «Solo baja» contra la
 * base y la exigencia de fuente en las claves nuevas llegan con D6.
 */

const RAIZ = join(import.meta.dirname, "../..");
const CARPETA = "arquitectura/deuda/textos-heredados";

type Catalogo = Readonly<Record<string, DefinicionDeTexto>>;

/** Los problemas de la línea base: claves `HEREDADO` fuera de la lista, y claves de la lista que no son `HEREDADO` o no existen. */
function problemasDeLaLineaBase(catalogo: Catalogo, lista: ReadonlySet<string>): string[] {
  const problemas: string[] = [];
  for (const [clave, definicion] of Object.entries(catalogo)) {
    if (definicion.fuente === "HEREDADO" && !lista.has(clave))
      problemas.push(`«${clave}» es HEREDADO pero no está en la línea base`);
  }
  for (const clave of lista) {
    const definicion = Object.hasOwn(catalogo, clave) ? catalogo[clave] : undefined;
    if (definicion === undefined) problemas.push(`«${clave}» está en la línea base y no existe`);
    else if (definicion.fuente !== "HEREDADO")
      problemas.push(`«${clave}» está en la línea base pero ya no es HEREDADO`);
  }
  return problemas;
}

function listaReal(): { claves: Set<string>; repetidas: string[]; archivos: string[] } {
  const archivos = readdirSync(join(RAIZ, CARPETA)).filter((f) => f.endsWith(".json"));
  const claves = new Set<string>();
  const repetidas: string[] = [];
  for (const archivo of archivos) {
    const contenido = JSON.parse(readFileSync(join(RAIZ, CARPETA, archivo), "utf8")) as string[];
    for (const clave of contenido) {
      if (claves.has(clave)) repetidas.push(clave);
      claves.add(clave);
    }
  }
  return { claves, repetidas, archivos };
}

describe("textos heredados: la línea base real", () => {
  const { claves, repetidas, archivos } = listaReal();

  it("no pasa en vacío y ninguna clave está en dos listas", () => {
    expect(archivos.length).toBeGreaterThan(0);
    expect(claves.size).toBeGreaterThan(0);
    expect(repetidas).toEqual([]);
  });

  it("los textos HEREDADO del catálogo son exactamente los de la lista", () => {
    expect(problemasDeLaLineaBase(CATALOGO_DE_TEXTOS, claves)).toEqual([]);
  });
});

describe("textos heredados: violaciones inyectadas", () => {
  const catalogo: Catalogo = {
    "a.uno": { porDefecto: "Uno", fuente: "HEREDADO" },
    "a.dos": { porDefecto: "Dos", fuente: { decision: `DEC-${410}` } },
    "a.tres": { porDefecto: "Tres" },
  };

  it("el catálogo y la lista coinciden: sin problemas", () => {
    expect(problemasDeLaLineaBase(catalogo, new Set(["a.uno"]))).toEqual([]);
  });

  it("un texto nuevo marcado HEREDADO fuera de la lista falla", () => {
    const nuevo = {
      ...catalogo,
      "a.nuevo": { porDefecto: "Nuevo", fuente: "HEREDADO" },
    } as Catalogo;
    expect(problemasDeLaLineaBase(nuevo, new Set(["a.uno"]))).toEqual([
      "«a.nuevo» es HEREDADO pero no está en la línea base",
    ]);
  });

  it("una clave de la lista a la que ya se le asignó fuente, o sin fuente, falla", () => {
    expect(problemasDeLaLineaBase(catalogo, new Set(["a.uno", "a.dos"]))).toEqual([
      "«a.dos» está en la línea base pero ya no es HEREDADO",
    ]);
    expect(problemasDeLaLineaBase(catalogo, new Set(["a.uno", "a.tres"]))).toHaveLength(1);
  });

  it("una clave de la lista que no existe falla", () => {
    expect(problemasDeLaLineaBase(catalogo, new Set(["a.uno", "a.borrada"]))).toEqual([
      "«a.borrada» está en la línea base y no existe",
    ]);
  });
});
