import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { ok } from "../../src/primitivas/resultado/resultado";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * Los botones de las páginas de Puntos de venta según lo que el SERVIDOR deja hacer hoy (I1 del PR #122): lo que no, sale apagado con
 * su motivo del catálogo. El cálculo está en `configuracion-fiscal-acciones.test.ts`; acá, que cada página lo aplique a sus botones.
 * Previene: abrir la ventana de «Pasar a producción», confirmar y recién ahí recibir el rechazo del módulo en desarrollo. Ocultar no
 * autoriza: el guard vuelve a decidir al enviar. Mismo armado que `configuracion-fiscal-paginas.test.ts` (guarda y armazón reales).
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const servidor = vi.hoisted((): { puntos: unknown; permisos: unknown } => ({
  puntos: null,
  permisos: null,
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () => Promise.resolve({ ok: true, valor: servidor.permisos }),
      sucursalesElegibles: () =>
        Promise.resolve(ok([{ id: "s-norte", nombre: "Sucursal Norte", activa: true }])),
    }),
  },
}));
vi.mock("../../apps/web/servidor/configuracion-fiscal", () => ({
  cargarElEstadoDeLaConfiguracion: () => Promise.resolve(null),
  cargarLosPuntosDeVenta: () => Promise.resolve(servidor.puntos),
  crearElPuntoDeVenta: () => Promise.resolve(null),
  editarElPuntoDeVenta: () => Promise.resolve(null),
  activarElPuntoDeVenta: () => Promise.resolve(null),
  desactivarElPuntoDeVenta: () => Promise.resolve(null),
}));
vi.mock("../../apps/web/servidor/facturacion", () => ({ cambiarElAmbiente: () => null }));
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

