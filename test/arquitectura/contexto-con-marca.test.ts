import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { AHORA_DE_PRUEBA, comoEmpresa } from "../integracion/entorno";
import { MARCA_PRINCIPAL_DE_PRUEBA, OTRA_MARCA_DE_PRUEBA } from "../utilidades/marcas";

/**
 * Meta-pruebas de la marca de entrada (marcas y planes, §B.2.4 y §E.2): ningún contexto operativo se
 * arma sin decidir por qué puerta entra, ni en el código ni en las pruebas. El tipo ya lo exige
 * (`marcaDeEntrada` es obligatorio); esta prueba lo vigila también donde el tipo no llega (un `as`,
 * un objeto armado a mano que se castea) y fija el valor por defecto del ayudante de pruebas.
 */

const RAIZ = join(import.meta.dirname, "../..");

/**
 * Cada objeto literal con `tipo: "OPERATIVO"` que NO menciona `marcaDeEntrada` entre las llaves que lo
 * encierran, con su línea. Mira el texto: encuentra la llave que abre el literal que contiene la
 * propiedad y la que lo cierra (las llaves de cadenas y comentarios no se tratan: los literales de
 * contexto no las llevan).
 */
function contextosOperativosSinMarca(fuente: string): number[] {
  const sinMarca: number[] = [];
  for (const m of fuente.matchAll(/tipo:\s*"OPERATIVO"/g)) {
    const posicion = m.index;
    let profundidad = 0;
    let inicio = -1;
    for (let i = posicion - 1; i >= 0; i--) {
      const c = fuente[i];
      if (c === "}") profundidad++;
      else if (c === "{") {
        if (profundidad === 0) {
          inicio = i;
          break;
        }
        profundidad--;
      }
    }
    if (inicio === -1) continue;
    let fin = fuente.length;
    profundidad = 0;
    for (let i = inicio; i < fuente.length; i++) {
      const c = fuente[i];
      if (c === "{") profundidad++;
      else if (c === "}") {
        profundidad--;
        if (profundidad === 0) {
          fin = i;
          break;
        }
      }
    }
    if (!/\bmarcaDeEntrada\b/.test(fuente.slice(inicio, fin + 1))) {
      sinMarca.push(fuente.slice(0, posicion).split("\n").length);
    }
  }
  return sinMarca;
}

const archivos = ["src", "test"]
  .flatMap((carpeta) =>
    readdirSync(join(RAIZ, carpeta), { recursive: true, encoding: "utf8" }).map((f) =>
      join(carpeta, f),
    ),
  )
  .filter((f) => f.endsWith(".ts"))
  .sort();

describe("ningún contexto operativo se arma sin marca de entrada", () => {
  it("revisa los archivos de src y de test (y el detector de este archivo no se revisa a sí mismo)", () => {
    expect(archivos).toEqual(
      expect.arrayContaining([
        "src/contexto/contexto.ts",
        "test/integracion/entorno.ts",
        "src/modulos/identidad/casos-de-uso/enviar-invitacion.ts",
      ]),
    );
  });

  it('todo literal `tipo: "OPERATIVO"` de src y test decide su marcaDeEntrada', () => {
    const sinMarca = archivos
      // Este archivo cita literales sin marca a propósito (las violaciones inyectadas de abajo).
      .filter((f) => f !== "test/arquitectura/contexto-con-marca.test.ts")
      .flatMap((f) =>
        contextosOperativosSinMarca(readFileSync(join(RAIZ, f), "utf8")).map(
          (linea) => `${f}:${linea}`,
        ),
      );
    expect(sinMarca).toEqual([]);
  });

  describe("el detector (con la violación inyectada)", () => {
    it("encuentra un contexto operativo sin marca, con su línea", () => {
      const fuente = [
        "const ok = { tipo: 'x' };",
        "const malo: ContextoOperativo = {",
        '  tipo: "OPERATIVO",',
        "  empresaId,",
        "  personaId: null,",
        "  ahora,",
        "};",
      ].join("\n");
      expect(contextosOperativosSinMarca(fuente)).toEqual([3]);
    });

    it("acepta la marca presente, incluso nula, en cualquier orden de propiedades", () => {
      expect(
        contextosOperativosSinMarca(
          'const a = { tipo: "OPERATIVO", empresaId, personaId: null, marcaDeEntrada: null, ahora };',
        ),
      ).toEqual([]);
      expect(
        contextosOperativosSinMarca(
          'const a = { marcaDeEntrada: m, tipo: "OPERATIVO", empresaId, personaId, ahora };',
        ),
      ).toEqual([]);
    });

    it("no se confunde con objetos vecinos ni anidados: la marca de otro literal no cuenta", () => {
      const fuente = [
        "const par = [",
        '  { tipo: "OPERATIVO", empresaId, personaId, ahora },',
        '  { tipo: "OPERATIVO", empresaId, personaId, marcaDeEntrada: m, ahora },',
        "];",
      ].join("\n");
      expect(contextosOperativosSinMarca(fuente)).toEqual([2]);
      const anidado = 'const a = { adentro: { marcaDeEntrada: m }, tipo: "OPERATIVO", empresaId };';
      expect(contextosOperativosSinMarca(anidado)).toEqual([]);
      const hermano = 'f({ marcaDeEntrada: m }, { tipo: "OPERATIVO", empresaId });';
      expect(contextosOperativosSinMarca(hermano)).toEqual([1]);
    });

    it("sin llaves que lo encierren no hay literal que revisar", () => {
      expect(contextosOperativosSinMarca('tipo: "OPERATIVO"')).toEqual([]);
    });

    it("el texto sin contexto operativo no da nada", () => {
      expect(contextosOperativosSinMarca("const a = 1;")).toEqual([]);
    });
  });
});

describe("el ayudante comoEmpresa de las pruebas", () => {
  const E = empresaId("e-1");
  const P = personaId("p-1");

  it("por defecto entra por la marca principal de las pruebas (solo en pruebas)", () => {
    expect(comoEmpresa(E)).toEqual({
      tipo: "OPERATIVO",
      empresaId: E,
      personaId: null,
      marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
      ahora: AHORA_DE_PRUEBA,
    });
    expect(comoEmpresa(E, P).marcaDeEntrada).toBe(MARCA_PRINCIPAL_DE_PRUEBA);
  });

  it("acepta otra marca, y null para el sistema sin puerta", () => {
    expect(comoEmpresa(E, P, OTRA_MARCA_DE_PRUEBA).marcaDeEntrada).toBe(OTRA_MARCA_DE_PRUEBA);
    expect(comoEmpresa(E, null, null).marcaDeEntrada).toBeNull();
  });

  it("las dos marcas de las pruebas son distintas", () => {
    expect(MARCA_PRINCIPAL_DE_PRUEBA).not.toBe(OTRA_MARCA_DE_PRUEBA);
  });

  it("un contexto operativo sin marcaDeEntrada no compila", () => {
    // @ts-expect-error falta `marcaDeEntrada`: hay que decidir por qué puerta entra (o null: el sistema)
    const sinMarca: ContextoOperativo = {
      tipo: "OPERATIVO",
      empresaId: E,
      personaId: P,
      ahora: new Date(0),
    };
    expect(sinMarca.tipo).toBe("OPERATIVO");
  });
});
