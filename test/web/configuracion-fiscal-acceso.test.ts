import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { DECLARACIONES_DE_CONSULTAS } from "../../src/modulos/fiscal/consultas/declaraciones";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * Los dos accesos a Configuración fiscal (respuesta del dueño, 2026-10-29): el renglón de Cuenta y el pendiente de Inicio. Los dos
 * salen del MISMO permiso con que se protege la pantalla (`datos_fiscales.editar`, según `permisosDelActor`); el pendiente además pide
 * que la lista tenga algún cartel (el mismo cálculo de la lista). Previene: ofrecer la entrada a quien el servidor va a rechazar, un
 * pendiente que no se puede resolver, y que un fallo de lectura rompa Inicio o filtre un mensaje al registro. Se renderizan las páginas
 * de verdad; solo se simula lo externo (sesión, permisos y la lectura de la lista).
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const mundo = vi.hoisted(
  (): {
    permisos: unknown;
    permisosFallan: boolean;
    estado: unknown;
    estadoLanza: Error | null;
    lecturas: number;
  } => ({ permisos: null, permisosFallan: false, estado: null, estadoLanza: null, lecturas: 0 }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () => {
        if (mundo.permisosFallan) return Promise.reject(new Error("la base no responde"));
        return Promise.resolve(mundo.permisos);
      },
    }),
  },
}));
vi.mock("../../apps/web/servidor/configuracion-fiscal", () => ({
  cargarElEstadoDeLaConfiguracion: () => {
    mundo.lecturas += 1;
    if (mundo.estadoLanza !== null) return Promise.reject(mundo.estadoLanza);
    return Promise.resolve(mundo.estado);
  },
}));
vi.mock("../../apps/web/servidor/empresas", () => ({
  sucursalesDelContexto: () => Promise.resolve({ ok: true, dato: [] }),
}));
vi.mock("../../apps/web/app/s/app/acciones", () => ({ cerrarSesionAccion: () => null }));
vi.mock("../../apps/web/servidor/sesion", () => ({
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

type Pagina = () => Promise<unknown>;
// Con ruta en una variable: el `tsc` de la raíz (sin DOM) no sigue la página hasta los componentes de cliente.
const cargar = (ruta: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ ruta);
const BASE = "../../apps/web/app/s/app/(operacion)";
const html = async (ruta: string): Promise<string> => {
  const { default: Pagina } = (await cargar(`${BASE}${ruta}`)) as { default: Pagina };
  return renderToStaticMarkup((await Pagina()) as ReactNode);
};
const pendientes = async (): Promise<readonly { id: string; titulo: string; href: string }[]> => {
  const { pendientesDeLaEmpresa } = (await cargar("../../apps/web/servidor/modulos")) as {
    pendientesDeLaEmpresa: (
      c: unknown,
    ) => Promise<readonly { id: string; titulo: string; href: string }[]>;
  };
  return pendientesDeLaEmpresa({ id: "contexto" });
};

const ACCION = "datos_fiscales.editar";
const conPermisos = (acciones: string[]) => {
  mundo.permisos = ok({ acciones, modulos: { activos: ["administracion"], enSoloLectura: [] } });
};
const estado = (cambios: Record<string, unknown> = {}): Respuesta<unknown> => ({
  ok: true,
  dato: {
    emisorId: "emisor",
    datosFiscales: { estado: "SIN_CARGAR" },
    puntosDeVenta: {
      estado: "CON_ACTIVOS",
      total: 1,
      activos: 1,
      ambientesEnUso: ["HOMOLOGACION"],
    },
    certificados: [
      { ambiente: "HOMOLOGACION", situacion: "VIGENTE", venceEn: null, vencido: false },
    ],
    ...cambios,
  },
});
const COMPLETO = estado({ datosFiscales: { estado: "VIGENTES" } });
const TEXTO = "Completá la configuración fiscal.";

let registro: MockInstance<typeof console.error>;
beforeEach(() => {
  mundo.permisosFallan = false;
  mundo.estadoLanza = null;
  mundo.lecturas = 0;
  conPermisos([ACCION]);
  mundo.estado = estado();
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  registro.mockRestore();
});

describe("el permiso", () => {
  it("es el mismo con que la consulta de la lista se protege (una regla, un lugar)", async () => {
    const { ACCION_DE_CONFIGURACION_FISCAL } = (await cargar(
      "../../apps/web/servidor/modulos",
    )) as { ACCION_DE_CONFIGURACION_FISCAL: string };
    expect(ACCION_DE_CONFIGURACION_FISCAL).toBe(
      DECLARACIONES_DE_CONSULTAS.estadoDeLaConfiguracionFiscal.accion,
    );
  });
});

describe("el pendiente de Inicio", () => {
  it("con el permiso y algo que falta: un solo pendiente, «Completá la configuración fiscal.», que lleva a la lista", async () => {
    expect(await pendientes()).toEqual([
      { id: "configuracion-fiscal", titulo: TEXTO, href: "/configuracion-fiscal" },
    ]);
    const marcado = await html("/page");
    expect(marcado).toMatch(
      /<a[^>]*href="\/configuracion-fiscal"[^>]*>[^]*Completá la configuración fiscal\./,
    );
  });

  it("con el permiso pero la lista completa (ninguna fila con cartel): no hay pendiente", async () => {
    mundo.estado = COMPLETO;
    expect(await pendientes()).toEqual([]);
    expect(await html("/page")).not.toContain(TEXTO);
  });

  it("sin el permiso: no hay pendiente y ni siquiera se lee la lista", async () => {
    conPermisos(["comprobantes.ver"]);
    expect(await pendientes()).toEqual([]);
    expect(mundo.lecturas).toBe(0);
    expect(await html("/page")).not.toContain(TEXTO);
  });

  it("si no se pudieron leer los permisos (rechazo o excepción): no hay pendiente", async () => {
    mundo.permisos = err({ codigo: "SIN_PERMISO" });
    expect(await pendientes()).toEqual([]);
    mundo.permisosFallan = true;
    expect(await pendientes()).toEqual([]);
    expect(mundo.lecturas).toBe(0);
  });

  it("un cartel de cualquier fila alcanza (aunque datos y puntos estén completos)", async () => {
    mundo.estado = estado({
      datosFiscales: { estado: "VIGENTES" },
      certificados: [
        { ambiente: "HOMOLOGACION", situacion: "FALTA_CARGAR", venceEn: null, vencido: false },
      ],
    });
    expect(await pendientes()).toHaveLength(1);
  });

  it("si la lectura es rechazada: no hay pendiente y se registra solo el tipo (el código), sin mensaje", async () => {
    mundo.estado = {
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABCD-0123" },
    };
    expect(await pendientes()).toEqual([]);
    expect(registro).toHaveBeenCalledTimes(1);
    const dicho = String(registro.mock.calls[0]?.[0]);
    expect(dicho).toContain("ERROR_INTERNO");
    expect(dicho).not.toContain("PD-ABCD-0123");
  });

  it("si la lectura lanza una excepción: no hay pendiente, Inicio sigue andando y se registra solo el tipo, nunca el mensaje", async () => {
    mundo.estadoLanza = new TypeError("password=secreto en 10.0.0.1");
    expect(await pendientes()).toEqual([]);
    expect(await html("/page")).not.toContain(TEXTO);
    expect(registro).toHaveBeenCalled();
    for (const llamada of registro.mock.calls) {
      const dicho = String(llamada[0]);
      expect(dicho).toContain("TypeError");
      expect(dicho).not.toContain("secreto");
      expect(dicho).not.toContain("10.0.0.1");
    }
  });
});

describe("el renglón «Configuración fiscal» de Cuenta", () => {
  it("con el permiso: se ve siempre, aunque la lista esté completa, y lleva a la lista", async () => {
    mundo.estado = COMPLETO;
    const marcado = await html("/cuenta/page");
    expect(marcado).toMatch(/<a[^>]*href="\/configuracion-fiscal"[^>]*>Configuración fiscal<\/a>/);
    expect(mundo.lecturas).toBe(0);
  });

  it("sin el permiso: no se ve", async () => {
    conPermisos(["comprobantes.ver"]);
    expect(await html("/cuenta/page")).not.toContain("/configuracion-fiscal");
  });

  it("si no se pudieron leer los permisos: no se ve y Cuenta sigue andando", async () => {
    mundo.permisosFallan = true;
    const marcado = await html("/cuenta/page");
    expect(marcado).not.toContain("/configuracion-fiscal");
    expect(marcado).toContain("Empresa de prueba");
  });
});
