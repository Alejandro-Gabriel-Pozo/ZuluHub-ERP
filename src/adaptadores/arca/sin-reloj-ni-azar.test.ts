import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * El adaptador de ARCA no usa reloj ni aleatoriedad por su cuenta: la hora entra como dato (`reloj.ahora()`,
 * el TRA se arma con el `ahora` que recibe) y el `uniqueId` del TRA sale de esa misma hora. Así el XML que se
 * firma y la vigencia del ticket son deterministas y se prueban sin simular el tiempo. Previene: un TRA o un
 * ticket que dependen de un reloj que la prueba no controla. Chequeo: este detector, con su violación inyectada.
 */
const PROHIBIDOS: readonly { nombre: string; patron: RegExp }[] = [
  { nombre: "Date.now", patron: /\bDate\s*\.\s*now\b/ },
  { nombre: "new Date() sin argumentos", patron: /\bnew\s+Date\b(?!\s*\(\s*[^)\s])/ },
  { nombre: "Math.random", patron: /\bMath\s*\.\s*random\b/ },
  { nombre: "randomUUID", patron: /\brandomUUID\b/ },
  { nombre: "getRandomValues", patron: /\bgetRandomValues\b/ },
  { nombre: "randomInt", patron: /\brandomInt\b/ },
  { nombre: "randomBytes", patron: /\brandomBytes\b/ },
  { nombre: "performance.now", patron: /\bperformance\s*\.\s*now\b/ },
];

const usosProhibidos = (fuente: string): string[] =>
  PROHIBIDOS.filter(({ patron }) => patron.test(fuente)).map(({ nombre }) => nombre);

const carpeta = fileURLToPath(new URL("./", import.meta.url));
const ARCHIVOS = readdirSync(carpeta).filter((a) => a.endsWith(".ts") && !a.endsWith(".test.ts"));

describe("el adaptador de ARCA no usa reloj ni aleatoriedad", () => {
  it("hay archivos que revisar", () => {
    expect(ARCHIVOS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(ARCHIVOS)("%s", (archivo) => {
    expect(usosProhibidos(readFileSync(`${carpeta}${archivo}`, "utf8"))).toEqual([]);
  });

  it("el detector (con la violación inyectada) encuentra cada uso", () => {
    expect(usosProhibidos("Date.now()")).toEqual(["Date.now"]);
    expect(usosProhibidos("new Date()")).toEqual(["new Date() sin argumentos"]);
    expect(usosProhibidos("Math.random()")).toEqual(["Math.random"]);
    expect(usosProhibidos("crypto.randomUUID()")).toEqual(["randomUUID"]);
    expect(usosProhibidos("crypto.getRandomValues(a)")).toEqual(["getRandomValues"]);
    expect(usosProhibidos("randomInt(3)")).toEqual(["randomInt"]);
    expect(usosProhibidos("randomBytes(8)")).toEqual(["randomBytes"]);
    expect(usosProhibidos("performance.now()")).toEqual(["performance.now"]);
    expect(usosProhibidos("new Date(ahora.getTime() + 1)")).toEqual([]);
  });
});
