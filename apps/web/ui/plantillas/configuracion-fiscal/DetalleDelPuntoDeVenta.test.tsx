import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { enArmazon, legibleYTocable, ventana } from "./ayudas-de-pruebas";
import { DetalleDelPuntoDeVenta } from "./DetalleDelPuntoDeVenta.cliente";
import { armarElPuntoDeVenta, type PuntoParaConfigurar } from "./modelo-de-puntos-de-venta";

/**
 * La pantalla de un punto de venta en Chromium: activar y desactivar (idempotentes), y el cambio de ambiente con su ventana de
 * confirmación (D-48): accesible, con el foco atrapado, que se cierra con Escape y devuelve el foco al botón que la abrió. Las acciones
 * del servidor van simuladas.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

type Accion = (pedido: unknown) => Promise<Respuesta<unknown>>;
const activar = vi.fn<Accion>();
const desactivar = vi.fn<Accion>();
const cambiarAmbiente = vi.fn<Accion>();

const BIEN: Respuesta<unknown> = { ok: true, dato: { yaEstaba: false } };
const INESPERADO: Respuesta<unknown> = {
  ok: false,
  error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABCD-0123" },
};

const PUNTO: PuntoParaConfigurar = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  numero: 2,
  activo: true,
  ambiente: "HOMOLOGACION",
  sucursal: { id: "s-norte", nombre: "Sucursal Norte", activa: true },
  tieneDomicilio: true,
  hayNumerosUsados: false,
  version: 7,
};

const pantalla = (cambios: Partial<PuntoParaConfigurar> = {}) => {
  const punto = { ...PUNTO, ...cambios };
  return (
    <DetalleDelPuntoDeVenta
      armado={armarElPuntoDeVenta(punto)}
      punto={{ id: punto.id, activo: punto.activo, version: punto.version }}
      activar={activar}
      desactivar={desactivar}
      cambiarAmbiente={cambiarAmbiente}
      rutaDeEdicion={`/configuracion-fiscal/puntos-de-venta/${punto.id}?editar=1`}
    />
  );
};

beforeEach(() => {
  for (const f of [activar, desactivar, cambiarAmbiente, router.push, router.refresh])
    f.mockReset();
});
afterEach(async () => {
  await page.viewport(390, 844);
});

const pasarAProduccion = () => page.getByRole("button", { name: "Pasar a producción" }).first();
const dialogo = () => page.getByRole("dialog", { name: "¿Pasar a producción?" });
const enLaVentana = (nombre: string) => dialogo().getByRole("button", { name: nombre });
function puerta() {
  let soltar: (r: Respuesta<unknown>) => void = () => undefined;
  const espera = new Promise<Respuesta<unknown>>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}

describe("un punto de venta: accesibilidad y medidas", () => {
  it.each([390, 1280])(
    "a %i px: sin violaciones como página, legible y tocable, sin desborde lateral",
    async (ancho) => {
      await ventana(ancho);
      await render(enArmazon("Punto de venta 00002", pantalla()));
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
      await expect.element(page.getByText("Sucursal Norte")).toBeVisible();
      await expect.element(page.getByText("Activo", { exact: true })).toBeVisible();
      await expect.element(page.getByText("Pruebas", { exact: true })).toBeVisible();
    },
  );

  it("en producción ya no se ofrece pasar a producción", async () => {
    await render(pantalla({ ambiente: "PRODUCCION" }));
    await expect.element(page.getByText("Producción", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("Pasar a producción");
  });

  it("«Editar» lleva a la edición del mismo punto de venta", async () => {
    await render(pantalla());
    tocar(page.getByRole("button", { name: "Editar" }));
    expect(router.push).toHaveBeenCalledWith(
      `/configuracion-fiscal/puntos-de-venta/${PUNTO.id}?editar=1`,
    );
  });
});

describe("activar y desactivar", () => {
  it("«Desactivar» manda solo el id; el doble toque es un solo envío; al terminar recarga la pantalla", async () => {
    const abierta = puerta();
    desactivar.mockReturnValue(abierta.espera);
    await render(pantalla());
    const boton = page.getByRole("button", { name: "Desactivar" });
    tocar(boton);
    tocar(boton);
    tocar(boton);
    abierta.soltar(BIEN);
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(desactivar).toHaveBeenCalledTimes(1);
    expect(desactivar).toHaveBeenCalledWith({ puntoDeVentaId: PUNTO.id });
    expect(activar).not.toHaveBeenCalled();
  });

  it("«Activar» (en uno no activo) manda solo el id a su acción", async () => {
    activar.mockResolvedValue(BIEN);
    await render(pantalla({ activo: false }));
    await expect.element(page.getByText("No activo", { exact: true })).toBeVisible();
    tocar(page.getByRole("button", { name: "Activar" }));
    await vi.waitFor(() => expect(activar).toHaveBeenCalledTimes(1));
    expect(activar).toHaveBeenCalledWith({ puntoDeVentaId: PUNTO.id });
    expect(desactivar).not.toHaveBeenCalled();
  });

  it("sin domicilio: «Para activarlo, cargá un domicilio.» y no recarga", async () => {
    activar.mockResolvedValue({
      ok: false,
      error: { ...errorDeCodigo("FISCAL_PUNTO_DE_VENTA_SIN_DOMICILIO"), campo: "domicilio" },
    });
    await render(pantalla({ activo: false, tieneDomicilio: false }));
    tocar(page.getByRole("button", { name: "Activar" }));
    await expect.element(page.getByText("Para activarlo, cargá un domicilio.")).toBeVisible();
    expect(document.body.textContent).not.toContain("FISCAL_PUNTO_DE_VENTA_SIN_DOMICILIO");
    expect(router.refresh).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });

  it("la red se corta: reintenta el MISMO pedido y el botón queda bloqueado mientras verifica", async () => {
    const segunda = puerta();
    desactivar
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(segunda.espera);
    await render(pantalla());
    tocar(page.getByRole("button", { name: "Desactivar" }));
    await vi.waitFor(() => expect(desactivar).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect
      .element(page.getByRole("status").first())
      .toHaveTextContent("Verificando si se registró…");
    await expect.element(page.getByRole("button", { name: "Desactivar" })).toBeDisabled();
    segunda.soltar(BIEN);
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(desactivar.mock.calls[1]).toEqual(desactivar.mock.calls[0]);
  });

  it("un INESPERADO devuelto como valor queda incierto, con la referencia, y reintenta lo mismo", async () => {
    const segunda = puerta();
    desactivar.mockResolvedValueOnce(INESPERADO).mockReturnValueOnce(segunda.espera);
    await render(pantalla());
    tocar(page.getByRole("button", { name: "Desactivar" }));
    await vi.waitFor(() => expect(desactivar).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect.element(page.getByText("PD-ABCD-0123", { exact: false })).toBeVisible();
    segunda.soltar(BIEN);
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(desactivar.mock.calls[1]).toEqual(desactivar.mock.calls[0]);
  });
});

describe("el cambio de ambiente y su ventana de confirmación (D-48)", () => {
  it("«Pasar a producción» abre la ventana con el aviso aprobado; no envía nada todavía", async () => {
    await render(pantalla());
    tocar(pasarAProduccion());
    await expect.element(dialogo()).toBeVisible();
    await expect
      .element(
        dialogo().getByText(
          "Un punto de venta que pasó a producción no vuelve al ambiente de pruebas.",
        ),
      )
      .toBeVisible();
    expect(cambiarAmbiente).not.toHaveBeenCalled();
    // El cuerpo describe a la ventana para el lector de pantalla.
    const descripcion = dialogo().element().getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(descripcion)?.textContent).toContain(
      "no vuelve al ambiente de pruebas",
    );
  });

  it.each([390, 1280])(
    "a %i px la ventana abierta no tiene violaciones de accesibilidad y se lee y se toca bien",
    async (ancho) => {
      await ventana(ancho);
      await render(enArmazon("Punto de venta 00002", pantalla()));
      tocar(pasarAProduccion());
      await expect.element(dialogo()).toBeVisible();
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
    },
  );

  it("el foco entra a la ventana (en el título, no en el botón que cambia el ambiente) y no sale con Tab", async () => {
    await render(pantalla());
    tocar(pasarAProduccion());
    await expect.element(dialogo()).toBeVisible();
    const titulo = dialogo().getByRole("heading", { name: "¿Pasar a producción?" }).element();
    await vi.waitFor(() => expect(document.activeElement).toBe(titulo));
    const dentro = (): boolean => dialogo().element().contains(document.activeElement);
    for (let i = 0; i < 8; i += 1) {
      await userEvent.tab();
      expect(dentro()).toBe(true);
    }
    for (let i = 0; i < 8; i += 1) {
      await userEvent.tab({ shift: true });
      expect(dentro()).toBe(true);
    }
  });

  it("Escape la cierra sin enviar y devuelve el foco al botón que la abrió", async () => {
    await render(pantalla());
    const boton = pasarAProduccion();
    tocar(boton);
    await expect.element(dialogo()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialogo()).not.toBeInTheDocument();
    await vi.waitFor(() => expect(document.activeElement).toBe(boton.element()));
    expect(cambiarAmbiente).not.toHaveBeenCalled();
  });

  it("«Cancelar» la cierra sin enviar y devuelve el foco", async () => {
    await render(pantalla());
    const boton = pasarAProduccion();
    tocar(boton);
    await expect.element(dialogo()).toBeVisible();
    tocar(enLaVentana("Cancelar"));
    await expect.element(dialogo()).not.toBeInTheDocument();
    await vi.waitFor(() => expect(document.activeElement).toBe(boton.element()));
    expect(cambiarAmbiente).not.toHaveBeenCalled();
  });

  it("confirmar manda el id, el ambiente y la versión que vio la pantalla UNA vez aunque se toque tres veces, cierra la ventana y recarga", async () => {
    const abierta = puerta();
    cambiarAmbiente.mockReturnValue(abierta.espera);
    await render(pantalla());
    const boton = pasarAProduccion();
    tocar(boton);
    await expect.element(dialogo()).toBeVisible();
    const confirmar = enLaVentana("Pasar a producción");
    tocar(confirmar);
    tocar(confirmar);
    tocar(confirmar);
    abierta.soltar(BIEN);
    await expect.element(dialogo()).not.toBeInTheDocument();
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(cambiarAmbiente).toHaveBeenCalledTimes(1);
    expect(cambiarAmbiente).toHaveBeenCalledWith({
      puntoDeVentaId: PUNTO.id,
      ambiente: "PRODUCCION",
      versionEsperada: 7,
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(boton.element()));
  });

  it("mientras envía la ventana no se cierra con Escape", async () => {
    const abierta = puerta();
    cambiarAmbiente.mockReturnValue(abierta.espera);
    await render(pantalla());
    tocar(pasarAProduccion());
    await expect.element(dialogo()).toBeVisible();
    tocar(enLaVentana("Pasar a producción"));
    await vi.waitFor(() => expect(cambiarAmbiente).toHaveBeenCalledTimes(1));
    await userEvent.keyboard("{Escape}");
    await expect.element(dialogo()).toBeVisible();
    abierta.soltar(BIEN);
    await expect.element(dialogo()).not.toBeInTheDocument();
  });

  it("si el servidor lo rechaza, la ventana sigue abierta y dice por qué con el texto del catálogo", async () => {
    cambiarAmbiente.mockResolvedValue({ ok: false, error: errorDeCodigo("FISCAL_SERIE_EN_CURSO") });
    await render(pantalla());
    tocar(pasarAProduccion());
    await expect.element(dialogo()).toBeVisible();
    tocar(enLaVentana("Pasar a producción"));
    await expect
      .element(
        dialogo().getByText("Hay un comprobante en proceso en este punto de venta.", {
          exact: false,
        }),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain("FISCAL_SERIE_EN_CURSO");
    expect(router.refresh).not.toHaveBeenCalled();
    // Cancelar y volver a abrirla: el error anterior ya no está.
    tocar(enLaVentana("Cancelar"));
    await expect.element(dialogo()).not.toBeInTheDocument();
    tocar(pasarAProduccion());
    await expect.element(dialogo()).toBeVisible();
    expect(dialogo().element().textContent).not.toContain("en proceso");
  });

  it("versión desactualizada: avisa y recarga lo último", async () => {
    cambiarAmbiente.mockResolvedValue({
      ok: false,
      error: errorDeCodigo("FISCAL_VERSION_DESACTUALIZADA"),
    });
    await render(pantalla());
    tocar(pasarAProduccion());
    await expect.element(dialogo()).toBeVisible();
    tocar(enLaVentana("Pasar a producción"));
    await expect
      .element(dialogo().getByText("Los datos cambiaron mientras los miraba.", { exact: false }))
      .toBeVisible();
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("la red se corta: reintenta el MISMO pedido (misma versión) y la ventana no se puede cerrar mientras verifica", async () => {
    const segunda = puerta();
    cambiarAmbiente
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(segunda.espera);
    await render(pantalla());
    tocar(pasarAProduccion());
    await expect.element(dialogo()).toBeVisible();
    tocar(enLaVentana("Pasar a producción"));
    await vi.waitFor(() => expect(cambiarAmbiente).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await userEvent.keyboard("{Escape}");
    await expect.element(dialogo()).toBeVisible();
    segunda.soltar(BIEN);
    await expect.element(dialogo()).not.toBeInTheDocument();
    expect(cambiarAmbiente.mock.calls[1]).toEqual(cambiarAmbiente.mock.calls[0]);
  });
});
