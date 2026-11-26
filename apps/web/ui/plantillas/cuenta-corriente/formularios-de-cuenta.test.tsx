import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeCondicionesDeCuenta } from "./FormularioDeCondicionesDeCuenta.cliente";
import { FormularioDeHabilitarCuenta } from "./FormularioDeHabilitarCuenta.cliente";
import { FormularioDeReactivarCuenta } from "./FormularioDeReactivarCuenta.cliente";
import { FormularioDeSuspenderCuenta } from "./FormularioDeSuspenderCuenta.cliente";

/**
 * Los formularios de escritura de la cuenta corriente (CC-5, A2) en Chromium: habilitar (elegir cliente, aviso del que no tiene CUIT y botón apagado), cambiar plazo y límite, suspender y reactivar con su
 * motivo. Cada uno: apagado sin permiso o con un dato vacío, el doble toque manda UN solo envío, manda lo que corresponde a la acción y el error del servidor sale anunciado. Las reglas (válido, versión,
 * cliente con CUIT) las decide el servidor: acá solo se ve qué se ofrece y qué se manda.
 */
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const accionLenta = () => {
  let liberar: () => void = () => undefined;
  const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
    void datos;
    await new Promise<void>((r) => {
      liberar = r;
    });
    return { error: null };
  });
  return { accion, liberar: () => liberar() };
};
const enviado = (accion: { mock: { calls: unknown[][] } }): FormData =>
  accion.mock.calls[0]?.[1] as FormData;

const CLIENTES = [
  {
    parteId: "c1",
    etiqueta: "Turismo Andino S. A. · 30-68901234-5",
    nombre: "Turismo Andino S. A.",
    tieneCuit: true,
  },
  {
    parteId: "c2",
    etiqueta: "Kiosco Sin Papeles · —",
    nombre: "Kiosco Sin Papeles",
    tieneCuit: false,
  },
];
const TEXTOS_DE_HABILITAR = {
  cliente: "Cliente",
  elegirCliente: "Elegí un cliente…",
  razonSocial: "Razón social",
  plazo: "Plazo",
  limite: "Límite de crédito (ARS)",
  faltaElCuit: "Falta el CUIT:",
  faltaElCuitDetalle: "este cliente no tiene CUIT cargado.",
  habilitar: "Habilitar",
  cancelar: "Cancelar",
};
const habilitar = (accion: AccionDeFormulario = ok, puedeGuardar = true) => (
  <FormularioDeHabilitarCuenta
    accion={accion}
    textos={TEXTOS_DE_HABILITAR}
    clientes={CLIENTES}
    digitosDelPlazo={3}
    hrefDeCancelar="/caja/cuenta-corriente"
    puedeGuardar={puedeGuardar}
  />
);

