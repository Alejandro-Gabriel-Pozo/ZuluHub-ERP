import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { SelectorDeSucursal } from "./SelectorDeSucursal.cliente";

/**
 * La sucursal con la que se trabaja en ESTE dispositivo: una preferencia local por empresa, que solo vale si
 * sigue entre las disponibles. Si el almacenamiento falla, la pantalla anda igual.
 */
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const dos = [
  { id: "s1", nombre: "Casa central" },
  { id: "s2", nombre: "Sucursal Norte" },
] as const;

describe("SelectorDeSucursal", () => {
  it("sin sucursales no se muestra; con una, es solo un dato; con varias, un selector nativo", async () => {
    const { container, rerender } = await render(
      <SelectorDeSucursal empresaId="e1" sucursales={[]} />,
    );
    expect(container.textContent).toBe("");
    await rerender(<SelectorDeSucursal empresaId="e1" sucursales={[dos[0]]} />);
    await expect.element(page.getByText("Sucursal: Casa central")).toBeVisible();
    expect(page.getByRole("combobox").query()).toBeNull();
    await rerender(<SelectorDeSucursal empresaId="e1" sucursales={dos} />);
    await expect.element(page.getByRole("combobox", { name: "Sucursal" })).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("con varias y nada guardado pide elegir; al elegir se recuerda en el dispositivo, por empresa", async () => {
    await render(<SelectorDeSucursal empresaId="e1" sucursales={dos} />);
    const selector = page.getByRole("combobox", { name: "Sucursal" });
    await expect.element(selector).toHaveValue("");
    await expect
      .element(page.getByRole("option", { name: "Elegí una sucursal" }))
      .toBeInTheDocument();
    await userEvent.selectOptions(selector, "s2");
    await expect.element(selector).toHaveValue("s2");
    expect(localStorage.getItem("pd:sucursal:e1")).toBe("s2");
    expect(localStorage.getItem("pd:sucursal:e2")).toBeNull();
    await expect.element(page.getByText("Elegí una sucursal")).not.toBeInTheDocument();
  });

  it("lo recordado se usa al volver; si esa sucursal ya no está, no se usa", async () => {
    localStorage.setItem("pd:sucursal:e1", "s2");
    const { unmount } = await render(<SelectorDeSucursal empresaId="e1" sucursales={dos} />);
    await expect.element(page.getByRole("combobox", { name: "Sucursal" })).toHaveValue("s2");
    await unmount();
    localStorage.setItem("pd:sucursal:e1", "s-desactivada");
    await render(<SelectorDeSucursal empresaId="e1" sucursales={dos} />);
    await expect.element(page.getByRole("combobox", { name: "Sucursal" })).toHaveValue("");
  });

  it("otra empresa en el mismo dispositivo no arrastra la sucursal de la primera", async () => {
    localStorage.setItem("pd:sucursal:e1", "s2");
    await render(<SelectorDeSucursal empresaId="e2" sucursales={dos} />);
    await expect.element(page.getByRole("combobox", { name: "Sucursal" })).toHaveValue("");
  });

  it("sin almacenamiento (ventana privada, sitio bloqueado) la pantalla anda y simplemente no recuerda", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    await render(<SelectorDeSucursal empresaId="e1" sucursales={dos} />);
    const selector = page.getByRole("combobox", { name: "Sucursal" });
    await expect.element(selector).toHaveValue("");
    await userEvent.selectOptions(selector, "s1");
    await expect.element(selector).toBeVisible();
  });
});
