import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { base } from "../utilidades/detalle-de-comprobante";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página del detalle de un comprobante: valida la forma del id ANTES de preguntar, llama a la lectura del servidor
 * solo con ese id (la empresa y el permiso los decide el servidor) y pinta cada error con su texto, sin el código crudo.
 */
vi.mock("server-only", () => ({}));
// La barra y el botón «Anular con nota de crédito» piden los permisos de la persona (`permisosDelActor`). Por defecto ve «Comprobantes»
// pero no puede anular (el filtro de la barra se prueba en `modulos-de-la-barra.test.ts`).
const permisos = vi.hoisted(
  (): { acciones: string[]; activos: string[]; enSoloLectura: string[] } => ({
    acciones: [],
    activos: [],
    enSoloLectura: [],
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () =>
        Promise.resolve({
          ok: true,
          valor: {
            acciones: permisos.acciones,
            modulos: { activos: permisos.activos, enSoloLectura: permisos.enSoloLectura },
          },
        }),
    }),
  },
}));
const lectura = vi.hoisted((): { llamadas: unknown[]; respuesta: unknown } => ({
  llamadas: [],
  respuesta: null,
}));
vi.mock("../../apps/web/servidor/facturacion", () => ({
  verElComprobante: (entrada: unknown) => {
    lectura.llamadas.push(entrada);
    return Promise.resolve(lectura.respuesta);
  },
}));
// La guarda real (`pantallaDeOperacion`) y el armazón real: solo se simula lo externo, la sesión, la puerta y la empresa.
vi.mock("../../apps/web/servidor/sesion", () => ({
  empresaDelPedido: () =>
    Promise.resolve({
      puerta: { marca: { nombre: "Marca de prueba" } },
      entrada: {
        ok: true,
        dato: {
          tipo: "ENTRA",
          empresa: { nombre: "Empresa de prueba" },
          contexto: {},
        },
      },
    }),
}));

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";

// Con ruta en una variable: el `tsc` de la raíz (sin DOM) no sigue la página hasta los componentes de cliente.
const cargar = (
  ruta: string,
): Promise<{ default: (p: { params: Promise<{ id: string }> }) => Promise<unknown> }> =>
  import(/* @vite-ignore */ ruta);

