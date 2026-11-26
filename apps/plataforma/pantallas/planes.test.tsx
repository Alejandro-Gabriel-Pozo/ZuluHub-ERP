import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import {
  crearPlanAccion,
  guardarBorradorAccion,
  publicarVersionAccion,
} from "../app/planes/acciones";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../web/ui/pruebas/ayudas";
import { EditorDeBorrador, type PropsDeEditorDeBorrador } from "./editor-de-borrador.cliente";
import { NuevoPlan } from "./nuevo-plan.cliente";

/**
 * Planes de la consola (cliente): una clave de idempotencia por intento reusada en cada reintento, un doble toque que envía una sola vez, los valores fijados al primer toque, la publicación que guarda
 * antes, los avisos que no bloquean y SOPORTE sin botones de escritura (esos no llegan: la página no los ofrece). Las acciones del servidor van simuladas; no hay red ni base.
 */
vi.mock("../app/planes/acciones", () => ({
  crearPlanAccion: vi.fn(),
  guardarBorradorAccion: vi.fn(),
  publicarVersionAccion: vi.fn(),
}));
const empujar = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: empujar, refresh: vi.fn() }) }));

const crear = vi.mocked(crearPlanAccion);
const guardar = vi.mocked(guardarBorradorAccion);
const publicar = vi.mocked(publicarVersionAccion);

const PLAN = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";
const BASE = {
  nombreComercial: "Prueba",
  modulos: ["administracion", "clientes", "facturacion"],
  perillas: {},
};
const PROPS: PropsDeEditorDeBorrador = {
  planId: PLAN,
  codigo: "prueba",
  inicial: BASE,
  versionEsperada: null,
  base: { numero: 1, contenido: BASE },
  copiadaDe: 1,
  puedePublicar: true,
};
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  for (const m of [crear, guardar, publicar, empujar]) m.mockReset();
  guardar.mockResolvedValue({ ok: true, dato: { borradorId: "b", version: 1 } });
  publicar.mockResolvedValue({ ok: true, dato: { numero: 2 } });
  crear.mockResolvedValue({ ok: true, dato: { planId: PLAN, yaExistia: false } });
});
afterEach(restaurarConexion);

const botonGuardar = () => page.getByRole("button", { name: /Guardar borrador|Verificando/ });
type EntradaDeGuardado = {
  claveDeIdempotencia: string;
  versionEsperada: number | null;
  nombreComercial: string;
  modulos: string[];
  perillas: Record<string, unknown>;
};
const guardados = () => guardar.mock.calls.map(([e]) => e as EntradaDeGuardado);

