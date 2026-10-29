import { afterEach, describe, expect, it, vi } from "vitest";
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
  violacionesDeAccesibilidad,
} from "../../pruebas/ayudas";
import {
  anularUnaParte,
  boton,
  campo,
  conMotivo,
  enArmazon,
  ID,
  listo,
  motivo,
  servidorFalso,
} from "../../pruebas/ayudas-de-anulacion";

/**
 * El envío de la anulación en Chromium (el dinero se mueve una sola vez): bloqueo del botón («Anulando…»), doble toque, dos envíos a
 * la vez, corte de red, resultado inesperado y rechazo de negocio. Todos con la MISMA clave y los MISMOS valores en cada reintento.
 */

afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

describe("anular: el envío es idempotente por intento", () => {
  it("el pedido lleva un renglón por alícuota, el motivo y UNA clave; el botón se bloquea («Anulando…») y al terminar vuelve al detalle", async () => {
    let terminar: (r: Respuesta<{ comprobanteId: string }>) => void = () => undefined;
    const servidor = servidorFalso(() => new Promise((resolver) => (terminar = resolver)));
    const irA = vi.fn();
    await render(enArmazon({ emitir: servidor.emitir, irA }));
    await anularUnaParte();
    await userEvent.type(campo("IVA 21 %"), "20000");
    await userEvent.type(campo("IVA 10,5 %"), "40000,25");
    await conMotivo("  Se facturó de más  ");
    tocar(boton("Anular comprobante"));
    await expect.element(boton("Anulando…")).toHaveAttribute("aria-disabled", "true");
    await expect.element(boton("Anulando…")).toHaveAttribute("aria-busy", "true");
    expect(servidor.pedidos).toHaveLength(1);
    expect(servidor.pedidos[0]?.["clave"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect({ ...servidor.pedidos[0], clave: "(la clave)" }).toEqual({
      clave: "(la clave)",
      comprobanteAsociadoId: ID,
      puntoDeVentaId: null,
      concepto: "PRODUCTOS",
      servicio: null,
      modoDePrecio: "IVA_INCLUIDO",
      renglones: [
        {
          descripcion: "Anulación parcial de la factura 00001-00000123, IVA 21 %",
          cantidad: "1",
          precioUnitario: "20000.00",
          descuento: null,
          alicuota: "21",
        },
        {
          descripcion: "Anulación parcial de la factura 00001-00000123, IVA 10,5 %",
          cantidad: "1",
          precioUnitario: "40000.25",
          descuento: null,
          alicuota: "10.5",
        },
      ],
      motivo: "Se facturó de más",
    });
    // Mientras se envía no se edita nada.
    await expect.element(motivo()).toBeDisabled();
    await expect.element(boton("Volver")).toBeDisabled();
    expect(irA).not.toHaveBeenCalled();
    terminar(listo);
    await vi.waitFor(() => expect(irA).toHaveBeenCalledWith(`/facturacion/comprobantes/${ID}`));
    // Ya se hizo: hasta que la navegación cambie la página, el botón sigue bloqueado (otro toque sería otra nota).
    await expect.element(boton("Anulando…")).toHaveAttribute("aria-disabled", "true");
    tocar(boton("Anulando…"));
    tocar(boton("Anulando…"));
    expect(servidor.pedidos).toHaveLength(1);
  });

  it("anular el total manda un renglón por alícuota con lo facturado; letra C, uno solo sin alícuota", async () => {
    const servidor = servidorFalso();
    await render(enArmazon({ emitir: servidor.emitir }));
    await conMotivo();
    tocar(boton("Anular comprobante"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    const renglones = servidor.pedidos[0]?.["renglones"] as Record<string, unknown>[];
    expect(renglones.map((r) => [r["alicuota"], r["precioUnitario"]])).toEqual([
      ["21", "60500.00"],
      ["10.5", "30250.00"],
    ]);
  });

  it("un doble toque (tres, en el mismo instante) es UNA emisión", async () => {
    const servidor = servidorFalso(
      () => new Promise((resolver) => setTimeout(() => resolver(listo), 60)),
    );
    const irA = vi.fn();
    await render(enArmazon({ emitir: servidor.emitir, irA }));
    await conMotivo();
    tocar(boton("Anular comprobante"));
    tocar(boton("Anular comprobante"));
    tocar(boton("Anular comprobante"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalledTimes(1));
    expect(servidor.pedidos).toHaveLength(1);
  });

  it("dos envíos simultáneos salen con la misma clave: uno solo llega al servidor", async () => {
    const servidor = servidorFalso(
      () => new Promise((resolver) => setTimeout(() => resolver(listo), 60)),
    );
    await render(enArmazon({ emitir: servidor.emitir }));
    await conMotivo();
    const el = boton("Anular comprobante").element() as HTMLElement;
    el.click();
    el.click();
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 120));
    expect(servidor.pedidos).toHaveLength(1);
  });

  it("corte de red: «Verificando si se registró…» y el reintento reenvía la MISMA clave con los MISMOS valores", async () => {
    const servidor = servidorFalso((n) =>
      n === 1 ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(listo),
    );
    const irA = vi.fn();
    await page.viewport(390, 2000);
    await render(enArmazon({ emitir: servidor.emitir, irA, esperaEntreVerificacionesMs: 400 }));
    await conMotivo();
    tocar(boton("Anular comprobante"));
    await expect.element(page.getByText("Verificando si se registró…")).toBeVisible();
    // Con el resultado incierto no se puede empezar otro intento ni cambiar lo que se mandó.
    await expect.element(boton("Anular comprobante")).toBeDisabled();
    await expect.element(motivo()).toBeDisabled();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await vi.waitFor(() => expect(irA).toHaveBeenCalled());
    expect(servidor.pedidos).toHaveLength(2);
    expect(servidor.pedidos[1]).toEqual(servidor.pedidos[0]);
    expect(servidor.pedidos[1]?.["clave"]).toBe(servidor.pedidos[0]?.["clave"]);
  });

  it("un resultado INESPERADO devuelto como valor no borra la clave: se reintenta con la misma, y a mano también", async () => {
    const inesperado: Respuesta<{ comprobanteId: string }> = {
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    };
    const servidor = servidorFalso((n) => Promise.resolve(n <= 4 ? inesperado : listo));
    const irA = vi.fn();
    await render(enArmazon({ emitir: servidor.emitir, irA }));
    await conMotivo();
    tocar(boton("Anular comprobante"));
    await expect.element(page.getByText("PD-ABC123", { exact: false })).toBeVisible();
    // Agotadas las verificaciones automáticas queda el «Reintentar» a mano.
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(4), { timeout: 3000 });
    await expect.element(boton("Reintentar")).toBeVisible();
    // Salida sin cambiar la clave (D-11): «Cancelar» lleva al Detalle.
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", `/facturacion/comprobantes/${ID}`);
    expect(document.body.textContent).not.toContain("ERROR_INTERNO");
    await userEvent.click(boton("Reintentar"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalled(), { timeout: 3000 });
    expect(servidor.pedidos).toHaveLength(5);
    expect(new Set(servidor.pedidos.map((p) => p["clave"])).size).toBe(1);
    for (const pedido of servidor.pedidos) expect(pedido).toEqual(servidor.pedidos[0]);
  });

  it("un rechazo de negocio es definitivo: se ve su texto sin el código y el nuevo intento lleva OTRA clave", async () => {
    const servidor = servidorFalso((n) =>
      Promise.resolve(
        n === 1 ? { ok: false, error: errorDeCodigo("FISCAL_MOTIVO_INVALIDO") } : listo,
      ),
    );
    await render(enArmazon({ emitir: servidor.emitir }));
    await conMotivo("Primer motivo");
    tocar(boton("Anular comprobante"));
    await expect.element(page.getByText("Escriba el motivo", { exact: false })).toBeVisible();
    expect(document.body.textContent).not.toContain("FISCAL_MOTIVO_INVALIDO");
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await expect.element(motivo()).toBeEnabled();
    await userEvent.type(motivo(), " corregido");
    tocar(boton("Anular comprobante"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(2));
    expect(servidor.pedidos[1]?.["clave"]).not.toBe(servidor.pedidos[0]?.["clave"]);
    expect(servidor.pedidos[1]?.["motivo"]).toBe("Primer motivo corregido");
  });

  it("sin conexión el botón está apagado y dice por qué; no se manda nada", async () => {
    const servidor = servidorFalso();
    await render(enArmazon({ emitir: servidor.emitir }));
    await conMotivo();
    simularConexion(false);
    await expect.element(boton("Anular comprobante")).toBeDisabled();
    await expect
      .element(boton("Anular comprobante"))
      .toHaveAccessibleDescription("No se puede enviar sin conexión.");
    expect(servidor.pedidos).toHaveLength(0);
  });
});
