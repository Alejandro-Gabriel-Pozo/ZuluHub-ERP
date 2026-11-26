import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import { PantallaDeDetalleDeFactura } from "./PantallaDeDetalleDeFactura";
import { TomarElCosto } from "./TomarElCosto.cliente";
import type { AccionesDeLaFactura, FichaDeFacturaParaLaPantalla } from "./modelo-de-facturas";
import { textosDeFacturas } from "./textos-de-facturas";

/**
 * «Tomar el costo de la factura» en Chromium (Compras 4, PR C; maqueta `compra-conciliar.html`, estados «Tomar el costo» y «Costo tomado»): el botón de cada línea recibida cubierta entera por la línea de la
 * factura, solo con el permiso; la hoja con el producto, la sucursal y el «Precio neto» ya cargado y sin campo para escribir; el envío idempotente por intento (un doble toque es UN pedido; un reintento manda
 * la MISMA clave con el MISMO pedido, que no lleva precio ni motivo); el rechazo como el genérico; la línea con el costo ya tomado, sin botón; y «Anular conciliación» que sigue ofreciéndose (DEC-0941).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = "5d5d5d5d-1111-4222-8333-444444444444";
const ID_RECEPCION = "9c9c9c9c-1111-4222-8333-444444444444";
const SUCURSAL_CENTRO = "a1a1a1a1-1111-4222-8333-444444444444";
const SUCURSAL_NORTE = "b2b2b2b2-1111-4222-8333-444444444444";
const SUCURSALES = [
  { id: SUCURSAL_CENTRO, nombre: "Casa central" },
  { id: SUCURSAL_NORTE, nombre: "Norte" },
];
const GENERICO = {
  codigo: "COMPRAS_ACCION_NO_PERMITIDA",
  clave: "compras.error.sin_permiso",
  presentacion: "AVISO",
} as const;
const TODO: AccionesDeLaFactura = {
  cargar: true,
  verConciliaciones: true,
  conciliar: true,
  anularConciliacion: true,
  tomarElCosto: true,
  verNotas: false,
};
const textos = textosDeFacturas();

afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

const FICHA: FichaDeFacturaParaLaPantalla = {
  comprobanteId: ID,
  proveedor: "Distribuidora Central",
  tipo: "FACTURA_A",
  puntoDeVenta: 4,
  numero: 5678,
  fechaNegocio: "2026-11-24",
  totalSegunFactura: "2420.00",
  estado: "CONCILIADA",
  lineas: [
    {
      numero: 1,
      producto: "Harina 000",
      unidadDeStockId: "GRAMO",
      facturada: "2000.0000",
      conciliada: "2000.0000",
      recibidoPorSucursal: [
        { sucursalId: SUCURSAL_CENTRO, recibida: "1200.0000", sinConciliar: "0.0000" },
        { sucursalId: SUCURSAL_NORTE, recibida: "800.0000", sinConciliar: "0.0000" },
      ],
      costos: [
        {
          recepcionId: ID_RECEPCION,
          recepcionNumero: 14,
          linea: 1,
          sucursalId: SUCURSAL_CENTRO,
          recibida: "1200.0000",
          estado: "SE_PUEDE_TOMAR",
          precioNeto: "1.000000",
        },
        {
          recepcionId: "8e8e8e8e-1111-4222-8333-444444444444",
          recepcionNumero: 15,
          linea: 1,
          sucursalId: SUCURSAL_NORTE,
          recibida: "800.0000",
          estado: "TOMADO",
          precioNeto: "1.000000",
        },
      ],
    },
  ],
  conciliaciones: [
    {
      conciliacionId: "c1c1c1c1-1111-4222-8333-444444444444",
      fechaNegocio: "2026-11-24",
      anulada: false,
      anulableEnAlcance: true,
      asignaciones: [
        {
          lineaDeFactura: 1,
          recepcionNumero: 14,
          sucursalId: SUCURSAL_CENTRO,
          lineaDeRecepcion: 1,
          cantidad: "1200.0000",
        },
      ],
    },
  ],
};

type Salida = Respuesta<Readonly<{ recepcionId: string; linea: number; yaExistia: boolean }>>;
const HECHA: Salida = { ok: true, dato: { recepcionId: ID_RECEPCION, linea: 1, yaExistia: false } };

function servidorFalso(respuesta: () => Promise<Salida> = () => Promise.resolve(HECHA)) {
  const pedidos: Record<string, unknown>[] = [];
  return {
    pedidos,
    tomar: (pedido: unknown) => {
      pedidos.push(pedido as Record<string, unknown>);
      return respuesta();
    },
  };
}
const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });
/** El botón de la hoja abierta (el de la línea, que la abre, tiene el mismo nombre). */
const confirmar = () =>
  page
    .getByRole("dialog")
    .getByRole("button", { name: "Tomar el costo de la factura", exact: true });

const detalle = (
  servidor: ReturnType<typeof servidorFalso>,
  extra: Partial<Parameters<typeof PantallaDeDetalleDeFactura>[0]> = {},
) => (
  <PantallaDeDetalleDeFactura
    ficha={FICHA}
    textos={textos}
    sucursales={SUCURSALES}
    acciones={TODO}
    tomarElCosto={servidor.tomar}
    accionesDeAnular={{
      "c1c1c1c1-1111-4222-8333-444444444444": () => Promise.resolve({ estado: "INICIAL" }),
    }}
    {...extra}
  />
);

