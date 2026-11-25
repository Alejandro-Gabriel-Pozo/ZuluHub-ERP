import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { restaurarConexion, violacionesDeAccesibilidad, tocar } from "../../web/ui/pruebas/ayudas";
import {
  activarDominioAccion,
  agregarDominioAccion,
  desactivarDominioAccion,
  retirarDominioAccion,
  verificarDominioAccion,
} from "../app/dominios/acciones";
import type { DominioParaLaPantalla } from "../logica/cambio-de-dominio";
import { ListaDeDominios } from "./lista-de-dominios.cliente";

/**
 * La pantalla «Dominios» (cliente): agregar, verificar, activar, desactivar y retirar con una clave de idempotencia por intento, lo que se ofrece en cada estado y sin permiso. Vive acá
 * porque el proyecto de componentes (Chromium) recoge las pruebas de `apps/plataforma`. Las acciones del servidor van simuladas; no hay red ni base.
 */
vi.mock("../app/dominios/acciones", () => ({
  agregarDominioAccion: vi.fn(),
  verificarDominioAccion: vi.fn(),
  activarDominioAccion: vi.fn(),
  desactivarDominioAccion: vi.fn(),
  retirarDominioAccion: vi.fn(),
}));
const refrescar = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refrescar }) }));

const agregar = vi.mocked(agregarDominioAccion);
const verificar = vi.mocked(verificarDominioAccion);
const activar = vi.mocked(activarDominioAccion);
const desactivar = vi.mocked(desactivarDominioAccion);
const retirar = vi.mocked(retirarDominioAccion);

type Respuesta = Awaited<ReturnType<typeof agregarDominioAccion>>;
const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const D3 = "33333333-3333-4333-8333-333333333333";
const D4 = "44444444-4444-4444-8444-444444444444";
const E1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BIEN = (dominioId: string): Respuesta => ({ ok: true, dato: { dominioId, yaEstaba: false } });

const DOMINIOS: readonly DominioParaLaPantalla[] = [
  {
    id: D1,
    host: "app.hotel-uno.com.ar",
    superficie: "APP",
    titular: "CLIENTE",
    estado: "PENDIENTE_VERIFICACION",
    verificadoEn: null,
    motivo: null,
    empresa: "Hotel Uno",
  },
  {
    id: D2,
    host: "carta.hotel-uno.com.ar",
    superficie: "CARTA",
    titular: "CLIENTE",
    estado: "VERIFICADO",
    verificadoEn: "20/11/2026",
    motivo: null,
    empresa: "Hotel Uno",
  },
  {
    id: D3,
    host: "carta.hotel-dos.com.ar",
    superficie: "CARTA",
    titular: "OPERADOR",
    estado: "ACTIVO",
    verificadoEn: "12/11/2026",
    motivo: null,
    empresa: "Hotel Dos",
  },
  {
    id: D4,
    host: "app.hotel-tres.com.ar",
    superficie: "APP",
    titular: "CLIENTE",
    estado: "RETIRADO",
    verificadoEn: null,
    motivo: "El cliente se fue",
    empresa: "Hotel Tres",
  },
];
const EMPRESAS = [{ id: E1, razonSocial: "Hotel Uno" }];

const mostrar = (puedeEditar = true, dominios: readonly DominioParaLaPantalla[] = DOMINIOS) =>
  render(<ListaDeDominios dominios={dominios} empresas={EMPRESAS} puedeEditar={puedeEditar} />);

function puerta() {
  let soltar: (r: Respuesta) => void = () => undefined;
  const espera = new Promise<Respuesta>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}

beforeEach(() => {
  for (const f of [agregar, verificar, activar, desactivar, retirar, refrescar]) f.mockReset();
});
afterEach(restaurarConexion);

const fila = (host: string) => page.getByRole("listitem").filter({ hasText: host });

describe("ListaDeDominios: lo que se ve", () => {
  it("cada dominio muestra su estado y solo los botones que corresponden a ese estado; el retirado no tiene ninguno", async () => {
    await mostrar();
    await expect.element(page.getByText("Pendiente de verificación")).toBeVisible();
    await expect.element(page.getByText("Verificado el 20/11/2026")).toBeVisible();
    await expect.element(page.getByText("Motivo: El cliente se fue")).toBeVisible();
    expect(
      fila("app.hotel-uno")
        .getByRole("button")
        .elements()
        .map((b) => b.textContent),
    ).toEqual(["Verificar", "Retirar"]);
    expect(
      fila("carta.hotel-uno")
        .getByRole("button")
        .elements()
        .map((b) => b.textContent),
    ).toEqual(["Activar", "Retirar"]);
    expect(
      fila("carta.hotel-dos")
        .getByRole("button")
        .elements()
        .map((b) => b.textContent),
    ).toEqual(["Desactivar", "Retirar"]);
    expect(fila("app.hotel-tres").getByRole("button").elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: /Borrar|Eliminar/ }).elements()).toHaveLength(0);
  });

  it("sin dominios dice que todavía no hay", async () => {
    await mostrar(true, []);
    await expect.element(page.getByText("Todavía no hay dominios.")).toBeVisible();
  });

  it("sin permiso: no se ofrece ningún botón (ni agregar ni cambiar)", async () => {
    await mostrar(false);
    expect(page.getByRole("button").elements()).toHaveLength(0);
  });

  it("no tiene violaciones de accesibilidad", async () => {
    await mostrar();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});