describe("FormularioDeHabilitarCuenta", () => {
  it("ofrece a los clientes con su CUIT, muestra la razón social del elegido y es accesible", async () => {
    await render(habilitar());
    await expect.element(page.getByLabelText("Cliente")).toBeVisible();
    await userEvent.selectOptions(page.getByLabelText("Cliente"), "c1");
    await expect.element(page.getByText("Razón social")).toBeVisible();
    await expect.element(page.getByText("Turismo Andino S. A.", { exact: true })).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Habilitar» sale apagado hasta elegir cliente y cargar plazo y límite", async () => {
    await render(habilitar());
    const boton = page.getByRole("button", { name: "Habilitar" });
    await expect.element(boton).toBeDisabled();
    await userEvent.selectOptions(page.getByLabelText("Cliente"), "c1");
    await expect.element(boton).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Plazo"), "60");
    await expect.element(boton).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Límite de crédito (ARS)"), "1500,5");
    await expect.element(boton).toBeEnabled();
  });

  it("un cliente sin CUIT se puede elegir: avisa por qué y «Habilitar» queda apagado aunque el resto esté completo", async () => {
    await render(habilitar());
    await userEvent.selectOptions(page.getByLabelText("Cliente"), "c2");
    await userEvent.fill(page.getByLabelText("Plazo"), "30");
    await userEvent.fill(page.getByLabelText("Límite de crédito (ARS)"), "100");
    await expect.element(page.getByText("Falta el CUIT:")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Habilitar" })).toBeDisabled();
    await userEvent.selectOptions(page.getByLabelText("Cliente"), "c1");
    expect(page.getByText("Falta el CUIT:").elements()).toHaveLength(0);
    await expect.element(page.getByRole("button", { name: "Habilitar" })).toBeEnabled();
  });

  it("sin permiso sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(habilitar(accion, false));
    await userEvent.selectOptions(page.getByLabelText("Cliente"), "c1");
    await userEvent.fill(page.getByLabelText("Plazo"), "30");
    await userEvent.fill(page.getByLabelText("Límite de crédito (ARS)"), "100");
    const boton = page.getByRole("button", { name: "Habilitar" });
    await expect.element(boton).toBeDisabled();
    tocar(boton);
    expect(accion).not.toHaveBeenCalled();
  });

  it("manda el cliente, el plazo y el límite como texto exacto, y el doble toque dispara una sola vez", async () => {
    const { accion, liberar } = accionLenta();
    await render(habilitar(accion));
    await userEvent.selectOptions(page.getByLabelText("Cliente"), "c1");
    await userEvent.fill(page.getByLabelText("Plazo"), "60");
    await userEvent.fill(page.getByLabelText("Límite de crédito (ARS)"), "1500,5");
    const boton = page.getByRole("button", { name: "Habilitar" });
    tocar(boton);
    await expect.element(boton).toHaveAttribute("aria-busy", "true");
    tocar(boton);
    tocar(boton);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(boton).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
    const datos = enviado(accion);
    expect(datos.get("parteId")).toBe("c1");
    expect(datos.get("plazoDias")).toBe("60");
    expect(datos.get("limite")).toBe("1500.50");
  });

  it("el error del servidor sale anunciado y «Cancelar» es un enlace al listado que no envía", async () => {
    const rechazo: AccionDeFormulario = () =>
      Promise.resolve({
        error: {
          codigo: "CLIENTES_ACCION_NO_PERMITIDA",
          clave: "clientes.error.sin_permiso",
          presentacion: "AVISO",
        } as never,
      });
    await render(habilitar(rechazo));
    await userEvent.selectOptions(page.getByLabelText("Cliente"), "c1");
    await userEvent.fill(page.getByLabelText("Plazo"), "30");
    await userEvent.fill(page.getByLabelText("Límite de crédito (ARS)"), "100");
    tocar(page.getByRole("button", { name: "Habilitar" }));
    await expect.element(page.getByRole("alert")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", "/caja/cuenta-corriente");
  });
});

describe("FormularioDeCondicionesDeCuenta", () => {
  const condiciones = (accion: AccionDeFormulario = ok, puedeGuardar = true) => (
    <FormularioDeCondicionesDeCuenta
      accion={accion}
      textos={{
        plazo: "Plazo",
        limite: "Límite de crédito (ARS)",
        guardar: "Guardar",
        cancelar: "Cancelar",
      }}
      actual={{ plazoDias: 45, limite: "5000.00" }}
      digitosDelPlazo={3}
      hrefDeCancelar="/caja/cuenta-corriente/c1"
      puedeGuardar={puedeGuardar}
    />
  );

  it("viene con el plazo y el límite que hoy tiene la ficha, y es accesible", async () => {
    await render(condiciones());
    await expect.element(page.getByLabelText("Plazo")).toHaveValue("45");
    await expect.element(page.getByLabelText("Límite de crédito (ARS)")).toHaveValue("5.000,00");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("manda lo editado como texto exacto; «Guardar» se apaga si se vacía un dato o falta el permiso", async () => {
    const accion = vi.fn(ok);
    await render(condiciones(accion));
    const guardar = page.getByRole("button", { name: "Guardar" });
    await userEvent.fill(page.getByLabelText("Plazo"), "");
    await expect.element(guardar).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Plazo"), "90");
    await userEvent.fill(page.getByLabelText("Límite de crédito (ARS)"), "7000,25");
    tocar(guardar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(enviado(accion).get("plazoDias")).toBe("90");
    expect(enviado(accion).get("limite")).toBe("7000.25");
  });

  it("sin permiso sale apagado y «Cancelar» vuelve a la ficha", async () => {
    const accion = vi.fn(ok);
    await render(condiciones(accion, false));
    const guardar = page.getByRole("button", { name: "Guardar" });
    await expect.element(guardar).toBeDisabled();
    tocar(guardar);
    expect(accion).not.toHaveBeenCalled();
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", "/caja/cuenta-corriente/c1");
  });

  it("el doble toque manda un solo envío", async () => {
    const { accion, liberar } = accionLenta();
    await render(condiciones(accion));
    const guardar = page.getByRole("button", { name: "Guardar" });
    tocar(guardar);
    await expect.element(guardar).toHaveAttribute("aria-busy", "true");
    tocar(guardar);
    tocar(guardar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });
});

describe.each([
  {
    nombre: "FormularioDeSuspenderCuenta",
    motivo: "Motivo de la suspensión (obligatorio)",
    boton: "Suspender cuenta",
    formulario: (accion: AccionDeFormulario, puedeGuardar: boolean) => (
      <FormularioDeSuspenderCuenta
        accion={accion}
        textos={{ motivo: "Motivo de la suspensión (obligatorio)", suspender: "Suspender cuenta" }}
        puedeGuardar={puedeGuardar}
      />
    ),
  },
  {
    nombre: "FormularioDeReactivarCuenta",
    motivo: "Motivo de la reactivación (obligatorio)",
    boton: "Reactivar cuenta",
    formulario: (accion: AccionDeFormulario, puedeGuardar: boolean) => (
      <FormularioDeReactivarCuenta
        accion={accion}
        textos={{
          motivo: "Motivo de la reactivación (obligatorio)",
          reactivar: "Reactivar cuenta",
        }}
        puedeGuardar={puedeGuardar}
      />
    ),
  },
])("$nombre", ({ motivo, boton, formulario }) => {
  it("el botón sale apagado sin motivo (o solo con espacios) y se enciende al escribirlo; es accesible", async () => {
    await render(formulario(ok, true));
    const b = page.getByRole("button", { name: boton });
    await expect.element(b).toBeDisabled();
    await userEvent.fill(page.getByLabelText(motivo), "   ");
    await expect.element(b).toBeDisabled();
    await userEvent.fill(page.getByLabelText(motivo), "Pago atrasado");
    await expect.element(b).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin permiso sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario(accion, false));
    await userEvent.fill(page.getByLabelText(motivo), "Pago atrasado");
    const b = page.getByRole("button", { name: boton });
    await expect.element(b).toBeDisabled();
    tocar(b);
    expect(accion).not.toHaveBeenCalled();
  });

  it("manda el motivo y el doble toque dispara una sola vez", async () => {
    const { accion, liberar } = accionLenta();
    await render(formulario(accion, true));
    await userEvent.fill(page.getByLabelText(motivo), "Pago atrasado");
    const b = page.getByRole("button", { name: boton });
    tocar(b);
    await expect.element(b).toHaveAttribute("aria-busy", "true");
    tocar(b);
    tocar(b);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(b).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
    expect(enviado(accion).get("motivo")).toBe("Pago atrasado");
  });

  it("el error del servidor sale anunciado", async () => {
    const rechazo: AccionDeFormulario = () =>
      Promise.resolve({
        error: {
          codigo: "CLIENTES_ACCION_NO_PERMITIDA",
          clave: "clientes.error.sin_permiso",
          presentacion: "AVISO",
        } as never,
      });
    await render(formulario(rechazo, true));
    await userEvent.fill(page.getByLabelText(motivo), "x");
    tocar(page.getByRole("button", { name: boton }));
    await expect.element(page.getByRole("alert")).toBeVisible();
  });
});
