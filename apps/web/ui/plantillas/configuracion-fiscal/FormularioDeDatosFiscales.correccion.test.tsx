import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar } from "../../pruebas/ayudas";
import { FormularioDeDatosFiscales } from "./FormularioDeDatosFiscales.cliente";

/**
 * Guardar, confirmar rechazado, corregir y volver a confirmar (D-88), en Chromium con las acciones simuladas. Lo que se verifica:
 * tras el primer guardado exitoso el formulario trata el borrador como existente (el mismo id y la versión que devolvió el servidor) y,
 * como un domicilio no se edita (el mismo id con otro contenido es `ID_EN_USO`), el domicilio corregido sale con un id nuevo.
 * Previene: tener que recargar la página para corregir después de una confirmación rechazada.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const guardar = vi.fn<(pedido: unknown) => Promise<Respuesta<{ version: number }>>>();
const confirmar = vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>();

const LISTA = "/configuracion-fiscal";
const FALTA_EL_INICIO = {
  ok: false,
  error: { ...errorDeCodigo("FISCAL_CONFIGURACION_DATOS_INVALIDOS"), campo: "inicioActividades" },
} as const;

beforeEach(() => {
  guardar.mockReset();
  confirmar.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});

const boton = (nombre: string) => page.getByRole("button", { name: nombre });
const pedidos = () => guardar.mock.calls.map(([pedido]) => pedido as Record<string, unknown>);
const domicilioDe = (pedido: Record<string, unknown> | undefined) =>
  pedido?.["domicilio"] as { id: string; calle: string } | undefined;

async function abrirYConfirmarSinElInicio() {
  await render(
    <FormularioDeDatosFiscales
      emisorId="2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d"
      cuit="30712345678"
      borrador={null}
      vigente={null}
      hoy="2026-11-05"
      condicionesDeIva={[{ valor: "RESPONSABLE_INSCRIPTO", etiqueta: "IVA Responsable Inscripto" }]}
      guardar={guardar}
      confirmar={confirmar}
      rutaAlGuardar={LISTA}
      rutaAlConfirmar={LISTA}
      rutaAlCancelar={LISTA}
    />,
  );
  await page.getByLabelText("Razón social").fill("Mi Empresa SRL");
  await page.getByLabelText("Calle").fill("Mitre");
  tocar(boton("Confirmar"));
  await expect
    .element(page.getByLabelText("Inicio de actividades"))
    .toHaveAttribute("aria-invalid", "true");
}

describe("corregir después de una confirmación rechazada", () => {
  it("el segundo guardado sale con la versión devuelta, el mismo borrador y un domicilio con id nuevo", async () => {
    guardar.mockResolvedValueOnce({ ok: true, dato: { version: 1 } });
    guardar.mockResolvedValueOnce({ ok: true, dato: { version: 2 } });
    confirmar.mockResolvedValueOnce(FALTA_EL_INICIO).mockResolvedValueOnce({ ok: true, dato: {} });
    await abrirYConfirmarSinElInicio();
    expect(router.push).not.toHaveBeenCalled();

    await page.getByLabelText("Inicio de actividades").fill("2018-03-01");
    await page.getByLabelText("Calle").fill("Belgrano");
    tocar(boton("Confirmar"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));

    const [primero, segundo] = pedidos();
    expect(primero).not.toHaveProperty("versionEsperada");
    expect(segundo).toMatchObject({ borradorId: primero?.["borradorId"], versionEsperada: 1 });
    expect(domicilioDe(segundo)?.calle).toBe("Belgrano");
    expect(domicilioDe(segundo)?.id).not.toBe(domicilioDe(primero)?.id);
    expect(confirmar.mock.calls[1]?.[0]).toMatchObject({
      borradorId: primero?.["borradorId"],
      versionEsperada: 2,
    });
  });

  it("si solo se completa el inicio, el domicilio ya guardado no se vuelve a mandar", async () => {
    guardar.mockResolvedValueOnce({ ok: true, dato: { version: 1 } });
    guardar.mockResolvedValueOnce({ ok: true, dato: { version: 2 } });
    confirmar.mockResolvedValueOnce(FALTA_EL_INICIO).mockResolvedValueOnce({ ok: true, dato: {} });
    await abrirYConfirmarSinElInicio();

    await page.getByLabelText("Inicio de actividades").fill("2018-03-01");
    tocar(boton("Confirmar"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));

    expect(pedidos()[1]).toMatchObject({ versionEsperada: 1, inicioActividades: "2018-03-01" });
    expect(pedidos()[1]).not.toHaveProperty("domicilio");
  });
});
