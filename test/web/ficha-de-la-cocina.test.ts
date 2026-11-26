import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_LA_COCINA } from "../../src/capacidades/pantallas/ficha-de-la-cocina";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * La ficha de «Comandas» de la cocina (SAL-H) no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con uso y fuente del dueño, sus acciones están declaradas en el módulo `comandas`, la fila del
 * menú coincide (acceso y rótulo) y todo texto del catálogo que cita el modelo de la cocina y el botón de imprimir está en la ficha. Previene: un botón con una acción que no existe, un texto sin fuente o una ruta que se
 * mueve sin que la ficha lo note.
 */
describe("ficha de la pantalla «Comandas» de la cocina", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA_DE_LA_COCINA.archivos) {
      expect(() => readFileSync(archivo)).not.toThrow();
    }
  });

  it("todo texto que usa está declarado con usos y fuente del dueño, y cada clave existe en el catálogo", () => {
    const claves = [FICHA_DE_LA_COCINA.titulo, ...FICHA_DE_LA_COCINA.botones.map((b) => b.texto)];
    for (const clave of claves) expect(Object.keys(FICHA_DE_LA_COCINA.textos)).toContain(clave);
    for (const [clave, t] of Object.entries(FICHA_DE_LA_COCINA.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.decidio).not.toMatch(/orquestador/i);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("el único texto nuevo de la pantalla («Comandas») declara sus usos y la decisión que lo aceptó", () => {
    const definicion = CATALOGO_DE_TEXTOS["comandas.texto.cocina_comandas"] as {
      porDefecto: string;
      usos?: unknown;
      fuente?: unknown;
    };
    expect(definicion.porDefecto).toBe("Comandas");
    expect(definicion.usos).toBeDefined();
    expect(definicion.fuente).toEqual({ decision: "DEC-1042" });
  });

  it("todo texto del catálogo que citan el modelo de la cocina y los textos del botón está en la ficha", () => {
    const codigo = [
      "apps/web/ui/plantillas/salon/modelo-de-la-cocina.ts",
      "apps/web/ui/patrones/papel/textos-de-imprimir.ts",
      "apps/web/app/s/app/(operacion)/salon/comandas/page.tsx",
    ]
      .map((a) => readFileSync(a, "utf8"))
      .join("\n");
    const citadas = [
      ...new Set(
        [...codigo.matchAll(/"((?:comandas|salon)\.texto\.[a-z_]+)"/g)].map((m) => m[1] ?? ""),
      ),
    ];
    expect(citadas.length).toBeGreaterThan(8);
    for (const clave of citadas)
      expect(Object.keys(FICHA_DE_LA_COCINA.textos), clave).toContain(clave);
  });

  it("sus acciones existen en el módulo comandas y el acceso es el de la fila del menú", () => {
    const acciones = Object.keys(CATALOGO_DE_MODULOS.comandas.acciones);
    expect(acciones).toContain(FICHA_DE_LA_COCINA.acceso);
    for (const b of FICHA_DE_LA_COCINA.botones) {
      if ("envia" in b.hace) expect(acciones).toContain(b.hace.envia);
    }
    const fila = FILAS_DEL_MENU.find((f) => f.tipo === "pantalla" && f.clave === "comandas");
    expect(fila).toMatchObject({
      accion: FICHA_DE_LA_COCINA.acceso,
      etiqueta: FICHA_DE_LA_COCINA.titulo,
      href: FICHA_DE_LA_COCINA.rutas[0],
      modulo: "comandas",
    });
  });
});
