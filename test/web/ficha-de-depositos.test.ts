import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_DEPOSITOS } from "../../src/capacidades/pantallas/ficha-de-depositos";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * La ficha de «Depósitos» de stock no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con sus usos y su fuente, sus acciones están declaradas en el módulo `stock`, la
 * fila del menú coincide y todo texto del catálogo que cita el modelo, la lista y los formularios está declarado en la ficha. Previene: un botón con una acción que no existe, un texto sin fuente o una
 * ruta que se mueve sin que la ficha lo note.
 */
describe("ficha de la pantalla «Depósitos» de stock", () => {
  const ficha = FICHA_DE_DEPOSITOS;

  it("sus archivos existen", () => {
    for (const archivo of ficha.archivos) expect(() => readFileSync(archivo)).not.toThrow();
  });

  it("todo texto de un botón o del título está declarado con usos y fuente, y cada clave existe", () => {
    const declaradas: string[] = Object.keys(ficha.textos);
    for (const clave of [ficha.titulo, ...ficha.botones.map((b) => b.texto)]) {
      expect(declaradas).toContain(clave);
    }
    for (const [clave, t] of Object.entries(ficha.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("los tres errores nuevos nacen con su decisión y dicen lo aprobado", () => {
    for (const [clave, texto] of [
      ["stock.error.deposito_con_existencia", "El depósito tiene existencia"],
      ["stock.error.es_el_de_venta", "No se puede desactivar el depósito de venta"],
      [
        "stock.error.deposito_desactualizado",
        "Otra persona modificó este depósito. Actualizá la pantalla",
      ],
    ] as const) {
      const definicion = CATALOGO_DE_TEXTOS[clave] as {
        porDefecto: string;
        usos?: unknown;
        fuente?: unknown;
      };
      expect(definicion.porDefecto).toBe(texto);
      expect(definicion.usos, clave).toBeDefined();
      expect(definicion.fuente, clave).toEqual({ decision: "DEC-1018" });
    }
  });

  it("todo texto del catálogo que citan la lista, los formularios y el modelo está en la ficha", () => {
    const codigo = [
      "apps/web/app/s/app/(operacion)/stock/depositos/page.tsx",
      "apps/web/app/s/app/(operacion)/stock/depositos/nuevo/page.tsx",
      "apps/web/app/s/app/(operacion)/stock/depositos/[id]/editar/page.tsx",
      "apps/web/ui/plantillas/stock/depositos/modelo-de-depositos.ts",
    ]
      .map((a) => readFileSync(a, "utf8"))
      .join("\n");
    const citadas = [
      ...new Set(
        [...codigo.matchAll(/"((?:stock|catalogo)\.(?:[a-z_]+\.)+[a-z_]+)"/g)].map(
          (m) => m[1] ?? "",
        ),
      ),
    ];
    expect(citadas.length).toBeGreaterThan(10);
    for (const clave of citadas) expect(Object.keys(ficha.textos), clave).toContain(clave);
  });

  it("sus acciones existen en el módulo stock y el acceso es el de la fila del menú", () => {
    const acciones = Object.keys(CATALOGO_DE_MODULOS.stock.acciones);
    expect(acciones).toContain(ficha.acceso);
    for (const b of ficha.botones) {
      if ("envia" in b.hace) expect(acciones).toContain(b.hace.envia);
    }
    const fila = FILAS_DEL_MENU.find((f) => f.tipo === "pantalla" && f.clave === "stock");
    expect(fila).toMatchObject({ accion: ficha.acceso, etiqueta: "stock.pantalla.stock" });
  });

  it("la lista de rutas es la de las tres páginas", () => {
    expect(ficha.rutas).toEqual([
      "/stock/depositos",
      "/stock/depositos/nuevo",
      "/stock/depositos/[id]/editar",
    ]);
  });
});
