import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_CARTA_EN_LINEA } from "../../src/capacidades/pantallas/ficha-de-carta-en-linea";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { REGISTRO_DE_DATOS } from "../../src/capacidades/datos/registro";

/**
 * La ficha de la pantalla «Carta en línea» no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con usos y fuente, las acciones de sus botones existen en un módulo y los
 * datos de la identidad están registrados y los pide el formulario. Previene: un botón con una acción que no existe, un texto sin fuente, un dato sin consumidor o un archivo que se mueve sin que la ficha lo note.
 */
describe("ficha de la pantalla «Carta en línea»", () => {
  const ficha = FICHA_DE_CARTA_EN_LINEA;

  it("sus archivos existen", () => {
    for (const archivo of ficha.archivos) expect(() => readFileSync(archivo)).not.toThrow();
  });

  it("todo texto de un botón, rótulo o estado está declarado con usos y fuente, y cada clave existe", () => {
    const claves = [
      ...ficha.botones.map((b) => b.texto),
      ...Object.values(ficha.rotulos),
      ...Object.values(ficha.estados),
    ];
    const declaradas: string[] = Object.keys(ficha.textos);
    for (const clave of claves) expect(declaradas).toContain(clave);
    for (const [clave, t] of Object.entries(ficha.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("los textos nuevos de la identidad llevan su decisión como fuente y su dato como uso", () => {
    const nuevos = Object.entries(CATALOGO_DE_TEXTOS).filter(([clave]) =>
      /^catalogo\.carta\.(cara|colores|usar_empresa|paleta_|otro_color|contraste_aviso|color_invalido|logo|direccion_de_la_imagen|direccion_no_sirve|quitar)/.test(
        clave,
      ),
    );
    expect(nuevos).toHaveLength(19);
    for (const [clave, texto] of nuevos) {
      expect(texto, clave).toMatchObject({ fuente: { decision: "DEC-0827" } });
      expect(Object.keys(ficha.textos), clave).toContain(clave);
    }
  });

  it("la acción de cada botón existe en un módulo", () => {
    const todas = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    for (const b of ficha.botones) expect(todas).toContain(b.hace.envia);
  });

  it("los datos de la identidad están registrados y los pide el formulario de la ficha", () => {
    const formulario = "apps/web/ui/plantillas/carta/FormularioDeCartaEnLinea.cliente.tsx";
    expect(ficha.archivos).toContain(formulario);
    for (const dato of ["cara-de-la-carta", "color-de-la-carta", "logo-de-la-carta"] as const)
      expect(REGISTRO_DE_DATOS[dato].consumidores).toContain(formulario);
  });
});
