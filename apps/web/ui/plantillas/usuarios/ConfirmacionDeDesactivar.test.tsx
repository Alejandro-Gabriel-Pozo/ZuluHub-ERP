import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { ConfirmacionDeDesactivar } from "./ConfirmacionDeDesactivar.cliente";
import { armarLaFichaDeUsuario, type DesactivarArmado } from "./modelo-de-usuarios";

/**
 * «Desactivar» de la ficha (tramo U3, parte A) en Chromium real: el botón abre un cuadro que pide confirmar («¿Desactivar a …?», «Se corta su acceso ahora.»), con «Cancelar» y «Desactivar»; el foco inicial va al
 * título (nunca al botón que desactiva), Escape cierra y el foco vuelve a quien lo abrió; sin violaciones graves de accesibilidad; mientras envía no se cierra y un doble toque es UN envío; un rechazo del
 * servidor sale como el genérico y el cuadro queda abierto para reintentar o cancelar. Previene: desactivar a alguien (corta el acceso al instante) con un toque de más, y un doble envío.
 */
const persona = {
  personaId: "0b0b0b0b-1111-4222-8333-444444444441",
  email: "ana@lacteos.test",
  rol: "OPERADOR",
  activo: true,
} as const;
const textos = armarLaFichaDeUsuario(
  persona,
  {},
  { personaId: "otra", puedeDesactivar: true, puedeReactivar: false },
).desactivar as DesactivarArmado;

type Resultado = Readonly<{
  error: null | { codigo: string; clave: string; presentacion: string };
}>;
const GENERICO = {
  error: {
    codigo: "USUARIOS_NO_PERMITIDO",
    clave: "usuarios.error.accion_no_permitida",
    presentacion: "ERROR_GENERICO",
  },
} as const;
const montar = (accion: () => Promise<Resultado>) =>
  render(
    <ConfirmacionDeDesactivar
      accion={accion as unknown as Parameters<typeof ConfirmacionDeDesactivar>[0]["accion"]}
      textos={textos}
    />,
  );
const abierto = () => document.querySelector("dialog")?.open ?? false;

describe("ConfirmacionDeDesactivar", () => {
  it("antes de tocar no hay cuadro; al tocar «Desactivar» pide confirmar, con el foco en el título y sin violaciones graves", async () => {
    await montar(() => Promise.resolve({ error: null }));
    expect(abierto()).toBe(false);
    await userEvent.click(page.getByRole("button", { name: "Desactivar" }));
    await expect
      .element(page.getByRole("heading", { name: "¿Desactivar a ana@lacteos.test?" }))
      .toBeVisible();
    await expect.element(page.getByText("Se corta su acceso ahora.")).toBeVisible();
    expect(document.activeElement).toBe(
      page.getByRole("heading", { name: "¿Desactivar a ana@lacteos.test?" }).element(),
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("«Cancelar» cierra sin enviar nada y el foco vuelve al botón que lo abrió; Escape también", async () => {
    const accion = vi.fn(() => Promise.resolve({ error: null }));
    await montar(accion);
    const abrir = page.getByRole("button", { name: "Desactivar" });
    await userEvent.click(abrir);
    await userEvent.click(page.getByRole("button", { name: "Cancelar" }));
    await vi.waitFor(() => expect(abierto()).toBe(false));
    expect(document.activeElement).toBe(abrir.element());

    await userEvent.click(abrir);
    await vi.waitFor(() => expect(abierto()).toBe(true));
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(abierto()).toBe(false));
    expect(accion).not.toHaveBeenCalled();
  });

  it("el orden de los botones es «Cancelar» y después «Desactivar» (como en la maqueta)", async () => {
    await montar(() => Promise.resolve({ error: null }));
    await userEvent.click(page.getByRole("button", { name: "Desactivar" }));
    const dialogo = document.querySelector("dialog") as HTMLDialogElement;
    const nombres = [...dialogo.querySelectorAll("form button")].map((b) => b.textContent);
    expect(nombres).toEqual(["Cancelar", "Desactivar"]);
  });

  it("confirmar con un doble toque manda UN solo envío; mientras corre dice «Enviando…» y el cuadro no se cierra con Escape", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(
      () =>
        new Promise<Resultado>((resolver) => {
          liberar = () => resolver({ error: null });
        }),
    );
    await montar(accion);
    await userEvent.click(page.getByRole("button", { name: "Desactivar" }));
    const dialogo = document.querySelector("dialog") as HTMLDialogElement;
    const confirmar = dialogo.querySelector('button[type="submit"]') as HTMLButtonElement;
    await userEvent.dblClick(confirmar);
    await expect
      .element(page.getByRole("button", { name: "Enviando…" }))
      .toHaveAttribute("aria-busy", "true");
    await userEvent.keyboard("{Escape}");
    expect(abierto()).toBe(true);
    expect(page.getByRole("button", { name: "Cancelar" }).element()).toHaveProperty(
      "disabled",
      true,
    );
    liberar();
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
  });

  it("un rechazo del servidor sale como el genérico dentro del cuadro, que sigue abierto para cancelar o reintentar", async () => {
    await montar(() => Promise.resolve(GENERICO));
    await userEvent.click(page.getByRole("button", { name: "Desactivar" }));
    const dialogo = document.querySelector("dialog") as HTMLDialogElement;
    await userEvent.click(dialogo.querySelector('button[type="submit"]') as HTMLButtonElement);
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(abierto()).toBe(true);
    await expect.element(page.getByRole("button", { name: "Cancelar" })).toBeEnabled();
  });
});
