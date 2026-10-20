import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import {
  CODIGOS_PUBLICOS,
  clasificarError,
  errorInesperado,
  errorPublicoDe,
  type CodigoPublico,
} from "./respuesta";

/**
 * ADR-016, la prueba de «un error inesperado no filtra su detalle», como propiedad: con CUALQUIER forma de
 * falla que lleve una palabra secreta, lo que sale hacia la pantalla no la contiene. Y lo que sale de un
 * error conocido es siempre uno de los códigos de la tabla: nada que el error haya traído de más.
 */
const SECRETO = "SECRETO-PD-9f3a";
const codigos = Object.keys(CODIGOS_PUBLICOS) as CodigoPublico[];

/** Fallas con el secreto en cualquier lugar donde un adaptador o una librería lo podría poner. */
const falla = fc.oneof(
  fc.constant(new Error(`connect ECONNREFUSED ${SECRETO}`)),
  fc.constant({ tipo: "Inesperado", sqlstate: "08006", mensaje: `password ${SECRETO}` }),
  fc.constant({ tipo: "Unicidad", restriccion: SECRETO }),
  fc.constant({ tipo: "ConcurrenciaAgotada", mensaje: SECRETO }),
  fc.constant({ tipo: "AccesoDenegado", detalle: SECRETO }),
  fc.constant(SECRETO),
  fc.constant({ codigo: SECRETO, empresaId: SECRETO }),
  fc.constant({ codigo: "ESTE_NO_EXISTE", campo: SECRETO }),
  fc.constant({ nested: { profundo: SECRETO } }),
  fc.string().map((s) => `${s}${SECRETO}`),
  fc.anything(),
);

describe("propiedades del traductor de respuestas", () => {
  it("ningún camino expone el detalle: lo inesperado sale solo con código genérico y referencia", () => {
    fc.assert(
      fc.property(falla, fc.boolean(), (error, indisponible) => {
        const clasificado = clasificarError(error);
        const publico =
          clasificado.tipo === "PUBLICO"
            ? errorPublicoDe(clasificado)
            : errorInesperado("PD-0000-0000", indisponible);
        expect(JSON.stringify(publico)).not.toContain(SECRETO);
        if (clasificado.tipo === "INESPERADO") {
          expect(Object.keys(publico).sort()).toEqual([
            "clave",
            "codigo",
            "presentacion",
            "referencia",
          ]);
          expect(["ERROR_INTERNO", "NO_DISPONIBLE"]).toContain(publico.codigo);
        }
      }),
    );
  });

  it("un error conocido sale con un código de la tabla y, como mucho, un campo con forma de campo", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...codigos),
        fc.dictionary(fc.string(), fc.anything()),
        (codigo, extra) => {
          const publico = errorPublicoDe(
            (() => {
              const c = clasificarError({ ...extra, codigo });
              if (c.tipo !== "PUBLICO") throw new Error("tenía que ser público");
              return c;
            })(),
          );
          expect(codigos).toContain(publico.codigo);
          expect(publico.codigo).toBe(codigo);
          const claves = Object.keys(publico);
          for (const k of claves) expect(["codigo", "clave", "presentacion", "campo"]).toContain(k);
          if (publico.campo !== undefined) {
            expect(publico.campo).toMatch(
              /^[a-z][A-Za-z0-9_]{0,63}(\.[a-z][A-Za-z0-9_]{0,63}){0,3}$/,
            );
          }
        },
      ),
    );
  });

  it("clasificar no lanza con ningún valor, por raro que sea", () => {
    fc.assert(
      fc.property(fc.anything(), (valor) => {
        expect(() => clasificarError(valor)).not.toThrow();
      }),
    );
  });
});
