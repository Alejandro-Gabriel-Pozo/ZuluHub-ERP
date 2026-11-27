import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { TrabajoDeImpresion } from "../../patrones/papel/BotonDeImprimir.cliente";
import type { PapelParaImprimir } from "../../patrones/papel/hoja-del-papel";
import { armarLosTextosDeImprimir } from "../../patrones/papel/textos-de-imprimir";
import { PantallaDeLaCocina } from "./PantallaDeLaCocina.cliente";
import { armarLaCocina, type EnvioDeLaCocinaDeLaPantalla } from "./modelo-de-la-cocina";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

/**
 * La pantalla de la cocina en Chromium (SAL-H; maqueta aprobada el 25/11/2026): cada envío con mesa, «Envío N» y hora; lo pendiente se imprime con el trabajo que ya creó el envío (un doble toque es un solo diálogo y no se
 * vuelve a pedir el trabajo); lo fallido arranca en «No se pudo imprimir» y «Reintentar» pide el mismo trabajo con un intento más; sin impresora avisa; sin permiso los botones salen apagados; al volver a la pestaña se
 * actualiza; y axe. El navegador no confirma que el papel salió: «Impresa» es lo que declara el diálogo.
 */
const envio = (extra: Partial<EnvioDeLaCocinaDeLaPantalla> = {}): EnvioDeLaCocinaDeLaPantalla => ({
  trabajoId: "trab-5",
  envioId: "env-5",
  rotulo: "Mesa 5",
  numero: 2,
  hora: "21:14",
  estado: "PENDIENTE",
  intentos: 1,
  sinImpresora: false,
  ...extra,
});
const fallida = envio({
  trabajoId: "trab-3",
  envioId: "env-3",
  rotulo: "Mesa 3",
  numero: 1,
  hora: "21:09",
  estado: "FALLIDA",
  intentos: 1,
});

const trabajo = (extra: Partial<TrabajoDeImpresion> = {}): Respuesta<TrabajoDeImpresion> => ({
  ok: true,
  dato: {
    trabajoId: "trab-3",
    estado: "PENDIENTE",
    intentos: 2,
    sinImpresora: false,
    yaExistia: true,
    reintento: true,
    ...extra,
  },
});
const accionesFalsas = () => ({
  imprimir: vi.fn<(pedido: unknown) => Promise<Respuesta<TrabajoDeImpresion>>>(() =>
    Promise.resolve(trabajo()),
  ),
  reimprimir: vi.fn<(pedido: unknown) => Promise<Respuesta<TrabajoDeImpresion>>>(() =>
    Promise.resolve(trabajo()),
  ),
  declarar: vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>(() =>
    Promise.resolve({ ok: true, dato: {} }),
  ),
  papel: vi.fn<(pedido: unknown) => Promise<Respuesta<PapelParaImprimir>>>(() =>
    Promise.resolve({
      ok: true,
      dato: { ancho: 80, lineas: [{ texto: "COMANDA", estilo: "NEGRITA" }] },
    }),
  ),
});
type Acciones = ReturnType<typeof accionesFalsas>;

const pantalla = (
  envios: readonly EnvioDeLaCocinaDeLaPantalla[],
  acciones: Acciones,
  extra: Partial<{ puedeImprimir: boolean; configurar: boolean }> = {},
) => (
  <PantallaDeLaCocina
    cocina={armarLaCocina({}, envios)}
    textos={armarLosTextosDeImprimir()}
    acciones={acciones}
    puedeImprimir={extra.puedeImprimir ?? true}
    configurarImpresoras={
      extra.configurar === true ? <a href="/salon/impresoras">Configurar impresoras</a> : null
    }
  />
);