const hoja = (
  servidor: ReturnType<typeof servidorFalso>,
  extra: Partial<Parameters<typeof TomarElCosto>[0]> = {},
) => (
  <TomarElCosto
    comprobanteId={ID}
    recepcionId={ID_RECEPCION}
    linea={1}
    hoja={{
      producto: "Harina 000",
      sucursalYCantidad: "Casa central: 1.200 Gramo",
      precioNeto: "Precio neto: $ 1,00",
    }}
    tomar={servidor.tomar}
    textos={{
      tomarElCosto: textos.tomarElCosto,
      cancelar: textos.cancelar,
      cerrar: textos.cerrar,
      enviando: textos.enviando,
      reintentar: textos.reintentar,
    }}
    irA={() => undefined}
    {...extra}
  />
);

describe("«Tomar el costo de la factura»", () => {
  it("se ofrece en la línea recibida que la factura cubre entera y sin costo, solo con el permiso; la ya tomada muestra su «Precio neto» y no tiene botón", async () => {
    const servidor = servidorFalso();
    const { unmount } = await render(detalle(servidor));
    await expect.element(boton("Tomar el costo de la factura")).toBeVisible();
    expect(
      page.getByRole("button", { name: "Tomar el costo de la factura" }).elements(),
    ).toHaveLength(1);
    await expect
      .element(page.getByText("Casa central: 1.200 Gramo", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("Norte · Precio neto: $ 1,00", { exact: true }))
      .toBeVisible();
    // «Anular conciliación» se sigue ofreciendo con costos tomados (DEC-0941).
    await expect.element(boton("Anular conciliación")).toBeVisible();
    await unmount();
    const sinPermiso = await render(
      detalle(servidor, { acciones: { ...TODO, tomarElCosto: false } }),
    );
    await expect.element(boton("Tomar el costo de la factura")).not.toBeInTheDocument();
    await sinPermiso.unmount();
    await render(
      <PantallaDeDetalleDeFactura
        ficha={FICHA}
        textos={textos}
        sucursales={SUCURSALES}
        acciones={TODO}
      />,
    );
    await expect.element(boton("Tomar el costo de la factura")).not.toBeInTheDocument();
  });

  it("la hoja muestra el producto, la sucursal y el «Precio neto» sin ningún campo para escribir", async () => {
    await render(hoja(servidorFalso()));
    tocar(boton("Tomar el costo de la factura"));
    await expect.element(page.getByText("Harina 000", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Casa central: 1.200 Gramo", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Precio neto: $ 1,00", { exact: true })).toBeVisible();
    expect(page.getByRole("textbox").elements()).toHaveLength(0);
    expect(page.getByRole("spinbutton").elements()).toHaveLength(0);
  });

  it("el pedido sale con la clave del intento, la recepción y la línea: sin precio, sin motivo, sin empresa, persona ni sucursal", async () => {
    const servidor = servidorFalso();
    await render(hoja(servidor));
    tocar(boton("Tomar el costo de la factura"));
    await userEvent.click(confirmar());
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    const pedido = servidor.pedidos[0] as Record<string, unknown>;
    expect(Object.keys(pedido).sort()).toEqual(["clave", "linea", "recepcionId"]);
    expect(pedido["clave"]).toMatch(UUID);
    expect(pedido).toMatchObject({ recepcionId: ID_RECEPCION, linea: 1 });
  });

  it("un doble toque (tres, en el mismo instante) es UNA toma, y al terminar abre el detalle de la factura", async () => {
    const servidor = servidorFalso(
      () => new Promise((resolver) => setTimeout(() => resolver(HECHA), 60)),
    );
    const irA = vi.fn();
    await render(hoja(servidor, { irA }));
    tocar(boton("Tomar el costo de la factura"));
    await expect.element(confirmar()).toBeVisible();
    tocar(confirmar());
    tocar(confirmar());
    tocar(confirmar());
    await vi.waitFor(() => expect(irA).toHaveBeenCalledTimes(1));
    expect(irA).toHaveBeenCalledWith(`/compras/facturas/${ID}`);
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
          : { ok: true, dato: { recepcionId: ID_RECEPCION, linea: 1, yaExistia: true } },
      ) as Promise<Salida>;
    });
    await render(hoja(servidor));
    tocar(boton("Tomar el costo de la factura"));
    await expect.element(confirmar()).toBeVisible();
    tocar(confirmar());
    await expect.element(boton("Reintentar")).toBeVisible();
    tocar(boton("Reintentar"));
    await vi.waitFor(() => expect(servidor.pedidos.length).toBeGreaterThanOrEqual(2), {
      timeout: 5000,
    });
    expect(servidor.pedidos[1]).toEqual(servidor.pedidos[0]);
  });

  it("un rechazo (alcance, costo ya tomado, línea sin conciliar entera) se muestra como el genérico", async () => {
    const servidor = servidorFalso(() => Promise.resolve({ ok: false, error: GENERICO }));
    await render(hoja(servidor));
    tocar(boton("Tomar el costo de la factura"));
    await expect.element(confirmar()).toBeVisible();
    tocar(confirmar());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
  });

  it("cumple accesibilidad (axe) con la hoja abierta", async () => {
    await render(hoja(servidorFalso()));
    tocar(boton("Tomar el costo de la factura"));
    await expect.element(page.getByText("Precio neto: $ 1,00", { exact: true })).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });
});
