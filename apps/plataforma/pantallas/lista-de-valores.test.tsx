import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { restaurarConexion, tocar } from "../../web/ui/pruebas/ayudas";
import {
  agregarValorAccion,
  corregirNombreAccion,
  desactivarValorAccion,
  reactivarValorAccion,
} from "../app/listas/acciones";
import type { ValorParaLaPantalla } from "../logica/cambio-de-lista";
import { ListaDeValores } from "./lista-de-valores.cliente";

/**
 * La pantalla de una lista del sistema (cliente): agregar, corregir el nombre, desactivar y reactivar con una clave de idempotencia por intento. Vive acá porque el
 * proyecto de componentes (Chromium) recoge las pruebas de `apps/plataforma`. Las acciones del servidor van simuladas; no hay red ni base.
 */
vi.mock("../app/listas/acciones", () => ({
  agregarValorAccion: vi.fn(),
  corregirNombreAccion: vi.fn(),
  desactivarValorAccion: vi.fn(),
  reactivarValorAccion: vi.fn(),
}));
const refrescar = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refrescar }) }));

const agregar = vi.mocked(agregarValorAccion);
const corregir = vi.mocked(corregirNombreAccion);
const desactivar = vi.mocked(desactivarValorAccion);
const reactivar = vi.mocked(reactivarValorAccion);

type Respuesta = Awaited<ReturnType<typeof agregarValorAccion>>;
const BIEN: Respuesta = { ok: true, dato: { version: 2 } };

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const V3 = "33333333-3333-4333-8333-333333333333";
const V4 = "44444444-4444-4444-8444-444444444444";
const VALORES: readonly ValorParaLaPantalla[] = [
  { id: V1, nombre: "Cabal", activo: true, fija: false, version: 3 },
  { id: V2, nombre: "Diners Club", activo: false, fija: false, version: 4 },
  { id: V3, nombre: "Visa", activo: true, fija: false, version: 1 },
  { id: V4, nombre: "Otra", activo: true, fija: true, version: 1 },
];

const mostrar = (puedeEditar = true) =>
  render(<ListaDeValores lista="marcas" valores={VALORES} puedeEditar={puedeEditar} />);

/** Una respuesta que el test suelta cuando quiere: sostiene un envío en vuelo. */
function puerta() {
  let soltar: (r: Respuesta) => void = () => undefined;
  const espera = new Promise<Respuesta>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}

beforeEach(() => {
  for (const f of [agregar, corregir, desactivar, reactivar, refrescar]) f.mockReset();
});
afterEach(restaurarConexion);

