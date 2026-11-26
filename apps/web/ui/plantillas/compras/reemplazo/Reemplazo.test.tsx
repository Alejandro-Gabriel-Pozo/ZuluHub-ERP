import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import { FormularioDeReemplazar, type QueSeReemplaza } from "./FormularioDeReemplazar.cliente";
import { PantallaDeReemplazo } from "./PantallaDeReemplazo";
import { renglonesDeLaCompra, type PasoPrevio } from "./modelo-de-reemplazo";
import { textosDeReemplazo } from "./textos-de-reemplazo";

/**
 * «Reemplazar el comprobante» en Chromium (NOTAS-2c-2; pantalla 11): «Qué hay que deshacer antes» en el orden del servidor con enlaces solo donde hay permiso; el formulario del comprobante nuevo con el motivo precargado
 * (editable y obligatorio), el aviso del costo del stock solo cuando el importe difiere, el pedido con la clave del intento y, en el cambio de la compra, la factura que se miraba. Un doble toque es UNA petición; lo que
 * rechaza el servidor se ve como el genérico.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FACTURA = "5d5d5d5d-1111-4222-8333-444444444444";
const COMPRA = "6e6e6e6e-1111-4222-8333-444444444444";
const NUEVA = "7f7f7f7f-1111-4222-8333-444444444444";
const PRODUCTO = "0b0b0b0b-1111-4222-8333-444444444444";
const GENERICO = {
  codigo: "COMPRAS_ACCION_NO_PERMITIDA",
  clave: "compras.error.sin_permiso",
  presentacion: "AVISO",
} as const;
const textos = textosDeReemplazo();
const AVISO = "El costo del stock no cambia; si hace falta, usá Corregir lo recibido";
const MOTIVO = "Reemplazada por la factura 0004-00005678";

afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });
const enlace = (nombre: string) => page.getByRole("link", { name: nombre, exact: true });

const PASOS: readonly PasoPrevio[] = [
  { freno: "PAGO_VIGENTE", ruta: `/compras/${COMPRA}` },
  { freno: "CONCILIACIONES_VIVAS", ruta: null },
  { freno: "NOTAS_VIGENTES", ruta: `/compras/facturas/${FACTURA}/notas` },
];

describe("PantallaDeReemplazo: qué hay que deshacer antes", () => {
  it("lista los pasos en el orden del servidor; con enlace solo los que tienen permiso (los demás se muestran sin enlace)", async () => {
    await render(
      <PantallaDeReemplazo pasos={PASOS} textos={textos}>
        <p>formulario</p>
      </PantallaDeReemplazo>,
    );
    await expect
      .element(page.getByRole("heading", { name: "Qué hay que deshacer antes" }))
      .toBeVisible();
    const items = page.getByRole("listitem");
    await expect.element(items.nth(0)).toHaveTextContent("Pago");
    await expect.element(items.nth(1)).toHaveTextContent("Conciliaciones");
    await expect.element(items.nth(2)).toHaveTextContent("Notas de la factura");
    await expect.element(enlace("Pago")).toHaveAttribute("href", `/compras/${COMPRA}`);
    await expect
      .element(enlace("Notas de la factura"))
      .toHaveAttribute("href", `/compras/facturas/${FACTURA}/notas`);
    await expect.element(enlace("Conciliaciones")).not.toBeInTheDocument();
    await expect.element(page.getByText("formulario")).toBeVisible();
  });

  it("sin pasos previos no se dibuja la sección (sin texto nuevo) y se ve el formulario", async () => {
    await render(
      <PantallaDeReemplazo pasos={[]} textos={textos}>
        <p>formulario</p>
      </PantallaDeReemplazo>,
    );
    await expect.element(page.getByText("Qué hay que deshacer antes")).not.toBeInTheDocument();
    await expect.element(page.getByText("formulario")).toBeVisible();
  });

  it("cumple accesibilidad (axe) con los pasos", async () => {
    await render(
      <PantallaDeReemplazo pasos={PASOS} textos={textos}>
        <p>formulario</p>
      </PantallaDeReemplazo>,
    );
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });
});

describe("FormularioDeReemplazar", () => {
  function servidorFalso(
    respuesta: () => Promise<Respuesta<{ comprobanteId: string; yaExistia: boolean }>> = () =>
      Promise.resolve({ ok: true, dato: { comprobanteId: NUEVA, yaExistia: false } }),
  ) {
    const pedidos: Record<string, unknown>[] = [];
    return {
      pedidos,
      enviar: (pedido: unknown) => {
        pedidos.push(pedido as Record<string, unknown>);
        return respuesta();
      },
      buscarProductos: (texto: string) =>
        Promise.resolve({
          ok: true as const,
          dato: {
            productos: texto.toLowerCase().includes("harina")
              ? [{ productoId: PRODUCTO, nombre: "Harina 000", unidadBase: "GRAMO" }]
              : [],
          },
        }),
      cotizarFactura: () =>
        Promise.resolve({
          ok: true as const,
          dato: {
            lineas: [{ netoDeLinea: "2000.00", ivaDeLinea: "420.00" }],
            totalCalculado: "2420.00",
            totalSegunFactura: "2420.00",
            totalCoincide: true,
          },
        }),
    };
  }

  const DE_FACTURA: QueSeReemplaza = { tipo: "FACTURA", comprobanteId: FACTURA };
  const DE_COMPRA: QueSeReemplaza = {
    tipo: "COMPRA",
    recepcionId: COMPRA,
    facturaVigenteVistaId: FACTURA,
    renglones: renglonesDeLaCompra([
      { numero: 1, producto: "Harina 000", cantidadEnStock: "2000.0000", unidadDeStockId: "GRAMO" },
    ]),
  };

  const formulario = (
    servidor: ReturnType<typeof servidorFalso>,
    extra: Partial<Parameters<typeof FormularioDeReemplazar>[0]> = {},
  ) => (
    <FormularioDeReemplazar
      textos={textos}
      que={DE_FACTURA}
      importeOriginal="2420.00"
      conPasosPendientes={false}
      buscarProductos={servidor.buscarProductos}
      cotizarFactura={servidor.cotizarFactura}
      enviar={servidor.enviar}
      esperaDeLaLecturaMs={10}
      irA={() => undefined}
      {...extra}
    />
  );

  /** La factura nueva sin el producto ni el total (según el caso). */
  async function escribirLaFactura(total = "2420", conProducto = true) {
    if (conProducto) {
      await userEvent.type(page.getByRole("combobox", { name: "Agregar producto" }), "harina");
      await userEvent.click(page.getByRole("option", { name: /Harina 000/ }));
    }
    await userEvent.selectOptions(page.getByLabelText("Tipo"), "FACTURA_A");
    await userEvent.type(page.getByLabelText("Punto de venta"), "4");
    await userEvent.type(page.getByLabelText("Número"), "5678");
    await userEvent.fill(page.getByLabelText("Fecha de la factura"), "2026-11-20");
    // En la compra (N1/N2) la cantidad ya viene precargada con lo que entró al stock.
    if (conProducto) await userEvent.type(page.getByLabelText("Cantidad facturada"), "2000");
    await userEvent.type(page.getByLabelText("Precio neto"), "1");
    await userEvent.fill(page.getByLabelText("Total según la factura"), total);
  }

  it("el botón «Reemplazar» está apagado hasta que el comprobante nuevo está completo; no se elige proveedor ni sucursal", async () => {
    await render(formulario(servidorFalso()));
    await expect.element(boton("Reemplazar")).toBeDisabled();
    await expect.element(page.getByLabelText("Proveedor")).not.toBeInTheDocument();
    await expect.element(page.getByLabelText("Sucursal")).not.toBeInTheDocument();
    await escribirLaFactura();
    await expect.element(boton("Reemplazar")).toBeEnabled();
  });

  it("el motivo viene precargado con el número de la factura nueva, se puede editar y es obligatorio", async () => {
    await render(formulario(servidorFalso()));
    const motivo = page.getByLabelText("Motivo");
    await expect.element(motivo).toHaveValue("");
    await escribirLaFactura();
    await expect.element(motivo).toHaveValue(MOTIVO);
    await userEvent.fill(motivo, "");
    await expect.element(boton("Reemplazar")).toBeDisabled();
    await userEvent.fill(motivo, "La anuló el proveedor");
    await expect.element(boton("Reemplazar")).toBeEnabled();
  });

  it("el pedido lleva solo lo declarado (la factura que se reemplaza, el motivo, la factura nueva con el producto de cada línea) con la clave del intento; sin proveedor ni sucursal", async () => {
    const servidor = servidorFalso();
    await render(formulario(servidor));
    await escribirLaFactura();
    tocar(boton("Reemplazar"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    const pedido = servidor.pedidos[0] as { clave: string; factura: Record<string, unknown> };
    expect(Object.keys(pedido).sort()).toEqual(["clave", "comprobanteId", "factura", "motivo"]);
    expect(pedido.clave).toMatch(UUID);
    expect(pedido).toMatchObject({ comprobanteId: FACTURA, motivo: MOTIVO });
    expect(pedido.factura).toMatchObject({
      tipo: "FACTURA_A",
      puntoDeVenta: "4",
      numero: "5678",
      totalSegunFactura: "2420.00",
      lineas: [
        { productoId: PRODUCTO, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" },
      ],
    });
    expect(Object.keys(pedido.factura)).not.toContain("proveedorId");
  });

  it("el aviso del costo del stock aparece solo cuando el importe de la nueva difiere de la original (texto, sin cuentas)", async () => {
    await render(formulario(servidorFalso()));
    await expect.element(page.getByText(AVISO)).not.toBeInTheDocument();
    await escribirLaFactura("2420");
    await expect.element(page.getByText(AVISO)).not.toBeInTheDocument();
    await userEvent.fill(page.getByLabelText("Total según la factura"), "2500");
    await expect.element(page.getByText(AVISO)).toBeVisible();
    await userEvent.fill(page.getByLabelText("Total según la factura"), "2420");
    await expect.element(page.getByText(AVISO)).not.toBeInTheDocument();
  });

  it("con pasos previos pendientes el envío queda apagado (el servidor igual los revalida)", async () => {
    await render(formulario(servidorFalso(), { conPasosPendientes: true }));
    await escribirLaFactura();
    await expect.element(boton("Reemplazar")).toBeDisabled();
  });

  it("un doble toque es UN reemplazo, y al terminar abre la factura nueva", async () => {
    const servidor = servidorFalso(
      () =>
        new Promise((resolver) =>
          setTimeout(
            () => resolver({ ok: true, dato: { comprobanteId: NUEVA, yaExistia: false } }),
            60,
          ),
        ),
    );
    const irA = vi.fn();
    await render(formulario(servidor, { irA }));
    await escribirLaFactura();
    tocar(boton("Reemplazar"));
    tocar(boton("Reemplazar"));
    tocar(boton("Reemplazar"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalledTimes(1));
    expect(irA).toHaveBeenCalledWith(`/compras/facturas/${NUEVA}`);
    expect(servidor.pedidos).toHaveLength(1);
  });

  it("un rechazo del servidor se muestra como el genérico, no navega y deja reintentar", async () => {
    const servidor = servidorFalso(() => Promise.resolve({ ok: false, error: GENERICO }));
    const irA = vi.fn();
    await render(formulario(servidor, { irA }));
    await escribirLaFactura();
    tocar(boton("Reemplazar"));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(irA).not.toHaveBeenCalled();
    await userEvent.type(page.getByLabelText("Número"), "9");
    await expect.element(page.getByText("Esta acción no está permitida")).not.toBeInTheDocument();
  });

  it("quitar un producto de la factura nueva lo saca de las líneas", async () => {
    await render(formulario(servidorFalso()));
    await userEvent.type(page.getByRole("combobox", { name: "Agregar producto" }), "harina");
    await userEvent.click(page.getByRole("option", { name: /Harina 000/ }));
    await expect.element(boton("Quitar Harina 000")).toBeVisible();
    tocar(boton("Quitar Harina 000"));
    await expect.element(boton("Quitar Harina 000")).not.toBeInTheDocument();
  });

  it("cambiar el comprobante de la compra: las líneas son los renglones de la compra (no se eligen productos) y el pedido lleva la factura que se miraba", async () => {
    const servidor = servidorFalso();
    await render(formulario(servidor, { que: DE_COMPRA }));
    await expect
      .element(page.getByRole("combobox", { name: "Agregar producto" }))
      .not.toBeInTheDocument();
    await expect.element(boton("Cambiar el comprobante de la compra")).toBeDisabled();
    await escribirLaFactura("2420", false);
    tocar(boton("Cambiar el comprobante de la compra"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    const pedido = servidor.pedidos[0] as { clave: string; factura: Record<string, unknown> };
    expect(Object.keys(pedido).sort()).toEqual(
      ["clave", "facturaVigenteVistaId", "factura", "motivo", "recepcionId"].sort(),
    );
    expect(pedido).toMatchObject({
      recepcionId: COMPRA,
      facturaVigenteVistaId: FACTURA,
      motivo: MOTIVO,
    });
    expect(pedido.factura).toMatchObject({
      lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
    });
  });

  it("al terminar el cambio de la compra vuelve a la ficha de la compra", async () => {
    const irA = vi.fn();
    await render(formulario(servidorFalso(), { que: DE_COMPRA, irA }));
    await escribirLaFactura("2420", false);
    tocar(boton("Cambiar el comprobante de la compra"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalledWith(`/compras/${COMPRA}`));
  });

  it("cumple accesibilidad (axe) con el comprobante nuevo completo y con el aviso", async () => {
    await render(formulario(servidorFalso()));
    await escribirLaFactura("2500");
    await expect.element(page.getByText(AVISO)).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });
});
