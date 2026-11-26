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

  const conCasilla = (accion: AccionDeFormulario, alReiniciar?: () => void) => (
    <FormularioDeAccion accion={accion} {...(alReiniciar === undefined ? {} : { alReiniciar })}>
      <BotonDeEnvio textoEnviando="Enviando…">Guardar</BotonDeEnvio>
    </FormularioDeAccion>
  );
  const bien: AccionDeFormulario = () => Promise.resolve({ error: null });
  const mal: AccionDeFormulario = () =>
    Promise.resolve({
      error: { codigo: "ERROR_INTERNO", clave: "error.inesperado", presentacion: "INESPERADO" },
    });

  it("al terminar la acción React reinicia el formulario y avisa por `alReiniciar` (con éxito)", async () => {
    const reinicios = vi.fn();
    await render(conCasilla(bien, reinicios));
    tocar(page.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(reinicios).toHaveBeenCalledTimes(1));
  });

  it("también avisa por `alReiniciar` cuando la acción devuelve un error", async () => {
    const reinicios = vi.fn();
    await render(conCasilla(mal, reinicios));
    tocar(page.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(reinicios).toHaveBeenCalledTimes(1));
  });

  it("sin `alReiniciar` el formulario se comporta como siempre (nada se llama)", async () => {
    const reinicios = vi.fn();
    document.addEventListener("reset", reinicios, true);
    try {
      await render(conCasilla(bien));
      tocar(page.getByRole("button", { name: "Guardar" }));
      // El reinicio de React sí ocurre (se ve el evento del navegador); solo que nadie lo atiende.
      await vi.waitFor(() => expect(reinicios).toHaveBeenCalledTimes(1));
    } finally {
      document.removeEventListener("reset", reinicios, true);
    }
  });
});
