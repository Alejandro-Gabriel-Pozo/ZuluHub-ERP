import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rutaDeCobrarLaCuenta } from "../../apps/web/ui/plantillas/salon/rutas-del-salon";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_DIVIDIR_LA_CUENTA } from "../../src/capacidades/pantallas/ficha-de-dividir-la-cuenta";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * La ficha de «Dividir la cuenta» (SAL-E2) no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con uso y fuente del dueño, las acciones de sus botones existen y todo texto del catálogo que cita
 * su modelo está en la ficha. Previene: un botón con una acción que no existe, un texto sin fuente y una hoja que muestra un texto que nadie declaró.
 */
const ACCIONES = new Set(
  Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones)),
);

describe("ficha de «Dividir la cuenta»", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA_DE_DIVIDIR_LA_CUENTA.archivos) {
      expect(() => readFileSync(archivo)).not.toThrow();
    }
  });

  it("todo texto está declarado con usos y fuente del dueño y existe en el catálogo; el título y cada botón están declarados", () => {
    const declarados = Object.keys(FICHA_DE_DIVIDIR_LA_CUENTA.textos);
    for (const clave of [
      FICHA_DE_DIVIDIR_LA_CUENTA.titulo,
      ...FICHA_DE_DIVIDIR_LA_CUENTA.botones.map((b) => b.texto),
    ]) {
      expect(declarados).toContain(clave);
    }
    for (const [clave, t] of Object.entries(FICHA_DE_DIVIDIR_LA_CUENTA.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.decidio).not.toMatch(/orquestador/i);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("el acceso y las acciones de sus botones existen en el catálogo de módulos", () => {
    expect(ACCIONES.has(FICHA_DE_DIVIDIR_LA_CUENTA.acceso)).toBe(true);
    for (const b of FICHA_DE_DIVIDIR_LA_CUENTA.botones) {
      if ("envia" in b.hace) expect(ACCIONES.has(b.hace.envia), b.id).toBe(true);
    }
    expect(Object.keys(CATALOGO_DE_MODULOS.salon.acciones)).toContain("salon.dividir");
  });

  it("todo texto del catálogo que citan los textos y el modelo de dividir está en la ficha", () => {
    const codigo = [
      "apps/web/ui/plantillas/salon/textos-de-dividir.ts",
      "apps/web/ui/plantillas/salon/modelo-de-dividir.ts",
      "apps/web/ui/plantillas/cobrar/textos-de-dividir-en-el-cobro.ts",
    ]
      .map((archivo) => readFileSync(archivo, "utf8"))
      .join("\n");
    const citados = [
      ...new Set(
        [...codigo.matchAll(/"((?:salon|comandas|ventas|vidriera)\.[a-z_.]+)"/g)].map((m) => m[1]),
      ),
    ];
    expect(citados.length).toBeGreaterThan(15);
    for (const clave of citados)
      expect(Object.keys(FICHA_DE_DIVIDIR_LA_CUENTA.textos), String(clave)).toContain(clave);
  });

  it("las rutas son las del salón y la de cobrar una cuenta hija codifica los ids", () => {
    expect(FICHA_DE_DIVIDIR_LA_CUENTA.rutas).toEqual([
      "/salon/cuenta/[mesaId]",
      "/salon/cuenta/[mesaId]/cobrar",
    ]);
    expect(rutaDeCobrarLaCuenta("m1", "c2")).toBe("/salon/cuenta/m1/cobrar?cuenta=c2");
    expect(rutaDeCobrarLaCuenta("../x", "a&b=1")).toBe(
      "/salon/cuenta/..%2Fx/cobrar?cuenta=a%26b%3D1",
    );
  });
});
