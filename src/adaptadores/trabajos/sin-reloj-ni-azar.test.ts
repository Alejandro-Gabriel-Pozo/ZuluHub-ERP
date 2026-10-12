import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * El procesador de la cola no usa reloj ni aleatoriedad (ADR-004, G4; ADR-007): `ahora` entra como
 * dato. Así la espera de los reintentos es determinista y se prueba sin simular el tiempo.
 */
const PROHIBIDOS: readonly { nombre: string; patron: RegExp }[] = [
  { nombre: "Date.now", patron: /\bDate\s*\.\s*now\b/ },
  { nombre: "new Date() sin argumentos", patron: /\bnew\s+Date\b(?!\s*\(\s*[^)\s])/ },
  { nombre: "Math.random", patron: /\bMath\s*\.\s*random\b/ },
  { nombre: "randomUUID", patron: /\brandomUUID\b/ },
  { nombre: "getRandomValues", patron: /\bgetRandomValues\b/ },
  { nombre: "randomInt", patron: /\brandomInt\b/ },
  { nombre: "performance.now", patron: /\bperformance\s*\.\s*now\b/ },
];

const usosProhibidos = (fuente: string): string[] =>
  PROHIBIDOS.filter(({ patron }) => patron.test(fuente)).map(({ nombre }) => nombre);

const ARCHIVOS = ["reintentos.ts", "error-seguro.ts", "procesador.ts"];

describe("el procesador de trabajos no usa reloj ni aleatoriedad", () => {
  it.each(ARCHIVOS)("%s", (archivo) => {
    const ruta = fileURLToPath(new URL(archivo, import.meta.url));
    expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
  });

  it("el detector (con la violación inyectada) encuentra cada uso", () => {
    expect(usosProhibidos("Date.now()")).toEqual(["Date.now"]);
    expect(usosProhibidos("new Date()")).toEqual(["new Date() sin argumentos"]);
    expect(usosProhibidos("Math.random()")).toEqual(["Math.random"]);
    expect(usosProhibidos("randomInt(3)")).toEqual(["randomInt"]);
    expect(usosProhibidos("new Date(ahora.getTime() + 1)")).toEqual([]);
  });
});