describe("pantalla de la cocina", () => {
  let imprimir: MockInstance<() => void>;
  beforeEach(() => {
    router.refresh.mockClear();
    imprimir = vi.spyOn(window, "print").mockImplementation(() => undefined);
  });
  afterEach(() => {
    imprimir.mockRestore();
  });

  it("cada envío dice mesa, «Envío N» y hora; lo pendiente ofrece «Imprimir» y lo fallido, «Reintentar»; axe sin violaciones", async () => {
    await render(pantalla([envio(), fallida], accionesFalsas()));
    await expect.element(page.getByText("Mesa 5")).toBeVisible();
    await expect.element(page.getByText("Envío 2 · 21:14")).toBeVisible();
    await expect.element(page.getByText("Mesa 3")).toBeVisible();
    await expect.element(page.getByText("Envío 1 · 21:09")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Imprimir" })).toBeVisible();
    await expect.element(page.getByText("No se pudo imprimir")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Ver en pantalla" })).toBeVisible();
    expect(imprimir).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("IDEMPOTENCIA: dos toques en «Imprimir» abren UN diálogo con el trabajo que ya existe, sin pedirlo de nuevo, y declaran «Impresa»", async () => {
    const acciones = accionesFalsas();
    await render(pantalla([envio()], acciones));
    const boton = page.getByRole("button", { name: "Imprimir" });
    tocar(boton);
    tocar(boton);
    await expect.element(page.getByText("Impresa")).toBeVisible();
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(acciones.imprimir).not.toHaveBeenCalled();
    expect(acciones.papel).toHaveBeenCalledWith({ documentoTipo: "COMANDA", documentoId: "env-5" });
    expect(acciones.declarar).toHaveBeenCalledTimes(1);
    expect(acciones.declarar).toHaveBeenCalledWith({
      trabajoId: "trab-5",
      numero: 1,
      resultado: "IMPRESA",
    });
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Reintentar» pide el MISMO trabajo (un intento más) UNA vez, abre el diálogo y declara el intento nuevo", async () => {
    const acciones = accionesFalsas();
    await render(pantalla([fallida], acciones));
    const boton = page.getByRole("button", { name: "Reintentar" });
    tocar(boton);
    tocar(boton);
    await expect.element(page.getByText("Impresa")).toBeVisible();
    expect(acciones.imprimir).toHaveBeenCalledTimes(1);
    const [pedido] = acciones.imprimir.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(pedido).toMatchObject({
      trabajoId: "trab-3",
      documentoTipo: "COMANDA",
      documentoId: "env-3",
    });
    expect(String(pedido["claveIdempotencia"])).toMatch(/^[0-9a-f-]{36}$/);
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(acciones.declarar).toHaveBeenCalledWith({
      trabajoId: "trab-3",
      numero: 2,
      resultado: "IMPRESA",
    });
  });

  it("si otra PC ya imprimió el trabajo, «Reintentar» no abre otro diálogo", async () => {
    const acciones = accionesFalsas();
    acciones.imprimir.mockImplementation(() =>
      Promise.resolve(trabajo({ estado: "IMPRESA", reintento: false, intentos: 1 })),
    );
    await render(pantalla([fallida], acciones));
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect.element(page.getByText("Impresa")).toBeVisible();
    expect(imprimir).not.toHaveBeenCalled();
  });

  it("sin impresora para la comanda avisa, con «Ver en pantalla» y «Configurar impresoras» solo si se ofrece", async () => {
    await render(pantalla([envio({ sinImpresora: true })], accionesFalsas(), { configurar: true }));
    await page.getByRole("button", { name: "Imprimir" }).click();
    await expect
      .element(page.getByText("No hay impresora para la comanda de cocina"))
      .toBeVisible();
    await expect.element(page.getByRole("link", { name: "Configurar impresoras" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Ver en pantalla" })).toBeVisible();
    expect(imprimir).not.toHaveBeenCalled();
  });

  it("sin permiso para imprimir los botones salen apagados (el servidor decide)", async () => {
    await render(pantalla([envio(), fallida], accionesFalsas(), { puedeImprimir: false }));
    await expect.element(page.getByRole("button", { name: "Imprimir" })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Reintentar" })).toBeDisabled();
  });

  it("se actualiza al volver a la pestaña y nunca por tiempo", async () => {
    await render(pantalla([envio()], accionesFalsas()));
    expect(router.refresh).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("sin nada pendiente la lista queda vacía, sin leyenda ni botones", async () => {
    await render(pantalla([], accionesFalsas()));
    expect(page.getByRole("button").elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
