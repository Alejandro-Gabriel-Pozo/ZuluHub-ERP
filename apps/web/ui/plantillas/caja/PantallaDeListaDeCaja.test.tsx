import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import type { AccionesDeLista } from "./lista-de-caja";
import { armarLaListaDeCajas } from "./modelo-de-cajas";
import { armarLaListaDeMedios, type MedioDeLaLista } from "./modelo-de-medios-de-pago";
import { PantallaDeListaDeCaja } from "./PantallaDeListaDeCaja";

/** «Medios de pago» en Chromium (maqueta `medios.html`, 09/11/2026): las tarjetas, los botones apagados sin permiso y el doble toque. Las acciones del servidor van simuladas. */
const TODO: AccionesDeLista = { agregar: true, editar: true, desactivar: true, reactivar: true };
const NADA: AccionesDeLista = {
  agregar: false,
  editar: false,
  desactivar: false,
  reactivar: false,
};
const TEXTOS = {
  agregar: "Agregar medio",
  editar: "Editar",
  desactivar: "Desactivar",
  reactivar: "Reactivar",
};
const medio = (cambios: Partial<MedioDeLaLista>): MedioDeLaLista => ({
  id: "m1",
  tipo: "QR",
  nombre: null,
  activo: true,
  version: 1,
  ...cambios,
});
const MEDIOS = [
  medio({ id: "ef", tipo: "EFECTIVO" }),
  medio({ id: "qr", tipo: "QR", nombre: "Mercado Pago" }),
  medio({ id: "tr", tipo: "TRANSFERENCIA", activo: false }),
];

const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const pantalla = (
  acciones: AccionesDeLista,
  desactivar: AccionDeFormulario = ok,
  reactivar: AccionDeFormulario = ok,
) => (
  <PantallaDeListaDeCaja
    filas={armarLaListaDeMedios(MEDIOS)}
    acciones={acciones}
    textos={TEXTOS}
    hrefDeAgregar="/caja/medios-de-pago/nuevo"
    accionDe={() => ({ desactivar, reactivar })}
  />
);

describe("PantallaDeListaDeCaja", () => {
  it("muestra una tarjeta por medio, con su estado y su cuenta de cobro, y es accesible", async () => {
    await render(pantalla(TODO));
    await expect.element(page.getByText("Mercado Pago")).toBeVisible();
    await expect.element(page.getByText("QR · Cuenta de cobro: opcional")).toBeVisible();
    await expect.element(page.getByText("Cuenta de cobro: no lleva")).toBeVisible();
    await expect.element(page.getByText("Desactivado")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("una tarjeta sin línea de detalle (las cajas) no deja un hueco vacío", async () => {
    await render(
      <PantallaDeListaDeCaja
        filas={armarLaListaDeCajas([{ id: "k1", nombre: "Caja 1", activa: true, version: 1 }])}
        acciones={TODO}
        textos={TEXTOS}
        hrefDeAgregar="/caja/cajas/nuevo"
        accionDe={() => ({ desactivar: ok, reactivar: ok })}
      />,
    );
    await expect.element(page.getByText("Caja 1")).toBeVisible();
    expect(page.getByRole("listitem").elements()[0]?.textContent).toBe(
      "Caja 1ActivoEditarDesactivar",
    );
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Agregar medio» y «Editar» son enlaces a su pantalla", async () => {
    await render(pantalla(TODO));
    await expect
      .element(page.getByRole("link", { name: "Agregar medio" }))
      .toHaveAttribute("href", "/caja/medios-de-pago/nuevo");
    await expect
      .element(page.getByRole("link", { name: "Editar" }).first())
      .toHaveAttribute("href", "/caja/medios-de-pago/ef");
  });

  it("el efectivo no se desactiva: su botón sale apagado; el de un medio desactivado dice «Reactivar»", async () => {
    await render(pantalla(TODO));
    const desactivar = page.getByRole("button", { name: "Desactivar" });
    // Efectivo (apagado) y Mercado Pago (activo): uno apagado y uno disponible.
    await expect.element(desactivar.first()).toBeDisabled();
    await expect.element(desactivar.last()).toBeEnabled();
    await expect.element(page.getByRole("button", { name: "Reactivar" })).toBeEnabled();
  });

  it("sin permiso todos los botones salen apagados y no hay enlaces que lleven a una pantalla que va a rechazar", async () => {
    await render(pantalla(NADA));
    await expect.element(page.getByRole("link")).not.toBeInTheDocument();
    for (const nombre of ["Agregar medio", "Editar", "Desactivar", "Reactivar"]) {
      for (const boton of page.getByRole("button", { name: nombre }).elements()) {
        expect(boton).toBeDisabled();
      }
    }
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("desactivar: el segundo toque seguido no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const desactivar = vi.fn(async () => {
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(pantalla(TODO, desactivar));
    const boton = page.getByRole("button", { name: "Desactivar" }).last();
    tocar(boton);
    await expect.element(boton).toHaveAttribute("aria-busy", "true");
    tocar(boton);
    tocar(boton);
    await vi.waitFor(() => expect(desactivar).toHaveBeenCalledTimes(1));
    liberar();
    // Se espera a que termine el envío: una acción en vuelo no tiene que pasar al próximo caso.
    await expect.element(boton).not.toHaveAttribute("aria-busy", "true");
  });

  it("si la acción falla, el error sale debajo con el texto del catálogo", async () => {
    const rechazo: AccionDeFormulario = () =>
      Promise.resolve({
        error: {
          codigo: "CAJA_ACCION_NO_PERMITIDA",
          clave: "caja.error.accion_no_permitida",
          presentacion: "AVISO",
        },
      });
    await render(pantalla(TODO, rechazo));
    tocar(page.getByRole("button", { name: "Desactivar" }).last());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
  });
});