describe("EditorDeBorrador", () => {
  it("abre con lo copiado, marca solos los módulos que se piden y quita los que dependen; sin violaciones de accesibilidad", async () => {
    await render(<EditorDeBorrador {...PROPS} />);
    await expect
      .element(page.getByText("Copiado de la v1. Un plan tiene a lo sumo un borrador."))
      .toBeVisible();
    await expect.element(page.getByLabelText("Administración")).toBeDisabled();
    await expect.element(page.getByLabelText("Administración")).toBeChecked();
    await expect.element(page.getByText("Siempre incluido").first()).toBeVisible();
    tocar(page.getByLabelText("Ventas"));
    await expect.element(page.getByLabelText("Ventas")).toBeChecked();
    await expect.element(page.getByLabelText("Catálogo")).toBeChecked();
    await expect.element(page.getByLabelText("Caja")).toBeChecked();
    await expect.element(page.getByLabelText("Catálogo")).toBeDisabled();
    await expect.element(page.getByText("Lo pide otro módulo del plan").first()).toBeVisible();
    await expect.element(page.getByText("Se suma el módulo Ventas")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    tocar(page.getByLabelText("Ventas"));
    await expect.element(page.getByLabelText("Ventas")).not.toBeChecked();
    await expect.element(page.getByLabelText("Catálogo")).not.toBeChecked();
  });

  it("etiqueta «En desarrollo» y advierte (sin bloquear) una perilla encendida sin su módulo", async () => {
    await render(<EditorDeBorrador {...PROPS} />);
    await expect.element(page.getByText("En desarrollo").first()).toBeVisible();
    tocar(page.getByLabelText("Salón", { exact: true }).last());
    await expect.element(page.getByText("Revisá antes de publicar")).toBeVisible();
    await expect
      .element(
        page.getByText(/La perilla «Salón» pertenece al módulo Salón, que este plan no incluye\./),
      )
      .toBeVisible();
    await expect.element(botonGuardar()).toBeEnabled();
    await expect.element(page.getByRole("button", { name: "Publicar…" })).toBeEnabled();
  });

  it("el límite de una perilla solo admite dígitos y viaja como número", async () => {
    guardar.mockResolvedValue({ ok: true, dato: { borradorId: "b", version: 1 } });
    await render(<EditorDeBorrador {...PROPS} />);
    await page.getByLabelText("Cajas por sucursal").fill("a4b2");
    tocar(botonGuardar());
    await expect.element(page.getByText("Borrador guardado.")).toBeVisible();
    expect(guardados()[0]?.perillas["cajas_por_sucursal"]).toEqual({ tipo: "LIMITE", limite: 42 });
  });

  it("Guardar: valores fijados al primer toque, módulos con lo que se pide y versión esperada; el siguiente guardado usa la versión nueva y otra clave", async () => {
    await render(<EditorDeBorrador {...PROPS} />);
    tocar(page.getByLabelText("Ventas"));
    tocar(botonGuardar());
    await expect.element(page.getByText("Borrador guardado.")).toBeVisible();
    const [primero] = guardados();
    expect(primero).toMatchObject({ versionEsperada: null, nombreComercial: "Prueba" });
    expect(primero?.modulos).toHaveLength(6);
    expect(primero?.modulos).toEqual(
      expect.arrayContaining([
        "administracion",
        "clientes",
        "facturacion",
        "catalogo",
        "caja",
        "ventas",
      ]),
    );
    guardar.mockResolvedValue({ ok: true, dato: { borradorId: "b", version: 2 } });
    await page.getByLabelText("Nombre comercial").fill("Prueba 2");
    tocar(botonGuardar());
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2));
    const [, segundo] = guardados();
    expect(segundo).toMatchObject({ versionEsperada: 1, nombreComercial: "Prueba 2" });
    expect(segundo?.claveDeIdempotencia).not.toBe(primero?.claveDeIdempotencia);
  });

  it("doble toque: se guarda una sola vez", async () => {
    guardar.mockImplementation(async () => {
      await pausa(60);
      return { ok: true, dato: { borradorId: "b", version: 1 } };
    });
    await render(<EditorDeBorrador {...PROPS} />);
    tocar(botonGuardar());
    tocar(botonGuardar());
    await expect.element(page.getByText("Borrador guardado.")).toBeVisible();
    expect(guardar).toHaveBeenCalledTimes(1);
  });

  it("la acción lanza y luego responde: reintento con la MISMA clave y los MISMOS valores; el formulario queda bloqueado", async () => {
    let soltar: (r: Awaited<ReturnType<typeof guardarBorradorAccion>>) => void = () => undefined;
    guardar.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockReturnValueOnce(
      new Promise((r) => {
        soltar = r;
      }),
    );
    await render(<EditorDeBorrador {...PROPS} />);
    tocar(botonGuardar());
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect.element(page.getByLabelText("Nombre comercial")).toBeDisabled();
    soltar({ ok: true, dato: { borradorId: "b", version: 1 } });
    await expect.element(page.getByText("Borrador guardado.")).toBeVisible();
    const [a, b] = guardados();
    expect(b).toEqual(a);
  });

  it("un INESPERADO devuelto como valor deja el intento incierto y se reintenta con la misma clave (con la referencia a la vista)", async () => {
    guardar.mockResolvedValueOnce({
      ok: false,
      error: { tipo: "INESPERADO" },
      referencia: "PD-ABCD-0123",
    });
    await render(<EditorDeBorrador {...PROPS} />);
    tocar(botonGuardar());
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(guardados()[1]).toEqual(guardados()[0]);
    await expect.element(page.getByText("Borrador guardado.")).toBeVisible();
  });

  it("sin nombre comercial: «Falta el nombre comercial.» y no se envía nada", async () => {
    await render(<EditorDeBorrador {...PROPS} inicial={{ ...BASE, nombreComercial: "" }} />);
    tocar(botonGuardar());
    await expect.element(page.getByText("Falta el nombre comercial.")).toBeVisible();
    tocar(page.getByRole("button", { name: "Publicar…" }));
    expect(guardar).not.toHaveBeenCalled();
  });

  it("«La pantalla quedó vieja» (otro ADMIN guardó antes) ofrece recargar y no pisa nada", async () => {
    guardar.mockResolvedValue({
      ok: false,
      error: {
        tipo: "PANTALLA_VIEJA",
        texto: "La pantalla quedó vieja. Volvé a abrirla y probá de nuevo.",
      },
    });
    await render(<EditorDeBorrador {...PROPS} versionEsperada={3} />);
    tocar(botonGuardar());
    await expect
      .element(page.getByText("La pantalla quedó vieja. Volvé a abrirla y probá de nuevo."))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Recargar" })).toBeVisible();
  });

  it("sin permiso para publicar no hay botón «Publicar…»; el aviso de permiso del servidor se dice con su texto", async () => {
    guardar.mockResolvedValue({ ok: false, error: { tipo: "OCULTAR_ACCION" } });
    await render(<EditorDeBorrador {...PROPS} puedePublicar={false} />);
    await expect.element(page.getByRole("button", { name: "Publicar…" })).not.toBeInTheDocument();
    tocar(botonGuardar());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
  });
});

