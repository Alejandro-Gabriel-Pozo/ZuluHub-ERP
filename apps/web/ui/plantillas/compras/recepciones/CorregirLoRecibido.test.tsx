import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import { CorregirLoRecibido } from "./CorregirLoRecibido.cliente";
import { PantallaDeDetalleDeRecepcion } from "./PantallaDeDetalleDeRecepcion";
import type { FichaDeRecepcionParaLaPantalla } from "./modelo-de-recepciones";
import { textosDeRecepciones } from "./textos-de-recepciones";

/**
 * «Corregir lo recibido» en Chromium (Compras 4, PR D; maqueta «Tomar el costo», estado «Corregir»): el botón de cada línea de una recepción CONFIRMADA solo con el permiso, la hoja con lo que rige hoy, la cantidad,
 * el motivo de una lista cerrada y la nota opcional, el aviso de «Reparto interno», el envío idempotente por intento (un doble toque es UN pedido; un reintento manda la MISMA clave con el MISMO pedido), el rechazo
 * como el genérico y la historia de «Correcciones» con lo que rige hoy. Lo que se rechaza en el servidor (alcance, tope de lo conciliado, existencia) se ve como el genérico.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = "9c9c9c9c-1111-4222-8333-444444444444";
const GENERICO = {
  codigo: "COMPRAS_ACCION_NO_PERMITIDA",
  clave: "compras.error.sin_permiso",
  presentacion: "AVISO",
} as const;
const textos = textosDeRecepciones();
const TODO = { registrar: true, confirmar: true, anular: true, corregir: true };
const CAUSAS = ["ERROR_DE_CARGA", "REPARTO_INTERNO", "FALTANTE_DEL_PROVEEDOR"] as const;
const FICHA: FichaDeRecepcionParaLaPantalla = {
  recepcionId: ID,
  numero: 14,
  proveedor: "Distribuidora Central",
  fechaNegocio: "2026-11-24",
  remito: null,
  estado: "RECIBIDA_SIN_FACTURAR",
  motivoDeAnulacion: null,
  lineas: [
    {
      numero: 1,
      producto: "Harina 000",
      cantidadDeCompra: "60.0000",
      unidadDeCompraId: "KILOGRAMO",
      cantidadEnStock: "60000.0000",
      unidadDeStockId: "GRAMO",
      cantidadRecibida: "60000.0000",
      correccionesVistas: 0,
      correcciones: [],
    },
  ],
};

afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

type Salida = Respuesta<
  Readonly<{ recepcionId: string; linea: number; numero: number; yaExistia: boolean }>
>;
const HECHA: Salida = {
  ok: true,
  dato: { recepcionId: ID, linea: 1, numero: 1, yaExistia: false },
};

function servidorFalso(respuesta: () => Promise<Salida> = () => Promise.resolve(HECHA)) {
  const pedidos: Record<string, unknown>[] = [];
  return {
    pedidos,
    corregir: (pedido: unknown) => {
      pedidos.push(pedido as Record<string, unknown>);
      return respuesta();
    },
  };
}
const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });

const detalle = (
  servidor: ReturnType<typeof servidorFalso>,
  extra: Partial<Parameters<typeof PantallaDeDetalleDeRecepcion>[0]> = {},
) => (
  <PantallaDeDetalleDeRecepcion
    ficha={FICHA}
    textos={textos}
    acciones={TODO}
    accionDeCorregir={servidor.corregir}
    causas={CAUSAS}
    {...extra}
  />
);

const hoja = (
  servidor: ReturnType<typeof servidorFalso>,
  extra: Partial<Parameters<typeof CorregirLoRecibido>[0]> = {},
) => (
  <CorregirLoRecibido
    recepcionId={ID}
    linea={1}
    nombre="Harina 000"
    hoy="60.000 Gramo"
    causas={CAUSAS}
    correccionesVistas={0}
    corregir={servidor.corregir}
    textos={{
      corregirLoRecibido: textos.corregirLoRecibido,
      corregir: textos.corregir,
      cantidadRecibida: textos.cantidadRecibida,
      motivoDeLaCorreccion: textos.motivoDeLaCorreccion,
      causaErrorDeCarga: textos.causaErrorDeCarga,
      causaRepartoInterno: textos.causaRepartoInterno,
      causaFaltanteDelProveedor: textos.causaFaltanteDelProveedor,
      avisoRepartoInterno: textos.avisoRepartoInterno,
      nota: textos.nota,
      sinElegir: textos.sinElegir,
      cancelar: textos.cancelar,
      cerrar: textos.cerrar,
      enviando: textos.enviando,
      reintentar: textos.reintentar,
    }}
    irA={() => undefined}
    {...extra}
  />
);

async function abrirYCompletar(cantidad: string, causa: string, nota = "") {
  tocar(boton("Corregir lo recibido"));
  await userEvent.type(page.getByLabelText("Cantidad recibida"), cantidad);
  await userEvent.selectOptions(page.getByLabelText("Motivo de la corrección"), causa);
  if (nota !== "") await userEvent.type(page.getByLabelText("Nota"), nota);
}

describe("«Corregir lo recibido»", () => {
  it("se ofrece en cada línea de una recepción confirmada solo con el permiso; en una por confirmar, anulada o sin permiso no", async () => {
    const servidor = servidorFalso();
    const { unmount } = await render(detalle(servidor));
    await expect.element(boton("Corregir lo recibido")).toBeVisible();
    await unmount();
    const sinPermiso = await render(detalle(servidor, { acciones: { ...TODO, corregir: false } }));
    await expect.element(boton("Corregir lo recibido")).not.toBeInTheDocument();
    await sinPermiso.unmount();
    const porConfirmar = await render(
      detalle(servidor, { ficha: { ...FICHA, estado: "PENDIENTE_DE_CONFIRMAR" } }),
    );
    await expect.element(boton("Corregir lo recibido")).not.toBeInTheDocument();
    await porConfirmar.unmount();
    await render(
      detalle(servidor, {
        ficha: { ...FICHA, estado: "ANULADA", motivoDeAnulacion: "Se cargó dos veces" },
      }),
    );
    await expect.element(boton("Corregir lo recibido")).not.toBeInTheDocument();
  });

  it("sin la acción ligada no se dibuja el botón (todo nace cerrado)", async () => {
    await render(<PantallaDeDetalleDeRecepcion ficha={FICHA} textos={textos} acciones={TODO} />);
    await expect.element(boton("Corregir lo recibido")).not.toBeInTheDocument();
  });

  it("la hoja muestra lo que rige hoy y el motivo ofrece solo la lista cerrada; «Corregir» queda apagado hasta completar la cantidad y el motivo", async () => {
    await render(hoja(servidorFalso()));
    tocar(boton("Corregir lo recibido"));
    await expect.element(page.getByText("Harina 000 · 60.000 Gramo")).toBeVisible();
    const motivo = page.getByLabelText("Motivo de la corrección");
    await expect
      .element(motivo.getByRole("option", { name: "Error de carga" }))
      .toBeInTheDocument();
    await expect
      .element(motivo.getByRole("option", { name: "Reparto interno" }))
      .toBeInTheDocument();
    await expect
      .element(motivo.getByRole("option", { name: "Faltante del proveedor" }))
      .toBeInTheDocument();
    await expect.element(boton("Corregir")).toBeDisabled();
    await userEvent.type(page.getByLabelText("Cantidad recibida"), "50000");
    await expect.element(boton("Corregir")).toBeDisabled();
    await userEvent.selectOptions(motivo, "FALTANTE_DEL_PROVEEDOR");
    await expect.element(boton("Corregir")).toBeEnabled();
  });

  it("con «Reparto interno» avisa que la otra sucursal tiene que corregirse también; con otro motivo no", async () => {
    await render(hoja(servidorFalso()));
    tocar(boton("Corregir lo recibido"));
    const aviso = page.getByText(/la otra sucursal/);
    await userEvent.selectOptions(
      page.getByLabelText("Motivo de la corrección"),
      "REPARTO_INTERNO",
    );
    await expect.element(aviso).toBeVisible();
    await userEvent.selectOptions(page.getByLabelText("Motivo de la corrección"), "ERROR_DE_CARGA");
    await expect.element(aviso).not.toBeInTheDocument();
  });

  it("el pedido sale con la clave del intento, la versión vista, la cantidad, la causa y la nota; sin empresa, persona ni sucursal", async () => {
    const servidor = servidorFalso();
    await render(hoja(servidor, { correccionesVistas: 2 }));
    await abrirYCompletar("50000", "FALTANTE_DEL_PROVEEDOR", "Faltaron 10 bolsas");
    tocar(boton("Corregir"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    const pedido = servidor.pedidos[0] as Record<string, unknown>;
    expect(Object.keys(pedido).sort()).toEqual([
      "cantidad",
      "causa",
      "clave",
      "correccionesVistas",
      "linea",
      "nota",
      "recepcionId",
    ]);
    expect(pedido["clave"]).toMatch(UUID);
    expect(pedido).toMatchObject({
      recepcionId: ID,
      linea: 1,
      correccionesVistas: 2,
      cantidad: "50000",
      causa: "FALTANTE_DEL_PROVEEDOR",
      nota: "Faltaron 10 bolsas",
    });
  });

  it("la nota es opcional: sin ella el pedido no la lleva", async () => {
    const servidor = servidorFalso();
    await render(hoja(servidor));
    await abrirYCompletar("50000", "ERROR_DE_CARGA");
    tocar(boton("Corregir"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    expect(servidor.pedidos[0]).not.toHaveProperty("nota");
  });

  it("un doble toque (tres, en el mismo instante) es UNA corrección, y al terminar abre el detalle de la recepción", async () => {
    const servidor = servidorFalso(
      () => new Promise((resolver) => setTimeout(() => resolver(HECHA), 60)),
    );
    const irA = vi.fn();
    await render(hoja(servidor, { irA }));
    await abrirYCompletar("50000", "ERROR_DE_CARGA");
    tocar(boton("Corregir"));
    tocar(boton("Corregir"));
    tocar(boton("Corregir"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalledTimes(1));
    expect(irA).toHaveBeenCalledWith(`/compras/recepciones/${ID}`);
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
          : { ok: true, dato: { recepcionId: ID, linea: 1, numero: 1, yaExistia: true } },
      ) as Promise<Salida>;
    });
    await render(hoja(servidor));
    await abrirYCompletar("50000", "ERROR_DE_CARGA");
    tocar(boton("Corregir"));
    await expect.element(boton("Reintentar")).toBeVisible();
    tocar(boton("Reintentar"));
    await vi.waitFor(() => expect(servidor.pedidos.length).toBeGreaterThanOrEqual(2), {
      timeout: 5000,
    });
    expect(servidor.pedidos[1]).toEqual(servidor.pedidos[0]);
  });

  it("un rechazo (alcance, por debajo de lo conciliado, otra persona corrigió antes) se muestra como el genérico", async () => {
    const servidor = servidorFalso(() => Promise.resolve({ ok: false, error: GENERICO }));
    await render(hoja(servidor));
    await abrirYCompletar("50000", "ERROR_DE_CARGA");
    tocar(boton("Corregir"));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
  });

  it("una línea corregida muestra lo que rige hoy y la historia de «Correcciones» con su motivo y su nota", async () => {
    await render(
      detalle(servidorFalso(), {
        ficha: {
          ...FICHA,
          lineas: [
            {
              ...(FICHA.lineas[0] as (typeof FICHA.lineas)[number]),
              cantidadRecibida: "50000.0000",
              correccionesVistas: 1,
              correcciones: [
                {
                  numero: 1,
                  cantidadAnterior: "60000.0000",
                  cantidadNueva: "50000.0000",
                  causa: "FALTANTE_DEL_PROVEEDOR",
                  nota: "Faltaron 10 bolsas",
                },
              ],
            },
          ],
        },
      }),
    );
    await expect.element(page.getByText("50.000 Gramo", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Correcciones", { exact: true })).toBeVisible();
    await expect
      .element(
        page.getByText(
          "Harina 000 · 60.000 Gramo → 50.000 Gramo · Faltante del proveedor · Faltaron 10 bolsas",
        ),
      )
      .toBeVisible();
  });

  it("cumple accesibilidad (axe) con la hoja abierta", async () => {
    await render(hoja(servidorFalso()));
    tocar(boton("Corregir lo recibido"));
    await expect.element(page.getByLabelText("Cantidad recibida")).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });
});
