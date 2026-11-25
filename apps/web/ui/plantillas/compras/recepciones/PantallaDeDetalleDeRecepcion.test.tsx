import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import { PantallaDeDetalleDeRecepcion } from "./PantallaDeDetalleDeRecepcion";
import { PantallaDeListaDeRecepciones } from "./PantallaDeListaDeRecepciones";
import type {
  FichaDeRecepcionParaLaPantalla,
  ListaDeRecepcionesParaLaPantalla,
} from "./modelo-de-recepciones";
import type { ResultadoDeLaRecepcion } from "./resultado-de-recepcion";
import { textosDeRecepciones } from "./textos-de-recepciones";

/**
 * «Recepciones» en Chromium (Compras 4; maqueta `compra-recibir.html`): la lista con su estado en texto, el detalle con lo recibido SIN precios, y los botones «Confirmar recepción» y «Anular recepción» solo con la
 * recepción «Por confirmar» y el permiso. Los botones se apagan mientras envían (un segundo toque no manda nada) y el depósito se pide solo si hay más de uno.
 */

const ID = "9c9c9c9c-1111-4222-8333-444444444444";
const FICHA: FichaDeRecepcionParaLaPantalla = {
  recepcionId: ID,
  numero: 14,
  proveedor: "Distribuidora Central",
  fechaNegocio: "2026-11-24",
  remito: { puntoDeVenta: 3, numero: 18842, fecha: "2026-11-24" },
  estado: "PENDIENTE_DE_CONFIRMAR",
  motivoDeAnulacion: null,
  lineas: [
    {
      numero: 1,
      producto: "Harina 000",
      cantidadDeCompra: "60.0000",
      unidadDeCompraId: "KILOGRAMO",
      cantidadEnStock: "60000.0000",
      unidadDeStockId: "GRAMO",
    },
  ],
};
const GENERICO = {
  codigo: "COMPRAS_ACCION_NO_PERMITIDA",
  clave: "compras.error.sin_permiso",
  presentacion: "AVISO",
} as const;
const TODO = { registrar: true, confirmar: true, anular: true };
const textos = textosDeRecepciones();

afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

const hecho = (): Promise<ResultadoDeLaRecepcion> =>
  Promise.resolve({ estado: "HECHO", ruta: "/compras/recepciones/otra" });
const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });

const detalle = (
  extra: Partial<Parameters<typeof PantallaDeDetalleDeRecepcion>[0]> = {},
  acciones = vi.fn(hecho),
) => (
  <PantallaDeDetalleDeRecepcion
    ficha={FICHA}
    textos={textos}
    acciones={TODO}
    accionDeConfirmar={acciones}
    accionDeAnular={vi.fn(hecho)}
    {...extra}
  />
);

