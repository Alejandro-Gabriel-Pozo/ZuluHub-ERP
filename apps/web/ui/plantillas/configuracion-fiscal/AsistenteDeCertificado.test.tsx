import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { enArmazon, legibleYTocable, ventana } from "./ayudas-de-pruebas";
import { AsistenteDeCertificado } from "./AsistenteDeCertificado.cliente";
import type { ArranqueDelAmbiente } from "./modelo-de-certificado";
import type { PedidoGenerado } from "./PasoGenerarPedido.cliente";

/**
 * El asistente del certificado de ARCA en Chromium (opción B): los tres pasos, el detalle del vigente y los errores. Se verifica: el `id`
 * del pedido es idempotente (un reintento lo reenvía idéntico; doble toque = un solo envío), «Guardando…», el pedido que se ve UNA vez
 * («Copiar» y «Descargar»), el pegado contra el pedido del estado, el error genérico con referencia que deja reintentar, «Revisá los
 * datos marcados.», el alias del reemplazo, axe y foco a 390 y 1280, y la consola limpia. La renovación en curso (D-94): `.pendiente.test.tsx`.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const generar = vi.fn<(pedido: unknown) => Promise<Respuesta<PedidoGenerado>>>();
const cargar = vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>();

const EMISOR = "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d";
const PEDIDO_ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const LISTA = "/configuracion-fiscal/certificado-de-arca";
const PEM_DEL_PEDIDO =
  "-----BEGIN CERTIFICATE REQUEST-----\nTEXTODEPRUEBADELPEDIDO\n-----END CERTIFICATE REQUEST-----\n";
const PEM_PEGADO =
  "-----BEGIN CERTIFICATE-----\nTEXTODEPRUEBADELCERTIFICADO\n-----END CERTIFICATE-----";
const GENERADO: Respuesta<PedidoGenerado> = {
  ok: true,
  dato: { certificadoId: PEDIDO_ID, pedidoPem: PEM_DEL_PEDIDO },
};
const INESPERADO = {
  ok: false,
  error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABCD-0123" },
} as const;
const DATOS_INVALIDOS = (campo: string) =>
  ({
    ok: false,
    error: { ...errorDeCodigo("FISCAL_CONFIGURACION_DATOS_INVALIDOS"), campo },
  }) as const;

const GENERAR: ArranqueDelAmbiente = { vista: "generar", aliasInicial: "" };
const CARGAR: ArranqueDelAmbiente = {
  vista: "cargar",
  certificadoId: PEDIDO_ID,
  datos: [
    { rotulo: "Alias", valor: "pedernalprod" },
    { rotulo: "Titular", valor: "20-12345678-6" },
  ],
};
const DETALLE: ArranqueDelAmbiente = {
  vista: "detalle",
  aliasInicial: "pedernalprueba",
  datos: [
    { rotulo: "Alias", valor: "pedernalprueba" },
    { rotulo: "Titular", valor: "20-12345678-6" },
    { rotulo: "Vence", valor: "12/10/2028" },
  ],
  cartel: { texto: "Vencido", tono: "peligro" },
  pedidoPendiente: null,
};

const asistente = (arranque: ArranqueDelAmbiente) =>
  enArmazon(
    "Producción",
    <AsistenteDeCertificado
      emisorId={EMISOR}
      ambiente="PRODUCCION"
      arranque={arranque}
      generar={generar}
      cargar={cargar}
      rutaALaLista={LISTA}
    />,
  );

const consola = ["log", "info", "warn", "error", "debug"] as const;
let escrito: string[] = [];
beforeEach(() => {
  generar.mockReset();
  cargar.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
  escrito = [];
  for (const nivel of consola) {
    vi.spyOn(console, nivel).mockImplementation((...partes: unknown[]) => {
      escrito.push(partes.map(String).join(" "));
    });
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  restaurarConexion();
  await page.viewport(390, 844);
});

const boton = (nombre: string) => page.getByRole("button", { name: nombre });
const pedidos = () => generar.mock.calls.map(([p]) => p as Record<string, unknown>);
function puerta<R>() {
  let soltar: (r: R) => void = () => undefined;
  const espera = new Promise<R>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}
async function completarElPedido(alias = "pedernalprod") {
  await page.getByLabelText("Alias").fill(alias);
  await page.getByLabelText("CUIT del titular").fill("20-12345678-6");
  await page.getByLabelText("Organización").fill("Mi Empresa SRL");
}
const sinPedidoNiCertificadoEnLaConsola = () => {
  expect(escrito.join("\n")).not.toMatch(/TEXTODEPRUEBA|BEGIN CERTIFICATE/);
};

describe.each([390, 1280])("cada paso, a %i px", (ancho) => {
  it("paso 1: accesible, legible y tocable; título «Generar pedido» y los tres campos", async () => {
    await ventana(ancho);
    await render(asistente(GENERAR));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await expect.element(page.getByRole("heading", { name: "Generar pedido" })).toBeVisible();
    for (const campo of ["Alias", "CUIT del titular", "Organización"]) {
      await expect.element(page.getByLabelText(campo)).toBeVisible();
    }
  });

  it("paso 2 y paso 3: accesibles, legibles y tocables", async () => {
    await ventana(ancho);
    generar.mockResolvedValue(GENERADO);
    await render(asistente(GENERAR));
    await completarElPedido();
    tocar(boton("Generar pedido"));
    await expect.element(boton("Siguiente")).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    tocar(boton("Siguiente"));
    await expect.element(boton("Cargar certificado")).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
  });

  it("el detalle del vigente vencido: accesible, con «Vencido», sus datos y «Reemplazar»", async () => {
    await ventana(ancho);
    await render(asistente(DETALLE));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    for (const t of ["Vencido", "pedernalprueba", "12/10/2028"]) {
      await expect.element(page.getByText(t, { exact: true })).toBeVisible();
    }
    await expect.element(boton("Reemplazar")).toBeVisible();
  });
});

describe("el recorrido de los tres pasos", () => {
  it("generar, ver el pedido una vez, pasar a pegar el certificado y cargarlo: vuelve a la lista", async () => {
    generar.mockResolvedValue(GENERADO);
    cargar.mockResolvedValue({
      ok: true,
      dato: { venceEn: "2028-10-12T00:00:00.000Z", yaEstaba: false },
    });
    await render(asistente(GENERAR));
    await completarElPedido();
    tocar(boton("Generar pedido"));
    // Paso 2: el pedido a la vista, con su nombre, y el foco en el título del paso.
    const pedido = page.getByRole("textbox", { name: "Pedido" });
    await expect.element(pedido).toHaveValue(PEM_DEL_PEDIDO);
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Pedido");
    });
    // El pedido salió con todos los datos y el id de idempotencia.
    expect(pedidos()).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        emisorId: EMISOR,
        ambiente: "PRODUCCION",
        alias: "pedernalprod",
        cuitTitular: "20-12345678-6",
        organizacion: "Mi Empresa SRL",
      },
    ]);
    tocar(boton("Siguiente"));
    // Paso 3: el pedido ya no está; se pega el certificado y se carga contra el pedido que se generó.
    await expect.element(page.getByRole("heading", { name: "Certificado" })).toBeVisible();
    expect(page.getByRole("textbox", { name: "Pedido" }).elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain("TEXTODEPRUEBADELPEDIDO");
    await page.getByRole("textbox", { name: "Certificado" }).fill(PEM_PEGADO);
    tocar(boton("Cargar certificado"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(cargar).toHaveBeenCalledWith({ certificadoId: PEDIDO_ID, certificadoPem: PEM_PEGADO });
    sinPedidoNiCertificadoEnLaConsola();
  });

  it("los tres pasos están numerados y el actual lo dice con aria-current", async () => {
    generar.mockResolvedValue(GENERADO);
    await render(asistente(GENERAR));
    const actual = () => document.querySelector('[aria-current="step"]')?.textContent;
    expect(actual()).toBe("1");
    await completarElPedido();
    tocar(boton("Generar pedido"));
    await expect.element(boton("Siguiente")).toBeVisible();
    expect(actual()).toBe("2");
    tocar(boton("Siguiente"));
    await expect.element(boton("Cargar certificado")).toBeVisible();
    expect(actual()).toBe("3");
  });
});

describe("el paso 1: idempotencia y «Guardando…»", () => {
  it("doble y triple toque en «Generar pedido»: un solo envío y el botón dice «Guardando…»", async () => {
    const abierta = puerta<Respuesta<PedidoGenerado>>();
    generar.mockReturnValue(abierta.espera);
    await render(asistente(GENERAR));
    await completarElPedido();
    tocar(boton("Generar pedido"));
    tocar(boton("Generar pedido"));
    tocar(boton("Generar pedido"));
    const enEspera = boton("Guardando…");
    await expect.element(enEspera).toBeVisible();
    expect(enEspera.element().textContent).toBe("Guardando…");
    abierta.soltar(GENERADO);
    await expect.element(boton("Siguiente")).toBeVisible();
    expect(generar).toHaveBeenCalledTimes(1);
  });

  it("un corte de red reenvía el MISMO pedido, con el mismo id, y sigue al paso 2", async () => {
    generar.mockRejectedValueOnce(new Error("red cortada")).mockResolvedValue(GENERADO);
    await render(asistente(GENERAR));
    await completarElPedido();
    tocar(boton("Generar pedido"));
    await expect.element(boton("Siguiente"), { timeout: 8000 }).toBeVisible();
    expect(generar).toHaveBeenCalledTimes(2);
    expect(pedidos()[1]).toEqual(pedidos()[0]);
  });

  it("cada vez que se abre el paso 1 es un pedido nuevo: otro id, explícito", async () => {
    generar.mockResolvedValue(GENERADO);
    await render(asistente(CARGAR));
    // Desde el pendiente: «Generar pedido» abre el paso 1 (el pedido perdido se reemplaza por otro).
    tocar(boton("Generar pedido"));
    await expect.element(page.getByLabelText("Alias")).toBeVisible();
    await completarElPedido();
    tocar(boton("Generar pedido"));
    await expect.element(boton("Siguiente")).toBeVisible();
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0]?.["id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("el paso 2: «Copiar» y «Descargar»", () => {
  async function enElPaso2() {
    generar.mockResolvedValue(GENERADO);
    await render(asistente(GENERAR));
    await completarElPedido();
    tocar(boton("Generar pedido"));
    await expect.element(boton("Siguiente")).toBeVisible();
  }

  it("«Copiar» copia el pedido tal cual; repetirlo es seguro", async () => {
    const escribir = vi.fn<(t: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: escribir },
    });
    await enElPaso2();
    tocar(boton("Copiar"));
    tocar(boton("Copiar"));
    expect(escribir).toHaveBeenCalledWith(PEM_DEL_PEDIDO);
    expect(generar).toHaveBeenCalledTimes(1);
  });

  it("si el navegador no deja copiar, no se rompe ni se escribe nada en la consola", async () => {
    const escribir = vi
      .fn<(t: string) => Promise<void>>()
      .mockRejectedValue(new Error("sin permiso"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: escribir },
    });
    await enElPaso2();
    tocar(boton("Copiar"));
    await vi.waitFor(() => expect(escribir).toHaveBeenCalled());
    await expect.element(boton("Siguiente")).toBeVisible();
    sinPedidoNiCertificadoEnLaConsola();
  });

  it("«Descargar» baja un archivo .csr con el pedido, desde la memoria de la pantalla; repetirlo es seguro", async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blobs.push(b as Blob);
      return "blob:prueba";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const nombres: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      nombres.push(this.download);
    });
    await enElPaso2();
    tocar(boton("Descargar"));
    tocar(boton("Descargar"));
    expect(nombres).toEqual(["pedernalprod.csr", "pedernalprod.csr"]);
    expect(await blobs[0]?.text()).toBe(PEM_DEL_PEDIDO);
    expect(generar).toHaveBeenCalledTimes(1);
  });

  it("el teclado: Tab llega a «Copiar», «Descargar» y «Siguiente», en ese orden, con el foco visible", async () => {
    await enElPaso2();
    const { userEvent } = await import("vitest/browser");
    const orden: string[] = [];
    for (let i = 0; i < 5 && orden.at(-1) !== "Siguiente"; i += 1) {
      await userEvent.tab();
      const el = document.activeElement as HTMLElement;
      if (el.tagName === "BUTTON") {
        expect(getComputedStyle(el).outlineStyle).toBe("solid");
        orden.push(el.textContent ?? "");
      }
    }
    expect(orden).toEqual(["Copiar", "Descargar", "Siguiente"]);
  });
});

describe("el paso 3: pegar el certificado", () => {
  it("desde el pedido pendiente se entra directo al paso 3, con alias y titular, sin el pedido", async () => {
    await render(asistente(CARGAR));
    await expect.element(page.getByRole("heading", { name: "Certificado" })).toBeVisible();
    await expect.element(page.getByText("pedernalprod", { exact: true })).toBeVisible();
    await expect.element(page.getByText("20-12345678-6", { exact: true })).toBeVisible();
    expect(page.getByRole("textbox", { name: "Pedido" }).elements()).toHaveLength(0);
  });

  it("doble toque en «Cargar certificado»: un solo envío; «Guardando…» mientras espera; lo pegado va tal cual", async () => {
    const abierta = puerta<Respuesta<unknown>>();
    cargar.mockReturnValue(abierta.espera);
    await render(asistente(CARGAR));
    await page.getByRole("textbox", { name: "Certificado" }).fill(PEM_PEGADO);
    tocar(boton("Cargar certificado"));
    tocar(boton("Cargar certificado"));
    await expect.element(boton("Guardando…")).toBeVisible();
    abierta.soltar({ ok: true, dato: { venceEn: "2028-10-12T00:00:00.000Z", yaEstaba: false } });
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(cargar).toHaveBeenCalledTimes(1);
    expect(cargar).toHaveBeenCalledWith({ certificadoId: PEDIDO_ID, certificadoPem: PEM_PEGADO });
  });

  it("un rechazo del servidor sin texto propio sale como el mensaje genérico con su referencia y deja volver a pegar", async () => {
    cargar.mockResolvedValueOnce(INESPERADO).mockResolvedValue({
      ok: true,
      dato: { venceEn: "2028-10-12T00:00:00.000Z", yaEstaba: false },
    });
    await render(asistente(CARGAR));
    await page.getByRole("textbox", { name: "Certificado" }).fill(PEM_PEGADO);
    tocar(boton("Cargar certificado"));
    await expect.element(page.getByText(/Referencia: PD-ABCD-0123/)).toBeVisible();
    await expect.element(page.getByText(/No se pudo completar/)).toBeVisible();
    // No queda en «Verificando…» ni bloqueado: el botón y el campo siguen disponibles.
    expect(document.body.textContent).not.toContain("Verificando");
    await expect.element(boton("Cargar certificado")).toBeEnabled();
    await expect.element(page.getByRole("textbox", { name: "Certificado" })).toBeEnabled();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    tocar(boton("Cargar certificado"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(cargar).toHaveBeenCalledTimes(2);
    sinPedidoNiCertificadoEnLaConsola();
  });

  it("con el pedido pendiente, «Cancelar» vuelve a la lista", async () => {
    await render(asistente(CARGAR));
    tocar(boton("Cancelar"));
    expect(router.push).toHaveBeenCalledWith(LISTA);
    expect(cargar).not.toHaveBeenCalled();
  });
});

describe("los errores del paso 1 por la vía común", () => {
  it("un alias o un CUIT que el servidor rechaza sin texto propio: genérico con referencia, y se puede corregir y reintentar", async () => {
    generar.mockResolvedValueOnce(INESPERADO).mockResolvedValue(GENERADO);
    await render(asistente(GENERAR));
    await completarElPedido("alias con espacios");
    tocar(boton("Generar pedido"));
    await expect.element(page.getByText(/Referencia: PD-ABCD-0123/)).toBeVisible();
    expect(document.body.textContent).not.toContain("Verificando");
    await expect.element(page.getByLabelText("Alias")).toBeEnabled();
    await page.getByLabelText("Alias").fill("pedernalprod");
    tocar(boton("Generar pedido"));
    await expect.element(boton("Siguiente")).toBeVisible();
    expect(pedidos()[1]?.["alias"]).toBe("pedernalprod");
    // Mismo id en el reintento tras un rechazo definitivo: el rechazo no escribió nada.
    expect(pedidos()[1]?.["id"]).toBe(pedidos()[0]?.["id"]);
  });

  it("datos mal escritos (error de forma): «Revisá los datos marcados.» en el campo, marcado y con el foco", async () => {
    generar.mockResolvedValue(DATOS_INVALIDOS("cuitTitular"));
    await render(asistente(GENERAR));
    await completarElPedido();
    tocar(boton("Generar pedido"));
    await expect.element(page.getByText("Revisá los datos marcados.")).toBeVisible();
    const campo = page.getByLabelText("CUIT del titular").element();
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    expect(campo.getAttribute("aria-describedby")).not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(campo));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });
});

describe("«Reemplazar» desde un certificado vigente", () => {
  it("abre el paso 1 con el alias del certificado actual y el resto en blanco", async () => {
    await render(asistente(DETALLE));
    tocar(boton("Reemplazar"));
    await expect.element(page.getByRole("heading", { name: "Generar pedido" })).toBeVisible();
    await expect.element(page.getByLabelText("Alias")).toHaveValue("pedernalprueba");
    await expect.element(page.getByLabelText("CUIT del titular")).toHaveValue("");
    await expect.element(page.getByLabelText("Organización")).toHaveValue("");
  });

  it("«Cancelar» vuelve al detalle, sin enviar nada", async () => {
    await render(asistente(DETALLE));
    tocar(boton("Reemplazar"));
    await expect.element(boton("Cancelar")).toBeVisible();
    tocar(boton("Cancelar"));
    await expect.element(boton("Reemplazar")).toBeVisible();
    expect(generar).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("el pedido del reemplazo es otro pedido: lleva su propio id", async () => {
    generar.mockResolvedValue(GENERADO);
    await render(asistente(DETALLE));
    tocar(boton("Reemplazar"));
    await page.getByLabelText("CUIT del titular").fill("20-12345678-6");
    await page.getByLabelText("Organización").fill("Mi Empresa SRL");
    tocar(boton("Generar pedido"));
    await expect.element(boton("Siguiente")).toBeVisible();
    expect(pedidos()[0]).toMatchObject({ alias: "pedernalprueba", ambiente: "PRODUCCION" });
  });
});
