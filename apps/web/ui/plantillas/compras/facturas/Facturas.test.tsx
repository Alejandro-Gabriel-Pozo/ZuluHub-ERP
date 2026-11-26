import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import { textosDeNuevaCompra } from "../nueva/textos-de-nueva-compra";
import { PantallaDeCargarFactura } from "./PantallaDeCargarFactura.cliente";
import { PantallaDeConciliar } from "./PantallaDeConciliar.cliente";
import { PantallaDeDetalleDeFactura } from "./PantallaDeDetalleDeFactura";
import { PantallaDeListaDeFacturas } from "./PantallaDeListaDeFacturas";
import type { DatosParaConciliarParaLaPantalla } from "./modelo-de-conciliar";
import type {
  AccionesDeLaFactura,
  FichaDeFacturaParaLaPantalla,
  ListaDeFacturasParaLaPantalla,
} from "./modelo-de-facturas";
import type { ResultadoDeLaFactura } from "./resultado-de-factura";
import { textosDeFacturas } from "./textos-de-facturas";

/**
 * «Facturas» en Chromium (Compras 4; maqueta `compra-conciliar.html`): la lista con su estado en texto, el detalle con lo Facturado, lo Conciliado y lo Recibido por sucursal, «Anular conciliación» solo con el
 * permiso, «Conciliar» con la propuesta precargada y «Cargar factura» con un producto por línea y SIN sucursal. Los envíos son idempotentes por intento: un doble toque es UN pedido y un reintento manda la MISMA clave
 * con el MISMO pedido; los botones se apagan mientras envían. Lo que se rechaza en el servidor se ve como el genérico.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = "5d5d5d5d-1111-4222-8333-444444444444";
const ID_PROVEEDOR = "7b7b7b7b-1111-4222-8333-444444444444";
const ID_PRODUCTO = "0b0b0b0b-1111-4222-8333-444444444444";
const ID_RECEPCION = "9c9c9c9c-1111-4222-8333-444444444444";
const ID_OTRA_RECEPCION = "8e8e8e8e-1111-4222-8333-444444444444";
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
  reemplazar: false,
};
const textos = textosDeFacturas();

afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });

const FICHA: FichaDeFacturaParaLaPantalla = {
  comprobanteId: ID,
  proveedor: "Distribuidora Central",
  tipo: "FACTURA_A",
  puntoDeVenta: 4,
  numero: 5678,
  fechaNegocio: "2026-11-24",
  totalSegunFactura: "2420.00",
  estado: "CONCILIADA_EN_PARTE",
  lineas: [
    {
      numero: 1,
      producto: "Harina 000",
      unidadDeStockId: "GRAMO",
      facturada: "2000.0000",
      conciliada: "800.0000",
      recibidoPorSucursal: [
        { sucursalId: SUCURSAL_CENTRO, recibida: "1000.0000", sinConciliar: "200.0000" },
        { sucursalId: SUCURSAL_NORTE, recibida: "1000.0000", sinConciliar: "1000.0000" },
      ],
      costos: [],
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
          cantidad: "800.0000",
        },
      ],
    },
    {
      conciliacionId: "d2d2d2d2-1111-4222-8333-444444444444",
      fechaNegocio: "2026-11-23",
      anulada: true,
      anulableEnAlcance: true,
      asignaciones: [
        {
          lineaDeFactura: 1,
          recepcionNumero: 12,
          sucursalId: SUCURSAL_NORTE,
          lineaDeRecepcion: 1,
          cantidad: "300.0000",
        },
      ],
    },
  ],
};

const hecho = (): Promise<ResultadoDeLaFactura> =>
  Promise.resolve({ estado: "HECHO", ruta: `/compras/facturas/${ID}` });

const detalle = (
  extra: Partial<Parameters<typeof PantallaDeDetalleDeFactura>[0]> = {},
  anular = vi.fn(hecho),
) => (
  <PantallaDeDetalleDeFactura
    ficha={FICHA}
    textos={textos}
    sucursales={SUCURSALES}
    acciones={TODO}
    accionesDeAnular={{ "c1c1c1c1-1111-4222-8333-444444444444": anular }}
    {...extra}
  />
);

describe("el detalle de una factura", () => {
  it("muestra el proveedor, la fecha, el total, el estado en texto y, por línea, Facturado, Conciliado y Recibido por sucursal", async () => {
    await render(detalle());
    await expect.element(page.getByText("Distribuidora Central · 24/11/2026")).toBeVisible();
    await expect.element(page.getByText("Conciliada en parte", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Harina 000", { exact: true })).toBeVisible();
    await expect.element(page.getByText(/2\.000/).first()).toBeVisible();
    await expect.element(page.getByText(/Casa central: 1\.000/)).toBeVisible();
    await expect.element(page.getByText(/Norte: 1\.000/)).toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "Conciliaciones", exact: true }))
      .toBeVisible();
  });

  it("«Conciliar» solo con permiso y con algo para conciliar; el enlace lleva a la pantalla de repartir", async () => {
    const { unmount } = await render(detalle());
    await expect
      .element(page.getByRole("link", { name: "Conciliar", exact: true }))
      .toHaveAttribute("href", `/compras/facturas/${ID}/conciliar`);
    await unmount();
    await render(detalle({ acciones: { ...TODO, conciliar: false } }));
    await expect
      .element(page.getByRole("link", { name: "Conciliar", exact: true }))
      .not.toBeInTheDocument();
  });

  it("una factura conciliada del todo, anulada o sin nada recibido no ofrece «Conciliar», aunque haya permiso", async () => {
    for (const estado of ["CONCILIADA", "ANULADA", "FACTURADA_FALTA_RECIBIR"] as const) {
      const { unmount } = await render(detalle({ ficha: { ...FICHA, estado } }));
      await expect
        .element(page.getByRole("link", { name: "Conciliar", exact: true }))
        .not.toBeInTheDocument();
      await unmount();
    }
    await render(detalle({ ficha: { ...FICHA, estado: "FALTA_CONCILIAR" } }));
    await expect.element(page.getByRole("link", { name: "Conciliar", exact: true })).toBeVisible();
  });

  it("«Anular conciliación» solo en la conciliación vigente, con permiso y con alcance; la anulada dice «Anulada»", async () => {
    await render(detalle());
    // Solo la primera (no anulada, con acción ligada) ofrece anular.
    await expect.element(boton("Anular conciliación")).toBeVisible();
    expect(page.getByRole("button", { name: "Anular conciliación" }).elements()).toHaveLength(1);
    await expect.element(page.getByText(/23\/11\/2026 · Norte: 300 · Anulada/)).toBeVisible();
  });

  it("sin permiso para ver conciliaciones no hay bloque; sin permiso para anular o sin alcance no hay botón", async () => {
    const { unmount } = await render(detalle({ acciones: { ...TODO, verConciliaciones: false } }));
    await expect
      .element(page.getByRole("heading", { name: "Conciliaciones", exact: true }))
      .not.toBeInTheDocument();
    await unmount();
    const sinAnular = await render(detalle({ acciones: { ...TODO, anularConciliacion: false } }));
    await expect.element(boton("Anular conciliación")).not.toBeInTheDocument();
    await sinAnular.unmount();
    await render(
      detalle({
        ficha: {
          ...FICHA,
          conciliaciones: FICHA.conciliaciones.map((c) => ({ ...c, anulableEnAlcance: false })),
        },
      }),
    );
    await expect.element(boton("Anular conciliación")).not.toBeInTheDocument();
  });

  it("«Anular conciliación» abre una hoja SIN motivo; «Anular» manda un solo pedido aunque se toque dos veces y la hoja se apaga mientras envía", async () => {
    let terminar: () => void = () => undefined;
    const accion = vi.fn(async (): Promise<ResultadoDeLaFactura> => {
      await new Promise<void>((r) => {
        terminar = r;
      });
      return { estado: "INICIAL" };
    });
    await render(detalle({}, accion));
    await userEvent.click(boton("Anular conciliación"));
    await expect.element(page.getByLabelText("Motivo")).not.toBeInTheDocument();
    const anular = page.getByRole("dialog").getByRole("button", { name: "Anular", exact: true });
    tocar(anular);
    await expect.element(anular).toHaveAttribute("aria-busy", "true");
    tocar(anular);
    tocar(anular);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    terminar();
    await expect.element(anular).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("un rechazo del servidor se muestra como el genérico y se puede volver a intentar", async () => {
    const accion = vi.fn((): Promise<ResultadoDeLaFactura> =>
      Promise.resolve({ estado: "ERROR", error: GENERICO }),
    );
    await render(detalle({}, accion));
    await userEvent.click(boton("Anular conciliación"));
    await userEvent.click(
      page.getByRole("dialog").getByRole("button", { name: "Anular", exact: true }),
    );
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
  });

  it("cumple accesibilidad (axe)", async () => {
    await render(detalle());
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });
});

describe("la lista de facturas", () => {
  const LISTA: ListaDeFacturasParaLaPantalla = {
    facturas: [
      {
        comprobanteId: ID,
        proveedor: "Distribuidora Central",
        tipo: "FACTURA_A",
        puntoDeVenta: 4,
        numero: 5678,
        fechaNegocio: "2026-11-24",
        totalSegunFactura: "2420.00",
        estado: "FALTA_CONCILIAR",
      },
      {
        comprobanteId: "1a1a1a1a-1111-4222-8333-444444444444",
        proveedor: null,
        tipo: null,
        puntoDeVenta: null,
        numero: null,
        fechaNegocio: "2026-11-21",
        totalSegunFactura: "100.00",
        estado: "FACTURADA_FALTA_RECIBIR",
      },
    ],
    siguiente: "2026-11-21|1a1a1a1a-1111-4222-8333-444444444444",
  };

  it("cada fila es un enlace a su detalle con el estado en texto; sin datos legibles dice «—»; hay «Cargar factura» y página siguiente", async () => {
    await render(<PantallaDeListaDeFacturas lista={LISTA} textos={textos} puedeCargar />);
    const fila = page.getByRole("link", {
      name: /Factura A 00004-00005678 · Distribuidora Central, Falta conciliar · 24\/11\/2026/,
    });
    await expect.element(fila).toHaveAttribute("href", `/compras/facturas/${ID}`);
    await expect
      .element(page.getByRole("link", { name: /— · —, Facturada, falta recibir · 21\/11\/2026/ }))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Cargar factura" }))
      .toHaveAttribute("href", "/compras/facturas/nueva");
    await expect.element(page.getByRole("link", { name: "Página siguiente" })).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });

  it("sin permiso de cargar no hay «Cargar factura»; sin filas dice «Sin resultados»", async () => {
    await render(
      <PantallaDeListaDeFacturas lista={{ facturas: [], siguiente: null }} textos={textos} />,
    );
    await expect.element(page.getByText("Sin resultados")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Cargar factura" }))
      .not.toBeInTheDocument();
  });
});

describe("Conciliar", () => {
  const DATOS: DatosParaConciliarParaLaPantalla = {
    lineas: [
      {
        numero: 1,
        producto: "Harina 000",
        unidadDeStockId: "GRAMO",
        facturada: "2000.0000",
        sinConciliar: "2000.0000",
      },
    ],
    recibidas: [
      {
        recepcionId: ID_RECEPCION,
        recepcionNumero: 14,
        sucursalId: SUCURSAL_CENTRO,
        linea: 1,
        productoId: ID_PRODUCTO,
        producto: "Harina 000",
        unidadDeStockId: "GRAMO",
        recibida: "1000.0000",
        sinAsignar: "1000.0000",
      },
      {
        recepcionId: ID_OTRA_RECEPCION,
        recepcionNumero: 9,
        sucursalId: SUCURSAL_NORTE,
        linea: 1,
        productoId: ID_PRODUCTO,
        producto: "Harina 000",
        unidadDeStockId: "GRAMO",
        recibida: "1500.0000",
        sinAsignar: "1500.0000",
      },
    ],
    propuesta: [
      { lineaDeFactura: 1, recepcionId: ID_RECEPCION, lineaDeRecepcion: 1, cantidad: "1000.0000" },
      {
        lineaDeFactura: 1,
        recepcionId: ID_OTRA_RECEPCION,
        lineaDeRecepcion: 1,
        cantidad: "1000.0000",
      },
    ],
    productosDeLasLineas: [{ numero: 1, productoId: ID_PRODUCTO }],
  };

  function servidorFalso(
    respuesta: () => Promise<Respuesta<{ conciliacionId: string; yaExistia: boolean }>> = () =>
      Promise.resolve({ ok: true, dato: { conciliacionId: ID, yaExistia: false } }),
  ) {
    const pedidos: Record<string, unknown>[] = [];
    return {
      pedidos,
      conciliar: (pedido: unknown) => {
        pedidos.push(pedido as Record<string, unknown>);
        return respuesta();
      },
    };
  }
  const conciliar = (
    servidor: ReturnType<typeof servidorFalso>,
    extra: Partial<Parameters<typeof PantallaDeConciliar>[0]> = {},
  ) => (
    <PantallaDeConciliar
      comprobanteId={ID}
      datos={DATOS}
      sucursales={SUCURSALES}
      conciliar={servidor.conciliar}
      textos={{
        recepcion: textos.recepcion,
        recibido: textos.recibido,
        facturado: textos.facturado,
        aConciliar: textos.aConciliar,
        validarConciliacion: textos.validarConciliacion,
        enviando: textos.enviando,
        reintentar: textos.reintentar,
      }}
      irA={() => undefined}
      {...extra}
    />
  );

  it("muestra cada línea de la factura con las líneas recibidas de cada sucursal y la propuesta precargada", async () => {
    await render(conciliar(servidorFalso()));
    await expect.element(page.getByText("Harina 000", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText(/Casa central · Recepción 14 · Recibido: 1\.000/))
      .toBeVisible();
    await expect.element(page.getByText(/Norte · Recepción 9 · Recibido: 1\.500/)).toBeVisible();
    await expect
      .element(page.getByLabelText("A conciliar · Casa central · Recepción 14"))
      .toHaveValue("1.000");
    await expect
      .element(page.getByLabelText("A conciliar · Norte · Recepción 9"))
      .toHaveValue("1.000");
    await expect.element(boton("Confirmar conciliación")).toBeEnabled();
  });

  it("el pedido sale con la propuesta, la clave del intento y solo lo declarado; corregir una cantidad la cambia y vaciar un campo la saca", async () => {
    const servidor = servidorFalso();
    await render(conciliar(servidor));
    const norte = page.getByLabelText("A conciliar · Norte · Recepción 9");
    await userEvent.clear(norte);
    await userEvent.type(norte, "600");
    tocar(boton("Confirmar conciliación"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    const pedido = servidor.pedidos[0] as Record<string, unknown>;
    expect(Object.keys(pedido).sort()).toEqual(["asignaciones", "clave", "comprobanteId"]);
    expect(pedido["clave"]).toMatch(UUID);
    expect(pedido["comprobanteId"]).toBe(ID);
    expect(pedido["asignaciones"]).toEqual([
      { lineaDeFactura: 1, recepcionId: ID_RECEPCION, lineaDeRecepcion: 1, cantidad: "1000" },
      { lineaDeFactura: 1, recepcionId: ID_OTRA_RECEPCION, lineaDeRecepcion: 1, cantidad: "600" },
    ]);
  });

  it("sin nada para conciliar el botón queda apagado", async () => {
    await render(conciliar(servidorFalso()));
    await userEvent.clear(page.getByLabelText("A conciliar · Casa central · Recepción 14"));
    await userEvent.clear(page.getByLabelText("A conciliar · Norte · Recepción 9"));
    await expect.element(boton("Confirmar conciliación")).toBeDisabled();
  });

  it("un doble toque (tres, en el mismo instante) es UNA conciliación, y al terminar abre el detalle de la factura", async () => {
    const servidor = servidorFalso(
      () =>
        new Promise((resolver) =>
          setTimeout(
            () => resolver({ ok: true, dato: { conciliacionId: ID, yaExistia: false } }),
            60,
          ),
        ),
    );
    const irA = vi.fn();
    await render(conciliar(servidor, { irA }));
    tocar(boton("Confirmar conciliación"));
    tocar(boton("Confirmar conciliación"));
    tocar(boton("Confirmar conciliación"));
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
          : { ok: true, dato: { conciliacionId: ID, yaExistia: true } },
      ) as Promise<Respuesta<{ conciliacionId: string; yaExistia: boolean }>>;
    });
    const irA = vi.fn();
    await render(conciliar(servidor, { irA, esperaEntreVerificacionesMs: 10 }));
    tocar(boton("Confirmar conciliación"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(servidor.pedidos.length).toBeGreaterThanOrEqual(2);
    expect(servidor.pedidos[1]).toEqual(servidor.pedidos[0]);
  });

  it("un rechazo (otra persona concilió antes, o se pasa de lo recibido) se muestra como el genérico y no navega", async () => {
    const servidor = servidorFalso(() => Promise.resolve({ ok: false, error: GENERICO }));
    const irA = vi.fn();
    await render(conciliar(servidor, { irA }));
    tocar(boton("Confirmar conciliación"));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(irA).not.toHaveBeenCalled();
  });

  it("cumple accesibilidad (axe)", async () => {
    await render(conciliar(servidorFalso()));
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });
});

describe("Cargar factura", () => {
  function servidorFalso(
    respuesta: () => Promise<Respuesta<{ comprobanteId: string; yaExistia: boolean }>> = () =>
      Promise.resolve({ ok: true, dato: { comprobanteId: ID, yaExistia: false } }),
  ) {
    const pedidos: Record<string, unknown>[] = [];
    const cotizadas: unknown[] = [];
    return {
      pedidos,
      cotizadas,
      registrar: (pedido: unknown) => {
        pedidos.push(pedido as Record<string, unknown>);
        return respuesta();
      },
      buscarProductos: (texto: string) =>
        Promise.resolve({
          ok: true as const,
          dato: {
            productos: texto.toLowerCase().includes("harina")
              ? [{ productoId: ID_PRODUCTO, nombre: "Harina 000", unidadBase: "GRAMO" }]
              : [],
          },
        }),
      buscarProveedores: (texto: string) =>
        Promise.resolve({
          ok: true as const,
          dato: texto.toLowerCase().includes("distri")
            ? [{ id: ID_PROVEEDOR, nombre: "Distribuidora Central", tieneCuit: true }]
            : [],
        }),
      cotizarFactura: (factura: unknown) => {
        cotizadas.push(factura);
        return Promise.resolve({
          ok: true as const,
          dato: {
            lineas: [{ netoDeLinea: "2000.00", ivaDeLinea: "420.00" }],
            totalCalculado: "2420.00",
            totalSegunFactura: "2420.00",
            totalCoincide: true,
          },
        });
      },
    };
  }
  const pantalla = (
    servidor: ReturnType<typeof servidorFalso>,
    extra: Partial<Parameters<typeof PantallaDeCargarFactura>[0]> = {},
  ) => (
    <PantallaDeCargarFactura
      textos={textosDeNuevaCompra()}
      textoDelBoton={textos.cargarFactura}
      buscarProductos={servidor.buscarProductos}
      buscarProveedores={servidor.buscarProveedores}
      cotizarFactura={servidor.cotizarFactura}
      registrar={servidor.registrar}
      esperaDeLaLecturaMs={10}
      irA={() => undefined}
      {...extra}
    />
  );

  async function cargarLaFactura() {
    await userEvent.type(page.getByRole("combobox", { name: "Proveedor" }), "distri");
    await userEvent.click(page.getByRole("option", { name: /Distribuidora Central/ }));
    await userEvent.type(page.getByRole("combobox", { name: "Agregar producto" }), "harina");
    await userEvent.click(page.getByRole("option", { name: /Harina 000/ }));
    await userEvent.selectOptions(page.getByLabelText("Tipo"), "FACTURA_A");
    await userEvent.type(page.getByLabelText("Punto de venta"), "4");
    await userEvent.type(page.getByLabelText("Número"), "5678");
    await userEvent.fill(page.getByLabelText("Fecha de la factura"), "2026-11-20");
    await userEvent.type(page.getByLabelText("Cantidad facturada"), "2000");
    await userEvent.type(page.getByLabelText("Precio neto"), "1");
    await userEvent.type(page.getByLabelText("Total según la factura"), "2420");
  }

  it("el botón «Cargar factura» está apagado hasta que la factura está completa; no hay sucursal, remito ni depósito", async () => {
    await render(pantalla(servidorFalso()));
    await expect.element(boton("Cargar factura")).toBeDisabled();
    await expect.element(page.getByLabelText("Depósito")).not.toBeInTheDocument();
    await expect.element(page.getByLabelText("Sucursal")).not.toBeInTheDocument();
    await expect.element(page.getByText("Remito del proveedor")).not.toBeInTheDocument();
    await cargarLaFactura();
    await expect.element(boton("Cargar factura")).toBeEnabled();
  });

  it("el pedido lleva el producto de cada línea y solo lo declarado: sin sucursal, sin depósito, sin remito y con la misma clave en todos los envíos del intento", async () => {
    const servidor = servidorFalso();
    await render(pantalla(servidor));
    await cargarLaFactura();
    tocar(boton("Cargar factura"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    const pedido = servidor.pedidos[0] as { clave: string; factura: Record<string, unknown> };
    expect(Object.keys(pedido).sort()).toEqual(["clave", "factura", "proveedorId"]);
    expect(pedido.clave).toMatch(UUID);
    expect(pedido).toMatchObject({ proveedorId: ID_PROVEEDOR });
    expect(pedido.factura).toMatchObject({
      tipo: "FACTURA_A",
      puntoDeVenta: "4",
      numero: "5678",
      fecha: "2026-11-20",
      totalSegunFactura: "2420.00",
      lineas: [
        { productoId: ID_PRODUCTO, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" },
      ],
    });
    expect(Object.keys(pedido.factura)).not.toContain("sucursalId");
    expect(Object.keys(pedido.factura)).not.toContain("remito");
  });

  it("un doble toque es UNA factura, y al terminar abre el detalle de la factura", async () => {
    const servidor = servidorFalso(
      () =>
        new Promise((resolver) =>
          setTimeout(
            () => resolver({ ok: true, dato: { comprobanteId: ID, yaExistia: false } }),
            60,
          ),
        ),
    );
    const irA = vi.fn();
    await render(pantalla(servidor, { irA }));
    await cargarLaFactura();
    tocar(boton("Cargar factura"));
    tocar(boton("Cargar factura"));
    tocar(boton("Cargar factura"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalledTimes(1));
    expect(irA).toHaveBeenCalledWith(`/compras/facturas/${ID}`);
    expect(servidor.pedidos).toHaveLength(1);
  });

  it("una factura repetida (otro envío con el mismo número) se muestra como el rechazo del servidor y no navega", async () => {
    const servidor = servidorFalso(() => Promise.resolve({ ok: false, error: GENERICO }));
    const irA = vi.fn();
    await render(pantalla(servidor, { irA }));
    await cargarLaFactura();
    tocar(boton("Cargar factura"));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(irA).not.toHaveBeenCalled();
  });

  it("cumple accesibilidad (axe) con la factura cargada", async () => {
    await render(pantalla(servidorFalso()));
    await cargarLaFactura();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });
});
