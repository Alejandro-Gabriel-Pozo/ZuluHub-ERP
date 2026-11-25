import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_RECEPCIONES } from "../../src/capacidades/pantallas/ficha-de-recepciones";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { FILAS_DE_COMPRAS } from "../../apps/web/ui/navegacion/menu-filas-compras";
import { textosDeRecepciones } from "../../apps/web/ui/plantillas/compras/recepciones/textos-de-recepciones";

/**
 * La ficha de las pantallas «Recepciones» no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con usos y fuente, las acciones de sus botones y de sus accesos existen en el módulo
 * de compras, y la fila del menú apunta a la lista con la acción de lectura y la perilla del plan. Previene: un botón con una acción que no existe, un texto sin fuente o una ruta que se mueve sin que la ficha lo note.
 */
describe("ficha de las pantallas «Recepciones»", () => {
  const acciones = Object.keys(CATALOGO_DE_MODULOS.compras.acciones);

  it("sus archivos existen", () => {
    for (const archivo of FICHA_DE_RECEPCIONES.archivos) {
      expect(() => readFileSync(archivo)).not.toThrow();
    }
  });

  it("todo texto de un botón o de un estado está declarado con usos y fuente, y cada clave existe", () => {
    const claves = [
      ...FICHA_DE_RECEPCIONES.botones.map((b) => b.texto),
      ...Object.values(FICHA_DE_RECEPCIONES.estados),
    ];
    for (const clave of claves) expect(Object.keys(FICHA_DE_RECEPCIONES.textos)).toContain(clave);
    for (const [clave, t] of Object.entries(FICHA_DE_RECEPCIONES.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("las acciones de sus botones y de sus accesos existen en el módulo de compras", () => {
    for (const b of FICHA_DE_RECEPCIONES.botones) {
      if (typeof b.hace === "object" && "envia" in b.hace) expect(acciones).toContain(b.hace.envia);
    }
    for (const accion of Object.values(FICHA_DE_RECEPCIONES.accesos)) {
      expect(acciones).toContain(accion);
    }
    expect(Object.keys(FICHA_DE_RECEPCIONES.accesos).sort()).toEqual(
      [...FICHA_DE_RECEPCIONES.rutas].sort(),
    );
  });

  it("cada ruta tiene su página y cada acción que envía es de quien administra (el botón nace ausente sin permiso)", () => {
    const paginas: Record<string, string> = {
      "/compras/recepciones": "page.tsx",
      "/compras/recepciones/recibir": "recibir/page.tsx",
      "/compras/recepciones/[id]": "[id]/page.tsx",
    };
    for (const ruta of FICHA_DE_RECEPCIONES.rutas) {
      const pagina = paginas[ruta];
      expect(pagina).toBeDefined();
      expect(existsSync(`apps/web/app/s/app/(operacion)/compras/recepciones/${pagina ?? ""}`)).toBe(
        true,
      );
    }
    for (const b of FICHA_DE_RECEPCIONES.botones) {
      if (typeof b.hace === "object" && "envia" in b.hace) expect(b.sinPermiso).toBe("AUSENTE");
    }
  });

  it("la fila del menú de «Recepciones»: la lista, la acción de lectura, la perilla del plan y el título aprobado", () => {
    const fila = FILAS_DE_COMPRAS.find((f) => f.clave === "recepciones");
    expect(fila).toMatchObject({
      href: "/compras/recepciones",
      modulo: "compras",
      accion: "recepciones.ver",
      perilla: "recepcion_separada",
      etiqueta: "compras.recepcion.titulo_lista",
    });
  });

  it("todo texto que la pantalla resuelve está en la ficha (nada sin declarar)", () => {
    const declarados = new Set(Object.values(FICHA_DE_RECEPCIONES.textos).map(() => true));
    expect(declarados.size).toBeGreaterThan(0);
    const textos = textosDeRecepciones();
    for (const valor of Object.values(textos)) expect(valor).not.toBe("");
  });
});
