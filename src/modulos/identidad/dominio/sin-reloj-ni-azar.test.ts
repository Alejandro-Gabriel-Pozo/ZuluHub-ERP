import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../../test/utilidades/reloj-y-azar";

/**
 * U8: el dominio de identidad no usa reloj ni aleatoriedad. La hora (`ahora`), los ids y el hash
 * del token entran como datos; así cada decisión se repite igual (idempotencia) y se prueba sin
 * simular el tiempo. Lo mismo vale para los casos de uso: corren dentro de la transacción, que el
 * adaptador repite entera ante un conflicto de serialización (ADR-004, G4), así que tampoco leen el
 * reloj ni sortean nada (el id y el token se emiten ANTES, fuera de la transacción, por el puerto).
 */
const carpetas = [
  fileURLToPath(new URL(".", import.meta.url)),
  fileURLToPath(new URL("../casos-de-uso/", import.meta.url)),
];
const fuentes = carpetas.flatMap((carpeta) =>
  readdirSync(carpeta)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `${carpeta}${f}`),
);
const nombres = fuentes.map((ruta) => ruta.slice(ruta.lastIndexOf("/") + 1));

describe("U8: el dominio de identidad no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos de dominio a revisar", () => {
    expect(nombres).toEqual(
      expect.arrayContaining([
        "errores.ts",
        "invitacion.ts",
        "membresia.ts",
        "asignacion.ts",
        "traspaso.ts",
        "aceptar-invitacion.ts",
        "invitar-usuario.ts",
        "apagar-membresia.ts",
        "reenviar-invitacion.ts",
      ]),
    );
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (ruta) => {
    expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
  });

  describe("el detector (con la violación inyectada)", () => {
    it("detecta cada uso prohibido", () => {
      expect(usosProhibidos("const t = Date.now();")).toEqual(["Date.now"]);
      expect(usosProhibidos("const t = Date . now();")).toEqual(["Date.now"]);
      expect(usosProhibidos("const t = new Date();")).toEqual(["new Date() sin argumentos"]);
      expect(usosProhibidos("const t = new Date( );")).toEqual(["new Date() sin argumentos"]);
      expect(usosProhibidos("const t = new Date;")).toEqual(["new Date() sin argumentos"]);
      expect(usosProhibidos("const r = Math.random();")).toEqual(["Math.random"]);
      expect(usosProhibidos("const r = crypto.randomUUID();")).toEqual(["randomUUID"]);
      expect(usosProhibidos("crypto.getRandomValues(a);")).toEqual(["getRandomValues"]);
      expect(usosProhibidos("const t = performance.now();")).toEqual(["performance.now"]);
    });

    it("deja pasar las fechas construidas con argumento", () => {
      expect(usosProhibidos("new Date(ahora.getTime() + plazo)")).toEqual([]);
      expect(usosProhibidos("new Date(0)")).toEqual([]);
      expect(usosProhibidos("new Date( ahora )")).toEqual([]);
    });
  });
});
