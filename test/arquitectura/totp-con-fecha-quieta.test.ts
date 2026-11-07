import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Toda prueba de integración que enrola o verifica un código TOTP corre con la FECHA quieta en mitad de un paso de 30 s
 * (`usarFechaQuietaDeTotp`, en `test/integracion/autenticacion-plataforma-apoyo.ts`). Falla que previene: la librería verifica el
 * código con `Date.now()`; con el reloj real, un paso que cambia entre «enrolar» y «pedir el código siguiente» rompe la prueba una
 * de cada tantas corridas (caso real: `autenticacion-plataforma-segundo-factor`, arreglado en #90 solo en ese archivo; otros ocho
 * archivos tenían el mismo defecto y fallaron en «Estabilidad»).
 * Alcance: los archivos de prueba que importan los apoyos de TOTP (`autenticacion-plataforma-apoyo`, `consola-apoyo`).
 */

const CARPETA = join(process.cwd(), "test", "integracion");
const USA_TOTP = /from "\.\/(autenticacion-plataforma-apoyo|consola-apoyo)"/;
const FECHA_QUIETA = /^\s*usarFechaQuietaDeTotp\(\);/m;

/** Los archivos que usan TOTP y no declaran la fecha quieta. */
function sinFechaQuieta(archivos: ReadonlyMap<string, string>): string[] {
  return [...archivos]
    .filter(([, texto]) => USA_TOTP.test(texto) && !FECHA_QUIETA.test(texto))
    .map(([nombre]) => nombre)
    .sort();
}

function pruebasDeIntegracion(): Map<string, string> {
  return new Map(
    readdirSync(CARPETA)
      .filter((nombre) => nombre.endsWith(".test.ts"))
      .map((nombre) => [nombre, readFileSync(join(CARPETA, nombre), "utf8")] as const),
  );
}

describe("TOTP con la fecha quieta", () => {
  it("cada prueba de integración que usa TOTP declara usarFechaQuietaDeTotp()", () => {
    const archivos = pruebasDeIntegracion();
    expect([...archivos.keys()].length).toBeGreaterThan(20);
    expect(sinFechaQuieta(archivos)).toEqual([]);
  });

  it("violación inyectada: un archivo que usa TOTP con el reloj real se detecta", () => {
    const sano =
      'import { x } from "./consola-apoyo";\ndescribe("a", () => {\n  usarFechaQuietaDeTotp();\n});';
    const roto = 'import { x } from "./autenticacion-plataforma-apoyo";\ndescribe("a", () => {});';
    const ajeno = 'import { x } from "./entorno";';
    const comentado = '// usarFechaQuietaDeTotp();\nimport { x } from "./consola-apoyo";';
    expect(
      sinFechaQuieta(
        new Map([
          ["sano.test.ts", sano],
          ["roto.test.ts", roto],
          ["ajeno.test.ts", ajeno],
          ["comentado.test.ts", comentado],
        ]),
      ),
    ).toEqual(["comentado.test.ts", "roto.test.ts"]);
  });
});
