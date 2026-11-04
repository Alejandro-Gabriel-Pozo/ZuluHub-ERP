import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import {
  restaurarConexion,
  simularConexion,
  tocar,
  verificarFoco,
  violacionesDeAccesibilidad,
} from "../../pruebas/ayudas";
import { enArmazon, legibleYTocable, ventana } from "../configuracion-fiscal/ayudas-de-pruebas";
import { PantallaDeContactoDeLaSucursal } from "./PantallaDeContactoDeLaSucursal.cliente";
import type { ContactoDeLaSucursal } from "./modelo-de-contacto-de-la-sucursal";

/**
 * «Contacto de la sucursal» en Chromium: precarga, envío de lo que cambió (nunca los campos no tocados), vaciar un campo, sin cambios no
 * envía, doble toque, reintento idéntico tras un corte de red, dato inválido marcado en su campo, conflicto de versión (con voseo) y
 * accesibilidad en celular (390 px) y escritorio (1280 px). La acción del servidor va simulada.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const guardar = vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>();
const SUCURSAL = "5b1e0f6c-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const CUENTA = "/cuenta";
const CONTACTO: ContactoDeLaSucursal = {
  telefono: "011 4555-1234",
  correo: null,
  web: "www.hotelcentro.com",
};
const BIEN: Respuesta<unknown> = { ok: true, dato: { version: 8 } };
const conCampo = (campo: string): Respuesta<never> => ({
  ok: false,
  error: { ...errorDeCodigo("FISCAL_CONFIGURACION_DATOS_INVALIDOS"), campo },
});

const pantalla = (contacto: ContactoDeLaSucursal = CONTACTO, version = 7) => (
  <PantallaDeContactoDeLaSucursal
    sucursalId={SUCURSAL}
    nombre="Centro"
    version={version}
    contacto={contacto}
    guardar={guardar}
    rutaAlGuardar={CUENTA}
    rutaAlCancelar={CUENTA}
  />
);

beforeEach(() => {
  guardar.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});
afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

const boton = (nombre: string) => page.getByRole("button", { name: nombre });
const campo = (etiqueta: string) => page.getByLabelText(etiqueta, { exact: true });
const valor = (etiqueta: string) => (campo(etiqueta).element() as HTMLInputElement).value;
const pedidos = () => guardar.mock.calls.map(([pedido]) => pedido as Record<string, unknown>);
function puerta<R>() {
  let soltar: (r: R) => void = () => undefined;
  const espera = new Promise<R>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}

describe("lo que muestra", () => {
  it("los tres campos con sus rótulos aprobados, precargados con el contacto guardado, y Guardar y Cancelar", async () => {
    await render(pantalla());
    expect(valor("Teléfono")).toBe("011 4555-1234");
    expect(valor("Correo")).toBe("");
    expect(valor("Web")).toBe("www.hotelcentro.com");
    await expect.element(boton("Guardar")).toBeVisible();
    await expect.element(boton("Cancelar")).toBeVisible();
    // Sin ayudas, placeholders ni contadores.
    expect(document.querySelectorAll("input[placeholder]")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
  });

  it("el teclado y el autocompletado son los del dato: teléfono, correo y web (texto, sin forzar el esquema)", async () => {
    await render(pantalla());
    const tel = campo("Teléfono").element();
    const correo = campo("Correo").element();
    const web = campo("Web").element();
    expect([
      tel.getAttribute("type"),
      tel.getAttribute("inputmode"),
      tel.getAttribute("autocomplete"),
    ]).toEqual(["tel", "tel", "tel"]);
    expect([
      correo.getAttribute("type"),
      correo.getAttribute("inputmode"),
      correo.getAttribute("autocomplete"),
    ]).toEqual(["email", "email", "email"]);
    expect([
      web.getAttribute("type"),
      web.getAttribute("inputmode"),
      web.getAttribute("autocomplete"),
    ]).toEqual(["text", "url", "url"]);
  });
});

describe("el envío", () => {
  it("solo envía lo que cambió, con la sucursal, el nombre y la versión esperada; los campos no tocados no viajan", async () => {
    guardar.mockResolvedValue(BIEN);
    await render(pantalla());
    await campo("Correo").fill("reservas@hotelcentro.com");
    tocar(boton("Guardar"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(CUENTA));
    expect(pedidos()).toEqual([
      {
        sucursalId: SUCURSAL,
        versionEsperada: 7,
        nombre: "Centro",
        correo: "reservas@hotelcentro.com",
      },
    ]);
  });

  it("vaciar un campo manda null y no toca los otros", async () => {
    guardar.mockResolvedValue(BIEN);
    await render(pantalla());
    await campo("Web").fill("");
    tocar(boton("Guardar"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(CUENTA));
    expect(pedidos()).toEqual([
      { sucursalId: SUCURSAL, versionEsperada: 7, nombre: "Centro", web: null },
    ]);
  });

  it("sin cambios no envía nada y vuelve como si hubiera guardado", async () => {
    await render(pantalla());
    tocar(boton("Guardar"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(CUENTA));
    expect(guardar).not.toHaveBeenCalled();
  });

  it("Enter dentro de un campo guarda", async () => {
    guardar.mockResolvedValue(BIEN);
    await render(pantalla());
    await campo("Teléfono").fill("011 4555-9900");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(CUENTA));
  });

  it("doble toque: un solo envío, con «Guardando…» y Cancelar sin efecto mientras tanto", async () => {
    const abierta = puerta<Respuesta<unknown>>();
    guardar.mockReturnValue(abierta.espera);
    await render(pantalla());
    await campo("Teléfono").fill("011 4555-9900");
    tocar(boton("Guardar"));
    tocar(boton("Guardar"));
    tocar(boton("Guardar"));
    await expect.element(boton("Guardando…")).toBeVisible();
    tocar(boton("Cancelar"));
    expect(router.push).not.toHaveBeenCalled();
    abierta.soltar(BIEN);
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(CUENTA));
    expect(guardar).toHaveBeenCalledTimes(1);
  });

  it("red cortada: reintenta con el MISMO pedido, con los campos bloqueados mientras se verifica", async () => {
    const segunda = puerta<Respuesta<unknown>>();
    guardar
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(segunda.espera);
    await render(pantalla());
    await campo("Teléfono").fill("011 4555-9900");
    tocar(boton("Guardar"));
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect.element(page.getByRole("status")).toHaveTextContent("Verificando si se registró…");
    await expect.element(campo("Teléfono")).toBeDisabled();
    segunda.soltar(BIEN);
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(CUENTA));
    expect(guardar).toHaveBeenCalledTimes(2);
    expect(pedidos()[1]).toEqual(pedidos()[0]);
  });

  it("sin conexión no se envía nada: Guardar se apaga y, al volver, se envía lo que está escrito", async () => {
    guardar.mockResolvedValue(BIEN);
    await render(pantalla());
    await campo("Teléfono").fill("011 4555-9900");
    simularConexion(false);
    await expect.element(boton("Guardar")).toBeDisabled();
    expect(guardar).not.toHaveBeenCalled();
    simularConexion(true);
    await expect.element(boton("Guardar")).toBeEnabled();
    tocar(boton("Guardar"));
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(1));
  });

  it("«Cancelar» vuelve sin enviar nada", async () => {
    await render(pantalla());
    tocar(boton("Cancelar"));
    expect(router.push).toHaveBeenCalledWith(CUENTA);
    expect(guardar).not.toHaveBeenCalled();
  });
});

describe("errores", () => {
  it("«Revisá los datos marcados.» marca el campo, queda asociado por aria-describedby y recibe el foco", async () => {
    guardar.mockResolvedValue(conCampo("correo"));
    await render(pantalla());
    await campo("Correo").fill("reservas@hotelcentro");
    tocar(boton("Guardar"));
    const marcado = campo("Correo");
    await expect.element(marcado).toHaveAttribute("aria-invalid", "true");
    expect(
      document.getElementById(marcado.element().getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe("Revisá los datos marcados.");
    await vi.waitFor(() => expect(document.activeElement).toBe(marcado.element()));
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each([
    ["telefono", "Teléfono"],
    ["correo", "Correo"],
    ["web", "Web"],
  ] as const)("con el campo %s marca «%s»", async (nombre, etiqueta) => {
    guardar.mockResolvedValue(conCampo(nombre));
    await render(pantalla());
    await campo("Teléfono").fill("x");
    tocar(boton("Guardar"));
    await expect.element(campo(etiqueta)).toHaveAttribute("aria-invalid", "true");
  });

  it("al volver a escribir en el campo marcado, el error se va", async () => {
    guardar.mockResolvedValue(conCampo("telefono"));
    await render(pantalla());
    await campo("Teléfono").fill("x");
    tocar(boton("Guardar"));
    await expect.element(campo("Teléfono")).toHaveAttribute("aria-invalid", "true");
    await campo("Teléfono").fill("011 4555-9900");
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it("un rechazo sin campo (sin permiso) se dice arriba con su texto, sin marcar nada", async () => {
    guardar.mockResolvedValue({ ok: false, error: errorDeCodigo("SIN_PERMISO") });
    await render(pantalla());
    await campo("Teléfono").fill("x");
    tocar(boton("Guardar"));
    await expect.element(page.getByText("No tiene permiso para hacer esto.")).toBeVisible();
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it("conflicto de versión: avisa en voseo, recarga y, al llegar la ficha nueva, parte de ella y envía su versión", async () => {
    guardar
      .mockResolvedValueOnce({ ok: false, error: errorDeCodigo("FISCAL_VERSION_DESACTUALIZADA") })
      .mockResolvedValueOnce(BIEN);
    const { rerender } = await render(pantalla());
    await campo("Correo").fill("mio@hotelcentro.com");
    tocar(boton("Guardar"));
    await expect
      .element(
        page.getByText(
          "Los datos cambiaron mientras los mirabas. Actualizá la pantalla e intentá de nuevo.",
        ),
      )
      .toBeVisible();
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    // Llega la ficha nueva: otra persona cambió el teléfono.
    await rerender(pantalla({ ...CONTACTO, telefono: "011 4555-9900" }, 8));
    expect(valor("Teléfono")).toBe("011 4555-9900");
    expect(valor("Correo")).toBe("");
    await campo("Web").fill("");
    tocar(boton("Guardar"));
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2));
    expect(pedidos()[1]).toEqual({
      sucursalId: SUCURSAL,
      versionEsperada: 8,
      nombre: "Centro",
      web: null,
    });
  });
});

describe.each([
  ["celular de 390 px", 390],
  ["escritorio de 1280 px", 1280],
] as const)("accesibilidad en %s", (_nombre, ancho) => {
  it("axe sin violaciones, textos de 16 px, controles de 48 px y sin desborde, también con un error marcado", async () => {
    await ventana(ancho);
    guardar.mockResolvedValue(conCampo("correo"));
    await render(enArmazon("Contacto de la sucursal", pantalla()));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await campo("Correo").fill("reservas@hotelcentro");
    tocar(boton("Guardar"));
    await expect.element(campo("Correo")).toHaveAttribute("aria-invalid", "true");
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
  });

  it("con teclado: Tab recorre los campos en orden con el foco visible", async () => {
    await ventana(ancho);
    await render(pantalla());
    await verificarFoco(campo("Teléfono").element() as HTMLElement);
    await userEvent.tab();
    expect(document.activeElement).toBe(campo("Correo").element());
    await userEvent.tab();
    expect(document.activeElement).toBe(campo("Web").element());
    await userEvent.tab();
    expect(document.activeElement).toBe(boton("Guardar").element());
  });
});
