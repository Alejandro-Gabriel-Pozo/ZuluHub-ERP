import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * Las dos páginas del certificado de ARCA (lista por ambiente y asistente de un ambiente): con la guarda real (`pantallaDeOperacion`) y el
 * armazón real; solo se simula lo externo (sesión, servidor, `next/navigation`). El estado sale del servidor: nada del navegador salvo el
 * ambiente de la dirección.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const servidor = vi.hoisted((): { certificados: unknown; pedidos: string[] } => ({
  certificados: null,
  pedidos: [],
}));
vi.mock("../../apps/web/servidor/certificado-de-arca", () => ({
  cargarLosCertificados: () => {
    servidor.pedidos.push("certificados");
    return Promise.resolve(servidor.certificados);
  },
  generarElPedidoDeCertificado: () => Promise.resolve(null),
  cargarElCertificado: () => Promise.resolve(null),
}));
vi.mock("../../apps/web/servidor/composicion", () => ({ web: {} }));
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
vi.mock("../../apps/web/servidor/modulos", () => ({
  destinosDeModulos: () => Promise.resolve([]),
}));

type Pagina = (p: { params?: Promise<{ ambiente: string }> }) => Promise<unknown>;
// Con ruta en una variable: el `tsc` de la raíz (sin DOM) no sigue la página hasta los componentes de cliente.
const cargar = (ruta: string): Promise<{ default: Pagina }> => import(/* @vite-ignore */ ruta);
const BASE = "../../apps/web/app/s/app/(operacion)/configuracion-fiscal/certificado-de-arca";

async function html(ruta: string, ambiente?: string): Promise<string> {
  const { default: Pagina } = await cargar(`${BASE}${ruta}`);
  const arbol = await Pagina(
    ambiente === undefined ? {} : { params: Promise.resolve({ ambiente }) },
  );
  return renderToStaticMarkup(arbol as ReactNode);
}
const texto = (marcado: string): string =>
  marcado
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const titulos = (marcado: string, h: "h1" | "h2"): string[] =>
  [...marcado.matchAll(new RegExp(`<${h}\\b[^>]*>(.*?)</${h}>`, "g"))].map((m) => m[1] as string);

const EMISOR = "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d";
const PEDIDO = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const respuesta = (certificados: unknown[]): Respuesta<unknown> => ({
  ok: true,
  dato: { emisorId: EMISOR, certificados },
});
const PENDIENTE = {
  ambiente: "PRODUCCION",
  situacion: "PEDIDO_GENERADO",
  certificadoId: PEDIDO,
  alias: "pedernalprod",
  cuitTitular: "20123456786",
  creadoEn: "2026-11-03T12:00:00.000Z",
};
const VIGENTE = (cambios: Record<string, unknown> = {}) => ({
  ambiente: "HOMOLOGACION",
  situacion: "VIGENTE",
  certificadoId: "c-1",
  alias: "pedernalprueba",
  cuitTitular: "20123456786",
  venceEn: "2028-10-13T02:00:00.000Z",
  vencido: false,
  autorizacion: { estado: "VERIFICADA", en: "2026-11-01T00:00:00.000Z" },
  pedidoPendiente: null,
  ...cambios,
});

beforeEach(() => {
  servidor.pedidos = [];
});

