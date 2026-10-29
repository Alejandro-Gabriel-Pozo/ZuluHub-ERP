import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar } from "../../pruebas/ayudas";
import { FormularioDePuntoDeVenta } from "./FormularioDePuntoDeVenta.cliente";
import type { PuntoParaConfigurar } from "./modelo-de-puntos-de-venta";

/**
 * El texto de espera del formulario (respuesta del dueño, 2026-10-29): mientras guarda, en el alta y en la edición, el botón dice
 * «Guardando…» (con los tres puntos en un solo carácter). Previene: un botón que no dice qué pasa mientras espera la red.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const guardar = vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>();
const LISTA = "/configuracion-fiscal/puntos-de-venta";
const ORIGINAL: PuntoParaConfigurar = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  numero: 2,
  activo: true,
  ambiente: "HOMOLOGACION",
  sucursal: { id: "s-norte", nombre: "Sucursal Norte", activa: true },
  tieneDomicilio: true,
  hayNumerosUsados: false,
  version: 7,
};
const formulario = (original: PuntoParaConfigurar | null) => (
  <FormularioDePuntoDeVenta
    emisorId="2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d"
    original={original}
    sucursales={[{ valor: "s-norte", etiqueta: "Sucursal Norte" }]}
    guardar={guardar}
    rutaAlTerminar={LISTA}
    rutaAlCancelar={LISTA}
  />
);

beforeEach(() => {
  guardar.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});

describe("el texto de espera al guardar", () => {
  it.each([
    ["alta", null],
    ["edición", ORIGINAL],
  ] as const)("%s: mientras envía, el botón dice «Guardando…»", async (_nombre, original) => {
    let soltar: (r: Respuesta<unknown>) => void = () => undefined;
    guardar.mockReturnValue(
      new Promise<Respuesta<unknown>>((resolve) => {
        soltar = resolve;
      }),
    );
    await render(formulario(original));
    tocar(page.getByRole("button", { name: "Guardar" }));
    const enEspera = page.getByRole("button", { name: "Guardando…" });
    await expect.element(enEspera).toBeVisible();
    expect(enEspera.element().textContent).toBe("Guardando…");
    soltar({ ok: true, dato: { version: 1 } });
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
  });
});