async function html(id: string): Promise<string> {
  const { default: Pagina } = await cargar(
    "../../apps/web/app/s/app/(operacion)/facturacion/comprobantes/[id]/page",
  );
  const arbol = await Pagina({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(arbol as ReactNode);
}

const titulos = (marcado: string): string[] =>
  [...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1] as string);

const pagina = async (id: string): Promise<string> => (await html(id)).replace(/<[^>]+>/g, " ");

const respuesta = (r: Respuesta<unknown>): void => {
  lectura.respuesta = r;
};

describe("la página del detalle de un comprobante", () => {
  beforeEach(() => {
    lectura.llamadas = [];
    permisos.acciones = ["comprobantes.ver"];
    permisos.activos = ["facturacion"];
    permisos.enSoloLectura = [];
  });

  it("con un comprobante, lo lee por su id y lo pinta", async () => {
    respuesta({ ok: true, dato: base });
    const texto = await pagina(ID);
    expect(lectura.llamadas).toEqual([{ comprobanteId: ID }]);
    expect(texto).toContain("Factura B 00001-00001234");
  });

  it("la barra marca «Comprobantes» como el destino actual (el detalle es del módulo)", async () => {
    respuesta({ ok: true, dato: base });
    expect(await html(ID)).toMatch(
      /<a[^>]*href="\/facturacion\/comprobantes"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/facturacion\/comprobantes"/,
    );
  });

  it("con un comprobante hay UN solo h1, con el título real", async () => {
    respuesta({ ok: true, dato: base });
    const marcado = await html(ID);
    expect(titulos(marcado)).toEqual(["Factura B 00001-00001234"]);
  });

  it("sin comprobante (id inválido o error) el único h1 es el genérico «Comprobante»", async () => {
    respuesta({ ok: false, error: errorDeCodigo("FISCAL_COMPROBANTE_NO_ENCONTRADO") });
    for (const id of ["no-es-un-id", ID]) expect(titulos(await html(id))).toEqual(["Comprobante"]);
  });

  it.each(["no-es-un-id", "0B9F6A1E-2C3D-4E5F-8A7B-9C0D1E2F3A4B", `${ID}x`, "1; drop table"])(
    "un id con otra forma («%s») es «no encontrado» y no llega al servidor",
    async (id) => {
      const texto = await pagina(id);
      expect(texto).toContain("No encontramos ese comprobante.");
      expect(lectura.llamadas).toEqual([]);
    },
  );

  it.each([
    ["FISCAL_COMPROBANTE_NO_ENCONTRADO", "No encontramos ese comprobante."],
    ["SIN_PERMISO", "No tiene permiso para hacer esto."],
    ["MODULO_EN_DESARROLLO", "Esta función todavía está en desarrollo."],
    ["SESION_VENCIDA", "Tu sesión venció"],
  ] as const)("el error %s se ve con su texto y sin el código", async (codigo, esperado) => {
    respuesta({ ok: false, error: errorDeCodigo(codigo) });
    const texto = await pagina(ID);
    expect(texto).toContain(esperado);
    expect(texto).not.toContain(codigo);
  });

  it("un error inesperado muestra la referencia y nada técnico", async () => {
    respuesta({
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    });
    const texto = await pagina(ID);
    expect(texto).toContain("PD-ABC123");
    expect(texto).not.toContain("ERROR_INTERNO");
  });
});

describe("la página del detalle: el botón «Anular con nota de crédito»", () => {
  const BOTON = "Anular con nota de crédito";
  const MOTIVO = "Solo se anula una factura o una nota de débito Autorizada.";
  /** Apagado: el botón existe, no lleva al enlace, y su motivo está a la vista y asociado (`aria-describedby`). */
  const expectApagado = (marcado: string): void => {
    expect(marcado).toContain(BOTON);
    expect(marcado).toContain(MOTIVO);
    expect(marcado).not.toContain("/anular");
    expect(marcado).toMatch(/<button[^>]*disabled[^>]*aria-describedby="[^"]+"/);
  };
  const poder = (cambios: Partial<typeof permisos> = {}) => {
    permisos.acciones = ["comprobantes.ver", "notas_de_credito.emitir"];
    permisos.activos = ["facturacion"];
    permisos.enSoloLectura = [];
    Object.assign(permisos, cambios);
  };

  // El fixture del detalle no trae `id` (la pantalla no lo usa); el botón sí: lleva a `/…/{id}/anular`.
  const conId = { ...base, id: ID };
  beforeEach(() => {
    lectura.llamadas = [];
    respuesta({ ok: true, dato: conId });
  });

  it("con la acción de emitir notas de crédito y la factura Autorizada: aparece y lleva a la pantalla de anular", async () => {
    poder();
    const marcado = await html(ID);
    expect(marcado).toContain(BOTON);
    expect(marcado).toContain(`href="/facturacion/comprobantes/${ID}/anular"`);
  });

  it("una nota de débito Autorizada también se anula (D-70): aparece y lleva a la pantalla de anular", async () => {
    poder();
    respuesta({
      ok: true,
      dato: { ...conId, tipo: "NOTA_DEBITO_B", acreditado: null, acreditacion: null },
    });
    const marcado = await html(ID);
    expect(marcado).toContain(BOTON);
    expect(marcado).toContain(`href="/facturacion/comprobantes/${ID}/anular"`);
  });

  it("una nota de débito que no está Autorizada: el botón aparece APAGADO, con su motivo", async () => {
    poder();
    respuesta({ ok: true, dato: { ...conId, tipo: "NOTA_DEBITO_B", estado: "RECHAZADO" } });
    expectApagado(await html(ID));
  });

  it("sin la acción de emitir notas de crédito (solo puede ver): no aparece", async () => {
    poder({ acciones: ["comprobantes.ver"] });
    expect(await html(ID)).not.toContain(BOTON);
  });

  it("con otra acción de emitir (la factura manual) pero no la de notas de crédito: no aparece", async () => {
    poder({ acciones: ["comprobantes.ver", "comprobantes.emitir_manual"] });
    expect(await html(ID)).not.toContain(BOTON);
  });

  it("con el módulo en solo lectura y la acción: SÍ aparece (el servidor la permite; dueño, 2026-10-29)", async () => {
    poder({ activos: [], enSoloLectura: ["facturacion"] });
    expect(await html(ID)).toContain(`href="/facturacion/comprobantes/${ID}/anular"`);
  });

  it.each([
    "PENDIENTE",
    "EN_VALIDACION",
    "RECHAZADO",
    "INCIERTO",
    "CONFLICTO",
    "DESCARTADO",
  ] as const)(
    "una factura %s no se anula: el botón aparece APAGADO, con su motivo",
    async (estado) => {
      poder();
      respuesta({ ok: true, dato: { ...conId, estado } });
      expectApagado(await html(ID));
    },
  );

  it("apagado y sin la acción de emitir notas de crédito: no aparece", async () => {
    poder({ acciones: ["comprobantes.ver"] });
    respuesta({ ok: true, dato: { ...conId, estado: "RECHAZADO" } });
    expect(await html(ID)).not.toContain(BOTON);
  });

  it.each(["NOTA_CREDITO_A", "NOTA_CREDITO_B", "NOTA_CREDITO_C"] as const)(
    "una nota de crédito (%s) no se anula: no aparece",
    async (tipo) => {
      poder();
      respuesta({ ok: true, dato: { ...conId, tipo, acreditado: null, acreditacion: null } });
      expect(await html(ID)).not.toContain(BOTON);
    },
  );
});