describe("la lista del certificado de ARCA", () => {
  it("Pruebas y Producción, cada una un enlace a su asistente, con su cartel y el vencimiento solo como fecha", async () => {
    servidor.certificados = respuesta([VIGENTE(), PENDIENTE]);
    const marcado = await html("/page");
    const t = texto(marcado);
    expect(t).toContain("Pruebas Vence 12/10/2028");
    expect(t).toContain("Producción Pendiente");
    expect(marcado).toContain('href="/configuracion-fiscal/certificado-de-arca/pruebas"');
    expect(marcado).toContain('href="/configuracion-fiscal/certificado-de-arca/produccion"');
    expect(marcado.match(/<li>/g)).toHaveLength(2);
    // Dueño, 2026-11-03: ni días que faltan ni «por vencer».
    expect(t).not.toMatch(/días|por vencer|verificada/i);
    expect(titulos(marcado, "h1")).toEqual(["Certificado de ARCA"]);
  });

  it("vencido: «Vencido»; falta cargar: «Falta cargar»", async () => {
    servidor.certificados = respuesta([VIGENTE({ vencido: true })]);
    const t = texto(await html("/page"));
    expect(t).toContain("Pruebas Vence 12/10/2028 Vencido");
    expect(t).toContain("Producción Falta cargar");
  });

  it("sin permiso: dice «sin permiso» con el texto del catálogo y sin el código", async () => {
    servidor.certificados = { ok: false, error: errorDeCodigo("SIN_PERMISO") };
    const t = texto(await html("/page"));
    expect(t).toContain("No tenés permiso para hacer esto.");
    expect(t).not.toContain("SIN_PERMISO");
  });
});

describe("la pantalla de un ambiente", () => {
  it("falta cargar: el paso 1 con los tres campos y «Generar pedido»", async () => {
    servidor.certificados = respuesta([VIGENTE()]);
    const marcado = await html("/[ambiente]/page", "produccion");
    expect(titulos(marcado, "h1")).toEqual(["Producción"]);
    expect(titulos(marcado, "h2")).toEqual(["Generar pedido"]);
    const t = texto(marcado);
    for (const rotulo of ["Alias", "CUIT del titular", "Organización", "Cancelar"]) {
      expect(t).toContain(rotulo);
    }
    expect(t).not.toContain("Reemplazar");
  });

  it("pedido generado: el paso 3, con alias y titular, y sin el pedido (no se vuelve a ver)", async () => {
    servidor.certificados = respuesta([VIGENTE(), PENDIENTE]);
    const marcado = await html("/[ambiente]/page", "produccion");
    expect(titulos(marcado, "h2")).toEqual(["Certificado"]);
    const t = texto(marcado);
    expect(t).toContain("Alias pedernalprod");
    expect(t).toContain("Titular 20-12345678-6");
    expect(t).toContain("Cargar certificado");
    expect(marcado).not.toContain("BEGIN CERTIFICATE REQUEST");
    // El certificado se carga contra el pedido del estado: ese id viaja a la pantalla, no uno del navegador.
    expect(marcado).toContain("<textarea");
  });

  it("vigente: el detalle con alias, titular, «Vence» y «Reemplazar»; sin cartel", async () => {
    servidor.certificados = respuesta([VIGENTE(), PENDIENTE]);
    const t = texto(await html("/[ambiente]/page", "pruebas"));
    expect(t).toContain("Alias pedernalprueba");
    expect(t).toContain("Titular 20-12345678-6");
    expect(t).toContain("Vence 12/10/2028");
    expect(t).toContain("Reemplazar");
    expect(t).not.toContain("Vencido");
  });

  it("vencido: «Vencido» y «Reemplazar»", async () => {
    servidor.certificados = respuesta([VIGENTE({ vencido: true })]);
    const t = texto(await html("/[ambiente]/page", "pruebas"));
    expect(t).toContain("Vencido");
    expect(t).toContain("Reemplazar");
  });

  it("una dirección que no es un ambiente es «no encontrado» y no pide nada al servidor", async () => {
    servidor.certificados = respuesta([]);
    await expect(html("/[ambiente]/page", "otro")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(servidor.pedidos).toEqual([]);
  });

  it("sin permiso: solo el texto del catálogo, sin pasos ni campos", async () => {
    servidor.certificados = { ok: false, error: errorDeCodigo("SIN_PERMISO") };
    const marcado = await html("/[ambiente]/page", "pruebas");
    expect(texto(marcado)).toContain("No tenés permiso para hacer esto.");
    expect(marcado).not.toContain("<form");
    expect(marcado).not.toContain("<textarea");
  });
});
