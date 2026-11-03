import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { enArmazon, legibleYTocable, ventana } from "./ayudas-de-pruebas";
import { BotonDeCorregir } from "./BotonDeCorregir.cliente";
import { armarLaLectura, type VigenteDeDatosFiscales } from "./modelo-de-datos-fiscales";
import { PantallaDeDatosFiscales } from "./PantallaDeDatosFiscales";

/**
 * «Datos fiscales», primero lo vigente (opción A) en Chromium: la lectura, el aviso del borrador (D-68) y «Corregir», que pide el
 * borrador con una clave NUEVA por toque, fija el pedido en el primer intento y sigue al formulario. La acción del servidor va simulada.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const empezar = vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>();

const EMISOR = "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d";
const CORREGIR = "/configuracion-fiscal/datos-fiscales/corregir";
const VIGENTE: VigenteDeDatosFiscales = {
  id: "v1",
  numero: 2,
  vigenteDesde: "2026-10-13T01:30:00.000Z",
  razonSocial: "Distribuidora Sur SA",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilio: {
    id: "d1",
    calle: "Av. Rivadavia",
    numero: "1234",
    piso: "3",
    departamento: "B",
    localidad: "Ciudad de Buenos Aires",
    provincia: "AR-C",
    codigoPostal: "1000",
  },
  inicioActividades: "2018-03-01",
};
const lectura = armarLaLectura(
  "30712345678",
  VIGENTE,
  [{ valor: "RESPONSABLE_INSCRIPTO", etiqueta: "IVA Responsable Inscripto" }],
  "2026-10-12",
);
const MIGAS = [{ texto: "Configuración fiscal", href: "/configuracion-fiscal" }];

const lecturaConCorregir = () => (
  <PantallaDeDatosFiscales
    migas={MIGAS}
    lectura={lectura}
    aviso={null}
    accion={<BotonDeCorregir emisorId={EMISOR} empezar={empezar} rutaAlTerminar={CORREGIR} />}
  />
);
const lecturaConBorrador = () => (
  <PantallaDeDatosFiscales
    migas={MIGAS}
    lectura={lectura}
    aviso={{
      titulo: "Hay un borrador sin confirmar.",
      detalle:
        "Lo guardó otra persona o desde otro dispositivo. Los datos que rigen siguen siendo los de abajo.",
    }}
    accion={<EnlaceDeAccion href={CORREGIR}>Seguir con el borrador</EnlaceDeAccion>}
  />
);

beforeEach(() => {
  empezar.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});
afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

const corregir = () => page.getByRole("button", { name: "Corregir" });
const pedidos = () => empezar.mock.calls.map(([pedido]) => pedido as Record<string, string>);
const BIEN: Respuesta<unknown> = {
  ok: true,
  dato: { borradorId: "b1", version: 1, yaEstaba: false },
};

describe("lo vigente, solo para leer", () => {
  it.each([390, 1280])(
    "a %i px: sin violaciones como página, legible y tocable, sin desborde lateral",
    async (ancho) => {
      await ventana(ancho);
      await render(enArmazon("Datos fiscales", lecturaConCorregir()));
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
    },
  );

  it("muestra los cinco datos con su rótulo, «Rige desde el …» y un solo botón; nada para escribir", async () => {
    await render(lecturaConCorregir());
    const t = document.body.textContent ?? "";
    for (const esperado of [
      "CUIT30-71234567-8",
      "Razón socialDistribuidora Sur SA",
      "Condición frente al IVAIVA Responsable Inscripto",
      "Domicilio fiscalAv. Rivadavia 1234, Piso 3, Departamento B, Ciudad de Buenos Aires",
      "Inicio de actividades01/03/2018",
      "Rige desde el 12/10/2026.",
    ]) {
      expect(t).toContain(esperado);
    }
    await expect.element(corregir()).toBeVisible();
    expect(document.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(document.querySelectorAll("button")).toHaveLength(1);
  });
});

describe("ya hay un borrador (D-68)", () => {
  it.each([390, 1280])(
    "a %i px: el aviso, lo que rige y «Seguir con el borrador», sin violaciones",
    async (ancho) => {
      await ventana(ancho);
      await render(enArmazon("Datos fiscales", lecturaConBorrador()));
      await expect.element(page.getByText("Hay un borrador sin confirmar.")).toBeVisible();
      await expect
        .element(
          page.getByText(
            "Lo guardó otra persona o desde otro dispositivo. Los datos que rigen siguen siendo los de abajo.",
          ),
        )
        .toBeVisible();
      await expect.element(page.getByText("Distribuidora Sur SA")).toBeVisible();
      const seguir = page.getByRole("link", { name: "Seguir con el borrador" });
      await expect.element(seguir).toHaveAttribute("href", CORREGIR);
      expect(page.getByRole("button", { name: "Corregir" }).elements()).toHaveLength(0);
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
    },
  );
});

describe("«Corregir»", () => {
  it("pide el borrador con el emisor y un `borradorId` nuevo, y sigue al formulario", async () => {
    empezar.mockResolvedValue(BIEN);
    await render(lecturaConCorregir());
    tocar(corregir());
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(CORREGIR));
    expect(pedidos()).toHaveLength(1);
    expect(Object.keys(pedidos()[0] ?? {}).sort()).toEqual(["borradorId", "emisorId"]);
    expect(pedidos()[0]?.["emisorId"]).toBe(EMISOR);
    expect(pedidos()[0]?.["borradorId"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("si ya había un borrador (de otra pantalla) el servidor devuelve ESE y también sigue al formulario", async () => {
    empezar.mockResolvedValue({
      ok: true,
      dato: { borradorId: "otro", version: 9, yaEstaba: true },
    });
    await render(lecturaConCorregir());
    tocar(corregir());
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(CORREGIR));
  });

  it("doble toque: un solo pedido", async () => {
    let soltar: (r: Respuesta<unknown>) => void = () => undefined;
    empezar.mockReturnValue(
      new Promise<Respuesta<unknown>>((resolve) => {
        soltar = resolve;
      }),
    );
    await render(lecturaConCorregir());
    tocar(corregir());
    tocar(corregir());
    tocar(corregir());
    soltar(BIEN);
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(CORREGIR));
    expect(empezar).toHaveBeenCalledTimes(1);
  });

  it("la red se corta: el reintento reenvía el MISMO `borradorId` y queda «Verificando…»", async () => {
    empezar.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(BIEN);
    await render(lecturaConCorregir());
    tocar(corregir());
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(CORREGIR), { timeout: 5000 });
    expect(empezar).toHaveBeenCalledTimes(2);
    expect(pedidos()[1]).toEqual(pedidos()[0]);
  });

  it("un INESPERADO devuelto como valor no es definitivo: muestra la referencia y reintenta lo MISMO", async () => {
    empezar
      .mockResolvedValueOnce({
        ok: false,
        error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABCD-0123" },
      })
      .mockResolvedValueOnce(BIEN);
    await render(lecturaConCorregir());
    tocar(corregir());
    await expect.element(page.getByText("PD-ABCD-0123", { exact: false })).toBeVisible();
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(CORREGIR), { timeout: 5000 });
    expect(pedidos()[1]).toEqual(pedidos()[0]);
  });

  it("un `borradorId` NUEVO por cada toque: tras un rechazo definitivo, el toque siguiente usa otra clave", async () => {
    empezar
      .mockResolvedValueOnce({ ok: false, error: errorDeCodigo("SIN_PERMISO") })
      .mockResolvedValueOnce(BIEN);
    await render(lecturaConCorregir());
    tocar(corregir());
    await expect.element(page.getByText("No tiene permiso para hacer esto.")).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
    tocar(corregir());
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(CORREGIR));
    expect(pedidos()[1]?.["borradorId"]).not.toBe(pedidos()[0]?.["borradorId"]);
  });

  it("sin datos vigentes para corregir (`FISCAL_SIN_DATOS_FISCALES`): sigue al formulario, que parte de cero, sin mostrar un error", async () => {
    empezar.mockResolvedValue({ ok: false, error: errorDeCodigo("FISCAL_SIN_DATOS_FISCALES") });
    await render(lecturaConCorregir());
    tocar(corregir());
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(CORREGIR));
    expect(document.querySelector('[role="alert"], [role="status"] p')).toBeNull();
  });

  it("un rechazo sin permiso se dice con el texto del catálogo y sin el código", async () => {
    empezar.mockResolvedValue({ ok: false, error: errorDeCodigo("SIN_PERMISO") });
    await render(lecturaConCorregir());
    tocar(corregir());
    await expect.element(page.getByText("No tiene permiso para hacer esto.")).toBeVisible();
    expect(document.body.textContent).not.toContain("SIN_PERMISO");
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });
});
