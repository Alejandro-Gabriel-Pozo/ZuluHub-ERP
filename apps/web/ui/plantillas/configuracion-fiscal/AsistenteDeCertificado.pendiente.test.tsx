import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { enArmazon } from "./ayudas-de-pruebas";
import { AsistenteDeCertificado } from "./AsistenteDeCertificado.cliente";
import type { ArranqueDelAmbiente } from "./modelo-de-certificado";

/**
 * D-94: desde el detalle del certificado vigente, con una renovación en curso, «Cargar certificado» lleva al paso 3 contra ESE pedido.
 * Sin renovación en curso el botón no está. Las acciones van simuladas.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const cargar = vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>();
const RENOVACION_ID = "5c1e7d90-1a2b-4c3d-9e8f-0a1b2c3d4e5f";
const PEM_PEGADO =
  "-----BEGIN CERTIFICATE-----\nTEXTODEPRUEBADELCERTIFICADO\n-----END CERTIFICATE-----";

const detalle = (conPendiente: boolean): ArranqueDelAmbiente => ({
  vista: "detalle",
  aliasInicial: "pedernalprueba",
  datos: [
    { rotulo: "Alias", valor: "pedernalprueba" },
    { rotulo: "Titular", valor: "20-12345678-6" },
    { rotulo: "Vence", valor: "12/10/2028" },
  ],
  cartel: null,
  pedidoPendiente: conPendiente
    ? {
        certificadoId: RENOVACION_ID,
        datos: [
          { rotulo: "Alias", valor: "renovacion" },
          { rotulo: "Titular", valor: "20-12345678-6" },
        ],
      }
    : null,
});

const asistente = (arranque: ArranqueDelAmbiente) =>
  enArmazon(
    "Pruebas",
    <AsistenteDeCertificado
      emisorId="2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d"
      ambiente="HOMOLOGACION"
      arranque={arranque}
      generar={vi.fn()}
      cargar={cargar}
      rutaALaLista="/configuracion-fiscal/certificado-de-arca"
    />,
  );
const boton = (nombre: string) => page.getByRole("button", { name: nombre });

beforeEach(() => {
  cargar.mockReset();
  router.push.mockReset();
});
afterEach(() => {
  restaurarConexion();
});

describe("el vigente con una renovación en curso", () => {
  it("muestra «Cargar certificado» junto a «Reemplazar», accesible", async () => {
    await render(asistente(detalle(true)));
    await expect.element(boton("Cargar certificado")).toBeVisible();
    await expect.element(boton("Reemplazar")).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("lleva al paso 3 y carga el certificado contra el pedido pendiente, no contra el vigente", async () => {
    cargar.mockResolvedValue({ ok: true, dato: { venceEn: "2029-10-12T00:00:00.000Z" } });
    await render(asistente(detalle(true)));
    tocar(boton("Cargar certificado"));
    await expect.element(page.getByRole("heading", { name: "Certificado" })).toBeVisible();
    await expect.element(page.getByText("renovacion")).toBeVisible();
    await page.getByRole("textbox", { name: "Certificado" }).fill(PEM_PEGADO);
    tocar(boton("Cargar certificado"));
    await vi.waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/configuracion-fiscal/certificado-de-arca"),
    );
    expect(cargar).toHaveBeenCalledTimes(1);
    expect(cargar.mock.calls[0]?.[0]).toEqual({
      certificadoId: RENOVACION_ID,
      certificadoPem: PEM_PEGADO,
    });
  });

  it("sin renovación en curso no hay «Cargar certificado»", async () => {
    await render(asistente(detalle(false)));
    await expect.element(boton("Reemplazar")).toBeVisible();
    expect(boton("Cargar certificado").elements()).toHaveLength(0);
  });
});
