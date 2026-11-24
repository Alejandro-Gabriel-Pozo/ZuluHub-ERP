import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../../src/capacidades/experiencia/respuesta";
import {
  restaurarConexion,
  simularConexion,
  tocar,
  violacionesDeAccesibilidad,
} from "../../../pruebas/ayudas";
import {
  PantallaDeNuevaCompra,
  type PropsDePantallaDeNuevaCompra,
} from "./PantallaDeNuevaCompra.cliente";
import { textosDeNuevaCompra } from "./textos-de-nueva-compra";

/**
 * «Nueva compra» en Chromium (Compras PR 6b): elegir proveedor, agregar productos, ver lo que calcula el servidor, el remito y «Comprar y recibir». El envío es idempotente por intento (una
 * compra y una entrada de stock aunque se toque dos veces o se corte la red): todos los envíos de un intento llevan la MISMA clave y el MISMO pedido.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID_PROVEEDOR = "7b7b7b7b-1111-4222-8333-444444444444";
const ID_PRODUCTO = "0b0b0b0b-1111-4222-8333-444444444444";
const ID_COMPRA = "9c9c9c9c-1111-4222-8333-444444444444";
const BIFE = {
  productoId: ID_PRODUCTO,
  nombre: "Bife de chorizo",
  unidadBase: "KILOGRAMO",
  clase: "MATERIA_PRIMA",
  presentaciones: [],
};

afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

function servidorFalso(
  respuestaDeRegistrar: (
    n: number,
  ) => Promise<Respuesta<{ recepcionId: string; yaExistia: boolean }>> = () =>
    Promise.resolve({ ok: true, dato: { recepcionId: ID_COMPRA, yaExistia: false } }),
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
        dato: { productos: texto.toLowerCase().includes("bife") ? [BIFE] : [] },
      }),
    buscarProveedores: (texto) =>
      Promise.resolve({
        ok: true,
        dato: texto.toLowerCase().includes("frigo")
          ? [{ id: ID_PROVEEDOR, nombre: "Frigorífico Norte", tieneCuit: true }]
          : [],
      }),
    cotizar: (renglones) => {
      cotizaciones.push(renglones);
      const lista = renglones as { productoId: string; precio: string | null }[];
      return Promise.resolve({
        ok: true,
        dato: {
          total: lista.some((r) => r.precio === null) ? null : "22000.00",
          renglones: lista.map((r) => ({
            productoId: r.productoId,
            cantidadEnStock: "2.0000",
            importe: r.precio === null ? null : "22000.00",
            costoPorUnidadDeStock: r.precio === null ? null : "11000.000000",
            dePesoVariable: false,
          })),
        },
      });
    },
    registrar: (pedido) => {
      pedidos.push(pedido as Record<string, unknown>);
      return respuestaDeRegistrar(pedidos.length);
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
    textos={textosDeNuevaCompra()}
    {...servidor.props}
    puedeAgregarProveedor={false}
    depositos={[]}
    esperaDeLaLecturaMs={10}
    irA={() => undefined}
    {...extra}
  />
);

const boton = (nombre: string) => page.getByRole("button", { name: nombre });

async function elegirElProveedor() {
  await userEvent.type(page.getByRole("combobox", { name: "Proveedor" }), "frigo");
  await userEvent.click(page.getByRole("option", { name: /Frigorífico Norte/ }));
}

async function agregarElBife() {
  await userEvent.type(page.getByRole("combobox", { name: "Agregar producto" }), "bife");
  await userEvent.click(page.getByRole("option", { name: /Bife de chorizo/ }));
}

async function cargarLaCompra(cantidad = "2", precio = "11000") {
  await elegirElProveedor();
  await agregarElBife();
  await userEvent.type(page.getByLabelText("Cantidad"), cantidad);
  await userEvent.type(page.getByLabelText("Precio", { exact: true }), precio);
}

describe("Nueva compra: lo que se ve y lo que calcula el servidor", () => {
  it("sin proveedor ni productos «Comprar y recibir» está apagado", async () => {
    await render(pantalla(servidorFalso()));
    await expect.element(boton("Comprar y recibir")).toBeDisabled();
  });

  it("al agregar el producto aparece su tarjeta en la unidad base; «Entra a tu stock» y el costo vuelven del servidor, con coma y miles", async () => {
    const servidor = servidorFalso();
    await render(pantalla(servidor));
    await cargarLaCompra();
    await expect.element(page.getByText("Entra a tu stock: 2 Kilogramo")).toBeVisible();
    await expect.element(page.getByText("Costo por unidad de stock: $ 11.000,00")).toBeVisible();
    await expect.element(page.getByText("$ 22.000,00", { exact: true }).first()).toBeVisible();
    // «Total» al pie: lo calcula el servidor (la pantalla no suma dinero).
    await expect.element(page.getByText("Total", { exact: true })).toBeVisible();
    // La cuenta es del servidor: lo que la pantalla le manda es texto, nunca `number`.
    expect(servidor.cotizaciones.at(-1)).toEqual([
      {
        productoId: ID_PRODUCTO,
        unidadDeCompraId: "KILOGRAMO",
        cantidad: "2",
        precioPor: "UNIDAD",
        unidadDePrecioId: "KILOGRAMO",
        precio: "11000.00",
      },
    ]);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin precio muestra «Sin precio», nunca cero", async () => {
    await render(pantalla(servidorFalso()));
    await elegirElProveedor();
    await agregarElBife();
    await userEvent.type(page.getByLabelText("Cantidad"), "2");
    await expect.element(page.getByText("Costo por unidad de stock: Sin precio")).toBeVisible();
    // Con una línea sin precio el total no aparenta estar completo: dice «Sin precio», nunca cero.
    await expect.element(page.getByText("Total", { exact: true })).toBeVisible();
    expect(page.getByText("Sin precio", { exact: true }).elements().length).toBeGreaterThanOrEqual(
      2,
    );
    expect(document.body.textContent).not.toContain("$ 0,00");
  });

  it("las unidades de otra dimensión aparecen apagadas en «Cómo se compra» y en «Precio por»", async () => {
    await render(pantalla(servidorFalso()));
    await elegirElProveedor();
    await agregarElBife();
    for (const nombre of [/Cómo se compra/, /Precio por/]) {
      const selector = page.getByRole("combobox", { name: nombre }).element();
      const opcion = (v: string) =>
        selector.querySelector<HTMLOptionElement>(`option[value="${v}"]`);
      expect(opcion("GRAMO")?.disabled).toBe(false);
      expect(opcion("LITRO")?.disabled).toBe(true);
      expect(opcion("UNIDAD")?.disabled).toBe(true);
    }
  });

  it("«Quitar» saca el renglón y el producto vuelve a poder agregarse; sin renglones no se puede comprar", async () => {
    await render(pantalla(servidorFalso()));
    await cargarLaCompra();
    await expect.element(boton("Comprar y recibir")).toBeEnabled();
    await userEvent.click(boton("Quitar"));
    expect(page.getByLabelText("Cantidad").elements()).toHaveLength(0);
    await expect.element(boton("Comprar y recibir")).toBeDisabled();
    await agregarElBife();
    await expect.element(page.getByLabelText("Cantidad")).toBeVisible();
  });

  it("un producto ya agregado no se ofrece otra vez", async () => {
    await render(pantalla(servidorFalso()));
    await elegirElProveedor();
    await agregarElBife();
    await userEvent.type(page.getByRole("combobox", { name: "Agregar producto" }), "bife");
    await expect.element(page.getByText("Sin resultados")).toBeVisible();
  });

  it("«Agregar proveedor» solo se ofrece con permiso", async () => {
    await render(pantalla(servidorFalso()));
    expect(page.getByRole("button", { name: "Agregar proveedor" }).elements()).toHaveLength(0);
  });

  it("con permiso, «Agregar proveedor» abre la hoja, agrega y deja elegido al proveedor", async () => {
    const servidor = servidorFalso();
    await render(pantalla(servidor, { puedeAgregarProveedor: true }));
    await userEvent.click(boton("Agregar proveedor"));
    await userEvent.type(page.getByLabelText("Razón social"), "Carnes del Sur");
    await userEvent.click(page.getByRole("button", { name: "Agregar", exact: true }));
    await expect
      .element(page.getByRole("combobox", { name: "Proveedor" }))
      .toHaveValue("Carnes del Sur");
  });

  it("el aviso de proveedor repetido NO bloquea: el segundo «Agregar» agrega igual", async () => {
    const servidor = servidorFalso();
    const llamadas: boolean[] = [];
    const agregarProveedor: PropsDePantallaDeNuevaCompra["agregarProveedor"] = (
      _c,
      _n,
      _nom,
      igual,
    ) => {
      llamadas.push(igual);
      return Promise.resolve(
        igual
          ? { ok: true, dato: { estado: "GUARDADA", parteId: ID_PROVEEDOR } }
          : {
              ok: true,
              dato: {
                estado: "DUPLICADOS",
                duplicados: [{ parteId: "x", nombre: "Carnes del Sur" }],
              },
            },
      );
    };
    await render(pantalla(servidor, { puedeAgregarProveedor: true, agregarProveedor }));
    await userEvent.click(boton("Agregar proveedor"));
    await userEvent.type(page.getByLabelText("Razón social"), "Carnes del Sur");
    await userEvent.click(page.getByRole("button", { name: "Agregar", exact: true }));
    await expect.element(page.getByText("Ya existe un proveedor con ese nombre")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Agregar", exact: true }));
    await vi.waitFor(() => expect(llamadas).toEqual([false, true]));
    await expect
      .element(page.getByRole("combobox", { name: "Proveedor" }))
      .toHaveValue("Carnes del Sur");
  });

  it("con más de un depósito hay que elegir uno antes de comprar", async () => {
    const servidor = servidorFalso();
    await render(
      pantalla(servidor, {
        depositos: [
          { id: "d1", nombre: "Cámara" },
          { id: "d2", nombre: "Seco" },
        ],
      }),
    );
    await cargarLaCompra();
    await expect.element(boton("Comprar y recibir")).toBeDisabled();
    await userEvent.selectOptions(page.getByRole("combobox", { name: "Depósito" }), "d2");
    await expect.element(boton("Comprar y recibir")).toBeEnabled();
    tocar(boton("Comprar y recibir"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    expect(servidor.pedidos[0]).toMatchObject({ depositoId: "d2" });
  });
});

describe("Nueva compra: el envío", () => {
  it("manda UNA clave, el proveedor, los renglones y el remito como texto, y abre la ficha de la compra; sin empresa, persona ni sucursal", async () => {
    const servidor = servidorFalso();
    const irA = vi.fn();
    await render(pantalla(servidor, { irA }));
    await cargarLaCompra();
    await userEvent.type(page.getByLabelText("Punto de venta"), "2");
    await userEvent.type(page.getByLabelText("Número"), "7842");
    await userEvent.fill(page.getByLabelText("Fecha del remito"), "2026-11-05");
    tocar(boton("Comprar y recibir"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalledWith(`/compras/${ID_COMPRA}`));
    expect(servidor.pedidos).toHaveLength(1);
    expect(servidor.pedidos[0]?.["clave"]).toMatch(UUID);
    expect({ ...servidor.pedidos[0], clave: "(la clave)" }).toEqual({
      clave: "(la clave)",
      proveedorId: ID_PROVEEDOR,
      depositoId: null,
      remito: { puntoDeVenta: "2", numero: "7842", fecha: "2026-11-05" },
      renglones: [
        {
          productoId: ID_PRODUCTO,
          unidadDeCompraId: "KILOGRAMO",
          cantidad: "2",
          precioPor: "UNIDAD",
          unidadDePrecioId: "KILOGRAMO",
          precio: "11000.00",
        },
      ],
    });
  });

  it("un doble toque (tres, en el mismo instante) es UNA compra", async () => {
    const servidor = servidorFalso(
      () =>
        new Promise((resolver) =>
          setTimeout(
            () => resolver({ ok: true, dato: { recepcionId: ID_COMPRA, yaExistia: false } }),
            60,
          ),
        ),
    );
    const irA = vi.fn();
    await render(pantalla(servidor, { irA }));
    await cargarLaCompra();
    tocar(boton("Comprar y recibir"));
    tocar(boton("Comprar y recibir"));
    tocar(boton("Comprar y recibir"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalledTimes(1));
    expect(servidor.pedidos).toHaveLength(1);
  });

  it("corte de red: «Verificando…» y el reintento reenvía la MISMA clave con el MISMO pedido; nada se edita mientras tanto", async () => {
    const servidor = servidorFalso((n) =>
      n === 1
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve({ ok: true, dato: { recepcionId: ID_COMPRA, yaExistia: true } }),
    );
    const irA = vi.fn();
    await page.viewport(390, 2400);
    await render(pantalla(servidor, { irA, esperaEntreVerificacionesMs: 400 }));
    await cargarLaCompra();
    tocar(boton("Comprar y recibir"));
    await expect.element(page.getByText("Verificando si se registró…").first()).toBeVisible();
    await expect.element(page.getByLabelText("Cantidad")).toBeDisabled();
    await vi.waitFor(() => expect(irA).toHaveBeenCalledWith(`/compras/${ID_COMPRA}`));
    expect(servidor.pedidos).toHaveLength(2);
    expect(servidor.pedidos[1]).toEqual(servidor.pedidos[0]);
    expect(servidor.pedidos[1]?.["clave"]).toBe(servidor.pedidos[0]?.["clave"]);
  });

  it("un rechazo de negocio (remito repetido) se ve con su texto, no navega y el próximo toque es otro intento con otra clave", async () => {
    const servidor = servidorFalso(() =>
      Promise.resolve({ ok: false, error: errorDeCodigo("COMPRAS_REMITO_REPETIDO") }),
    );
    const irA = vi.fn();
    await render(pantalla(servidor, { irA }));
    await cargarLaCompra();
    tocar(boton("Comprar y recibir"));
    await expect.element(page.getByText("Ese remito ya está cargado")).toBeVisible();
    expect(irA).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("COMPRAS_REMITO_REPETIDO");
    await userEvent.type(page.getByLabelText("Número"), "1");
    tocar(boton("Comprar y recibir"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(2));
    expect(servidor.pedidos[1]?.["clave"]).not.toBe(servidor.pedidos[0]?.["clave"]);
  });

  it("sin conexión el botón está apagado y dice por qué; no se manda nada y lo escrito se conserva", async () => {
    const servidor = servidorFalso();
    await render(pantalla(servidor));
    await cargarLaCompra();
    simularConexion(false);
    await expect.element(boton("Comprar y recibir")).toBeDisabled();
    await expect
      .element(boton("Comprar y recibir"))
      .toHaveAccessibleDescription("No se puede enviar sin conexión.");
    await expect.element(page.getByLabelText("Cantidad")).toHaveValue("2");
    expect(servidor.pedidos).toHaveLength(0);
  });
});

describe("Nueva compra «Con factura» (Compras PR 7)", () => {
  /** La cuenta de la factura que haría el servidor: se anota lo que recibe y se contesta algo fijo (la pantalla nunca suma). */
  function conFactura(servidor: ReturnType<typeof servidorFalso>, tieneCuit = true) {
    const cotizadas: Record<string, unknown>[] = [];
    return {
      cotizadas,
      pantalla: pantalla(servidor, {
        conFactura: true,
        buscarProveedores: (texto) =>
          Promise.resolve({
            ok: true,
            dato: texto.toLowerCase().includes("frigo")
              ? [{ id: ID_PROVEEDOR, nombre: "Frigorífico Norte", tieneCuit }]
              : [],
          }),
        cotizarFactura: (factura) => {
          cotizadas.push(factura as Record<string, unknown>);
          return Promise.resolve({
            ok: true,
            dato: {
              lineas: [{ netoDeLinea: "22000.00", ivaDeLinea: "4620.00" }],
              totalCalculado: "26620.00",
              totalSegunFactura: (factura as { totalSegunFactura: string }).totalSegunFactura,
              totalCoincide:
                (factura as { totalSegunFactura: string }).totalSegunFactura === "26620.00",
            },
          });
        },
      }),
    };
  }

  async function llenarElComprobante() {
    await userEvent.selectOptions(page.getByLabelText("Tipo"), "FACTURA_A");
    await userEvent.type(page.getByLabelText("Punto de venta").nth(1), "5");
    await userEvent.type(page.getByLabelText("Número").nth(1), "1187");
    await userEvent.fill(page.getByLabelText("Fecha de la factura"), "2026-11-20");
  }

  it("sin «Con factura» no hay bloque de factura", async () => {
    await render(pantalla(servidorFalso()));
    expect(page.getByLabelText("Tipo").elements()).toHaveLength(0);
    expect(page.getByLabelText("Total según la factura").elements()).toHaveLength(0);
  });

  it("con «Con factura» el bloque aparece y «Comprar y recibir» espera a la factura", async () => {
    const { pantalla: conBloque } = conFactura(servidorFalso());
    await render(conBloque);
    await cargarLaCompra();
    await expect.element(page.getByLabelText("Tipo")).toBeVisible();
    await expect.element(boton("Comprar y recibir")).toBeDisabled();
  });

  it("precarga la cantidad y el precio neto del renglón; el IVA solo en una A; el servidor cuenta y la pantalla lo muestra; sin violaciones de accesibilidad", async () => {
    const servidor = servidorFalso();
    const { pantalla: p, cotizadas } = conFactura(servidor);
    await render(p);
    await cargarLaCompra("2", "11000");
    await expect.element(page.getByLabelText("Cantidad facturada")).toHaveValue("2");
    await vi.waitFor(() =>
      expect((page.getByLabelText("Precio neto").element() as HTMLInputElement).value).toMatch(
        /^11\.000/,
      ),
    );
    await userEvent.selectOptions(page.getByLabelText("Tipo"), "FACTURA_B");
    await expect
      .element(page.getByText("Sin IVA discriminado: es un comprobante B o C"))
      .toBeVisible();
    expect(page.getByLabelText("IVA: Bife de chorizo").elements()).toHaveLength(0);
    await userEvent.selectOptions(page.getByLabelText("Tipo"), "FACTURA_A");
    await expect.element(page.getByLabelText("IVA: Bife de chorizo")).toHaveValue("21");
    await userEvent.type(page.getByLabelText("Total según la factura"), "26620");
    await vi.waitFor(() => expect(cotizadas.length).toBeGreaterThan(0));
    const ultima = cotizadas.at(-1) as {
      tipo: string;
      lineas: Record<string, unknown>[];
      totalSegunFactura: string;
    };
    expect(ultima.tipo).toBe("FACTURA_A");
    expect(ultima.totalSegunFactura).toBe("26620.00");
    expect(ultima.lineas).toEqual([
      { cantidadFacturada: "2", precioNeto: "11000.00", alicuota: "21" },
    ]);
    await expect.element(page.getByText("$ 26.620,00").first()).toBeVisible();
    await expect.element(page.getByText("El total coincide con la factura")).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });

  it("un total que no coincide avisa y deja guardar igual; la factura sale completa con la MISMA clave y el mismo pedido, y un doble toque es UN envío", async () => {
    const servidor = servidorFalso();
    const { pantalla: p } = conFactura(servidor);
    await render(p);
    await cargarLaCompra("2", "11000");
    await llenarElComprobante();
    await userEvent.type(page.getByLabelText("Total según la factura"), "26000");
    await expect.element(page.getByText("El total no coincide")).toBeVisible();
    const comprar = boton("Comprar y recibir");
    await expect.element(comprar).toBeEnabled();
    tocar(comprar);
    tocar(comprar);
    await vi.waitFor(() => expect(servidor.pedidos.length).toBe(1));
    const pedido = servidor.pedidos[0] as { factura: Record<string, unknown> };
    expect(pedido.factura).toMatchObject({
      tipo: "FACTURA_A",
      puntoDeVenta: "5",
      numero: "1187",
      fecha: "2026-11-20",
      vencimientoDePago: null,
      percepciones: null,
      totalSegunFactura: "26000.00",
      cuitDelProveedor: null,
      lineas: [{ renglon: 1, cantidadFacturada: "2", precioNeto: "11000.00", alicuota: "21" }],
    });
    expect(Object.keys(pedido.factura).sort()).not.toContain("pago");
  });

  it("la primera factura de un proveedor sin CUIT lo pide y no deja guardar sin él; con CUIT no lo pide", async () => {
    const servidor = servidorFalso();
    const { pantalla: sinCuit } = conFactura(servidor, false);
    const { unmount } = await render(sinCuit);
    await cargarLaCompra("2", "11000");
    await llenarElComprobante();
    await userEvent.type(page.getByLabelText("Total según la factura"), "26620");
    await expect.element(boton("Comprar y recibir")).toBeDisabled();
    await userEvent.type(page.getByLabelText("CUIT"), "20123456786");
    await expect.element(boton("Comprar y recibir")).toBeEnabled();
    tocar(boton("Comprar y recibir"));
    await vi.waitFor(() => expect(servidor.pedidos.length).toBe(1));
    expect(
      (servidor.pedidos[0] as { factura: { cuitDelProveedor: string } }).factura.cuitDelProveedor,
    ).toBe("20123456786");
    unmount();
    const conCuit = servidorFalso();
    await render(conFactura(conCuit, true).pantalla);
    await cargarLaCompra("2", "11000");
    expect(page.getByLabelText("CUIT").elements()).toHaveLength(0);
  });
});