describe("ListaDeDominios: verificar, activar, desactivar", () => {
  it("verificar manda el dominio y una clave; al terminar vuelve a pedir la lista", async () => {
    verificar.mockResolvedValue(BIEN(D1));
    await mostrar();
    tocar(fila("app.hotel-uno").getByRole("button", { name: "Verificar" }));
    await vi.waitFor(() => expect(verificar).toHaveBeenCalledTimes(1));
    expect(verificar.mock.calls[0]?.[0]).toMatchObject({ dominioId: D1 });
    expect(
      typeof (verificar.mock.calls[0]?.[0] as { claveDeIdempotencia: string }).claveDeIdempotencia,
    ).toBe("string");
    await vi.waitFor(() => expect(refrescar).toHaveBeenCalled());
    await expect.element(page.getByText("Dominio verificado.")).toBeVisible();
  });

  it("activar y desactivar mandan su dominio", async () => {
    activar.mockResolvedValue(BIEN(D2));
    desactivar.mockResolvedValue(BIEN(D3));
    await mostrar();
    tocar(fila("carta.hotel-uno").getByRole("button", { name: "Activar" }));
    await vi.waitFor(() => expect(activar).toHaveBeenCalledTimes(1));
    expect(activar.mock.calls[0]?.[0]).toMatchObject({ dominioId: D2 });
  });

  it("doble toque: una sola llamada con una sola clave mientras no hay respuesta", async () => {
    const p = puerta();
    verificar.mockReturnValue(p.espera);
    await mostrar();
    const boton = fila("app.hotel-uno").getByRole("button", { name: "Verificar" });
    tocar(boton);
    tocar(boton);
    await vi.waitFor(() => expect(verificar).toHaveBeenCalledTimes(1));
    p.soltar(BIEN(D1));
    await vi.waitFor(() => expect(refrescar).toHaveBeenCalled());
    expect(verificar).toHaveBeenCalledTimes(1);
  });
});

describe("ListaDeDominios: agregar y retirar", () => {
  it("agregar manda empresa, nombre del sitio, qué muestra y titular con una clave", async () => {
    agregar.mockResolvedValue(BIEN(D1));
    await mostrar();
    tocar(page.getByRole("button", { name: "Agregar dominio" }));
    await page.getByLabelText("Empresa").selectOptions(E1);
    await page.getByLabelText("Nombre del sitio").fill("app.hotel-nuevo.com.ar");
    await page.getByLabelText("Qué muestra").selectOptions("APP");
    await page.getByLabelText("Titular").selectOptions("CLIENTE");
    tocar(page.getByRole("button", { name: "Agregar", exact: true }));
    await vi.waitFor(() => expect(agregar).toHaveBeenCalledTimes(1));
    expect(agregar.mock.calls[0]?.[0]).toMatchObject({
      tipo: "AGREGAR",
      empresaId: E1,
      host: "app.hotel-nuevo.com.ar",
      superficie: "APP",
      titular: "CLIENTE",
    });
    await vi.waitFor(() => expect(refrescar).toHaveBeenCalled());
  });

  it("un error del nombre del sitio sale debajo de su campo y no se repite arriba", async () => {
    agregar.mockResolvedValue({
      ok: false,
      error: { tipo: "CAMPO", campo: "host", texto: "El nombre del sitio no es válido." },
    });
    await mostrar();
    tocar(page.getByRole("button", { name: "Agregar dominio" }));
    await page.getByLabelText("Empresa").selectOptions(E1);
    await page.getByLabelText("Nombre del sitio").fill("http://x");
    await page.getByLabelText("Qué muestra").selectOptions("CARTA");
    await page.getByLabelText("Titular").selectOptions("OPERADOR");
    tocar(page.getByRole("button", { name: "Agregar", exact: true }));
    await expect.element(page.getByText("El nombre del sitio no es válido.")).toBeVisible();
    expect(page.getByText("El nombre del sitio no es válido.").elements()).toHaveLength(1);
  });

  it("retirar abre el motivo y lo manda con el dominio", async () => {
    retirar.mockResolvedValue(BIEN(D3));
    await mostrar();
    tocar(fila("carta.hotel-dos").getByRole("button", { name: "Retirar" }));
    await page.getByLabelText("Motivo").fill("El cliente se fue");
    tocar(page.getByRole("button", { name: "Retirar" }).first());
    await vi.waitFor(() => expect(retirar).toHaveBeenCalledTimes(1));
    expect(retirar.mock.calls[0]?.[0]).toMatchObject({
      dominioId: D3,
      motivo: "El cliente se fue",
    });
  });
});
