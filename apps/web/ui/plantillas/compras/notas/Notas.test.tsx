import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import type { ResultadoDeAnularPago } from "../pago/resultado-de-pago";
import { PantallaDeDetalleDeFactura } from "../facturas/PantallaDeDetalleDeFactura";
import type { FichaDeFacturaParaLaPantalla } from "../facturas/modelo-de-facturas";
import { textosDeFacturas } from "../facturas/textos-de-facturas";
import { FormularioDeCargarNota } from "./FormularioDeCargarNota.cliente";
import { PantallaDeNotas } from "./PantallaDeNotas";
import {
  armarLaPantallaDeNotas,
  type AccionesDeLasNotas,
  type NotasParaLaPantalla,
} from "./modelo-de-notas";
import { textosDeNotas } from "./textos-de-notas";

/**
 * Las pantallas de notas del proveedor en Chromium (NOTAS-2c-1; maqueta `servicios-y-bienes-de-uso.html`, pantallas 9 y 10). «Notas de la factura»: lo que dice el servidor sin sumar nada, los botones solo con el permiso de
 * cada acción y la hoja de «Anular» que pide el motivo. «Cargar una nota del proveedor»: el pedido sale con la clave del intento, la factura de la ruta y la nota con los importes como TEXTO, sin proveedor ni empresa; un doble toque
 * es UN pedido; un reintento manda la MISMA clave con el MISMO pedido; un rechazo se ve como el genérico; al terminar abre «Notas de la factura». Accesibilidad con axe.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FACTURA = "5d5d5d5d-1111-4222-8333-444444444444";
const NOTA = "6e6e6e6e-1111-4222-8333-444444444444";
const textos = textosDeNotas();
const GENERICO = {
  codigo: "COMPRAS_ACCION_NO_PERMITIDA",
  clave: "compras.error.sin_permiso",
  presentacion: "AVISO",
} as const;

afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

const TODO: AccionesDeLasNotas = {
  registrarCredito: true,
  registrarDebito: true,
  anularCredito: true,
  anularDebito: true,
};
const DATOS: NotasParaLaPantalla = {
  facturaId: FACTURA,
  tipo: "FACTURA_A",
  puntoDeVenta: 3,
  numero: 12345,
  totalDeLaFactura: "1876710.00",
  acreditado: "121000.00",
  debitado: "12100.00",
  netoAPagar: "1755710.00",
  saldoAFavorPendiente: null,
  notas: [
    {
      comprobanteId: NOTA,
      clase: "NOTA_DE_CREDITO",
      tipo: "NOTA_CREDITO_A",
      puntoDeVenta: 3,
      numero: 77,
      fechaNegocio: "2026-11-27",
      total: "121000.00",
      estado: "REGISTRADO",
    },
    {
      comprobanteId: "7f7f7f7f-1111-4222-8333-444444444444",
      clase: "NOTA_DE_DEBITO",
      tipo: "NOTA_DEBITO_A",
      puntoDeVenta: 3,
      numero: 12,
      fechaNegocio: "2026-12-01",
      total: "12100.00",
      estado: "ANULADO",
    },
  ],
};

const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });
const enlace = (nombre: string) => page.getByRole("link", { name: nombre, exact: true });

const pantalla = (
  cambios: Partial<NotasParaLaPantalla> = {},
  acciones: AccionesDeLasNotas = TODO,
  accion: (previo: ResultadoDeAnularPago, datos: FormData) => Promise<ResultadoDeAnularPago> = () =>
    Promise.resolve({ estado: "INICIAL" }),
) => (
  <PantallaDeNotas
    pantalla={armarLaPantallaDeNotas({ ...DATOS, ...cambios }, textos, acciones)}
    textos={textos}
    accionesDeAnular={{ [NOTA]: accion }}
  />
);

describe("«Notas de la factura»", () => {
  it("muestra lo que dice el servidor: total, créditos, débitos, importe a pagar y la lista con su estado; sin violaciones de accesibilidad", async () => {
    await render(pantalla());
    await expect.element(page.getByText("Total de la factura", { exact: true })).toBeVisible();
    await expect.element(page.getByText("$ 1.876.710,00", { exact: true })).toBeVisible();
    await expect.element(page.getByText("− $ 121.000,00", { exact: true })).toBeVisible();
    await expect.element(page.getByText("+ $ 12.100,00", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Importe a pagar", { exact: true })).toBeVisible();
    await expect.element(page.getByText("$ 1.755.710,00", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Nota de crédito · A 0003-00000077 · 27/11/2026", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("Nota de débito · A 0003-00000012 · 01/12/2026", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Vigente", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Anulada", { exact: true })).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });

  it("«Saldada por notas» con neto cero y «Saldo a favor» con su importe cuando un pago supera al neto", async () => {
    const saldada = await render(pantalla({ netoAPagar: "0.00", acreditado: "1876710.00" }));
    await expect.element(page.getByText("Saldada por notas", { exact: true })).toBeVisible();
    await saldada.unmount();
    await render(pantalla({ netoAPagar: "0.00", saldoAFavorPendiente: "500.50" }));
    await expect.element(page.getByText("Saldo a favor", { exact: true })).toBeVisible();
    await expect.element(page.getByText("$ 500,50", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Saldada por notas", { exact: true }))
      .not.toBeInTheDocument();
  });

  it("todo nace cerrado: sin permisos no hay «Anular» ni «Cargar»; con ellos, cada enlace lleva a la carga de su clase", async () => {
    const sin = await render(
      pantalla(
        {},
        {
          registrarCredito: false,
          registrarDebito: false,
          anularCredito: false,
          anularDebito: false,
        },
      ),
    );
    await expect.element(boton("Anular")).not.toBeInTheDocument();
    await expect.element(enlace("Cargar nota de crédito")).not.toBeInTheDocument();
    await expect.element(enlace("Cargar nota de débito")).not.toBeInTheDocument();
    await sin.unmount();
    await render(pantalla());
    await expect
      .element(enlace("Cargar nota de crédito"))
      .toHaveAttribute("href", `/compras/facturas/${FACTURA}/notas/nueva?clase=credito`);
    await expect
      .element(enlace("Cargar nota de débito"))
      .toHaveAttribute("href", `/compras/facturas/${FACTURA}/notas/nueva?clase=debito`);
    // Solo la nota vigente tiene «Anular»; la anulada no.
    expect(page.getByRole("button", { name: "Anular", exact: true }).elements()).toHaveLength(1);
  });

  it("«Anular» abre la hoja, pide el motivo (apagado sin escribirlo) y manda solo el motivo; el id de la nota no viaja en el formulario", async () => {
    const accion = vi.fn(() => Promise.resolve<ResultadoDeAnularPago>({ estado: "INICIAL" }));
    await render(pantalla({}, TODO, accion));
    tocar(boton("Anular"));
    const confirmar = page.getByRole("dialog").getByRole("button", { name: "Anular", exact: true });
    await expect.element(confirmar).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Motivo"), "Se cargó dos veces");
    await expect.element(confirmar).toBeEnabled();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    tocar(confirmar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = (accion.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect([...datos.keys()]).toEqual(["motivo"]);
    expect(datos.get("motivo")).toBe("Se cargó dos veces");
  });

  it("un rechazo al anular (por ejemplo la nota que un pago ya descontó) se ve en la hoja con su texto", async () => {
    const accion = () =>
      Promise.resolve<ResultadoDeAnularPago>({
        estado: "ERROR",
        error: {
          codigo: "COMPRAS_NOTA_CON_PAGO",
          clave: "compras.error.nota_con_pago",
          presentacion: "AVISO",
        } as never,
      });
    await render(pantalla({}, TODO, accion));
    tocar(boton("Anular"));
    await userEvent.fill(page.getByLabelText("Motivo"), "Mal");
    tocar(page.getByRole("dialog").getByRole("button", { name: "Anular", exact: true }));
    await expect
      .element(page.getByText("Primero anulá el pago: se pagó con esta nota descontada"))
      .toBeVisible();
  });
});

type Salida = Respuesta<Readonly<{ comprobanteId: string; yaExistia: boolean }>>;
const HECHA: Salida = { ok: true, dato: { comprobanteId: NOTA, yaExistia: false } };

function servidorFalso(respuesta: () => Promise<Salida> = () => Promise.resolve(HECHA)) {
  const pedidos: Record<string, unknown>[] = [];
  return {
    pedidos,
    registrar: (pedido: unknown) => {
      pedidos.push(pedido as Record<string, unknown>);
      return respuesta();
    },
  };
}

const formulario = (
  servidor: ReturnType<typeof servidorFalso>,
  extra: Partial<Parameters<typeof FormularioDeCargarNota>[0]> = {},
) => (
  <FormularioDeCargarNota
    clase="credito"
    facturaId={FACTURA}
    textos={textos}
    todaviaSePuedeAcreditar="1010.00"
    registrar={servidor.registrar}
    irA={() => undefined}
    {...extra}
  />
);

async function completar() {
  await userEvent.selectOptions(page.getByLabelText("Tipo"), "NOTA_CREDITO_A");
  await userEvent.fill(page.getByLabelText("Punto de venta"), "3");
  await userEvent.fill(page.getByLabelText("Número"), "77");
  await userEvent.fill(page.getByLabelText("Fecha"), "2026-11-27");
  await userEvent.fill(page.getByLabelText("Neto"), "100000,00");
  await userEvent.fill(page.getByLabelText("Total de la nota"), "121000,00");
}

describe("«Cargar una nota del proveedor»", () => {
  it("«Guardar» queda apagado hasta completar la nota; la de crédito muestra lo que todavía se puede acreditar y la de débito no; sin violaciones de accesibilidad", async () => {
    const credito = await render(formulario(servidorFalso()));
    await expect.element(boton("Guardar")).toBeDisabled();
    await expect
      .element(page.getByText("Todavía se puede acreditar", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("$ 1.010,00", { exact: true })).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    await completar();
    await expect.element(boton("Guardar")).toBeEnabled();
    await credito.unmount();
    await render(formulario(servidorFalso(), { clase: "debito", todaviaSePuedeAcreditar: null }));
    await expect
      .element(page.getByText("Todavía se puede acreditar", { exact: true }))
      .not.toBeInTheDocument();
  });

  it("la alícuota solo se pide en una nota A; en una B o C se avisa que no discrimina IVA y el pedido sale sin alícuota", async () => {
    const servidor = servidorFalso();
    await render(formulario(servidor));
    await expect.element(page.getByLabelText("IVA")).not.toBeInTheDocument();
    await userEvent.selectOptions(page.getByLabelText("Tipo"), "NOTA_CREDITO_A");
    await expect.element(page.getByLabelText("IVA")).toBeVisible();
    await userEvent.selectOptions(page.getByLabelText("Tipo"), "NOTA_CREDITO_C");
    await expect.element(page.getByLabelText("IVA")).not.toBeInTheDocument();
    await expect
      .element(page.getByText("Sin IVA discriminado: es un comprobante B o C", { exact: true }))
      .toBeVisible();
    await userEvent.fill(page.getByLabelText("Punto de venta"), "3");
    await userEvent.fill(page.getByLabelText("Número"), "77");
    await userEvent.fill(page.getByLabelText("Fecha"), "2026-11-27");
    await userEvent.fill(page.getByLabelText("Neto"), "100000,00");
    await userEvent.fill(page.getByLabelText("Total de la nota"), "100000,00");
    tocar(boton("Guardar"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    expect((servidor.pedidos[0] as { nota: { importes: unknown } }).nota.importes).toEqual([
      { alicuota: null, neto: "100000.00" },
    ]);
  });

  it("la clase que pide la pantalla decide los tipos que se ofrecen", async () => {
    await render(formulario(servidorFalso(), { clase: "debito", todaviaSePuedeAcreditar: null }));
    const opciones = [...(page.getByLabelText("Tipo").element() as HTMLSelectElement).options].map(
      (o) => o.value,
    );
    expect(opciones.filter((v) => v !== "")).toEqual([
      "NOTA_DEBITO_A",
      "NOTA_DEBITO_B",
      "NOTA_DEBITO_C",
    ]);
  });

  it("el pedido sale con la clave del intento, la factura de la ruta y la nota con los importes como texto: sin proveedor, empresa ni persona", async () => {
    const servidor = servidorFalso();
    await render(formulario(servidor));
    await completar();
    tocar(boton("Guardar"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    const pedido = servidor.pedidos[0] as Record<string, unknown>;
    expect(Object.keys(pedido).sort()).toEqual(["clave", "facturaId", "nota"]);
    expect(pedido["clave"]).toMatch(UUID);
    expect(pedido["facturaId"]).toBe(FACTURA);
    expect(pedido["nota"]).toEqual({
      tipo: "NOTA_CREDITO_A",
      puntoDeVenta: "3",
      numero: "77",
      fecha: "2026-11-27",
      importes: [{ alicuota: "21", neto: "100000.00" }],
      totalSegunNota: "121000.00",
    });
  });

  it("un doble toque (tres, en el mismo instante) es UNA nota, y al terminar abre «Notas de la factura»", async () => {
    const servidor = servidorFalso(
      () => new Promise((resolver) => setTimeout(() => resolver(HECHA), 60)),
    );
    const irA = vi.fn();
    await render(formulario(servidor, { irA }));
    await completar();
    tocar(boton("Guardar"));
    tocar(boton("Guardar"));
    tocar(boton("Guardar"));
    await vi.waitFor(() => expect(irA).toHaveBeenCalledTimes(1));
    expect(irA).toHaveBeenCalledWith(`/compras/facturas/${FACTURA}/notas`);
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
          : { ok: true, dato: { comprobanteId: NOTA, yaExistia: true } },
      ) as Promise<Salida>;
    });
    await render(formulario(servidor));
    await completar();
    tocar(boton("Guardar"));
    await expect.element(boton("Reintentar")).toBeVisible();
    tocar(boton("Reintentar"));
    await vi.waitFor(() => expect(servidor.pedidos.length).toBeGreaterThanOrEqual(2), {
      timeout: 5000,
    });
    expect(servidor.pedidos[1]).toEqual(servidor.pedidos[0]);
  });

  it("un rechazo (tope, duplicada, tipo de otra clase, sin permiso) se muestra como el genérico y no navega", async () => {
    const servidor = servidorFalso(() => Promise.resolve({ ok: false, error: GENERICO }));
    const irA = vi.fn();
    await render(formulario(servidor, { irA }));
    await completar();
    tocar(boton("Guardar"));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(irA).not.toHaveBeenCalled();
  });
});

describe("el enlace «Notas de crédito» del detalle de la factura", () => {
  const FICHA: FichaDeFacturaParaLaPantalla = {
    comprobanteId: FACTURA,
    proveedor: "Distribuidora Central",
    tipo: "FACTURA_A",
    puntoDeVenta: 4,
    numero: 5678,
    fechaNegocio: "2026-11-24",
    totalSegunFactura: "2420.00",
    estado: "FALTA_CONCILIAR",
    lineas: [],
    conciliaciones: [],
  };
  const acciones = (verNotas: boolean) => ({
    cargar: false,
    verConciliaciones: false,
    conciliar: false,
    anularConciliacion: false,
    tomarElCosto: false,
    verNotas,
    reemplazar: false,
  });
  const detalle = (verNotas: boolean) => (
    <PantallaDeDetalleDeFactura
      ficha={FICHA}
      textos={textosDeFacturas()}
      sucursales={[]}
      acciones={acciones(verNotas)}
    />
  );

  it("se ofrece solo con el permiso de ver las notas y lleva a «Notas de la factura»", async () => {
    const sin = await render(detalle(false));
    await expect.element(enlace("Notas de crédito")).not.toBeInTheDocument();
    await sin.unmount();
    await render(detalle(true));
    await expect
      .element(enlace("Notas de crédito"))
      .toHaveAttribute("href", `/compras/facturas/${FACTURA}/notas`);
  });
});
