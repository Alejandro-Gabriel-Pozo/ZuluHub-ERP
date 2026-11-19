import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import {
  CAJA_ABIERTA,
  CAJA_CERRADA,
  GENERICO,
  PERMISOS_NINGUNO,
  PERMISOS_TODOS,
  accionesDelServidor,
} from "./ayudas-de-pruebas";
import type { AccionesDeLaPantallaDeCaja } from "./lista-de-caja";
import type { CajaDeLaPantalla } from "./modelo-de-la-caja";
import { PantallaDeCaja } from "./PantallaDeCaja";

/**
 * La pantalla «Caja» del mostrador en Chromium (maqueta `caja.html`), tramo de apertura: caja cerrada con «Abrir caja», caja abierta con la cabecera «Jornada … · Corte …» y el efectivo esperado,
 * el botón apagado sin permiso y el error del servidor como texto genérico. Las acciones van simuladas; el servidor decide de verdad.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});

const pantalla = (
  caja: CajaDeLaPantalla,
  opciones: Partial<{
    permisos: AccionesDeLaPantallaDeCaja;
    acciones: ReturnType<typeof accionesDelServidor>["acciones"];
  }> = {},
) => (
  <PantallaDeCaja
    cajas={[caja]}
    permisos={opciones.permisos ?? PERMISOS_TODOS}
    acciones={opciones.acciones ?? accionesDelServidor().acciones}
  />
);

describe("caja cerrada", () => {
  it("muestra la caja, «Cerrada» y «Abrir caja»; es accesible", async () => {
    await render(pantalla(CAJA_CERRADA));
    await expect.element(page.getByRole("heading", { name: "Caja 1", level: 2 })).toBeVisible();
    await expect.element(page.getByText("Cerrada")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Abrir caja" })).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin permiso «Abrir caja» sale apagado", async () => {
    await render(pantalla(CAJA_CERRADA, { permisos: PERMISOS_NINGUNO }));
    await expect.element(page.getByRole("button", { name: "Abrir caja" })).toBeDisabled();
  });

  it("«Abrir caja» abre el formulario del fondo inicial y «Cancelar» vuelve", async () => {
    await render(pantalla(CAJA_CERRADA));
    await userEvent.click(page.getByRole("button", { name: "Abrir caja" }));
    await expect.element(page.getByRole("heading", { name: "Abrir caja" })).toBeVisible();
    await expect.element(page.getByLabelText("Fondo inicial")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await userEvent.click(page.getByRole("button", { name: "Cancelar" }));
    await expect.element(page.getByRole("heading", { name: "Caja 1" })).toBeVisible();
  });

  it("abrir manda el fondo y el id de SU caja con una clave; el doble toque es un solo envío y recarga", async () => {
    const { acciones, mocks } = accionesDelServidor();
    let liberar: () => void = () => undefined;
    mocks.abrir.mockImplementation(
      () =>
        new Promise((resolver) => {
          liberar = () => {
            resolver({ ok: true, dato: {} });
          };
        }),
    );
    await render(pantalla(CAJA_CERRADA, { acciones }));
    await userEvent.click(page.getByRole("button", { name: "Abrir caja" }));
    await userEvent.fill(page.getByLabelText("Fondo inicial"), "15000");
    const abrir = page.getByRole("button", { name: "Abrir caja" });
    tocar(abrir);
    tocar(abrir);
    tocar(abrir);
    await vi.waitFor(() => {
      expect(mocks.abrir).toHaveBeenCalledTimes(1);
    });
    const pedido = mocks.abrir.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(pedido).toEqual({
      claveDeIdempotencia: expect.any(String) as string,
      cajaId: "caja-1",
      fondoInicial: "15000.00",
    });
    expect(router.refresh).not.toHaveBeenCalled();
    liberar();
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
    expect(mocks.abrir).toHaveBeenCalledTimes(1);
  });

  it("si la respuesta no llega, reintenta con la MISMA clave y el mismo pedido", async () => {
    const { acciones, mocks } = accionesDelServidor();
    mocks.abrir.mockRejectedValueOnce(new Error("red cortada"));
    await render(pantalla(CAJA_CERRADA, { acciones }));
    await userEvent.click(page.getByRole("button", { name: "Abrir caja" }));
    await userEvent.fill(page.getByLabelText("Fondo inicial"), "100");
    tocar(page.getByRole("button", { name: "Abrir caja" }));
    await expect.element(page.getByText("Verificando si se registró…").first()).toBeVisible();
    await vi.waitFor(
      () => {
        expect(mocks.abrir).toHaveBeenCalledTimes(2);
      },
      { timeout: 6000 },
    );
    expect(mocks.abrir.mock.calls[1]?.[0]).toEqual(mocks.abrir.mock.calls[0]?.[0]);
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("el rechazo del servidor sale como el texto genérico y se puede volver a intentar con otra clave", async () => {
    const { acciones, mocks } = accionesDelServidor();
    mocks.abrir.mockResolvedValueOnce(GENERICO);
    await render(pantalla(CAJA_CERRADA, { acciones }));
    await userEvent.click(page.getByRole("button", { name: "Abrir caja" }));
    await userEvent.fill(page.getByLabelText("Fondo inicial"), "100");
    tocar(page.getByRole("button", { name: "Abrir caja" }));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    tocar(page.getByRole("button", { name: "Abrir caja" }));
    await vi.waitFor(() => {
      expect(mocks.abrir).toHaveBeenCalledTimes(2);
    });
    const [primero, segundo] = mocks.abrir.mock.calls.map(
      (c) => c[0] as { claveDeIdempotencia: string },
    );
    expect(segundo?.claveDeIdempotencia).not.toBe(primero?.claveDeIdempotencia);
  });

  it("el fondo vacío no envía", async () => {
    const { acciones, mocks } = accionesDelServidor();
    await render(pantalla(CAJA_CERRADA, { acciones }));
    await userEvent.click(page.getByRole("button", { name: "Abrir caja" }));
    await expect.element(page.getByRole("button", { name: "Abrir caja" })).toBeDisabled();
    tocar(page.getByRole("button", { name: "Abrir caja" }));
    expect(mocks.abrir).not.toHaveBeenCalled();
  });
});

describe("caja abierta", () => {
  it("la cabecera dice «Jornada 09/11/2026 · Corte 06:00» y el efectivo esperado; no ofrece abrir; es accesible", async () => {
    await render(pantalla(CAJA_ABIERTA));
    await expect.element(page.getByText("Abierta")).toBeVisible();
    await expect.element(page.getByText("Jornada 09/11/2026 · Corte 06:00")).toBeVisible();
    await expect.element(page.getByText("Efectivo: $ 50.900,00")).toBeVisible();
    expect(page.getByRole("button", { name: "Abrir caja" }).elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
