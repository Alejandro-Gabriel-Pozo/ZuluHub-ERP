import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import {
  PERMITIDO,
  TODO_PERMITIDO,
  enArmazon,
  legibleYTocable,
  ventana,
} from "./ayudas-de-pruebas";
import { DetalleDelPuntoDeVenta } from "./DetalleDelPuntoDeVenta.cliente";
import {
  armarElPuntoDeVenta,
  type AccionesDePuntosDeVenta,
  type PuntoParaConfigurar,
} from "./modelo-de-puntos-de-venta";

/**
 * Los botones del detalle de un punto de venta según lo que el SERVIDOR deja hacer hoy (I1 del PR #122): lo que no, sale apagado con
 * su motivo a la vista y asociado al botón; tocarlo no envía ni abre nada. Hoy «Pasar a producción» sale apagado por el módulo en
 * desarrollo. Previene: abrir la ventana, confirmar y recién ahí recibir el rechazo. El servidor sigue decidiendo al enviar.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

type Accion = (pedido: unknown) => Promise<Respuesta<unknown>>;
const activar = vi.fn<Accion>();
const desactivar = vi.fn<Accion>();
const cambiarAmbiente = vi.fn<Accion>();

const EN_DESARROLLO = "Esta función todavía está en desarrollo.";
const SIN_PERMISO = "No tiene permiso para hacer esto.";
const apagada = (motivo: string) => ({ permitida: false, motivo });

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

const pantalla = (
  acciones: AccionesDePuntosDeVenta,
  cambios: Partial<PuntoParaConfigurar> = {},
) => {
  const punto = { ...PUNTO, ...cambios };
  return (
    <DetalleDelPuntoDeVenta
      armado={armarElPuntoDeVenta(punto)}
      punto={{ id: punto.id, activo: punto.activo, version: punto.version }}
      activar={activar}
      desactivar={desactivar}
      cambiarAmbiente={cambiarAmbiente}
      rutaDeEdicion={`/configuracion-fiscal/puntos-de-venta/${punto.id}?editar=1`}
      acciones={acciones}
    />
  );
};
// Lo que hoy entrega el servidor al gerente.
const DE_HOY: AccionesDePuntosDeVenta = {
  ...TODO_PERMITIDO,
  pasarAProduccion: apagada(EN_DESARROLLO),
};

beforeEach(() => {
  for (const f of [activar, desactivar, cambiarAmbiente, router.push, router.refresh])
    f.mockReset();
});

const boton = (nombre: string) => page.getByRole("button", { name: nombre });

describe("el detalle con lo que el servidor deja hacer hoy", () => {
  it.each([390, 1280])(
    "a %i px: «Pasar a producción» apagado con «Esta función todavía está en desarrollo.» a la vista, sin violaciones de axe",
    async (ancho) => {
      await ventana(ancho);
      await render(enArmazon("Punto de venta 00002", pantalla(DE_HOY)));
      const apagado = boton("Pasar a producción");
      await expect.element(apagado).toBeDisabled();
      await expect.element(page.getByText(EN_DESARROLLO)).toBeVisible();
      // El motivo describe al botón para el lector de pantalla.
      const descripcion = apagado.element().getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(descripcion)?.textContent).toBe(EN_DESARROLLO);
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
    },
  );

  it("lo que el servidor sí deja queda activo: Desactivar y Editar", async () => {
    await render(pantalla(DE_HOY));
    await expect.element(boton("Desactivar")).toBeEnabled();
    await expect.element(boton("Editar")).toBeEnabled();
  });

  it("tocar «Pasar a producción» apagado no abre la ventana ni envía nada", async () => {
    await render(pantalla(DE_HOY));
    tocar(boton("Pasar a producción"));
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    expect(cambiarAmbiente).not.toHaveBeenCalled();
  });

  it("sin permiso de desactivar: «Desactivar» apagado con su motivo; tocarlo no envía", async () => {
    await render(pantalla({ ...DE_HOY, desactivar: apagada(SIN_PERMISO) }));
    await expect.element(boton("Desactivar")).toBeDisabled();
    await expect.element(page.getByText(SIN_PERMISO)).toBeVisible();
    tocar(boton("Desactivar"));
    expect(desactivar).not.toHaveBeenCalled();
  });

  it("en uno no activo «Activar» depende de activar, no de desactivar", async () => {
    await render(pantalla({ ...DE_HOY, desactivar: apagada(SIN_PERMISO) }, { activo: false }));
    await expect.element(boton("Activar")).toBeEnabled();
  });

  it("sin permiso de editar: «Editar» apagado con su motivo; tocarlo no navega", async () => {
    await render(pantalla({ ...DE_HOY, editar: apagada(SIN_PERMISO) }));
    await expect.element(boton("Editar")).toBeDisabled();
    await expect.element(page.getByText(SIN_PERMISO)).toBeVisible();
    tocar(boton("Editar"));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("cuando el servidor lo deja, «Pasar a producción» está activo y abre la ventana (la regla es del servidor, no de la pantalla)", async () => {
    await render(pantalla({ ...DE_HOY, pasarAProduccion: PERMITIDO }));
    await expect.element(boton("Pasar a producción")).toBeEnabled();
    tocar(boton("Pasar a producción"));
    await expect.element(page.getByRole("dialog", { name: "¿Pasar a producción?" })).toBeVisible();
  });

  it("tras pasar a producción, la ventana se cierra y el foco va a la tarjeta del ambiente (el botón desaparece al refrescar)", async () => {
    cambiarAmbiente.mockResolvedValue({ ok: true, dato: { yaEstaba: false } });
    await render(pantalla(TODO_PERMITIDO));
    tocar(boton("Pasar a producción"));
    const ventanaDeConfirmar = page.getByRole("dialog", { name: "¿Pasar a producción?" });
    await expect.element(ventanaDeConfirmar).toBeVisible();
    tocar(ventanaDeConfirmar.getByRole("button", { name: "Pasar a producción" }));
    await vi.waitFor(() => {
      expect(cambiarAmbiente).toHaveBeenCalledTimes(1);
      expect(page.getByRole("dialog").elements()).toHaveLength(0);
      const activo = document.activeElement;
      expect(activo?.getAttribute("role")).toBe("group");
      expect(activo?.textContent).toContain("Ambiente");
    });
    // Se nombra con lo que dice: «Ambiente Pruebas» (el lector de pantalla lo anuncia al caer el foco).
    await expect.element(page.getByRole("group", { name: "Ambiente Pruebas" })).toBeVisible();
    expect(router.refresh).toHaveBeenCalled();
  });
});
