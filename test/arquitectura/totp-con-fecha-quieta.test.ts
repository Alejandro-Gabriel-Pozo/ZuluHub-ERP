import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Toda prueba de integración que USA TOTP corre con la FECHA quieta en mitad de un paso de 30 s
 * (`usarFechaQuietaDeTotp`, en `test/integracion/autenticacion-plataforma-apoyo.ts`). Falla que previene: la librería verifica el
 * código con `Date.now()`; con el reloj real, un paso que cambia entre «enrolar» y «pedir el código siguiente» rompe la prueba una
 * de cada tantas corridas (caso real: `autenticacion-plataforma-segundo-factor`, arreglado en #90 solo en ese archivo; otros ocho
 * archivos tenían el mismo defecto y fallaron en «Estabilidad»).
 * "Usa TOTP" se decide por USO, no por importación: nombra `codigoDeTotp`, `codigoDeLaAplicacion` o una ruta `two-factor/`, o
 * importa los apoyos que los envuelven (`autenticacion-plataforma-apoyo`, `consola-apoyo`). Lo comentado no cuenta (ni como uso ni
 * como llamada al helper). Y el archivo no puede volver al reloj real por su cuenta: `vi.useRealTimers()` / `vi.useFakeTimers()`
 * deshacen o pisan la fecha quieta (solo el helper los llama).
 */

const CARPETA = join(process.cwd(), "test", "integracion");
const USA_TOTP =
  /\b(?:codigoDeTotp|codigoDeLaAplicacion)\b|two-factor\/|from "\.\/(?:autenticacion-plataforma-apoyo|consola-apoyo)"/;
const FECHA_QUIETA = /^[ \t]*usarFechaQuietaDeTotp\(\);/m;
const TOCA_EL_RELOJ = /\bvi\.(?:useRealTimers|useFakeTimers)\s*\(/;

/** Sin comentarios de bloque ni líneas comentadas (lo que sigue a `//` en medio de una línea no se toca: puede ser una URL). */
const sinComentarios = (texto: string): string =>
  texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Por archivo, qué incumple (vacío si cumple). */
function incumplimientos(archivos: ReadonlyMap<string, string>): string[] {
  const fallas: string[] = [];
  for (const [nombre, crudo] of [...archivos].sort(([a], [b]) => a.localeCompare(b))) {
    const texto = sinComentarios(crudo);
    if (!USA_TOTP.test(texto)) continue;
    if (!FECHA_QUIETA.test(texto)) fallas.push(`${nombre}: falta usarFechaQuietaDeTotp()`);
    if (TOCA_EL_RELOJ.test(texto)) fallas.push(`${nombre}: llama a vi.useRealTimers/useFakeTimers`);
  }
  return fallas;
}

function pruebasDeIntegracion(): Map<string, string> {
  return new Map(
    readdirSync(CARPETA)
      .filter((nombre) => nombre.endsWith(".test.ts"))
      .map((nombre) => [nombre, readFileSync(join(CARPETA, nombre), "utf8")] as const),
  );
}

describe("TOTP con la fecha quieta", () => {
  it("cada prueba de integración que usa TOTP declara usarFechaQuietaDeTotp() y no toca el reloj", () => {
    const archivos = pruebasDeIntegracion();
    expect([...archivos.keys()].length).toBeGreaterThan(20);
    expect(incumplimientos(archivos)).toEqual([]);
  });

  it("violaciones inyectadas: cada forma de evadir se detecta y lo sano pasa", () => {
    const llamada = "describe('a', () => {\n  usarFechaQuietaDeTotp();\n});";
    const casos: Record<string, string> = {
      "sano-por-importacion.test.ts": `import { x } from "./consola-apoyo";\n${llamada}`,
      "sano-por-uso.test.ts": `const c = codigoDeLaAplicacion(s);\n${llamada}`,
      "roto-por-importacion.test.ts": 'import { x } from "./autenticacion-plataforma-apoyo";',
      "roto-por-uso-sin-importar.test.ts": "const c = codigoDeTotp(secreto, paso);",
      "roto-por-ruta.test.ts": 'pedir("POST", "/api/auth/two-factor/verify-totp");',
      "roto-llamada-en-comentario-de-bloque.test.ts": `import { x } from "./consola-apoyo";\n/* usarFechaQuietaDeTotp(); */`,
      "roto-llamada-en-comentario-de-linea.test.ts": `const c = codigoDeTotp(s);\n  // usarFechaQuietaDeTotp();`,
      "roto-llamada-al-final-de-una-linea.test.ts": `const c = codigoDeTotp(s); // usarFechaQuietaDeTotp();`,
      "roto-reloj-real.test.ts": `const c = codigoDeTotp(s);\n${llamada}\nafterEach(() => { vi.useRealTimers(); });`,
      "roto-reloj-propio.test.ts": `const c = codigoDeTotp(s);\n${llamada}\nvi.useFakeTimers();`,
      "ajeno.test.ts": 'import { x } from "./entorno";',
      "uso-solo-comentado.test.ts": "// codigoDeTotp(s) y two-factor/ en un comentario",
    };
    expect(incumplimientos(new Map(Object.entries(casos))).sort()).toEqual(
      [
        "roto-por-importacion.test.ts: falta usarFechaQuietaDeTotp()",
        "roto-por-ruta.test.ts: falta usarFechaQuietaDeTotp()",
        "roto-por-uso-sin-importar.test.ts: falta usarFechaQuietaDeTotp()",
        "roto-llamada-al-final-de-una-linea.test.ts: falta usarFechaQuietaDeTotp()",
        "roto-llamada-en-comentario-de-bloque.test.ts: falta usarFechaQuietaDeTotp()",
        "roto-llamada-en-comentario-de-linea.test.ts: falta usarFechaQuietaDeTotp()",
        "roto-reloj-propio.test.ts: llama a vi.useRealTimers/useFakeTimers",
        "roto-reloj-real.test.ts: llama a vi.useRealTimers/useFakeTimers",
      ].sort(),
    );
  });
});
