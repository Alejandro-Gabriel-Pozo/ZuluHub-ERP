import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * Las páginas de Configuración fiscal (lista, puntos de venta, alta y un punto de venta): con permiso, sin permiso y con error. La
 * guarda real (`pantallaDeOperacion`) y el armazón real; solo se simula lo externo (sesión, servidor, `next/navigation`).
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () =>
        Promise.resolve({
          ok: true,
          valor: { acciones: [], modulos: { activos: [], enSoloLectura: [] } },
        }),
    }),
  },
}));
const servidor = vi.hoisted(
  (): {
    estado: unknown;
    puntos: unknown;
    sucursales: unknown;
    pedidos: string[];
  } => ({ estado: null, puntos: null, sucursales: null, pedidos: [] }),
);
vi.mock("../../apps/web/servidor/configuracion-fiscal", () => ({
  cargarElEstadoDeLaConfiguracion: () => {
    servidor.pedidos.push("estado");
    return Promise.resolve(servidor.estado);
  },
  cargarLosPuntosDeVenta: () => {
    servidor.pedidos.push("puntos");
    return Promise.resolve(servidor.puntos);
  },
  crearElPuntoDeVenta: () => Promise.resolve(null),
  editarElPuntoDeVenta: () => Promise.resolve(null),
  activarElPuntoDeVenta: () => Promise.resolve(null),
  desactivarElPuntoDeVenta: () => Promise.resolve(null),
}));
vi.mock("../../apps/web/servidor/sucursal-elegida", () => ({
  sucursalesParaElegir: () => {
    servidor.pedidos.push("sucursales");
    return Promise.resolve(servidor.sucursales);
  },
}));
vi.mock("../../apps/web/servidor/facturacion", () => ({ cambiarElAmbiente: () => null }));
vi.mock("../../apps/web/servidor/sesion", () => ({
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

type Pagina = (p: {
  params?: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<unknown>;
// Con ruta en una variable: el `tsc` de la raíz (sin DOM) no sigue la página hasta los componentes de cliente.
const cargar = (ruta: string): Promise<{ default: Pagina }> => import(/* @vite-ignore */ ruta);
const BASE = "../../apps/web/app/s/app/(operacion)/configuracion-fiscal";

async function html(
  ruta: string,
  parametros: Readonly<{ id?: string; busqueda?: Record<string, string> }> = {},
): Promise<string> {
  const { default: Pagina } = await cargar(`${BASE}${ruta}`);
  const arbol = await Pagina({
    ...(parametros.id === undefined ? {} : { params: Promise.resolve({ id: parametros.id }) }),
    searchParams: Promise.resolve(parametros.busqueda ?? {}),
  });
  return renderToStaticMarkup(arbol as ReactNode);
}
const titulos = (marcado: string): string[] =>
  [...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1] as string);
const texto = (marcado: string): string =>
  marcado
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const EMISOR = "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d";
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const ID_2 = "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c";
const respuesta = (dato: unknown): Respuesta<unknown> => ({ ok: true, dato });
const falla = (codigo: Parameters<typeof errorDeCodigo>[0]): Respuesta<unknown> => ({
  ok: false,
  error: errorDeCodigo(codigo),
});

const estado = (cambios: Record<string, unknown> = {}) =>
  respuesta({
    emisorId: EMISOR,
    datosFiscales: { estado: "SIN_CARGAR" },
    puntosDeVenta: { estado: "SIN_PUNTOS", total: 0, activos: 0, ambientesEnUso: [] },
    certificados: [],
    ...cambios,
  });
const PV = (id: string, numero: number, cambios: Record<string, unknown> = {}) => ({
  id,
  numero,
  activo: true,
  ambiente: "HOMOLOGACION",
  sucursal: { id: "s-norte", nombre: "Sucursal Norte", activa: true },
  tieneDomicilio: true,
  hayNumerosUsados: false,
  version: 3,
  ...cambios,
});
const puntos = (items: unknown[]) => respuesta({ emisorId: EMISOR, items });
const sucursales = respuesta([
  { id: "s-norte", nombre: "Sucursal Norte", activa: true },
  { id: "s-sur", nombre: "Sucursal Sur", activa: false },
]);

beforeEach(() => {
  servidor.pedidos = [];
  servidor.estado = estado();
  servidor.puntos = puntos([PV(ID, 2), PV(ID_2, 3, { activo: false })]);
  servidor.sucursales = sucursales;
});

describe("la página «Configuración fiscal» (la lista de lo que falta)", () => {
  it("con permiso: un solo h1, el subtítulo y las tres filas con su cartel", async () => {
    const marcado = await html("/page");
    expect(titulos(marcado)).toEqual(["Configuración fiscal"]);
    const t = texto(marcado);
    expect(t).toContain("Lo que hace falta para emitir comprobantes");
    expect(t).toContain("Datos fiscales Falta cargar");
    expect(t).toContain("Puntos de venta Falta crear uno");
    expect(t).toContain("Certificado de ARCA");
  });

  it("las filas de datos fiscales y de puntos de venta son enlaces; la del certificado no", async () => {
    const marcado = await html("/page");
    expect(marcado).toContain('href="/configuracion-fiscal/datos-fiscales"');
    expect(marcado).toContain('href="/configuracion-fiscal/puntos-de-venta"');
    expect(marcado).not.toMatch(/<a[^>]*>[^<]*<span[^>]*>Certificado de ARCA/);
    expect(marcado.match(/<li>/g)).toHaveLength(3);
  });

  it("todo completo: ninguna fila lleva cartel", async () => {
    servidor.estado = estado({
      datosFiscales: { estado: "VIGENTES" },
      puntosDeVenta: {
        estado: "CON_ACTIVOS",
        total: 1,
        activos: 1,
        ambientesEnUso: ["HOMOLOGACION"],
      },
      certificados: [
        { ambiente: "HOMOLOGACION", situacion: "VIGENTE", venceEn: null, vencido: false },
      ],
    });
    const t = texto(await html("/page"));
    for (const cartel of ["Falta", "Pendiente", "Vencido", "Ninguno"]) {
      expect(t).not.toContain(cartel);
    }
  });

  it("sin permiso: dice «sin permiso» con el texto del catálogo y sin el código", async () => {
    servidor.estado = falla("SIN_PERMISO");
    const marcado = await html("/page");
    const t = texto(marcado);
    expect(t).toContain("No tiene permiso para hacer esto.");
    expect(t).not.toContain("SIN_PERMISO");
    expect(titulos(marcado)).toEqual(["Configuración fiscal"]);
  });

  it("con un error inesperado muestra la referencia y nada técnico", async () => {
    servidor.estado = {
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    };
    const t = texto(await html("/page"));
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});

describe("la página «Puntos de venta»", () => {
  it("lista todos, también los no activos, con el aviso de qué se puede hacer y «Agregar punto de venta»", async () => {
    const marcado = await html("/puntos-de-venta/page");
    expect(titulos(marcado)).toEqual(["Puntos de venta"]);
    const t = texto(marcado);
    expect(t).toContain("00002");
    expect(t).toContain("00003");
    expect(t).toContain("No activo");
    expect(t).toContain("Pruebas");
    expect(t).toContain("Tocá un punto de venta para editarlo, activarlo o desactivarlo.");
    expect(marcado).toContain(`href="/configuracion-fiscal/puntos-de-venta/${ID}"`);
    expect(marcado).toMatch(
      /<a[^>]*href="\/configuracion-fiscal\/puntos-de-venta\/nuevo"[^>]*>Agregar punto de venta/,
    );
  });

  it("sin ninguno: solo «Agregar punto de venta» (no hay un texto aprobado para el vacío)", async () => {
    servidor.puntos = puntos([]);
    const t = texto(await html("/puntos-de-venta/page"));
    expect(t).toContain("Agregar punto de venta");
    expect(t).not.toContain("Tocá un punto de venta");
  });

  it("sin permiso o con error: el texto del catálogo, sin «Agregar»", async () => {
    servidor.puntos = falla("SIN_PERMISO");
    const t = texto(await html("/puntos-de-venta/page"));
    expect(t).toContain("No tiene permiso para hacer esto.");
    expect(t).not.toContain("Agregar punto de venta");
  });
});

describe("la página «Agregar punto de venta»", () => {
  it("con permiso: el h1, el formulario con sus campos y las sucursales de la empresa; el emisor sale del servidor", async () => {
    const marcado = await html("/puntos-de-venta/nuevo/page");
    expect(titulos(marcado)).toEqual(["Agregar punto de venta"]);
    const t = texto(marcado);
    for (const rotulo of [
      "Número de punto de venta",
      "Sucursal",
      "Domicilio del punto de venta",
      "Calle",
      "Piso",
      "Departamento",
      "Localidad",
      "Provincia",
      "Código postal",
      "Guardar",
      "Cancelar",
    ]) {
      expect(t).toContain(rotulo);
    }
    expect(t).toContain("Sucursal Norte");
    expect(t).toContain("Sucursal Sur · Cerrada");
    // Las 24 provincias.
    expect(marcado.match(/<option value="AR-/g)).toHaveLength(24);
  });

  it("sin permiso: no pide las sucursales ni muestra el formulario", async () => {
    servidor.puntos = falla("SIN_PERMISO");
    const t = texto(await html("/puntos-de-venta/nuevo/page"));
    expect(t).toContain("No tiene permiso para hacer esto.");
    expect(t).not.toContain("Guardar");
    expect(servidor.pedidos).toEqual(["puntos"]);
  });

  it("si las sucursales fallan, dice el error y no muestra el formulario", async () => {
    servidor.sucursales = falla("SIN_PERMISO");
    const t = texto(await html("/puntos-de-venta/nuevo/page"));
    expect(t).toContain("No tiene permiso para hacer esto.");
    expect(t).not.toContain("Guardar");
  });
});

describe("la página de un punto de venta", () => {
  it("su título lleva el número; ofrece Desactivar, Pasar a producción y Editar", async () => {
    const marcado = await html("/puntos-de-venta/[id]/page", { id: ID });
    expect(titulos(marcado)).toEqual(["Punto de venta 00002"]);
    const t = texto(marcado);
    expect(t).toContain("Sucursal Norte");
    expect(t).toContain("Activo");
    expect(t).toContain("Desactivar");
    expect(t).toContain("Pasar a producción");
    expect(t).toContain("Editar");
  });

  it("uno no activo ofrece Activar; uno en producción ya no ofrece pasar a producción", async () => {
    servidor.puntos = puntos([PV(ID, 2, { activo: false, ambiente: "PRODUCCION" })]);
    const t = texto(await html("/puntos-de-venta/[id]/page", { id: ID }));
    expect(t).toContain("No activo");
    expect(t).toContain("Activar");
    expect(t).not.toContain("Desactivar");
    expect(t).toContain("Producción");
    expect(t).not.toContain("Pasar a producción");
  });

  it("un id que no es de los puntos de venta del emisor es «no encontrado» (no dice si existe en otra empresa)", async () => {
    const t = texto(await html("/puntos-de-venta/[id]/page", { id: "de-otra-empresa" }));
    expect(t).toContain("No se encontró el punto de venta.");
  });

  it("sin permiso: el texto del catálogo", async () => {
    servidor.puntos = falla("SIN_PERMISO");
    const t = texto(await html("/puntos-de-venta/[id]/page", { id: ID }));
    expect(t).toContain("No tiene permiso para hacer esto.");
    expect(t).not.toContain("Desactivar");
  });

  it("con ?editar=1 muestra el formulario con el número del punto de venta y no los botones de estado", async () => {
    const marcado = await html("/puntos-de-venta/[id]/page", {
      id: ID,
      busqueda: { editar: "1" },
    });
    expect(titulos(marcado)).toEqual(["Punto de venta 00002"]);
    expect(marcado).toContain('value="00002"');
    const t = texto(marcado);
    expect(t).toContain("Guardar");
    expect(t).not.toContain("Desactivar");
    expect(t).not.toContain("Pasar a producción");
  });

  it("al editar, la sucursal actual se ofrece aunque la persona no la pueda elegir hoy", async () => {
    servidor.sucursales = respuesta([{ id: "s-sur", nombre: "Sucursal Sur", activa: true }]);
    const marcado = await html("/puntos-de-venta/[id]/page", {
      id: ID,
      busqueda: { editar: "1" },
    });
    expect(marcado).toMatch(/<option value="s-norte"[^>]*>Sucursal Norte/);
  });

  it("otro valor de «editar» no abre la edición", async () => {
    const t = texto(
      await html("/puntos-de-venta/[id]/page", { id: ID, busqueda: { editar: "si" } }),
    );
    expect(t).toContain("Desactivar");
  });
});
