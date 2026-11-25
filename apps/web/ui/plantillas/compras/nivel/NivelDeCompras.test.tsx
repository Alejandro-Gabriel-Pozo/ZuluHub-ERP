import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import { FormularioDeNivelDeCompras } from "./FormularioDeNivelDeCompras.cliente";
import type { TextosDeNivelDeCompras } from "./modelo-de-nivel-de-compras";
import type { ResultadoDeGuardarElNivel } from "./resultado-de-nivel";

/**
 * «Nivel de compras» (Compras PR 11) en un navegador real: el selector con «Sin factura» y «Con factura» (los de la fase 5 no se ofrecen), «Guardar» apagado sin cambios, lo que viaja a la acción (el nivel, con la
 * versión que se vio), el doble toque (un solo envío), el nivel que quedó tras un rechazo por versión y el error genérico. Sin violaciones de accesibilidad (axe).
 */
const textos: TextosDeNivelDeCompras = {
  titulo: "Nivel de compras",
  guardar: "Guardar",
  niveles: { COMPRA_SIMPLE: "Sin factura", CON_COMPROBANTE: "Con factura" },
};
const inicial = {
  nivel: "COMPRA_SIMPLE",
  version: 1,
  niveles: ["COMPRA_SIMPLE", "CON_COMPROBANTE", "RECEPCION_SEPARADA", "TRES_VIAS"],
};
type Accion = (
  version: number,
  previo: ResultadoDeGuardarElNivel,
  datos: FormData,
) => Promise<ResultadoDeGuardarElNivel>;
const GENERICO = {
  codigo: "COMPRAS_ACCION_NO_PERMITIDA",
  clave: "compras.error.sin_permiso",
  presentacion: "AVISO",
} as never;

describe("FormularioDeNivelDeCompras", () => {
  it("ofrece solo «Sin factura» y «Con factura», con el vigente elegido y «Guardar» apagado; sin violaciones de accesibilidad", async () => {
    await render(
      <FormularioDeNivelDeCompras
        inicial={inicial}
        accion={() => Promise.resolve({ estado: "INICIAL" })}
        textos={textos}
      />,
    );
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    const selector = page.getByLabelText("Nivel de compras");
    await expect.element(selector).toHaveValue("COMPRA_SIMPLE");
    expect([...selector.element().querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Sin factura",
      "Con factura",
    ]);
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("al elegir otro nivel se enciende «Guardar»; manda el nivel con la versión que se vio y, al guardar, sigue con lo que devolvió el servidor", async () => {
    const accion = vi.fn<Accion>(() =>
      Promise.resolve({ estado: "HECHO", nivel: "CON_COMPROBANTE", version: 2 }),
    );
    await render(<FormularioDeNivelDeCompras inicial={inicial} accion={accion} textos={textos} />);
    await userEvent.selectOptions(page.getByLabelText("Nivel de compras"), "CON_COMPROBANTE");
    const guardar = page.getByRole("button", { name: "Guardar" });
    await expect.element(guardar).toBeEnabled();
    tocar(guardar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(accion.mock.calls[0]?.[0]).toBe(1);
    expect((accion.mock.calls[0]?.[2] as FormData).get("nivel")).toBe("CON_COMPROBANTE");
    await expect.element(guardar).toBeDisabled();
    // Tras guardar el selector sigue en lo que quedó vigente (el envío reinicia el formulario del navegador, no debe verse «Sin factura»).
    await expect.element(page.getByLabelText("Nivel de compras")).toHaveValue("CON_COMPROBANTE");
    // La siguiente vez lleva la versión que devolvió el servidor.
    await userEvent.selectOptions(page.getByLabelText("Nivel de compras"), "COMPRA_SIMPLE");
    tocar(guardar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2));
    expect(accion.mock.calls[1]?.[0]).toBe(2);
  });

  it("doble toque en «Guardar» = un solo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn<Accion>(async () => {
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { estado: "HECHO", nivel: "CON_COMPROBANTE", version: 2 };
    });
    await render(<FormularioDeNivelDeCompras inicial={inicial} accion={accion} textos={textos} />);
    await userEvent.selectOptions(page.getByLabelText("Nivel de compras"), "CON_COMPROBANTE");
    const guardar = page.getByRole("button", { name: "Guardar" });
    tocar(guardar);
    await expect.element(guardar).toHaveAttribute("aria-busy", "true");
    tocar(guardar);
    tocar(guardar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar).toBeDisabled();
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("si otra persona lo cambió antes: el genérico y el selector pasa al nivel que quedó", async () => {
    const accion = vi.fn<Accion>(() =>
      Promise.resolve({
        estado: "ERROR",
        error: GENERICO,
        vigente: { nivel: "CON_COMPROBANTE", version: 2 },
      }),
    );
    await render(<FormularioDeNivelDeCompras inicial={inicial} accion={accion} textos={textos} />);
    await userEvent.selectOptions(page.getByLabelText("Nivel de compras"), "CON_COMPROBANTE");
    await userEvent.click(page.getByRole("button", { name: "Guardar" }));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(page.getByLabelText("Nivel de compras")).toHaveValue("CON_COMPROBANTE");
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });
});