type Pagina = (p: {
  params?: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<unknown>;
// Con ruta en una variable: el `tsc` de la raíz (sin DOM) no sigue la página hasta los componentes de cliente.
const cargar = (ruta: string): Promise<{ default: Pagina }> => import(/* @vite-ignore */ ruta);
const BASE = "../../apps/web/app/s/app/(operacion)/configuracion-fiscal";
const html = async (
  ruta: string,
  parametros: Readonly<{ id?: string; busqueda?: Record<string, string> }> = {},
): Promise<string> => {
  const { default: Pagina } = await cargar(`${BASE}${ruta}`);
  const arbol = await Pagina({
    ...(parametros.id === undefined ? {} : { params: Promise.resolve({ id: parametros.id }) }),
    searchParams: Promise.resolve(parametros.busqueda ?? {}),
  });
  return renderToStaticMarkup(arbol as ReactNode);
};

const EMISOR = "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d";
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const respuesta = (dato: unknown): Respuesta<unknown> => ({ ok: true, dato });
const PV = (cambios: Record<string, unknown> = {}) => ({
  id: ID,
  numero: 2,
  activo: true,
  ambiente: "HOMOLOGACION",
  sucursal: { id: "s-norte", nombre: "Sucursal Norte", activa: true },
  tieneDomicilio: true,
  hayNumerosUsados: false,
  version: 3,
  ...cambios,
});

// Lo que hoy entrega el servidor al gerente: las acciones de `administracion` (módulo obligatorio, siempre activo) y NINGUNA de
// `facturacion`, que está en desarrollo.
const PERMISOS_DEL_GERENTE = {
  acciones: [
    "datos_fiscales.editar",
    "puntos_de_venta.activar",
    "puntos_de_venta.crear",
    "puntos_de_venta.desactivar",
    "puntos_de_venta.editar",
  ],
  modulos: { activos: ["administracion"], enSoloLectura: [] },
};
const sinPermisosDe = (...quitadas: string[]) => ({
  ...PERMISOS_DEL_GERENTE,
  acciones: PERMISOS_DEL_GERENTE.acciones.filter((a) => !quitadas.includes(a)),
});

beforeEach(() => {
  servidor.permisos = PERMISOS_DEL_GERENTE;
  servidor.puntos = respuesta({ emisorId: EMISOR, items: [PV()] });
});

const botones = (marcado: string): { nombre: string; apagado: boolean; motivo: string | null }[] =>
  [
    ...marcado.matchAll(
      /<button\b([^>]*)>(.*?)<\/button>(?:<span id="[^"]*" class="[^"]*">(.*?)<\/span>)?/g,
    ),
  ].map((m) => ({
    nombre: m[2] as string,
    apagado: (m[1] as string).includes('disabled=""'),
    motivo: m[3] ?? null,
  }));
const boton = (marcado: string, nombre: string) =>
  botones(marcado).find((b) => b.nombre === nombre);
const EN_DESARROLLO = "Esta función todavía está en desarrollo.";
const SIN_PERMISO = "No tiene permiso para hacer esto.";
const EDICION = { id: ID, busqueda: { editar: "1" } };

describe("los botones apagados según el servidor", () => {
  it("lista: «Agregar punto de venta» es un enlace activo si el servidor deja crear", async () => {
    const marcado = await html("/puntos-de-venta/page");
    expect(marcado).toContain('href="/configuracion-fiscal/puntos-de-venta/nuevo"');
    expect(boton(marcado, "Agregar punto de venta")).toBeUndefined();
  });

  it("lista: sin crear, «Agregar punto de venta» sale apagado con su motivo y no lleva al alta", async () => {
    servidor.permisos = sinPermisosDe("puntos_de_venta.crear");
    const marcado = await html("/puntos-de-venta/page");
    expect(boton(marcado, "Agregar punto de venta")).toEqual({
      nombre: "Agregar punto de venta",
      apagado: true,
      motivo: SIN_PERMISO,
    });
    expect(marcado).not.toContain('href="/configuracion-fiscal/puntos-de-venta/nuevo"');
  });

  it("detalle: «Pasar a producción» sale apagado por el módulo en desarrollo; Desactivar y Editar, activos", async () => {
    const marcado = await html("/puntos-de-venta/[id]/page", { id: ID });
    expect(boton(marcado, "Pasar a producción")).toEqual({
      nombre: "Pasar a producción",
      apagado: true,
      motivo: EN_DESARROLLO,
    });
    expect(boton(marcado, "Desactivar")).toEqual({
      nombre: "Desactivar",
      apagado: false,
      motivo: null,
    });
    expect(boton(marcado, "Editar")).toEqual({ nombre: "Editar", apagado: false, motivo: null });
  });

  it("detalle: sin desactivar y sin editar, esos botones salen apagados con «No tiene permiso para hacer esto.»", async () => {
    servidor.permisos = sinPermisosDe("puntos_de_venta.desactivar", "puntos_de_venta.editar");
    const marcado = await html("/puntos-de-venta/[id]/page", { id: ID });
    expect(boton(marcado, "Desactivar")).toMatchObject({ apagado: true, motivo: SIN_PERMISO });
    expect(boton(marcado, "Editar")).toMatchObject({ apagado: true, motivo: SIN_PERMISO });
  });

  it("detalle de uno no activo: «Activar» depende de activar, no de desactivar", async () => {
    servidor.puntos = respuesta({ emisorId: EMISOR, items: [PV({ activo: false })] });
    servidor.permisos = sinPermisosDe("puntos_de_venta.desactivar");
    expect(boton(await html("/puntos-de-venta/[id]/page", { id: ID }), "Activar")).toMatchObject({
      apagado: false,
    });
    servidor.permisos = sinPermisosDe("puntos_de_venta.activar");
    expect(boton(await html("/puntos-de-venta/[id]/page", { id: ID }), "Activar")).toMatchObject({
      apagado: true,
      motivo: SIN_PERMISO,
    });
  });

  it("alta: «Guardar» activo con permiso; sin crear, apagado con su motivo", async () => {
    expect(boton(await html("/puntos-de-venta/nuevo/page"), "Guardar")).toMatchObject({
      apagado: false,
    });
    servidor.permisos = sinPermisosDe("puntos_de_venta.crear");
    expect(boton(await html("/puntos-de-venta/nuevo/page"), "Guardar")).toMatchObject({
      apagado: true,
      motivo: SIN_PERMISO,
    });
  });

  it("edición: «Guardar» depende de editar (no de crear)", async () => {
    servidor.permisos = sinPermisosDe("puntos_de_venta.crear");
    expect(boton(await html("/puntos-de-venta/[id]/page", EDICION), "Guardar")).toMatchObject({
      apagado: false,
    });
    servidor.permisos = sinPermisosDe("puntos_de_venta.editar");
    expect(boton(await html("/puntos-de-venta/[id]/page", EDICION), "Guardar")).toMatchObject({
      apagado: true,
      motivo: SIN_PERMISO,
    });
  });
});
