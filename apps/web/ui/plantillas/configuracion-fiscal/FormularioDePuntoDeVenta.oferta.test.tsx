import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PERMITIDO, enArmazon, ventana } from "./ayudas-de-pruebas";
import { FormularioDePuntoDeVenta } from "./FormularioDePuntoDeVenta.cliente";
import type { OfertaDeAccion } from "./modelo-de-puntos-de-venta";

/**
 * Del formulario de un punto de venta, lo que no es de los datos sino de cómo se usa (PR #122): «Guardar» apagado cuando el servidor no
 * deja guardar (con su motivo), la opción vacía de la provincia con nombre para el lector de pantalla, el foco al enviar con Enter y
 * «Cancelar» durante el envío (sin `disabled`, para no perder el foco). La acción del servidor va simulada.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const guardar = vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>();
const LISTA = "/configuracion-fiscal/puntos-de-venta";
const SIN_PERMISO = "No tiene permiso para hacer esto.";

const formulario = (oferta: OfertaDeAccion = PERMITIDO) => (
  <FormularioDePuntoDeVenta
    emisorId="2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d"
    original={null}
    sucursales={[{ valor: "s-norte", etiqueta: "Sucursal Norte" }]}
    guardar={guardar}
    rutaAlTerminar={LISTA}
    rutaAlCancelar={LISTA}
    oferta={oferta}
  />
);

beforeEach(() => {
  guardar.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});

describe("«Guardar» según lo que el servidor deja hacer", () => {
  it("apagado con su motivo a la vista y asociado; ni tocarlo ni Enter en un campo envían nada", async () => {
    await ventana(390);
    await render(
      enArmazon("Agregar punto de venta", formulario({ permitida: false, motivo: SIN_PERMISO })),
    );
    const guardarBoton = page.getByRole("button", { name: "Guardar" });
    await expect.element(guardarBoton).toBeDisabled();
    await expect.element(page.getByText(SIN_PERMISO)).toBeVisible();
    const descripcion = guardarBoton.element().getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(descripcion)?.textContent).toBe(SIN_PERMISO);
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    tocar(guardarBoton);
    await page.getByLabelText("Calle").fill("Av. Rivadavia");
    await userEvent.keyboard("{Enter}");
    expect(guardar).not.toHaveBeenCalled();
  });

  it("con permiso queda activo y envía", async () => {
    guardar.mockResolvedValue({ ok: true, dato: { version: 1 } });
    await render(formulario());
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeEnabled();
    tocar(page.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(1));
  });
});

describe("accesibilidad del formulario", () => {
  it("la opción vacía de la provincia tiene nombre («Provincia»), el mismo del campo", async () => {
    await render(formulario());
    const opciones = (page.getByLabelText("Provincia").element() as HTMLSelectElement).options;
    expect(opciones[0]?.value).toBe("");
    expect(opciones[0]?.textContent).toBe("Provincia");
  });

  it("Enter en un campo envía y el foco se queda dentro del formulario (no cae al <body> al apagarse los campos)", async () => {
    let soltar: (r: Respuesta<unknown>) => void = () => undefined;
    guardar.mockReturnValue(
      new Promise<Respuesta<unknown>>((resolve) => {
        soltar = resolve;
      }),
    );
    await render(formulario());
    await page.getByLabelText("Número de punto de venta").fill("4");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(1));
    const enviando = page.getByRole("button", { name: "Guardando…" });
    await expect.element(enviando).toBeVisible();
    // Los campos quedaron apagados (`disabled`): el foco no puede quedar en uno de ellos ni caer al <body>.
    await expect.element(page.getByLabelText("Número de punto de venta")).toBeDisabled();
    expect(document.activeElement).toBe(enviando.element());
    soltar({ ok: true, dato: { version: 1 } });
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
  });

  it("mientras guarda, «Cancelar» no se puede usar pero no está `disabled` (conserva el foco): el toque se ignora", async () => {
    let soltar: (r: Respuesta<unknown>) => void = () => undefined;
    guardar.mockReturnValue(
      new Promise<Respuesta<unknown>>((resolve) => {
        soltar = resolve;
      }),
    );
    await render(formulario());
    tocar(page.getByRole("button", { name: "Guardar" }));
    await expect.element(page.getByRole("button", { name: "Guardando…" })).toBeVisible();
    const cancelar = page.getByRole("button", { name: "Cancelar" });
    expect(cancelar.element().getAttribute("aria-disabled")).toBe("true");
    expect((cancelar.element() as HTMLButtonElement).disabled).toBe(false);
    (cancelar.element() as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(cancelar.element());
    tocar(cancelar);
    expect(router.push).not.toHaveBeenCalledWith(LISTA);
    soltar({ ok: true, dato: { version: 1 } });
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
  });

  it("sin envío en curso «Cancelar» vuelve a la lista", async () => {
    await render(formulario());
    const cancelar = page.getByRole("button", { name: "Cancelar" });
    expect(cancelar.element().getAttribute("aria-disabled")).toBeNull();
    tocar(cancelar);
    expect(router.push).toHaveBeenCalledWith(LISTA);
  });
});
