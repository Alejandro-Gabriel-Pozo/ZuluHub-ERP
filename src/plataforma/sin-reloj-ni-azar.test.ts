import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../test/utilidades/reloj-y-azar";

/**
 * Las consultas y los casos de uso de soporte de plataforma no usan reloj ni aleatoriedad. La hora
 * (`ahora`) entra como dato en el contexto y los bytes de azar de la referencia los pasa la composición
 * (`azar`). Corren dentro de una transacción que el adaptador repite entera ante un conflicto de
 * serialización (ADR-004, G4): repetirlos tiene que dar lo mismo. (El dominio tiene su propia prueba en
 * `dominio/sin-reloj-ni-azar.test.ts`.)
 */
const carpetas = ["casos-de-uso/", "consultas/"].map((c) =>
  fileURLToPath(new URL(c, import.meta.url)),
);
const fuentes = carpetas.flatMap((carpeta) =>
  readdirSync(carpeta)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `${carpeta}${f}`),
);
const nombres = fuentes.map((ruta) => ruta.slice(ruta.lastIndexOf("/") + 1));

describe("las consultas y los casos de uso de soporte no usan reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(nombres).toEqual(
      expect.arrayContaining([
        "explicar-por-que.ts",
        "registrar-referencia.ts",
        "soporte.ts",
        "consultas.ts",
        "tenants-y-empresas.ts",
        "invitaciones.ts",
        "trabajos-fallidos.ts",
        "auditoria.ts",
        "configuracion.ts",
        "buscar-referencia.ts",
      ]),
    );
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (ruta) => {
    expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
  });
});
