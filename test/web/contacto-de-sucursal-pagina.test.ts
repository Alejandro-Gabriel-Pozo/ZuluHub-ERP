import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página «Contacto de la sucursal» (D-113, `/cuenta/contacto-de-la-sucursal`): pide la ficha de la sucursal elegida y arma la
 * pantalla con lo que el servidor devuelve; lo que el servidor no deja leer se dice con su texto, sin campos ni botones. La guarda real
 * (`pantallaDeOperacion`) y el armazón real; solo se simula lo externo. Previene: mostrar campos o botones cuando la lectura falla
 * («todo nace cerrado») y que abrir la pantalla escriba algo.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const servidor = vi.hoisted((): { ficha: unknown; lecturas: number; escrituras: number } => ({
  ficha: null,
  lecturas: 0,
  escrituras: 0,
}));
vi.mock("../../apps/web/servidor/contacto-de-sucursal", () => ({
  cargarElContactoDeLaSucursal: () => {
    servidor.lecturas += 1;
    return Promise.resolve(servidor.ficha);
  },
  guardarElContactoDeLaSucursal: () => {
    servidor.escrituras += 1;
    return Promise.resolve(null);
  },
}));
vi.mock("../../apps/web/servidor/modulos", () => ({
  destinosDeModulos: () => Promise.resolve([]),
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: { respuesta: { registrar: () => undefined } },
  empresaDelPedido: () =>
    Promise.resolve({
      puerta: { marca: { nombre: "Marca de prueba" } },
      entrada: {
        ok: true,
        dato: {
          tipo: "ENTRA",
          empresa: { nombre: "Empresa de prueba" },
          contexto: { id: "contexto" },
        },
      },
    }),
}));

type Pagina = () => Promise<unknown>;
// Con ruta en una variable: el `tsc` de la raíz (sin DOM) no sigue la página hasta los componentes de cliente.
const cargar = (ruta: string): Promise<{ default: Pagina }> => import(/* @vite-ignore */ ruta);
const PAGINA = "../../apps/web/app/s/app/(operacion)/cuenta/contacto-de-la-sucursal/page";

async function html(): Promise<string> {
  const { default: Pagina } = await cargar(PAGINA);
  return renderToStaticMarkup((await Pagina()) as ReactNode);
}
const titulos = (marcado: string): string[] =>
  [...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1] as string);
const texto = (marcado: string): string =>
  marcado
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const ficha = (contacto: Record<string, string | null> = {}): Respuesta<unknown> => ({
  ok: true,
  dato: {
    id: "11111111-1111-4111-8111-111111111111",
    nombre: "Casa central",
    contacto: { telefono: "011 4555-1234", correo: null, web: "www.hotelcentro.com", ...contacto },
    version: 3,
  },
});
const falla = (codigo: Parameters<typeof errorDeCodigo>[0]): Respuesta<unknown> => ({
  ok: false,
  error: errorDeCodigo(codigo),
});

beforeEach(() => {
  servidor.ficha = ficha();
  servidor.lecturas = 0;
  servidor.escrituras = 0;
});

describe("la página «Contacto de la sucursal»", () => {
  it("con la ficha: el título «Contacto de la sucursal», los tres campos con lo guardado (nulo = en blanco) y Guardar y Cancelar", async () => {
    const marcado = await html();
    expect(titulos(marcado)).toEqual(["Contacto de la sucursal"]);
    expect(marcado).toContain('value="011 4555-1234"');
    expect(marcado).toContain('value="www.hotelcentro.com"');
    expect(marcado).toMatch(/name="correo"[^>]*value=""|value=""[^>]*name="correo"/);
    for (const rotulo of ["Teléfono", "Correo", "Web"]) expect(texto(marcado)).toContain(rotulo);
    for (const boton of ["Guardar", "Cancelar"]) {
      expect(marcado).toMatch(new RegExp(`<button[^>]*>${boton}</button>`));
    }
  });

  it("no muestra el nombre como campo (el nombre no se edita acá)", async () => {
    expect(await html()).not.toContain('name="nombre"');
  });

  it("abrirla (y recargarla) solo lee: no escribe nada", async () => {
    await html();
    await html();
    expect(servidor.lecturas).toBe(2);
    expect(servidor.escrituras).toBe(0);
  });

  it("sin sucursal elegida: «Elegí una sucursal.» y ni campos ni botones", async () => {
    servidor.ficha = falla("FISCAL_SUCURSAL_NO_ELEGIDA");
    const marcado = await html();
    expect(texto(marcado)).toContain("Elegí una sucursal.");
    expect(marcado).not.toMatch(/<input|<form/);
  });

  it.each(["SIN_PERMISO", "FISCAL_SUCURSAL_FUERA_DE_ALCANCE", "ERROR_INTERNO"] as const)(
    "%s: se dice con su texto del catálogo, sin código y sin campos ni botones",
    async (codigo) => {
      servidor.ficha = falla(codigo);
      const marcado = await html();
      expect(titulos(marcado)).toEqual(["Contacto de la sucursal"]);
      expect(marcado).not.toMatch(/<input|<form/);
      expect(texto(marcado)).not.toContain(codigo);
    },
  );
});
