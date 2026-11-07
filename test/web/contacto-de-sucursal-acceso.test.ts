import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * El renglón «Contacto de la sucursal» de Cuenta (D-113): sale de la oferta de `sucursales.editar` que calcula el servidor con
 * `permisosDelActor` (gerente y administrador), igual que el acceso a Configuración fiscal. Previene: ofrecer la entrada a quien el
 * servidor va a rechazar (un operador), con el módulo en solo lectura (editar CREA_AMPLIA) o si no se pudieron leer los permisos
 * («todo nace cerrado»). Se renderiza la página de Cuenta de verdad; solo se simula lo externo.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn() }) }));
const mundo = vi.hoisted((): { permisos: unknown; fallan: boolean } => ({
  permisos: null,
  fallan: false,
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () =>
        mundo.fallan
          ? Promise.reject(new Error("la base no responde"))
          : Promise.resolve(mundo.permisos),
    }),
  },
}));
vi.mock("../../apps/web/servidor/empresas", () => ({
  sucursalesDelContexto: () => Promise.resolve({ ok: true, dato: [] }),
}));
vi.mock("../../apps/web/app/s/app/acciones", () => ({ cerrarSesionAccion: () => null }));
vi.mock("../../apps/web/servidor/sesion", () => ({
  // Sin lecturas compartidas: cada consulta abre la suya (la página las pide igual).
  dependenciasDeSesion: {},
  empresaDelPedido: () =>
    Promise.resolve({
      puerta: { marca: { nombre: "Marca de prueba" } },
      entrada: {
        ok: true,
        dato: {
          tipo: "ENTRA",
          empresa: {
            nombre: "Empresa de prueba",
            empresaId: "e-1",
            rol: "GERENTE",
            estadoEfectivo: "OPERA",
          },
          contexto: { id: "contexto" },
        },
      },
    }),
}));

const cargar = (ruta: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ ruta);
const cuenta = async (): Promise<string> => {
  const { default: Pagina } = (await cargar(
    "../../apps/web/app/s/app/(operacion)/cuenta/page",
  )) as { default: () => Promise<unknown> };
  return renderToStaticMarkup((await Pagina()) as ReactNode);
};
const RENGLON = /<a[^>]*href="\/cuenta\/contacto-de-la-sucursal"[^>]*>Contacto de la sucursal<\/a>/;
const conPermisos = (
  acciones: string[],
  modulos = { activos: ["administracion"], enSoloLectura: [] as string[] },
) => {
  mundo.permisos = ok({ acciones, modulos });
};

beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("el renglón «Contacto de la sucursal» de Cuenta", () => {
  it("con sucursales.editar: aparece y lleva a la pantalla", async () => {
    conPermisos(["sucursales.ver", "sucursales.editar"]);
    expect(await cuenta()).toMatch(RENGLON);
  });

  it("sin sucursales.editar (un operador): no aparece, y Cuenta sigue con lo demás", async () => {
    conPermisos(["comprobantes.ver"]);
    const marcado = await cuenta();
    expect(marcado).not.toContain("Contacto de la sucursal");
    expect(marcado).not.toContain("/cuenta/contacto-de-la-sucursal");
    expect(marcado).toContain("Cerrar sesión");
  });

  it("con el módulo en solo lectura (la acción no figura): no aparece", async () => {
    conPermisos(["sucursales.ver"], { activos: [], enSoloLectura: ["administracion"] });
    expect(await cuenta()).not.toContain("Contacto de la sucursal");
  });

  it("si no se pudieron leer los permisos (rechazo o excepción): no aparece", async () => {
    mundo.permisos = err({ codigo: "SIN_PERMISO" });
    expect(await cuenta()).not.toContain("Contacto de la sucursal");
    mundo.fallan = true;
    expect(await cuenta()).not.toContain("Contacto de la sucursal");
  });

  it("es independiente de Configuración fiscal: cada renglón sale con su propio permiso", async () => {
    conPermisos(["sucursales.editar"]);
    const marcado = await cuenta();
    expect(marcado).toMatch(RENGLON);
    expect(marcado).not.toContain("Configuración fiscal");
  });
});