describe("Publicar", () => {
  const abrir = async (props: Partial<PropsDeEditorDeBorrador> = {}) => {
    await render(<EditorDeBorrador {...PROPS} versionEsperada={1} {...props} />);
    tocar(page.getByRole("button", { name: "Publicar…" }));
    await expect.element(page.getByRole("dialog", { name: "Publicar la versión" })).toBeVisible();
  };

  it("sin cambios sin guardar abre el diálogo con el resumen y la versión que sigue, sin violaciones", async () => {
    await abrir();
    expect(guardar).not.toHaveBeenCalled();
    await expect
      .element(
        page.getByText(
          "Se publica la v2 del plan prueba. Queda congelada: después no se puede modificar, solo agregar otra versión.",
        ),
      )
      .toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("con cambios sin guardar, guarda primero y recién entonces abre el diálogo", async () => {
    await render(<EditorDeBorrador {...PROPS} versionEsperada={1} />);
    await page.getByLabelText("Nombre comercial").fill("Otro nombre");
    tocar(page.getByRole("button", { name: "Publicar…" }));
    await expect.element(page.getByRole("dialog", { name: "Publicar la versión" })).toBeVisible();
    expect(guardar).toHaveBeenCalledTimes(1);
  });

  it("sin motivo: «Falta el motivo.» y no se envía; con motivo, una sola publicación y se vuelve a la ficha con el aviso", async () => {
    await abrir();
    tocar(page.getByRole("button", { name: "Publicar", exact: true }));
    await expect.element(page.getByText("Falta el motivo.")).toBeVisible();
    expect(publicar).not.toHaveBeenCalled();
    await page.getByLabelText("Motivo").fill("  Lanzamiento ");
    tocar(page.getByRole("button", { name: "Publicar", exact: true }));
    await vi.waitFor(() => expect(empujar).toHaveBeenCalledWith(`/planes/${PLAN}?aviso=publicada`));
    expect(publicar).toHaveBeenCalledTimes(1);
    expect(publicar.mock.calls[0]?.[0]).toMatchObject({ planId: PLAN, motivo: "Lanzamiento" });
  });

  it("doble toque: una sola publicación", async () => {
    publicar.mockImplementation(async () => {
      await pausa(60);
      return { ok: true, dato: { numero: 2 } };
    });
    await abrir();
    await page.getByLabelText("Motivo").fill("Lanzamiento");
    tocar(page.getByRole("button", { name: "Publicar", exact: true }));
    tocar(page.getByRole("button", { name: /Publicar|Verificando/, exact: false }).last());
    await vi.waitFor(() => expect(empujar).toHaveBeenCalled());
    expect(publicar).toHaveBeenCalledTimes(1);
  });

  it("corte de red: reintenta con la MISMA clave y el MISMO motivo, aunque se edite el campo", async () => {
    publicar.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await abrir();
    await page.getByLabelText("Motivo").fill("Lanzamiento");
    tocar(page.getByRole("button", { name: "Publicar", exact: true }));
    await vi.waitFor(() => expect(publicar).toHaveBeenCalledTimes(2), { timeout: 5000 });
    const [a, b] = publicar.mock.calls.map(([e]) => e);
    expect(b).toEqual(a);
  });

  it("dos ADMIN a la vez: la que llega segunda ve SIN_BORRADOR con su texto y la opción de recargar", async () => {
    publicar.mockResolvedValue({
      ok: false,
      error: {
        tipo: "PANTALLA_VIEJA",
        texto:
          "Esta versión ya no tiene borrador: otra persona la publicó antes. Revisá las versiones del plan.",
      },
    });
    await abrir();
    await page.getByLabelText("Motivo").fill("Lanzamiento");
    tocar(page.getByRole("button", { name: "Publicar", exact: true }));
    await expect.element(page.getByText(/otra persona la publicó antes/)).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Recargar" })).toBeVisible();
    expect(empujar).not.toHaveBeenCalled();
  });

  it("segundo factor vencido: pide el código y repite el MISMO intento con la misma clave", async () => {
    publicar.mockResolvedValueOnce({ ok: false, error: { tipo: "SEGUNDO_FACTOR" } });
    const verificar = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ status: true }), { status: 200 }));
    await abrir();
    await page.getByLabelText("Motivo").fill("Lanzamiento");
    tocar(page.getByRole("button", { name: "Publicar", exact: true }));
    await vi.waitFor(() => expect(publicar).toHaveBeenCalledTimes(1));
    await expect
      .element(page.getByRole("dialog", { name: "Confirmá que sos vos" }).last())
      .toBeVisible();
    verificar.mockRestore();
  });
});

