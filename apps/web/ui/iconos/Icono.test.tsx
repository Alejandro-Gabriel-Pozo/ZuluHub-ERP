import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { CATALOGO_DE_ICONOS, TAMANOS_DE_ICONO } from "./catalogo";
import { Icono } from "./Icono";

describe("Icono", () => {
  it("decorativo: oculto al lector, sin foco", async () => {
    const { container } = await render(
      <p>
        <Icono clave="reloj" decorativo /> Hora
      </p>,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("con etiqueta: es una imagen con nombre accesible", async () => {
    await render(<Icono clave="sin-conexion" etiqueta="Sin conexión" />);
    await expect.element(page.getByRole("img", { name: "Sin conexión" })).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it.each(Object.entries(TAMANOS_DE_ICONO))(
    "tamaño %s = %i px, de la escala cerrada",
    async (tamano, lado) => {
      const { container } = await render(
        <Icono clave="cerrar" decorativo tamano={tamano as keyof typeof TAMANOS_DE_ICONO} />,
      );
      const caja = container.querySelector("svg")?.getBoundingClientRect();
      expect(caja?.width).toBe(lado);
      expect(caja?.height).toBe(lado);
    },
  );

  it("sin etiqueta y sin declararse decorativo no compila ([02] §4.3)", () => {
    // @ts-expect-error o lleva etiqueta o es decorativo: no se puede omitir las dos
    const mudo = <Icono clave="cerrar" />;
    // @ts-expect-error una etiqueta y decorativo a la vez no tiene sentido
    const contradictorio = <Icono clave="cerrar" etiqueta="x" decorativo />;
    // @ts-expect-error la clave tiene que estar en el catálogo
    const inventado = <Icono clave="no-existe" decorativo />;
    expect([mudo, contradictorio, inventado]).toHaveLength(3);
  });

  it("toda clave del catálogo se usa en algún componente o patrón (y ninguna sobra)", () => {
    const fuentes = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const codigo = Object.values(fuentes).join("\n");
    for (const clave of Object.keys(CATALOGO_DE_ICONOS)) {
      expect(codigo, `la clave de ícono «${clave}» no se usa`).toContain(`"${clave}"`);
    }
  });

  it("las claves nombran el significado, en minúsculas con guiones ([02] §4.2)", () => {
    for (const clave of Object.keys(CATALOGO_DE_ICONOS)) {
      expect(clave).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });
});
