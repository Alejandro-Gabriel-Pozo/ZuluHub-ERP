import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, simularConexion, tocar } from "../../pruebas/ayudas";
import { BIEN, enPagina, modeloDe, servidorSimulado } from "./ayudas-de-pruebas";
import { PantallaDelCierre } from "./PantallaDelCierre.cliente";

/**
 * Lo que mueve el registro del día no se duplica ([01] §6.2 y §6.4), con la red como es: un reintento de red manda el MISMO pedido con la MISMA clave, un resultado inesperado devuelto como valor
 * no se da por hecho (pudo quedar registrado) y se reintenta igual, una respuesta definitiva termina el intento y el próximo toque es otro intento con otra clave, y sin conexión no se envía.
 * Las acciones del servidor van simuladas y, como el servidor de verdad, devuelven lo mismo ante la misma clave.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const servidor = servidorSimulado();
beforeEach(() => {
  router.refresh.mockReset();
  for (const accion of Object.values(servidor.acciones)) accion.mockReset().mockResolvedValue(BIEN);
});
afterEach(restaurarConexion);

const INESPERADO: Respuesta<unknown> = {
  ok: false,
  error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABCD-0123" },
};

const pantalla = () =>
  enPagina(<PantallaDelCierre modelo={modeloDe()} servidor={servidor.acciones} />);
const boton = (nombre: string) => page.getByRole("button", { name: nombre });
const alPaso3 = async () => {
  await boton("Conciliación por medio").click();
  await boton("Hay que reconocer").click();
};
const abrirLaCorreccion = async () => {
  await page
    .getByRole("listitem")
    .filter({ hasText: "$ 18.400,00" })
    .getByRole("button", { name: "Corregir medio" })
    .click();
  const dialogo = page.getByRole("dialog", { name: "Corregir medio" });
  await dialogo.getByLabelText("Motivo").fill("Era débito");
  return dialogo;
};

describe("cerrar el día (idempotente por su estado: no lleva clave)", () => {
  it("se corta la red: el reintento manda EXACTAMENTE el mismo pedido y, al fin, vuelve a leer el día una sola vez", async () => {
    servidor.cerrar.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(BIEN);
    await render(pantalla());
    await alPaso3();
    await boton("Cerrar el día").click();
    await expect.element(page.getByText("Verificando si se registró…")).toBeVisible();
    await vi.waitFor(() => expect(servidor.cerrar).toHaveBeenCalledTimes(2), { timeout: 10_000 });
    expect(servidor.cerrar.mock.calls[1]?.[0]).toEqual(servidor.cerrar.mock.calls[0]?.[0]);
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  });

  it("un resultado inesperado devuelto como valor no se da por hecho: muestra la referencia y reintenta con el mismo pedido", async () => {
    servidor.cerrar.mockResolvedValueOnce(INESPERADO).mockResolvedValue(BIEN);
    await render(pantalla());
    await alPaso3();
    await boton("Cerrar el día").click();
    await expect.element(page.getByText("PD-ABCD-0123", { exact: false })).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(servidor.cerrar).toHaveBeenCalledTimes(2), { timeout: 10_000 });
    expect(servidor.cerrar.mock.calls[1]?.[0]).toEqual(servidor.cerrar.mock.calls[0]?.[0]);
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("sin conexión no se envía: el botón se apaga y dice por qué; al volver la red se puede", async () => {
    await render(pantalla());
    await alPaso3();
    simularConexion(false);
    await expect.element(boton("Cerrar el día")).toBeDisabled();
    // Cada botón de envío dice por qué no se puede: el de cerrar y el de cancelar.
    await expect
      .element(page.getByText("No se puede enviar sin conexión.", { exact: false }).first())
      .toBeVisible();
    tocar(boton("Cerrar el día"));
    expect(servidor.cerrar).not.toHaveBeenCalled();
    simularConexion(true);
    await expect.element(boton("Cerrar el día")).toBeEnabled();
  });
});

describe("corregir el medio de un cobro (idempotente por clave)", () => {
  it("el doble toque es UNA corrección y manda una clave", async () => {
    await render(pantalla());
    const dialogo = await abrirLaCorreccion();
    const guardar = dialogo.getByRole("button", { name: "Guardar" });
    tocar(guardar);
    tocar(guardar);
    tocar(guardar);
    await vi.waitFor(() => expect(servidor.corregir).toHaveBeenCalledTimes(1));
    expect(servidor.corregir.mock.calls[0]?.[0]).toHaveProperty("claveDeIdempotencia");
  });

  it("se corta la red: el reintento manda la MISMA clave y el MISMO pedido (aunque se haya editado el motivo mientras tanto)", async () => {
    servidor.corregir
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(BIEN);
    await render(pantalla());
    const dialogo = await abrirLaCorreccion();
    await dialogo.getByRole("button", { name: "Guardar" }).click();
    await expect.element(page.getByText("Verificando si se registró…")).toBeVisible();
    await dialogo.getByLabelText("Motivo").fill("Otro motivo escrito después");
    await vi.waitFor(() => expect(servidor.corregir).toHaveBeenCalledTimes(2), { timeout: 10_000 });
    const [primero, segundo] = [
      servidor.corregir.mock.calls[0]?.[0],
      servidor.corregir.mock.calls[1]?.[0],
    ] as Record<string, unknown>[];
    expect(segundo).toEqual(primero);
    expect(primero?.["motivo"]).toBe("Era débito");
  });

  it("tras una respuesta definitiva el próximo toque es OTRO intento, con otra clave", async () => {
    servidor.corregir
      .mockResolvedValueOnce({ ok: false, error: errorDeCodigo("CIERRE_ACCION_NO_PERMITIDA") })
      .mockResolvedValue(BIEN);
    await render(pantalla());
    const dialogo = await abrirLaCorreccion();
    const guardar = dialogo.getByRole("button", { name: "Guardar" });
    await guardar.click();
    await expect.element(dialogo.getByText("Esta acción no está permitida")).toBeVisible();
    await guardar.click();
    await vi.waitFor(() => expect(servidor.corregir).toHaveBeenCalledTimes(2));
    const claves = servidor.corregir.mock.calls.map(
      (c) => (c[0] as Record<string, unknown>)["claveDeIdempotencia"],
    );
    expect(new Set(claves).size).toBe(2);
  });
});
