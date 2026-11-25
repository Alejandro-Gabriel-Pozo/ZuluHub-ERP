import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import {
  PantallaDeNuevaCompra,
  type PropsDePantallaDeNuevaCompra,
} from "../nueva/PantallaDeNuevaCompra.cliente";
import { textosDeNuevaCompra } from "../nueva/textos-de-nueva-compra";

/**
 * «Recibir» en Chromium (Compras 4; maqueta `compra-recibir.html`, estado `recibir`): el formulario de «Nueva compra» en su modo «recepción»: SIN precio, sin factura, sin cotización y sin depósito, con el botón «Recibir».
 * El envío es idempotente por intento (una recepción aunque se toque dos veces o se corte la red): todos los envíos de un intento llevan la MISMA clave y el MISMO pedido; al terminar abre el detalle de la recepción.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID_PROVEEDOR = "7b7b7b7b-1111-4222-8333-444444444444";
const ID_PRODUCTO = "0b0b0b0b-1111-4222-8333-444444444444";
const ID_RECEPCION = "9c9c9c9c-1111-4222-8333-444444444444";
const HARINA = {
  productoId: ID_PRODUCTO,
  nombre: "Harina 000",
  unidadBase: "KILOGRAMO",
  clase: "MATERIA_PRIMA",
  presentaciones: [],
};

afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

function servidorFalso(
  respuesta: () => Promise<Respuesta<{ recepcionId: string; yaExistia: boolean }>> = () =>
    Promise.resolve({ ok: true, dato: { recepcionId: ID_RECEPCION, yaExistia: false } }),
) {
  const pedidos: Record<string, unknown>[] = [];
  const cotizaciones: unknown[] = [];
  const props: Pick<
    PropsDePantallaDeNuevaCompra,
    "buscarProductos" | "buscarProveedores" | "cotizar" | "registrar" | "agregarProveedor"
  > = {
    buscarProductos: (texto) =>
      Promise.resolve({
        ok: true,
        dato: { productos: texto.toLowerCase().includes("harina") ? [HARINA] : [] },
      }),
    buscarProveedores: (texto) =>
      Promise.resolve({
        ok: true,
        dato: texto.toLowerCase().includes("distri")
          ? [{ id: ID_PROVEEDOR, nombre: "Distribuidora Central", tieneCuit: true }]
          : [],
      }),
    cotizar: (renglones) => {
      cotizaciones.push(renglones);
      return Promise.resolve({ ok: true, dato: { total: null, renglones: [] } });
    },
    registrar: (pedido) => {
      pedidos.push(pedido as Record<string, unknown>);
      return respuesta();
    },
    agregarProveedor: () =>
      Promise.resolve({ ok: true, dato: { estado: "GUARDADA", parteId: ID_PROVEEDOR } }),
  };
  return { props, pedidos, cotizaciones };
}

const pantalla = (
  servidor: ReturnType<typeof servidorFalso>,
  extra: Partial<PropsDePantallaDeNuevaCompra> = {},
) => (
  <PantallaDeNuevaCompra
    modo="RECEPCION"
    textos={textosDeNuevaCompra()}
    {...servidor.props}
    puedeAgregarProveedor={false}
    depositos={[]}
    esperaDeLaLecturaMs={10}
    irA={() => undefined}
    {...extra}
  />
);

const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });

async function cargarLaRecepcion(cantidad = "60") {
  await userEvent.type(page.getByRole("combobox", { name: "Proveedor" }), "distri");
  await userEvent.click(page.getByRole("option", { name: /Distribuidora Central/ }));
  await userEvent.type(page.getByRole("combobox", { name: "Agregar producto" }), "harina");
  await userEvent.click(page.getByRole("option", { name: /Harina 000/ }));
  await userEvent.type(page.getByLabelText("Cantidad"), cantidad);
}

describe("Recibir: sin precio", () => {
  it("el botón es «Recibir» (no «Comprar y recibir») y está apagado sin proveedor ni productos", async () => {
    await render(pantalla(servidorFalso()));
    await expect.element(boton("Recibir")).toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Comprar y recibir" }))
      .not.toBeInTheDocument();
  });

  it("la tarjeta del producto NO pide «Precio por» ni «Precio», no hay factura ni depósito, y nada se cotiza", async () => {
    const servidor = servidorFalso();
    await render(
      pantalla(servidor, {
        conFactura: true,
        depositos: [
          { id: "x", nombre: "A" },
          { id: "y", nombre: "B" },
        ],
      }),
    );
    await cargarLaRecepcion();
    await expect.element(page.getByLabelText("Cantidad")).toBeVisible();
    await expect.element(page.getByLabelText("Precio por")).not.toBeInTheDocument();
    await expect.element(page.getByLabelText("Precio", { exact: true })).not.toBeInTheDocument();
    await expect.element(page.getByLabelText("Total según la factura")).not.toBeInTheDocument();
    await expect.element(page.getByLabelText("Depósito")).not.toBeInTheDocument();
    await expect.element(page.getByText(/Costo por unidad de stock/)).not.toBeInTheDocument();
    expect(servidor.cotizaciones).toHaveLength(0);
    await expect.element(boton("Recibir")).toBeEnabled();
  });

  it("el pedido sale sin precio, sin depósito y sin factura: solo proveedor, remito y renglones con producto, unidad y cantidad", async () => {
    const servidor = servidorFalso();
    await render(pantalla(servidor));
    await cargarLaRecepcion("60");
    tocar(boton("Recibir"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    const pedido = servidor.pedidos[0] as Record<string, unknown>;
    expect(Object.keys(pedido).sort()).toEqual(["clave", "proveedorId", "remito", "renglones"]);
    expect(pedido["clave"]).toMatch(UUID);
    expect(pedido["proveedorId"]).toBe(ID_PROVEEDOR);
    expect(pedido["renglones"]).toEqual([
      { productoId: ID_PRODUCTO, unidadDeCompraId: "KILOGRAMO", cantidad: "60" },
    ]);
  });

  it("un doble toque (tres, en el mismo instante) es UNA recepción, y al terminar abre el detalle de la recepción", async () => {
    const servidor = servidorFalso(
      () =>
        new Promise((resolver) =>
          setTimeout(
            () => resolver({ ok: true, dato: { recepcionId: ID_RECEPCION, yaExistia: false } }),
            60,
          ),
        ),
    );
    const irA = vi.fn();
    await render(pantalla(servidor, { irA }));
    await cargarLaRecepcion();
    tocar(boton("Recibir"));
    tocar(boton("Recibir"));
    tocar(boton("Recibir"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalledTimes(1));
    expect(irA).toHaveBeenCalledWith(`/compras/recepciones/${ID_RECEPCION}`);
    expect(servidor.pedidos).toHaveLength(1);
  });

  it("un reintento tras un resultado inesperado manda la MISMA clave con el MISMO pedido", async () => {
    let n = 0;
    const servidor = servidorFalso(() => {
      n += 1;
      return Promise.resolve(
        n === 1
          ? {
              ok: false,
              error: { presentacion: "INESPERADO", codigo: "ERROR_INTERNO", referencia: "PD-1" },
            }
          : { ok: true, dato: { recepcionId: ID_RECEPCION, yaExistia: true } },
      ) as Promise<Respuesta<{ recepcionId: string; yaExistia: boolean }>>;
    });
    const irA = vi.fn();
    await render(pantalla(servidor, { irA, esperaEntreVerificacionesMs: 10 }));
    await cargarLaRecepcion();
    tocar(boton("Recibir"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(servidor.pedidos.length).toBeGreaterThanOrEqual(2);
    expect(servidor.pedidos[1]).toEqual(servidor.pedidos[0]);
  });

  it("cumple accesibilidad (axe) con el formulario cargado", async () => {
    await render(pantalla(servidorFalso()));
    await cargarLaRecepcion();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });
});
