import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { leerCamposDeLaPagina } from "../../patrones/borrador-de-pagina";
import { restaurarConexion, tocar } from "../../pruebas/ayudas";
import { PasoCargarCertificado } from "./PasoCargarCertificado.cliente";

/**
 * El paso 3 (pegar el certificado) en Chromium, dos cosas que el asistente entero no cubre:
 *  - El certificado pegado NO entra al borrador de la página (lo que `ProveedorDeSesion` guarda en `sessionStorage` al vencer la sesión):
 *    el campo no tiene `name`. Falla si se le vuelve a poner.
 *  - Red cortada: el envío queda «incierto», se reintenta con el MISMO pedido y el certificado se carga una sola vez.
 */
const cargar = vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>();
const alTerminar = vi.fn();
const alCancelar = vi.fn();

const PEDIDO_ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const PEM_PEGADO =
  "-----BEGIN CERTIFICATE-----\nTEXTODEPRUEBADELCERTIFICADO\n-----END CERTIFICATE-----";
const CARGADO: Respuesta<unknown> = {
  ok: true,
  dato: { venceEn: "2028-10-12T00:00:00.000Z", yaEstaba: false },
};

const paso = () => (
  <main>
    <h2 id="titulo-del-paso">Certificado</h2>
    <PasoCargarCertificado
      certificadoId={PEDIDO_ID}
      cargar={cargar}
      alTerminar={alTerminar}
      alCancelar={alCancelar}
      idDelTitulo="titulo-del-paso"
    />
  </main>
);
const campo = () => page.getByRole("textbox", { name: "Certificado" });
const botonCargar = () => page.getByRole("button", { name: "Cargar certificado" });

beforeEach(() => {
  cargar.mockReset();
  alTerminar.mockReset();
  alCancelar.mockReset();
});
afterEach(() => {
  restaurarConexion();
});

describe("el paso 3: el certificado pegado no se guarda", () => {
  it("lo pegado no entra al borrador de la página ni lleva un `name` que lo mande en la URL", async () => {
    const { container } = await render(paso());
    await campo().fill(PEM_PEGADO);
    expect(container.querySelector("textarea")?.value).toBe(PEM_PEGADO);
    expect(container.querySelector("textarea")?.hasAttribute("name")).toBe(false);
    expect(Object.values(leerCamposDeLaPagina(container)).join("\n")).not.toContain(
      "TEXTODEPRUEBADELCERTIFICADO",
    );
    expect(leerCamposDeLaPagina(container)).toEqual({});
  });
});

describe("el paso 3: red cortada", () => {
  it("un envío que lanza queda incierto, se reintenta con el MISMO pedido y el certificado se carga una sola vez", async () => {
    cargar.mockRejectedValueOnce(new Error("red cortada")).mockResolvedValue(CARGADO);
    await render(paso());
    await campo().fill(PEM_PEGADO);
    tocar(botonCargar());
    await vi.waitFor(() => expect(alTerminar).toHaveBeenCalledTimes(1), { timeout: 8000 });
    expect(cargar).toHaveBeenCalledTimes(2);
    expect(cargar.mock.calls[1]?.[0]).toEqual(cargar.mock.calls[0]?.[0]);
    expect(cargar.mock.calls[0]?.[0]).toEqual({
      certificadoId: PEDIDO_ID,
      certificadoPem: PEM_PEGADO,
    });
  });
});
