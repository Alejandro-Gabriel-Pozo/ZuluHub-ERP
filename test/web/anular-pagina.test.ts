import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { factura, ID_FACTURA } from "../utilidades/anulacion";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página de anular `/facturacion/comprobantes/[id]/anular`, renderizada en el servidor: valida la forma del id ANTES de preguntar,
 * solo ofrece la pantalla a quien tiene la acción de emitir notas de crédito con el módulo activo, lee la factura por su id (la
 * empresa y el permiso de lectura los decide el servidor) y solo deja anular una factura o una nota de débito Autorizada (D-70). Cada error se ve con su texto y sin
 * el código crudo.
 */
vi.mock("server-only", () => ({}));

const mundo = vi.hoisted(
  (): {
    permisos: unknown;
    respuesta: unknown;
    lecturas: unknown[];
  } => ({ permisos: null, respuesta: null, lecturas: [] }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({ permisosDelActor: () => Promise.resolve(mundo.permisos) }),
  },
}));
vi.mock("../../apps/web/servidor/facturacion", () => ({
  verElComprobante: (entrada: unknown) => {
    mundo.lecturas.push(entrada);
    return Promise.resolve(mundo.respuesta);
  },
}));
vi.mock("../../apps/web/app/s/app/acciones-de-facturacion", () => ({
  emitirNotaDeCreditoAccion: () => Promise.reject(new Error("la página no emite nada")),
}));
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

const cargar = (
  ruta: string,
): Promise<{ default: (p: { params: Promise<{ id: string }> }) => Promise<unknown> }> =>
  import(/* @vite-ignore */ ruta);

async function html(id: string): Promise<string> {
  const { default: Pagina } = await cargar(
    "../../apps/web/app/s/app/(operacion)/facturacion/comprobantes/[id]/anular/page",
  );
  return renderToStaticMarkup((await Pagina({ params: Promise.resolve({ id }) })) as ReactNode);
}
const pagina = async (id: string): Promise<string> =>
  (await html(id)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const titulos = (marcado: string): string[] =>
  [...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1] as string);

const permisos = (p: { acciones?: string[]; activos?: string[]; enSoloLectura?: string[] }) => {
  mundo.permisos = ok({
    acciones: p.acciones ?? ["comprobantes.ver", "notas_de_credito.emitir"],
    modulos: { activos: p.activos ?? ["facturacion"], enSoloLectura: p.enSoloLectura ?? [] },
  });
};
const lectura = (r: Respuesta<unknown>) => {
  mundo.respuesta = r;
};

beforeEach(() => {
  mundo.lecturas = [];
  permisos({});
  lectura({ ok: true, dato: factura });
});

describe("la página de anular", () => {
  it("con permiso, módulo activo y una factura Autorizada: la lee por su id y muestra el paso 1 con el total por defecto", async () => {
    const texto = await pagina(ID_FACTURA);
    expect(mundo.lecturas).toEqual([{ comprobanteId: ID_FACTURA }]);
    for (const esperado of [
      "Factura B 00001-00000123 · Juan Pérez",
      "Qué anular",
      "Motivo y revisar",
      "Se anula el total",
      "Total de la factura",
      "$ 90.750,00",
      "Anular solo una parte",
      "Cancelar",
      "Siguiente",
    ]) {
      expect(texto).toContain(esperado);
    }
  });

  it("hay UN solo h1, «Anular comprobante», y «Comprobantes» queda marcado en la barra", async () => {
    const marcado = await html(ID_FACTURA);
    expect(titulos(marcado)).toEqual(["Anular comprobante"]);
    expect(marcado).toMatch(
      /<a[^>]*href="\/facturacion\/comprobantes"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/facturacion\/comprobantes"/,
    );
  });

  it("«Cancelar» vuelve al detalle de la factura", async () => {
    expect(await html(ID_FACTURA)).toContain(`href="/facturacion/comprobantes/${ID_FACTURA}"`);
  });

  it.each([
    "no-es-un-id",
    "0B9F6A1E-2C3D-4E5F-8A7B-9C0D1E2F3A4B",
    `${ID_FACTURA}x`,
    "1; drop table",
  ])("un id con otra forma («%s») es «no encontrado» y no llega al servidor", async (id) => {
    expect(await pagina(id)).toContain("No encontramos ese comprobante.");
    expect(mundo.lecturas).toEqual([]);
  });

  it("la pantalla arranca en «Se anula el total», sin ningún campo de importe todavía", async () => {
    const marcado = await html(ID_FACTURA);
    expect(marcado).toContain("Se anula el total");
    expect(marcado).not.toContain("Importe a anular");
    expect(marcado).not.toContain("Cantidad");
  });

  it("una factura que no existe (o es de otra sucursal u otra empresa) es «no encontrado», sin el código", async () => {
    lectura({ ok: false, error: errorDeCodigo("FISCAL_COMPROBANTE_NO_ENCONTRADO") });
    const texto = await pagina(ID_FACTURA);
    expect(texto).toContain("No encontramos ese comprobante.");
    expect(texto).not.toContain("FISCAL_COMPROBANTE_NO_ENCONTRADO");
    expect(texto).not.toContain("Siguiente");
  });
});

