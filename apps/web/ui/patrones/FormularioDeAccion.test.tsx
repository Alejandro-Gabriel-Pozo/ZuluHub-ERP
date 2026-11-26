import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { BotonDeEnvio } from "./BotonDeEnvio.cliente";
import { FormularioDeAccion, type AccionDeFormulario } from "./FormularioDeAccion.cliente";

/** Un formulario con acción del servidor: muestra el error de la acción, y mientras envía no se puede volver a tocar. */
const formulario = (accion: AccionDeFormulario) => (
  <FormularioDeAccion accion={accion}>
    <input type="hidden" name="empresaId" value="e1" />
    <BotonDeEnvio textoEnviando="Entrando…">Entrar a la empresa</BotonDeEnvio>
  </FormularioDeAccion>
);

describe("FormularioDeAccion y BotonDeEnvio", () => {
  it("manda los campos a la acción; mientras corre dice «Entrando…» y el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: { error: null }, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(formulario(accion as unknown as AccionDeFormulario));
    tocar(page.getByRole("button", { name: "Entrar a la empresa" }));
    await expect
      .element(page.getByRole("button", { name: "Entrando…" }))
      .toHaveAttribute("aria-busy", "true");
    tocar(page.getByRole("button", { name: "Entrando…" }));
    tocar(page.getByRole("button", { name: "Entrando…" }));
    liberar();
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect((accion.mock.calls[0]?.[1] as FormData).get("empresaId")).toBe("e1");
  });

  it("el error de la acción se muestra con el patrón que le toca (sin permiso -> «por qué no puedo»)", async () => {
    const accion: AccionDeFormulario = () =>
      Promise.resolve({
        error: {
          codigo: "SIN_PERMISO",
          clave: "motivo.sin_permiso",
          presentacion: "POR_QUE_NO_PUEDO",
        },
      });
    await render(formulario(accion));
    tocar(page.getByRole("button", { name: "Entrar a la empresa" }));
    await expect.element(page.getByText("No tenés permiso para hacer esto.")).toBeVisible();
    await expect.element(page.getByText("SIN_PERMISO")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un error inesperado lleva su referencia", async () => {
    const accion: AccionDeFormulario = () =>
      Promise.resolve({
        error: {
          codigo: "ERROR_INTERNO",
          clave: "error.inesperado",
          presentacion: "INESPERADO",
          referencia: "PD-1234-ABCD",
        },
      });
    await render(formulario(accion));
    tocar(page.getByRole("button", { name: "Entrar a la empresa" }));
    await expect.element(page.getByText("Referencia: PD-1234-ABCD")).toBeVisible();
    await expect.element(page.getByRole("alert")).toBeVisible();
  });

  /**
   * React 19 REINICIA el formulario al terminar la acción, un rato después de que el botón queda libre: dejaba las casillas y los campos controlados mostrando otra cosa que su estado y se
   * llevaba lo tipeado cuando la acción devolvía un error. `FormularioDeAccion` cancela el reinicio (`sinReiniciar`). Los campos que lo prueban (casillas, texto, selector) están en las pruebas
   * de cada pantalla (`Usuarios.test.tsx`, `Invitaciones.test.tsx`); acá, que el evento llega y queda cancelado, con éxito y con error.
   */
  const bien: AccionDeFormulario = () => Promise.resolve({ error: null });
  const mal: AccionDeFormulario = () =>
    Promise.resolve({
      error: { codigo: "ERROR_INTERNO", clave: "error.inesperado", presentacion: "INESPERADO" },
    });
  /** Espera el evento `reset` del formulario y dice si quedó cancelado (`defaultPrevented`, visto desde `document`, después de React). */
  async function conReinicio(correr: () => void): Promise<boolean> {
    let cancelado: boolean | null = null;
    const alReiniciar = (e: Event) => {
      cancelado = e.defaultPrevented;
    };
    document.addEventListener("reset", alReiniciar);
    try {
      correr();
      await vi.waitFor(() => expect(cancelado).not.toBeNull());
    } finally {
      document.removeEventListener("reset", alReiniciar);
    }
    return cancelado === true;
  }

  it("al terminar la acción el reinicio de React llega y queda cancelado (con éxito)", async () => {
    await render(formulario(bien as unknown as AccionDeFormulario));
    const cancelado = await conReinicio(() => {
      tocar(page.getByRole("button", { name: "Entrar a la empresa" }));
    });
    expect(cancelado).toBe(true);
  });

  it("también queda cancelado cuando la acción devuelve un error", async () => {
    await render(formulario(mal));
    const cancelado = await conReinicio(() => {
      tocar(page.getByRole("button", { name: "Entrar a la empresa" }));
    });
    expect(cancelado).toBe(true);
  });
});