describe("ListaDeValores: lo que se ve", () => {
  it("la vista de cómo se ve al cobrar solo trae los activos y cada valor sus botones", async () => {
    await mostrar();
    await expect.element(page.getByText("Cabal · Visa · Otra")).toBeVisible();
    await expect.element(page.getByText("Fija")).toBeVisible();
    await expect.element(page.getByText("Desactivado")).toBeVisible();
    expect(page.getByRole("button", { name: "Desactivar" }).elements()).toHaveLength(3);
    expect(page.getByRole("button", { name: "Reactivar" }).elements()).toHaveLength(1);
    expect(page.getByRole("button", { name: "Editar nombre" }).elements()).toHaveLength(4);
    expect(page.getByRole("button", { name: /Borrar|Eliminar/ }).elements()).toHaveLength(0);
  });

  it("la fija no se edita ni se desactiva (botones apagados)", async () => {
    await mostrar();
    const fila = page.getByRole("listitem").filter({ hasText: "Otra" });
    for (const boton of fila.getByRole("button").elements()) {
      expect((boton as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("sin permiso: todo apagado y el mensaje genérico", async () => {
    await mostrar(false);
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    for (const boton of page.getByRole("button").elements()) {
      expect((boton as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe("ListaDeValores: desactivar y reactivar", () => {
  it("desactivar manda el valor, la versión que vio y una clave; al terminar vuelve a pedir la lista", async () => {
    desactivar.mockResolvedValue(BIEN);
    await mostrar();
    tocar(
      page
        .getByRole("listitem")
        .filter({ hasText: "Cabal" })
        .getByRole("button", { name: "Desactivar" }),
    );
    await vi.waitFor(() => expect(desactivar).toHaveBeenCalledTimes(1));
    expect(desactivar.mock.calls[0]?.[0]).toMatchObject({ valorId: V1, versionEsperada: 3 });
    await vi.waitFor(() => expect(refrescar).toHaveBeenCalled());
    expect(reactivar).not.toHaveBeenCalled();
  });

  it("reactivar manda el valor desactivado y su versión", async () => {
    reactivar.mockResolvedValue(BIEN);
    await mostrar();
    tocar(page.getByRole("button", { name: "Reactivar" }));
    await vi.waitFor(() => expect(reactivar).toHaveBeenCalledTimes(1));
    expect(reactivar.mock.calls[0]?.[0]).toMatchObject({ valorId: V2, versionEsperada: 4 });
  });

  it("doble toque: una sola llamada con una sola clave mientras no hay respuesta", async () => {
    const p = puerta();
    desactivar.mockReturnValue(p.espera);
    await mostrar();
    const boton = page
      .getByRole("listitem")
      .filter({ hasText: "Cabal" })
      .getByRole("button", { name: "Desactivar" });
    tocar(boton);
    tocar(boton);
    tocar(boton);
    await vi.waitFor(() => expect(desactivar).toHaveBeenCalledTimes(1));
    p.soltar(BIEN);
    await vi.waitFor(() => expect(refrescar).toHaveBeenCalled());
    expect(desactivar).toHaveBeenCalledTimes(1);
  });

  it("segundo factor: al pedirlo se abre la ventana del código y se repite el MISMO pedido con la misma clave", async () => {
    desactivar
      .mockResolvedValueOnce({ ok: false, error: { tipo: "SEGUNDO_FACTOR" } })
      .mockResolvedValueOnce(BIEN);
    const verificar = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ status: true }), { status: 200 }));
    await mostrar();
    tocar(
      page
        .getByRole("listitem")
        .filter({ hasText: "Cabal" })
        .getByRole("button", { name: "Desactivar" }),
    );
    await expect.element(page.getByText("Confirmá que sos vos")).toBeVisible();
    await page.getByLabelText("Código de la aplicación").fill("123456");
    tocar(page.getByRole("button", { name: "Confirmar" }));
    await vi.waitFor(() => expect(desactivar).toHaveBeenCalledTimes(2));
    const [primero, segundo] = desactivar.mock.calls.map(([p]) => p);
    expect(segundo).toEqual(primero);
    verificar.mockRestore();
  });

  it("cancelar la ventana del código no cambia nada", async () => {
    desactivar.mockResolvedValue({ ok: false, error: { tipo: "SEGUNDO_FACTOR" } });
    await mostrar();
    tocar(
      page
        .getByRole("listitem")
        .filter({ hasText: "Cabal" })
        .getByRole("button", { name: "Desactivar" }),
    );
    await expect.element(page.getByText("Confirmá que sos vos")).toBeVisible();
    tocar(page.getByRole("button", { name: "Cancelar" }).first());
    await vi.waitFor(() =>
      expect(page.getByText("Confirmá que sos vos").elements()).toHaveLength(0),
    );
    expect(desactivar).toHaveBeenCalledTimes(1);
    expect(refrescar).not.toHaveBeenCalled();
  });

  it("un rechazo del servidor se dice con su texto, sin códigos, y no vuelve a pedir la lista", async () => {
    desactivar.mockResolvedValue({
      ok: false,
      error: {
        tipo: "PANTALLA_VIEJA",
        texto: "La pantalla quedó vieja. Volvé a abrirla y probá de nuevo.",
      },
    });
    await mostrar();
    tocar(
      page
        .getByRole("listitem")
        .filter({ hasText: "Cabal" })
        .getByRole("button", { name: "Desactivar" }),
    );
    await expect
      .element(page.getByText("La pantalla quedó vieja. Volvé a abrirla y probá de nuevo."))
      .toBeVisible();
    expect(refrescar).not.toHaveBeenCalled();
  });
});

describe("ListaDeValores: agregar y corregir el nombre", () => {
  it("agregar abre el formulario, manda el nombre con la lista y una clave y lo cierra al terminar", async () => {
    agregar.mockResolvedValue(BIEN);
    await mostrar();
    tocar(page.getByRole("button", { name: "Agregar valor" }));
    await page.getByLabelText("Nombre").fill("Tarjeta Sol");
    tocar(page.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(agregar).toHaveBeenCalledTimes(1));
    expect(agregar.mock.calls[0]?.[0]).toMatchObject({ lista: "marcas", nombre: "Tarjeta Sol" });
    await vi.waitFor(() => expect(page.getByLabelText("Nombre").elements()).toHaveLength(0));
    expect(refrescar).toHaveBeenCalled();
  });

  it("el nombre repetido aparece debajo del campo y el formulario sigue abierto", async () => {
    agregar.mockResolvedValue({
      ok: false,
      error: { tipo: "CAMPO", campo: "nombre", texto: "Ya existe un valor con ese nombre" },
    });
    await mostrar();
    tocar(page.getByRole("button", { name: "Agregar valor" }));
    await page.getByLabelText("Nombre").fill("visa");
    tocar(page.getByRole("button", { name: "Guardar" }));
    await expect.element(page.getByText("Ya existe un valor con ese nombre")).toBeVisible();
    await expect.element(page.getByLabelText("Nombre")).toHaveValue("visa");
    expect(refrescar).not.toHaveBeenCalled();
  });

  it("corregir el nombre parte del nombre actual y manda el valor con la versión que vio", async () => {
    corregir.mockResolvedValue(BIEN);
    await mostrar();
    tocar(
      page
        .getByRole("listitem")
        .filter({ hasText: "Visa" })
        .getByRole("button", { name: "Editar nombre" }),
    );
    await expect.element(page.getByLabelText("Nombre")).toHaveValue("Visa");
    await page.getByLabelText("Nombre").fill("Visa Débito");
    tocar(page.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(corregir).toHaveBeenCalledTimes(1));
    expect(corregir.mock.calls[0]?.[0]).toMatchObject({
      valorId: V3,
      nombre: "Visa Débito",
      versionEsperada: 1,
    });
  });

  it("cancelar cierra el formulario sin enviar nada", async () => {
    await mostrar();
    tocar(page.getByRole("button", { name: "Agregar valor" }));
    await expect.element(page.getByLabelText("Nombre")).toBeVisible();
    tocar(page.getByRole("button", { name: "Cancelar" }));
    await vi.waitFor(() => expect(page.getByLabelText("Nombre").elements()).toHaveLength(0));
    expect(agregar).not.toHaveBeenCalled();
  });

  it("un resultado inesperado queda «incierto»: se reintenta solo con la MISMA clave y no agrega dos veces", async () => {
    agregar
      .mockResolvedValueOnce({
        ok: false,
        error: { tipo: "INESPERADO" },
        referencia: "PD-ABCD-0123",
      })
      .mockResolvedValueOnce(BIEN);
    await mostrar();
    tocar(page.getByRole("button", { name: "Agregar valor" }));
    await page.getByLabelText("Nombre").fill("Tarjeta Sol");
    tocar(page.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(agregar).toHaveBeenCalledTimes(2), { timeout: 6000 });
    const [a, b] = agregar.mock.calls.map(([p]) => p as { claveDeIdempotencia: string });
    expect(a?.claveDeIdempotencia).toBe(b?.claveDeIdempotencia);
    await vi.waitFor(() => expect(refrescar).toHaveBeenCalled());
  });
});
