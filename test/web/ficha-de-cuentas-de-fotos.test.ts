import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_CUENTAS_DE_FOTOS } from "../../src/capacidades/pantallas/ficha-de-cuentas-de-fotos";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * La ficha de «Conectá tu cuenta de fotos» no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con su fuente, su acción existe en el módulo `vidriera`, y todo texto del
 * catálogo que citan la página, el modelo y los formularios está declarado en la ficha. Previene: un botón con una acción que no existe, un texto sin fuente y una ruta que se mueve sin que la ficha lo note.
 */
describe("ficha de la pantalla «Conectá tu cuenta de fotos»", () => {
  const ficha = FICHA_DE_CUENTAS_DE_FOTOS;

  it("sus archivos existen", () => {
    for (const archivo of ficha.archivos) expect(() => readFileSync(archivo)).not.toThrow();
  });

  it("todo texto del título y de los botones está declarado con usos y fuente, y cada clave existe en el catálogo", () => {
    const declaradas: string[] = Object.keys(ficha.textos);
    for (const clave of [ficha.titulo, ...ficha.botones.map((b) => b.texto)])
      expect(declaradas).toContain(clave);
    for (const [clave, t] of Object.entries(ficha.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio.length).toBeGreaterThan(0);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("los dos textos nuevos son la propuesta del brief y nacen con su decisión pendiente; ningún otro texto nuevo", () => {
    for (const [clave, texto] of [
      ["catalogo.cuentas_de_fotos.titulo", "Conectá tu cuenta de fotos"],
      ["catalogo.cuentas_de_fotos.cuenta", "Pegá el nombre de tu cuenta"],
    ] as const) {
      const definicion = CATALOGO_DE_TEXTOS[clave] as { porDefecto: string; fuente?: unknown };
      expect(definicion.porDefecto).toBe(texto);
      expect(definicion.fuente, clave).toEqual({ decision: "DEC-CAT-001" });
    }
    const nuevos = Object.keys(CATALOGO_DE_TEXTOS).filter((k) =>
      k.startsWith("catalogo.cuentas_de_fotos."),
    );
    expect(nuevos.sort()).toEqual([
      "catalogo.cuentas_de_fotos.cuenta",
      "catalogo.cuentas_de_fotos.titulo",
    ]);
  });

  it("todo texto del catálogo que citan la página, el modelo y los formularios está en la ficha", () => {
    const codigo = [
      "apps/web/app/s/app/(operacion)/catalogo/carta-en-linea/cuentas-de-fotos/page.tsx",
      "apps/web/ui/plantillas/carta/modelo-de-cuentas-de-fotos.ts",
      "apps/web/ui/plantillas/carta/PantallaDeCuentasDeFotos.tsx",
      "apps/web/ui/plantillas/carta/FormularioDeCuentaDeFotos.cliente.tsx",
      "apps/web/ui/plantillas/carta/FormularioDeRetiroDeCuentaDeFotos.cliente.tsx",
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
    expect(citadas.length).toBeGreaterThanOrEqual(4);
    for (const clave of citadas) expect(Object.keys(ficha.textos), clave).toContain(clave);
  });

  it("su acción existe en el módulo vidriera y es la que exige el acceso de la pantalla", () => {
    const acciones = Object.keys(CATALOGO_DE_MODULOS.vidriera.acciones);
    expect(acciones).toContain(ficha.acceso);
    for (const b of ficha.botones) {
      expect("envia" in b.hace && b.hace.envia).toBe(ficha.acceso);
    }
  });

  it("la lista de rutas es la de la página y el error y la falta de permiso salen con el genérico", () => {
    expect(ficha.rutas).toEqual(["/catalogo/carta-en-linea/cuentas-de-fotos"]);
    expect(ficha.estados).toEqual({ ERROR: "GENERICO", SIN_PERMISO: "GENERICO" });
  });
});
