import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClaveDeTexto } from "../../src/capacidades/vocabulario/catalogo";
import { describe, expect, it, vi } from "vitest";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * `pantallaDeOperacion` y `conTitulo` de verdad (la guarda y el armazón reales): el título de la pantalla es el único `h1`.
 * Previene: dos títulos en la pantalla (el genérico del armazón y el real como `h2`), o que inicio y cuenta pierdan el suyo.
 * Solo se simula lo externo: la sesión, la puerta y la empresa.
 */
vi.mock("server-only", () => ({}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  empresaDelPedido: () =>
    Promise.resolve({
      puerta: { marca: { nombre: "Marca de prueba" } },
      entrada: {
        ok: true,
        dato: { tipo: "ENTRA", empresa: { nombre: "Empresa de prueba" }, contexto: {} },
      },
    }),
}));

// Con ruta en una variable: el `tsc` de la raíz (sin DOM) no sigue la guarda hasta los componentes de cliente.
const cargar = (): Promise<{
  conTitulo: (titulo: string, cuerpo: ReactNode) => unknown;
  pantallaDeOperacion: (
    opciones: { titulo: ClaveDeTexto; actual?: "inicio" | "cuenta" },
    contenido: () => unknown,
  ) => Promise<ReactNode>;
}> => {
  const ruta = "../../apps/web/pantallas/operacion";
  return import(/* @vite-ignore */ ruta);
};

const h1s = (marcado: string): string[] =>
  [...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1] as string);

describe("pantallaDeOperacion y conTitulo", () => {
  it("con conTitulo, el único h1 es el título real y el cuerpo se ve", async () => {
    const { conTitulo, pantallaDeOperacion } = await cargar();
    const arbol = await pantallaDeOperacion({ titulo: "fiscal.pantalla.titulo" }, () =>
      conTitulo("Factura B 00001-00001234", createElement("p", null, "cuerpo del detalle")),
    );
    const marcado = renderToStaticMarkup(arbol);
    expect(h1s(marcado)).toEqual(["Factura B 00001-00001234"]);
    expect(marcado).toContain("<p>cuerpo del detalle</p>");
  });

  it("sin conTitulo, el h1 es el de la clave del catálogo (el genérico «Comprobante»)", async () => {
    const { pantallaDeOperacion } = await cargar();
    const arbol = await pantallaDeOperacion({ titulo: "fiscal.pantalla.titulo" }, () =>
      createElement("p", null, "cuerpo"),
    );
    expect(h1s(renderToStaticMarkup(arbol))).toEqual(["Comprobante"]);
  });

  it.each([
    ["inicio.titulo", "inicio", "Inicio"],
    ["cuenta.titulo", "cuenta", "Cuenta"],
  ] as const)(
    "%s mantiene su título del catálogo y su cuerpo, y marca su destino como actual",
    async (clave, actual, titulo) => {
      const { pantallaDeOperacion } = await cargar();
      const arbol = await pantallaDeOperacion({ titulo: clave, actual }, async () =>
        Promise.resolve(createElement("p", null, `cuerpo de ${actual}`)),
      );
      const marcado = renderToStaticMarkup(arbol);
      expect(h1s(marcado)).toEqual([titulo]);
      expect(marcado).toContain(`<p>cuerpo de ${actual}</p>`);
      expect(marcado.match(/aria-current="page"/g)).toHaveLength(1);
    },
  );

  it("sin destino actual (la pantalla de un módulo) ningún destino fijo queda marcado", async () => {
    const { pantallaDeOperacion } = await cargar();
    const arbol = await pantallaDeOperacion({ titulo: "fiscal.pantalla.titulo" }, () =>
      createElement("p", null, "cuerpo"),
    );
    expect(renderToStaticMarkup(arbol)).not.toContain("aria-current");
  });
});