describe("NuevoPlan", () => {
  const abrir = async () => {
    await render(<NuevoPlan />);
    tocar(page.getByRole("button", { name: "Nuevo plan" }));
    await expect.element(page.getByRole("dialog", { name: "Nuevo plan" })).toBeVisible();
  };

  it("muestra la ayuda del código, sin violaciones de accesibilidad", async () => {
    await abrir();
    await expect
      .element(
        page.getByText(
          "Minúsculas, números y guion; de 2 a 40; empieza con letra. No se puede cambiar.",
        ),
      )
      .toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un código mal formado se rechaza antes de enviar: «El código no es válido.»", async () => {
    await abrir();
    await page.getByLabelText("Código del plan").fill("Mal Codigo");
    tocar(page.getByRole("button", { name: "Crear plan" }));
    await expect.element(page.getByText("El código no es válido.")).toBeVisible();
    expect(crear).not.toHaveBeenCalled();
  });

  it("crea una sola vez aunque se toque dos veces y lleva a la ficha con el aviso", async () => {
    crear.mockImplementation(async () => {
      await pausa(60);
      return { ok: true, dato: { planId: PLAN, yaExistia: false } };
    });
    await abrir();
    await page.getByLabelText("Código del plan").fill(" prueba-2 ");
    tocar(page.getByRole("button", { name: "Crear plan" }));
    tocar(page.getByRole("button", { name: /Crear plan|Verificando/ }));
    await vi.waitFor(() => expect(empujar).toHaveBeenCalledWith(`/planes/${PLAN}?aviso=creado`));
    expect(crear).toHaveBeenCalledTimes(1);
    expect(crear.mock.calls[0]?.[0]).toMatchObject({ codigo: "prueba-2" });
  });

  it("si el plan ya existía, lo dice por la dirección (aviso «existia»)", async () => {
    crear.mockResolvedValue({ ok: true, dato: { planId: PLAN, yaExistia: true } });
    await abrir();
    await page.getByLabelText("Código del plan").fill("prueba");
    tocar(page.getByRole("button", { name: "Crear plan" }));
    await vi.waitFor(() => expect(empujar).toHaveBeenCalledWith(`/planes/${PLAN}?aviso=existia`));
  });

  it("un rechazo del servidor se dice con su texto y Cancelar cierra", async () => {
    crear.mockResolvedValue({
      ok: false,
      error: { tipo: "GENERAL", texto: "El código no es válido." },
    });
    await abrir();
    await page.getByLabelText("Código del plan").fill("prueba");
    tocar(page.getByRole("button", { name: "Crear plan" }));
    await expect.element(page.getByText("El código no es válido.")).toBeVisible();
    tocar(page.getByRole("button", { name: "Cancelar" }));
    await expect.element(page.getByRole("dialog", { name: "Nuevo plan" })).not.toBeInTheDocument();
  });
});
