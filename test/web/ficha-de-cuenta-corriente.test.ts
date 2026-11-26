import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";
import { RUTA_DE_LA_CUENTA_CORRIENTE } from "../../apps/web/ui/plantillas/cuenta-corriente/rutas-de-cuenta-corriente";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_CUENTA_CORRIENTE } from "../../src/capacidades/pantallas/ficha-de-cuenta-corriente";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * La ficha de la cuenta corriente (listado y ficha del cliente) no se desfasa: sus archivos existen, cada texto propio está en el catálogo con usos y fuente, los reutilizados existen, el acceso es el de la fila del
 * menú y todo texto `cuenta_corriente.*` que cita el código de la pantalla está declarado. Previene: un texto o una ruta que nadie declaró.
 */
const ficha = FICHA_DE_CUENTA_CORRIENTE;
const claves = (texto: string): string[] => [
  ...new Set(texto.match(/"cuenta_corriente\.[a-z_.]+"/g)?.map((c) => c.slice(1, -1)) ?? []),
];

describe("ficha de las pantallas de la cuenta corriente", () => {
  it("sus archivos existen y sus rutas son las de las páginas", () => {
    for (const archivo of ficha.archivos)
      expect(() => readFileSync(archivo), archivo).not.toThrow();
    expect(ficha.rutas[0]).toBe(RUTA_DE_LA_CUENTA_CORRIENTE);
    expect(ficha.rutas[1]).toBe(`${RUTA_DE_LA_CUENTA_CORRIENTE}/[parteId]`);
  });

  it("cada texto propio está en el catálogo con usos y fuente, y los reutilizados existen", () => {
    expect(Object.keys(ficha.textos)).toContain(ficha.titulo);
    for (const [clave, t] of Object.entries(ficha.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS), clave).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.donde).toMatch(/DEC-CCL-00[45]/);
    }
    for (const clave of ficha.reutilizados)
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
  });

  it("todo texto del catálogo `cuenta_corriente.*` está declarado en la ficha y viceversa", () => {
    const delCatalogo = Object.keys(CATALOGO_DE_TEXTOS).filter((c) =>
      c.startsWith("cuenta_corriente."),
    );
    expect(Object.keys(ficha.textos).sort()).toEqual(delCatalogo.sort());
  });

  it("el código de la pantalla solo cita textos declarados", () => {
    const citados = ficha.archivos
      .filter((a) => a.includes("plantillas/cuenta-corriente/") || a.includes("page.tsx"))
      .flatMap((a) => claves(readFileSync(a, "utf8")));
    for (const c of citados) expect(Object.keys(ficha.textos), c).toContain(c);
  });

  it("el acceso existe en el módulo y es el de la fila del menú", () => {
    expect(Object.keys(CATALOGO_DE_MODULOS.cuenta_corriente.acciones)).toContain(ficha.acceso);
    const fila = FILAS_DEL_MENU.find(
      (f) => f.tipo === "pantalla" && f.clave === "cuenta-corriente",
    );
    expect(fila).toMatchObject({
      accion: ficha.acceso,
      modulo: "cuenta_corriente",
      href: RUTA_DE_LA_CUENTA_CORRIENTE,
      etiqueta: "cuenta_corriente.menu.entrada",
    });
  });
});