describe("la página de anular: quién la ve", () => {
  it("sin la acción de emitir notas de crédito: «No tiene permiso», sin leer la factura y sin ofrecer nada", async () => {
    permisos({ acciones: ["comprobantes.ver", "comprobantes.emitir_manual"] });
    const texto = await pagina(ID_FACTURA);
    expect(texto).toContain("No tiene permiso para hacer esto.");
    expect(texto).not.toContain("Siguiente");
    expect(texto).not.toContain("SIN_PERMISO");
    expect(mundo.lecturas).toEqual([]);
  });

  it("con el módulo de facturación apagado: no se ofrece", async () => {
    permisos({ activos: ["administracion"] });
    const texto = await pagina(ID_FACTURA);
    expect(texto).toContain("Esta función no está activada para la empresa.");
    expect(texto).not.toContain("Siguiente");
    expect(mundo.lecturas).toEqual([]);
  });

  it("SUPUESTO: con el módulo en solo lectura tampoco se ofrece (el texto del motivo apagado, D-59, no está aprobado)", async () => {
    permisos({ activos: [], enSoloLectura: ["facturacion"] });
    const texto = await pagina(ID_FACTURA);
    expect(texto).toContain("quedó en solo lectura");
    expect(texto).not.toContain("Siguiente");
  });

  it("si no se pudieron leer los permisos: no se ofrece (cierra, no abre)", async () => {
    mundo.permisos = err({ codigo: "SIN_PERMISO" });
    expect(await pagina(ID_FACTURA)).not.toContain("Siguiente");
    expect(mundo.lecturas).toEqual([]);
  });
});

describe("la página de anular: qué se puede anular", () => {
  it.each([
    "PENDIENTE",
    "EN_VALIDACION",
    "RECHAZADO",
    "INCIERTO",
    "CONFLICTO",
    "DESCARTADO",
  ] as const)("una factura %s no se anula: solo una autorizada por ARCA", async (estado) => {
    lectura({ ok: true, dato: { ...factura, estado } });
    const texto = await pagina(ID_FACTURA);
    expect(texto).toContain("Solo se puede corregir un comprobante que ARCA ya autorizó.");
    expect(texto).not.toContain("Siguiente");
  });

  it("una nota de débito Autorizada sí se anula (D-70): ofrece el paso 1 con su nombre", async () => {
    lectura({ ok: true, dato: { ...factura, tipo: "NOTA_DEBITO_B", numero: "00001-00000200" } });
    const texto = await pagina(ID_FACTURA);
    expect(texto).toContain("Nota de débito B 00001-00000200 · Juan Pérez");
    expect(texto).toContain("Siguiente");
  });

  it("una nota de débito que no está Autorizada no se anula", async () => {
    lectura({ ok: true, dato: { ...factura, tipo: "NOTA_DEBITO_B", estado: "RECHAZADO" } });
    const texto = await pagina(ID_FACTURA);
    expect(texto).toContain("Solo se puede corregir un comprobante que ARCA ya autorizó.");
    expect(texto).not.toContain("Siguiente");
  });

  it("una nota de crédito no se anula con otra nota", async () => {
    lectura({ ok: true, dato: { ...factura, tipo: "NOTA_CREDITO_B" } });
    const texto = await pagina(ID_FACTURA);
    expect(texto).toContain("No se puede emitir una nota sobre una nota de crédito.");
    expect(texto).not.toContain("Siguiente");
  });

  it.each([
    ["SESION_VENCIDA", "Tu sesión venció"],
    ["SIN_PERMISO", "No tiene permiso para hacer esto."],
  ] as const)(
    "el error de lectura %s se ve con su texto y sin el código",
    async (codigo, esperado) => {
      lectura({ ok: false, error: errorDeCodigo(codigo) });
      const texto = await pagina(ID_FACTURA);
      expect(texto).toContain(esperado);
      expect(texto).not.toContain(codigo);
    },
  );

  it("un error inesperado muestra la referencia y nada técnico", async () => {
    lectura({ ok: false, error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" } });
    const texto = await pagina(ID_FACTURA);
    expect(texto).toContain("PD-ABC123");
    expect(texto).not.toContain("ERROR_INTERNO");
  });
});