describe("el detalle de una recepción", () => {
  it("muestra el proveedor, la fecha, el estado «Por confirmar», el remito y la línea con lo recibido; sin precios ni costos", async () => {
    await render(detalle());
    await expect.element(page.getByText("Distribuidora Central · 24/11/2026")).toBeVisible();
    await expect.element(page.getByText("Por confirmar", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Harina 000")).toBeVisible();
    await expect.element(page.getByText(/60 Kilogramo/)).toBeVisible();
    await expect.element(page.getByText(/\$/)).not.toBeInTheDocument();
    await expect.element(page.getByText(/Costo por unidad/)).not.toBeInTheDocument();
  });

  it("el gerente ve «Confirmar recepción» y «Anular recepción»; el operador (sin permiso) no ve ninguno de los dos", async () => {
    const { unmount } = await render(detalle());
    await expect.element(boton("Confirmar recepción")).toBeVisible();
    await expect.element(boton("Anular recepción")).toBeVisible();
    await unmount();
    await render(detalle({ acciones: { registrar: true, confirmar: false, anular: false } }));
    await expect.element(boton("Confirmar recepción")).not.toBeInTheDocument();
    await expect.element(boton("Anular recepción")).not.toBeInTheDocument();
  });

  it("una recepción ya confirmada o anulada no ofrece los botones, aunque haya permiso; la anulada dice su motivo", async () => {
    const { unmount } = await render(
      detalle({ ficha: { ...FICHA, estado: "RECIBIDA_SIN_FACTURAR" } }),
    );
    await expect.element(boton("Confirmar recepción")).not.toBeInTheDocument();
    await unmount();
    await render(
      detalle({ ficha: { ...FICHA, estado: "ANULADA", motivoDeAnulacion: "Se cargó dos veces" } }),
    );
    await expect.element(boton("Anular recepción")).not.toBeInTheDocument();
    await expect.element(page.getByText("Se cargó dos veces")).toBeVisible();
    await expect.element(page.getByText("Anulada", { exact: true })).toBeVisible();
  });

  it("un doble toque en «Confirmar recepción» (con el botón ya apagado) manda UN solo pedido", async () => {
    let terminar: () => void = () => undefined;
    const accion = vi.fn(async (): Promise<ResultadoDeLaRecepcion> => {
      await new Promise<void>((r) => {
        terminar = r;
      });
      return { estado: "INICIAL" };
    });
    await render(detalle({}, accion));
    const confirmar = boton("Confirmar recepción");
    tocar(confirmar);
    // El botón queda apagado mientras corre: los toques que siguen no mandan nada (y si llegaran, el servidor confirma una sola vez: `compras-recepciones-web.test.ts`).
    await expect.element(confirmar).toHaveAttribute("aria-busy", "true");
    tocar(confirmar);
    tocar(confirmar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    terminar();
    // Se espera a que la acción termine: una acción pendiente de una prueba bloquearía las de las pruebas que siguen.
    await expect.element(boton("Confirmar recepción")).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("con más de un depósito pide elegir cuál, y «Confirmar recepción» queda apagado hasta elegir", async () => {
    await render(
      detalle({
        depositos: [
          { id: "d1", nombre: "Depósito general" },
          { id: "d2", nombre: "Cámara" },
        ],
      }),
    );
    await expect.element(page.getByLabelText("Depósito")).toBeVisible();
    await expect.element(boton("Confirmar recepción")).toBeDisabled();
    await userEvent.selectOptions(page.getByLabelText("Depósito"), "d2");
    await expect.element(boton("Confirmar recepción")).toBeEnabled();
  });

  it("«Anular recepción» abre una hoja que pide el motivo; «Anular» queda apagado sin motivo", async () => {
    await render(detalle());
    await userEvent.click(boton("Anular recepción"));
    const anular = page.getByRole("dialog").getByRole("button", { name: "Anular", exact: true });
    await expect.element(anular).toBeDisabled();
    await userEvent.type(page.getByLabelText("Motivo"), "Se cargó dos veces");
    await expect.element(anular).toBeEnabled();
  });

  it("un rechazo del servidor se muestra como el genérico y la pantalla no navega", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (): Promise<ResultadoDeLaRecepcion> => {
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { estado: "ERROR", error: GENERICO };
    });
    await render(detalle({}, accion));
    const confirmar = boton("Confirmar recepción");
    tocar(confirmar);
    await expect.element(confirmar).toHaveAttribute("aria-busy", "true");
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(confirmar).not.toHaveAttribute("aria-busy", "true");
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(confirmar).toBeEnabled();
  });

  it("cumple accesibilidad (axe)", async () => {
    await render(detalle());
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });
});

describe("la lista de recepciones", () => {
  const LISTA: ListaDeRecepcionesParaLaPantalla = {
    recepciones: [
      {
        recepcionId: ID,
        numero: 14,
        proveedor: "Distribuidora Central",
        fechaNegocio: "2026-11-24",
        remito: null,
        estado: "PENDIENTE_DE_CONFIRMAR",
      },
      {
        recepcionId: "1a1a1a1a-1111-4222-8333-444444444444",
        numero: 13,
        proveedor: null,
        fechaNegocio: "2026-11-21",
        remito: null,
        estado: "RECIBIDA_SIN_FACTURAR",
      },
    ],
    siguiente: "2026-11-21|1a1a1a1a-1111-4222-8333-444444444444",
  };

  it("cada fila es un enlace a su detalle con el estado en texto; sin proveedor dice «—»; hay «Recibir» y página siguiente", async () => {
    await render(<PantallaDeListaDeRecepciones lista={LISTA} textos={textos} puedeRecibir />);
    const fila = page.getByRole("link", {
      name: /Recepción 14 · Distribuidora Central, Por confirmar · 24\/11\/2026/,
    });
    await expect.element(fila).toHaveAttribute("href", `/compras/recepciones/${ID}`);
    await expect
      .element(page.getByRole("link", { name: /Recepción 13 · —, Recibida sin facturar/ }))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Recibir" }))
      .toHaveAttribute("href", "/compras/recepciones/recibir");
    await expect.element(page.getByRole("link", { name: "Página siguiente" })).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });

  it("sin permiso de registrar no hay «Recibir»; sin filas dice «Sin resultados»", async () => {
    await render(
      <PantallaDeListaDeRecepciones lista={{ recepciones: [], siguiente: null }} textos={textos} />,
    );
    await expect.element(page.getByText("Sin resultados")).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Recibir" })).not.toBeInTheDocument();
  });
});
