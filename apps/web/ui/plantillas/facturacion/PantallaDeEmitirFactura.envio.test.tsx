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
  alPaso2,
  boton,
  campo,
  enArmazon,
  escribirRenglon,
  ID_FACTURA,
  listo,
  llegarARevisar,
  PUNTO_1,
  PUNTO_2_PRUEBAS,
  servidorFalso,
} from "../../pruebas/ayudas-de-emision";

/**
 * El envío de la factura en Chromium (una factura emitida no se borra, se anula): bloqueo del botón, doble toque, dos envíos a la vez,
 * corte de red, resultado inesperado y rechazo de negocio. Todos con la MISMA clave y los MISMOS valores en cada reintento. Los errores
 * (también los de un punto de venta que se ofrece y el servidor rechaza) se ven por la vía común, con su texto y sin el código.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

describe("emitir: el pedido", () => {
  it("lleva el cliente, el renglón con precio con IVA incluido, «productos», el punto de venta y UNA clave; sin empresa, emisor ni ambiente", async () => {
    const servidor = servidorFalso();
    await render(enArmazon({ emitir: servidor.emitir }));
    await llegarARevisar("dni");
    tocar(boton("Emitir factura"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    expect(servidor.pedidos[0]?.["clave"]).toMatch(UUID);
    expect({ ...servidor.pedidos[0], clave: "(la clave)" }).toEqual({
      clave: "(la clave)",
      puntoDeVentaId: PUNTO_1.id,
      concepto: "PRODUCTOS",
      servicio: null,
      modoDePrecio: "IVA_INCLUIDO",
      receptor: {
        nombre: "Juan Pérez",
        documento: { tipo: "DNI", numero: "27345678" },
        condicionIva: "CONSUMIDOR_FINAL",
        domicilio: null,
      },
      renglones: [
        {
          descripcion: "Medialunas (docena)",
          cantidad: "2",
          precioUnitario: "4500.00",
          descuento: null,
          alicuota: "21",
        },
      ],
    });
  });

  it("el consumidor final de una empresa que no discrimina IVA (letra C): sin documento, sin nombre y sin alícuota", async () => {
    const servidor = servidorFalso();
    await render(enArmazon({ emitir: servidor.emitir, discriminaIva: false }));
    await alPaso2();
    await escribirRenglon(1, { descripcion: "Café", cantidad: "1,5", precio: "1000,50" });
    await userEvent.click(boton("Siguiente"));
    tocar(boton("Emitir factura"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    expect(servidor.pedidos[0]).toMatchObject({
      receptor: {
        nombre: null,
        documento: { tipo: "SIN_IDENTIFICAR" },
        condicionIva: "CONSUMIDOR_FINAL",
      },
      renglones: [
        { descripcion: "Café", cantidad: "1.5", precioUnitario: "1000.50", alicuota: null },
      ],
    });
  });

  it("con varios puntos de venta manda el que se eligió, también el de pruebas", async () => {
    const servidor = servidorFalso();
    await render(enArmazon({ emitir: servidor.emitir, puntosDeVenta: [PUNTO_1, PUNTO_2_PRUEBAS] }));
    await llegarARevisar();
    await userEvent.selectOptions(
      page.getByRole("combobox", { name: "Punto de venta" }),
      PUNTO_2_PRUEBAS.id,
    );
    tocar(boton("Emitir factura"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    expect(servidor.pedidos[0]?.["puntoDeVentaId"]).toBe(PUNTO_2_PRUEBAS.id);
  });

  it("varios renglones: uno por uno, en orden, con su alícuota", async () => {
    const servidor = servidorFalso();
    await render(enArmazon({ emitir: servidor.emitir }));
    await alPaso2();
    await userEvent.click(boton("+ Agregar renglón"));
    await escribirRenglon(1, { descripcion: "Hospedaje", precio: "25000", iva: "21" });
    await escribirRenglon(2, {
      descripcion: "Desayuno",
      cantidad: "3",
      precio: "5000",
      iva: "10.5",
    });
    await userEvent.click(boton("Siguiente"));
    await expect.element(page.getByText("$ 40.000,00")).toBeVisible();
    tocar(boton("Emitir factura"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    const renglones = servidor.pedidos[0]?.["renglones"] as Record<string, unknown>[];
    expect(
      renglones.map((r) => [r["descripcion"], r["cantidad"], r["precioUnitario"], r["alicuota"]]),
    ).toEqual([
      ["Hospedaje", "1", "25000.00", "21"],
      ["Desayuno", "3", "5000.00", "10.5"],
    ]);
  });
});

describe("emitir: el envío es idempotente por intento", () => {
  it("el botón se bloquea al primer toque («Enviando…»), nada se edita y, al terminar, abre el detalle del comprobante", async () => {
    let terminar: (r: Respuesta<{ comprobanteId: string }>) => void = () => undefined;
    const servidor = servidorFalso(() => new Promise((resolver) => (terminar = resolver)));
    const irA = vi.fn();
    await render(
      enArmazon({ emitir: servidor.emitir, irA, puntosDeVenta: [PUNTO_1, PUNTO_2_PRUEBAS] }),
    );
    await llegarARevisar();
    await userEvent.selectOptions(
      page.getByRole("combobox", { name: "Punto de venta" }),
      PUNTO_1.id,
    );
    tocar(boton("Emitir factura"));
    await expect.element(boton("Enviando…")).toHaveAttribute("aria-disabled", "true");
    await expect.element(boton("Enviando…")).toHaveAttribute("aria-busy", "true");
    expect(servidor.pedidos).toHaveLength(1);
    // Mientras se envía no se vuelve atrás ni se cambia el punto de venta.
    await expect.element(boton("Volver")).toBeDisabled();
    await expect.element(page.getByRole("combobox", { name: "Punto de venta" })).toBeDisabled();
    expect(irA).not.toHaveBeenCalled();
    terminar(listo);
    await vi.waitFor(() =>
      expect(irA).toHaveBeenCalledWith(`/facturacion/comprobantes/${ID_FACTURA}`),
    );
    // Ya se hizo: hasta que la navegación cambie la página, el botón sigue bloqueado (otro toque sería otra factura).
    await expect.element(boton("Enviando…")).toHaveAttribute("aria-disabled", "true");
    tocar(boton("Enviando…"));
    tocar(boton("Enviando…"));
    expect(servidor.pedidos).toHaveLength(1);
    expect(irA).toHaveBeenCalledTimes(1);
  });

  it("un doble toque (tres, en el mismo instante) es UNA emisión", async () => {
    const servidor = servidorFalso(
      () => new Promise((resolver) => setTimeout(() => resolver(listo), 60)),
    );
    const irA = vi.fn();
    await render(enArmazon({ emitir: servidor.emitir, irA }));
    await llegarARevisar();
    tocar(boton("Emitir factura"));
    tocar(boton("Emitir factura"));
    tocar(boton("Emitir factura"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalledTimes(1));
    expect(servidor.pedidos).toHaveLength(1);
  });

  it("dos envíos simultáneos salen con la misma clave: uno solo llega al servidor", async () => {
    const servidor = servidorFalso(
      () => new Promise((resolver) => setTimeout(() => resolver(listo), 60)),
    );
    await render(enArmazon({ emitir: servidor.emitir }));
    await llegarARevisar();
    const el = boton("Emitir factura").element() as HTMLElement;
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
    await llegarARevisar("dni");
    tocar(boton("Emitir factura"));
    await expect.element(page.getByText("Verificando si se registró…")).toBeVisible();
    // Con el resultado incierto no se puede empezar otro intento ni cambiar lo que se mandó.
    await expect.element(boton("Emitir factura")).toBeDisabled();
    await expect.element(boton("Volver")).toBeDisabled();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await vi.waitFor(() =>
      expect(irA).toHaveBeenCalledWith(`/facturacion/comprobantes/${ID_FACTURA}`),
    );
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
    await llegarARevisar();
    tocar(boton("Emitir factura"));
    await expect.element(page.getByText("PD-ABC123", { exact: false })).toBeVisible();
    // Agotadas las verificaciones automáticas queda el «Reintentar» a mano.
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(4), { timeout: 3000 });
    await expect.element(boton("Reintentar")).toBeVisible();
    expect(document.body.textContent).not.toContain("ERROR_INTERNO");
    await userEvent.click(boton("Reintentar"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalled(), { timeout: 3000 });
    expect(servidor.pedidos).toHaveLength(5);
    expect(new Set(servidor.pedidos.map((p) => p["clave"])).size).toBe(1);
    for (const pedido of servidor.pedidos) expect(pedido).toEqual(servidor.pedidos[0]);
  });

  it("sin conexión el botón está apagado y dice por qué; no se manda nada", async () => {
    const servidor = servidorFalso();
    await render(enArmazon({ emitir: servidor.emitir }));
    await llegarARevisar();
    simularConexion(false);
    await expect.element(boton("Emitir factura")).toBeDisabled();
    await expect
      .element(boton("Emitir factura"))
      .toHaveAccessibleDescription("No se puede enviar sin conexión.");
    expect(servidor.pedidos).toHaveLength(0);
  });
});

describe("emitir: lo que rechaza el servidor se ve por la vía común", () => {
  it("un rechazo de negocio es definitivo: se ve su texto sin el código, se puede volver a corregir y el nuevo intento lleva OTRA clave y los valores corregidos", async () => {
    const servidor = servidorFalso((n) =>
      Promise.resolve(
        n === 1 ? { ok: false, error: errorDeCodigo("FISCAL_RECEPTOR_INVALIDO") } : listo,
      ),
    );
    await render(enArmazon({ emitir: servidor.emitir }));
    await llegarARevisar("dni");
    tocar(boton("Emitir factura"));
    await expect
      .element(page.getByText("Revisá los datos del cliente.", { exact: true }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("FISCAL_RECEPTOR_INVALIDO");
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    // Se vuelve al cliente, se corrige el nombre y se emite de nuevo.
    await expect.element(boton("Volver")).toBeEnabled();
    await userEvent.click(boton("Volver"));
    await userEvent.click(boton("Volver"));
    await userEvent.clear(campo("Nombre o razón social"));
    await userEvent.type(campo("Nombre o razón social"), "Juana Pérez");
    await userEvent.click(boton("Siguiente"));
    await userEvent.click(boton("Siguiente"));
    // El error anterior ya no está.
    expect(document.body.textContent).not.toContain("Revisá los datos del cliente");
    tocar(boton("Emitir factura"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(2));
    expect(servidor.pedidos[1]?.["clave"]).not.toBe(servidor.pedidos[0]?.["clave"]);
    expect(servidor.pedidos[1]).toMatchObject({ receptor: { nombre: "Juana Pérez" } });
  });

  it("un rechazo con el campo del cliente vuelve al paso del cliente y lo marca; al corregirlo la marca se va y el nuevo intento lleva otra clave y el domicilio escrito", async () => {
    const servidor = servidorFalso((n) =>
      Promise.resolve(
        n === 1
          ? {
              ok: false,
              error: { ...errorDeCodigo("FISCAL_RECEPTOR_INVALIDO"), campo: "receptor.domicilio" },
            }
          : listo,
      ),
    );
    await render(enArmazon({ emitir: servidor.emitir }));
    await llegarARevisar("dni");
    tocar(boton("Emitir factura"));
    // Vuelve al paso del cliente (ya no se ve «Revisá y emití») con SOLO el domicilio marcado, con el aviso genérico.
    await expect.element(campo("Domicilio")).toHaveAttribute("aria-invalid", "true");
    await expect.element(page.getByText("Revisá este dato.")).toBeVisible();
    await expect.element(campo("Nombre o razón social")).not.toHaveAttribute("aria-invalid");
    await expect.element(campo("DNI")).not.toHaveAttribute("aria-invalid");
    expect(document.body.textContent).not.toContain("Revisá y emití");
    expect(document.body.textContent).not.toContain("FISCAL_RECEPTOR_INVALIDO");
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await userEvent.type(campo("Domicilio"), "Av. Siempreviva 742");
    await expect.element(campo("Domicilio")).not.toHaveAttribute("aria-invalid");
    await userEvent.click(boton("Siguiente"));
    await userEvent.click(boton("Siguiente"));
    tocar(boton("Emitir factura"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(2));
    expect(servidor.pedidos[1]?.["clave"]).not.toBe(servidor.pedidos[0]?.["clave"]);
    expect(servidor.pedidos[1]).toMatchObject({ receptor: { domicilio: "Av. Siempreviva 742" } });
  });

  it("un rechazo del cliente sin campo se ve en el paso final, como siempre", async () => {
    const servidor = servidorFalso(() =>
      Promise.resolve({ ok: false, error: errorDeCodigo("FISCAL_RECEPTOR_INVALIDO") }),
    );
    await render(enArmazon({ emitir: servidor.emitir }));
    await llegarARevisar("dni");
    tocar(boton("Emitir factura"));
    await expect
      .element(page.getByText("Revisá los datos del cliente.", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Revisá y emití")).toBeVisible();
  });

  it.each([
    ["MODULO_EN_DESARROLLO", "Esta función todavía está en desarrollo."],
    ["MODULO_EN_SOLO_LECTURA", "Esta función quedó en solo lectura"],
    ["SIN_PERMISO", "No tiene permiso para hacer esto."],
    ["EMPRESA_NO_OPERA", "La empresa no está operando en este momento."],
    ["SESION_VENCIDA", "Tu sesión venció"],
    ["FISCAL_SUCURSAL_CERRADA", "Sucursal cerrada."],
    ["FISCAL_PUNTO_DE_VENTA_INACTIVO", "El punto de venta está inactivo."],
    ["FISCAL_SIN_CERTIFICADO", "No hay un certificado de ARCA vigente"],
    ["FISCAL_DATOS_INVALIDOS", "Revise los datos del comprobante"],
  ] as const)(
    "%s: un punto de venta que se ofreció y el servidor rechaza muestra su motivo, sin el código",
    async (codigo, esperado) => {
      const servidor = servidorFalso(() =>
        Promise.resolve({ ok: false, error: errorDeCodigo(codigo) }),
      );
      await render(enArmazon({ emitir: servidor.emitir }));
      await llegarARevisar();
      tocar(boton("Emitir factura"));
      await expect.element(page.getByText(esperado, { exact: false })).toBeVisible();
      expect(document.body.textContent).not.toContain(codigo);
      // El rechazo es definitivo: el botón vuelve a estar disponible.
      await expect.element(boton("Emitir factura")).toBeEnabled();
    },
  );
});
