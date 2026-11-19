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
import type { LineaDeLaVenta } from "../venta/modelo-de-la-cuenta";
import { PantallaDeCobro } from "./PantallaDeCobro.cliente";
import {
  type CobroPreparado,
  type MedioParaCobrar,
  type TicketAnulado,
  type VentaCobrada,
} from "./modelo-de-cobro";
import { textosDeCobrar } from "./textos-de-cobrar";

const nada = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };
const MEDIOS: readonly MedioParaCobrar[] = [
  { id: "m-efectivo", tipo: "EFECTIVO", nombre: null, cuentas: [], datosQuePide: nada },
  {
    id: "m-debito",
    tipo: "TARJETA_DEBITO",
    nombre: null,
    cuentas: [{ id: "c-posnet", tipo: "TERMINAL", nombre: "Posnet 1" }],
    datosQuePide: { ...nada, cupon: true, ultimos4: true, marca: true },
  },
  {
    id: "m-credito",
    tipo: "TARJETA_CREDITO",
    nombre: null,
    cuentas: [],
    datosQuePide: { cupon: true, ultimos4: true, marca: true, cuotas: true, dni: false },
  },
  {
    id: "m-transf",
    tipo: "TRANSFERENCIA",
    nombre: null,
    cuentas: [],
    datosQuePide: { ...nada, dni: true },
  },
];
const LISTO: CobroPreparado = {
  estado: "LISTO",
  cajaId: "caja-1",
  opciones: { medios: MEDIOS, marcasDeTarjeta: [{ id: "visa", nombre: "Visa" }] },
};
const cuenta: readonly LineaDeLaVenta[] = [
  { clave: "l1", productoId: "p1", varianteId: null, opcionIds: [], cantidad: 20_000, revision: 0 },
];
const TOTAL = { moneda: "ARS", monto: "1000.00" };
const VENTA: VentaCobrada = {
  ticketId: "ticket-1",
  ejemplarId: "ejemplar-1",
  numero: 12,
  estado: "COBRADO",
  total: TOTAL,
  cobros: [
    {
      medioDePagoId: "m-efectivo",
      cuentaDeCobroId: null,
      importe: { moneda: "ARS", monto: "1000.00" },
    },
  ],
};
const ANULADO: TicketAnulado = { ticketId: "ticket-1", numero: 12, estado: "ANULADO" };
const GENERICO = { ok: false, error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA") } as const;

let contador = 0;
const nuevoId = () => `id-${String(++contador)}`;

type Cobrar = (pedido: unknown) => Promise<Respuesta<VentaCobrada>>;
type Anular = (pedido: unknown) => Promise<Respuesta<TicketAnulado>>;

async function hoja(
  opciones: {
    preparado?: CobroPreparado;
    cobrar?: Cobrar;
    anular?: Anular;
    alVolver?: () => void;
    alNuevaVenta?: () => void;
    total?: { moneda: string; monto: string };
  } = {},
) {
  const cobrar = vi.fn<Cobrar>(
    opciones.cobrar ?? (() => Promise.resolve({ ok: true, dato: VENTA })),
  );
  const anular = vi.fn<Anular>(
    opciones.anular ?? (() => Promise.resolve({ ok: true, dato: ANULADO })),
  );
  const alVolver = vi.fn(opciones.alVolver ?? (() => undefined));
  const alNuevaVenta = vi.fn(opciones.alNuevaVenta ?? (() => undefined));
  await render(
    <PantallaDeCobro
      cuenta={cuenta}
      total={opciones.total ?? TOTAL}
      preparado={opciones.preparado ?? LISTO}
      textos={textosDeCobrar()}
      cobrar={cobrar}
      anular={anular}
      alVolver={alVolver}
      alNuevaVenta={alNuevaVenta}
      nuevoId={nuevoId}
      esperaEntreVerificacionesMs={10}
    />,
  );
  return { cobrar, anular, alVolver, alNuevaVenta };
}

const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });
const delCuadro = (nombre: string) =>
  page.getByRole("dialog").getByRole("button", { name: nombre, exact: true });
const campo = (nombre: string | RegExp) => page.getByRole("textbox", { name: nombre });
const medio = () => page.getByRole("combobox", { name: "Medio" });
const pedidoDe = (llamadas: { mock: { calls: unknown[][] } }, n: number) =>
  llamadas.mock.calls[n]?.[0] as Record<string, unknown>;
const estadoDeLaHoja = () => document.querySelector("[data-estado]")?.getAttribute("data-estado");

afterEach(() => {
  restaurarConexion();
});

describe("PantallaDeCobro: la vista", () => {
  it("abre con el total, el efectivo con el total como importe y «Cobro completo»; sin violaciones de accesibilidad", async () => {
    await hoja();
    expect(document.querySelector("[data-total-del-cobro]")?.textContent).toBe("$ 1.000,00");
    await expect.element(medio()).toHaveValue("m-efectivo");
    await expect.element(campo("Importe")).toHaveValue("1.000,00");
    expect(estadoDeLaHoja()).toBe("completo");
    await expect.element(boton("Cobrar")).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("solo ofrece los datos que el medio admite, con «(opcional)»", async () => {
    await hoja();
    // Efectivo: ninguno.
    expect(page.getByRole("textbox", { name: /Cupón/ }).elements()).toHaveLength(0);
    await userEvent.selectOptions(medio(), "m-debito");
    await expect.element(campo("Cupón (opcional)")).toBeVisible();
    await expect.element(campo("Últimos 4 dígitos (opcional)")).toBeVisible();
    await expect
      .element(page.getByRole("combobox", { name: "Marca de la tarjeta (opcional)" }))
      .toBeVisible();
    expect(page.getByRole("textbox", { name: /Cuotas/ }).elements()).toHaveLength(0);
    expect(page.getByRole("textbox", { name: /DNI/ }).elements()).toHaveLength(0);
    await userEvent.selectOptions(medio(), "m-credito");
    await expect.element(campo("Cuotas (opcional)")).toBeVisible();
    await userEvent.selectOptions(medio(), "m-transf");
    await expect.element(campo("DNI (opcional)")).toBeVisible();
    expect(page.getByRole("textbox", { name: /Cupón/ }).elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("la cuenta de cobro es opcional y solo la ofrecen los medios que tienen cuentas", async () => {
    await hoja();
    expect(page.getByRole("combobox", { name: "Cuenta de cobro" }).elements()).toHaveLength(0);
    await userEvent.selectOptions(medio(), "m-debito");
    await expect.element(page.getByRole("combobox", { name: "Cuenta de cobro" })).toHaveValue("");
    await userEvent.selectOptions(
      page.getByRole("combobox", { name: "Cuenta de cobro" }),
      "c-posnet",
    );
    await expect
      .element(page.getByRole("combobox", { name: "Cuenta de cobro" }))
      .toHaveValue("c-posnet");
  });

  it("un dato mal escrito se dice debajo del campo y apaga «Cobrar» hasta corregirlo o vaciarlo", async () => {
    await hoja();
    await userEvent.selectOptions(medio(), "m-debito");
    await userEvent.fill(campo("Últimos 4 dígitos (opcional)"), "12");
    await expect.element(page.getByText("Escribí 4 dígitos")).toBeVisible();
    await expect.element(boton("Cobrar")).toBeDisabled();
    await userEvent.fill(campo("Cupón (opcional)"), "4509953566233704");
    await expect
      .element(page.getByText("El cupón no puede ser un número de tarjeta"))
      .toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await userEvent.fill(campo("Últimos 4 dígitos (opcional)"), "");
    await userEvent.fill(campo("Cupón (opcional)"), "");
    await expect.element(boton("Cobrar")).toBeEnabled();
  });

  it("falta cobrar: dice cuánto y apaga «Cobrar»; «Agregar otro medio» propone lo que falta", async () => {
    await hoja();
    await userEvent.fill(campo("Importe"), "400");
    await expect.poll(estadoDeLaHoja).toBe("falta");
    await expect.element(page.getByText("Falta cobrar $ 600,00")).toBeVisible();
    await expect.element(boton("Cobrar")).toBeDisabled();
    await userEvent.click(boton("Agregar otro medio"));
    const importes = page.getByRole("textbox", { name: "Importe" }).elements();
    expect(importes).toHaveLength(2);
    expect((importes[1] as HTMLInputElement).value).toBe("600,00");
    await expect.poll(estadoDeLaHoja).toBe("completo");
    await expect.element(boton("Cobrar")).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("con otro medio, de más es «Sobran» y no se cobra; con efectivo es «Vuelto»", async () => {
    await hoja();
    await userEvent.selectOptions(medio(), "m-transf");
    await userEvent.fill(campo("Importe"), "1200");
    await expect.element(page.getByText("Sobran $ 200,00")).toBeVisible();
    await expect.element(boton("Cobrar")).toBeDisabled();
    await userEvent.selectOptions(medio(), "m-efectivo");
    await expect.element(page.getByText("Vuelto $ 200,00")).toBeVisible();
    await expect.element(boton("Cobrar")).toBeEnabled();
  });

  it("un importe vacío dice «Importe no válido» y no se puede cobrar", async () => {
    await hoja();
    await userEvent.fill(campo("Importe"), "");
    await expect.element(page.getByText("Importe no válido")).toBeVisible();
    await expect.element(boton("Cobrar")).toBeDisabled();
  });

  it("se puede quitar una fila agregada pero nunca la primera", async () => {
    await hoja();
    await userEvent.fill(campo("Importe"), "400");
    await userEvent.click(boton("Agregar otro medio"));
    expect(page.getByRole("button", { name: "Quitar", exact: true }).elements()).toHaveLength(1);
    await userEvent.click(boton("Quitar"));
    expect(page.getByRole("textbox", { name: "Importe" }).elements()).toHaveLength(1);
  });

  it.each([
    ["sin caja abierta", { estado: "ABRIR_LA_CAJA" }],
    ["sin permiso o con el día cerrado", { estado: "NO_PERMITIDO", jornadaAbierta: false }],
  ] as const)(
    "%s la vista no dibuja avisos (la venta ya los dio) y «Cobrar» queda apagado: nace cerrado",
    async (_caso, preparado) => {
      const h = await hoja({ preparado });
      await expect.element(boton("Cobrar")).toBeDisabled();
      expect(page.getByText("Abrí la caja para cobrar").elements()).toHaveLength(0);
      expect(page.getByText("Esta acción no está permitida").elements()).toHaveLength(0);
      expect(h.cobrar).not.toHaveBeenCalled();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    },
  );

  it("es una vista: «Cobro» con «‹ Volver a la cuenta» y sin «Volver» abajo; el foco va al título; «‹» vuelve a la cuenta", async () => {
    const { alVolver } = await hoja();
    await expect.element(page.getByRole("heading", { name: "Cobro", level: 2 })).toHaveFocus();
    expect(page.getByRole("button", { name: "Volver", exact: true }).elements()).toHaveLength(0);
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    await userEvent.click(boton("Volver a la cuenta"));
    expect(alVolver).toHaveBeenCalledTimes(1);
  });

  it("Medio e Importe van lado a lado, antes que la cuenta de cobro", async () => {
    await hoja();
    await userEvent.selectOptions(medio(), "m-debito");
    const y = (el: Element) => el.getBoundingClientRect();
    const m = y(medio().element());
    const i = y(campo("Importe").element());
    const c = y(page.getByRole("combobox", { name: /Cuenta de cobro/ }).element());
    expect(Math.abs(m.top - i.top)).toBeLessThan(4);
    expect(i.left).toBeGreaterThan(m.left);
    expect(c.top).toBeGreaterThan(m.top);
  });

  it("un toque en «Cobrar» durante la espera de apertura se ignora", async () => {
    const espera = { current: true };
    const cobrar = vi.fn<Cobrar>(() => Promise.resolve({ ok: true, dato: VENTA }));
    await render(
      <PantallaDeCobro
        cuenta={cuenta}
        total={TOTAL}
        preparado={LISTO}
        textos={textosDeCobrar()}
        cobrar={cobrar}
        anular={vi.fn<Anular>()}
        alVolver={() => undefined}
        alNuevaVenta={() => undefined}
        nuevoId={nuevoId}
        esperaAlAbrir={espera}
      />,
    );
    await userEvent.click(boton("Cobrar"));
    expect(cobrar).not.toHaveBeenCalled();
    espera.current = false;
    await userEvent.click(boton("Cobrar"));
    await expect.poll(() => cobrar.mock.calls.length).toBe(1);
  });
});

describe("PantallaDeCobro: cobrar", () => {
  it("manda el pedido con la caja, el total esperado, los ids y la clave; con efectivo de más viaja el NETO", async () => {
    const { cobrar } = await hoja();
    await userEvent.fill(campo("Importe"), "1500");
    await userEvent.click(boton("Cobrar"));
    await expect.poll(() => cobrar.mock.calls.length).toBe(1);
    const pedido = pedidoDe(cobrar, 0);
    expect(typeof pedido["claveIdempotencia"]).toBe("string");
    expect(pedido).toMatchObject({
      cajaId: "caja-1",
      totalEsperado: TOTAL,
      lineas: [{ productoId: "p1", opcionIds: [], cantidad: "2" }],
      cobros: [
        {
          medioDePagoId: "m-efectivo",
          cuentaDeCobroId: null,
          importe: { moneda: "ARS", monto: "1000.00" },
        },
      ],
    });
    expect(Object.keys(pedido).sort()).toEqual(
      [
        "cajaId",
        "claveIdempotencia",
        "cobros",
        "cuentaId",
        "ejemplarId",
        "lineas",
        "totalEsperado",
      ].sort(),
    );
  });

  it("los datos de la tarjeta viajan dentro del cobro y no los que el medio no admite", async () => {
    const { cobrar } = await hoja();
    await userEvent.selectOptions(medio(), "m-credito");
    await userEvent.fill(campo("Cupón (opcional)"), "ZX-9981");
    await userEvent.fill(campo("Últimos 4 dígitos (opcional)"), "0042");
    await userEvent.selectOptions(
      page.getByRole("combobox", { name: "Marca de la tarjeta (opcional)" }),
      "visa",
    );
    await userEvent.fill(campo("Cuotas (opcional)"), "6");
    await userEvent.click(boton("Cobrar"));
    await expect.poll(() => cobrar.mock.calls.length).toBe(1);
    expect((pedidoDe(cobrar, 0)["cobros"] as unknown[])[0]).toMatchObject({
      medioDePagoId: "m-credito",
      datos: { cupon: "ZX-9981", ultimos4: "0042", marcaDeTarjetaId: "visa", cuotas: 6 },
    });
  });

  it("DOBLE TOQUE en «Cobrar»: un solo envío, y al volver se muestra «Cobrado» y el número del ticket", async () => {
    let resolver: (r: Respuesta<VentaCobrada>) => void = () => undefined;
    const { cobrar } = await hoja({
      cobrar: () =>
        new Promise((r) => {
          resolver = r;
        }),
    });
    const cobrarBoton = boton("Cobrar");
    tocar(cobrarBoton);
    tocar(cobrarBoton);
    await expect.poll(() => cobrar.mock.calls.length).toBe(1);
    await new Promise((r) => setTimeout(r, 100));
    expect(cobrar).toHaveBeenCalledTimes(1);
    // Mientras corre no se edita ni se vuelve.
    await expect.element(campo("Importe")).toBeDisabled();
    await expect.element(boton("Volver a la cuenta")).toBeDisabled();
    resolver({ ok: true, dato: VENTA });
    await expect.element(page.getByText("Ticket N.º 12")).toBeVisible();
    await expect.element(page.getByText("Cobrado", { exact: true }).first()).toBeVisible();
    expect(cobrar).toHaveBeenCalledTimes(1);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("CORTE DE RED: reintenta con la MISMA clave y el MISMO pedido, y cobra una sola vez", async () => {
    let intento = 0;
    const { cobrar } = await hoja({
      cobrar: () => {
        intento += 1;
        return intento === 1
          ? Promise.reject(new Error("red"))
          : Promise.resolve({ ok: true, dato: { ...VENTA } });
      },
    });
    await userEvent.click(boton("Cobrar"));
    await expect.element(page.getByText("Ticket N.º 12")).toBeVisible();
    expect(cobrar).toHaveBeenCalledTimes(2);
    expect(pedidoDe(cobrar, 1)).toEqual(pedidoDe(cobrar, 0));
  });

  it("un resultado INESPERADO no se da por definitivo: se reintenta con la misma clave", async () => {
    let intento = 0;
    const { cobrar } = await hoja({
      cobrar: () => {
        intento += 1;
        const respuesta: Respuesta<VentaCobrada> =
          intento === 1
            ? {
                ok: false,
                error: { ...errorDeCodigo("ERROR_INTERNO"), presentacion: "INESPERADO" as const },
              }
            : { ok: true, dato: VENTA };
        return Promise.resolve(respuesta);
      },
    });
    await userEvent.click(boton("Cobrar"));
    await expect.element(page.getByText("Ticket N.º 12")).toBeVisible();
    expect(cobrar).toHaveBeenCalledTimes(2);
    expect(pedidoDe(cobrar, 1)["claveIdempotencia"]).toBe(pedidoDe(cobrar, 0)["claveIdempotencia"]);
  });

  it("un rechazo del servidor dice «No se pudo cobrar. No se cobró nada.» con el resumen y «Volver al cobro»; al volver todo sigue escrito y el siguiente intento lleva OTRA clave y los mismos ids", async () => {
    let intento = 0;
    const { cobrar } = await hoja({
      cobrar: () => {
        intento += 1;
        return Promise.resolve(intento === 1 ? GENERICO : { ok: true, dato: VENTA });
      },
    });
    await userEvent.fill(campo("Importe"), "1000");
    await userEvent.click(boton("Cobrar"));
    await expect.element(page.getByText("No se pudo cobrar. No se cobró nada.")).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Resultado", level: 2 })).toBeVisible();
    await expect.element(page.getByText("Efectivo")).toBeVisible();
    expect(page.getByRole("button", { name: "Volver a la cuenta" }).elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await userEvent.click(boton("Volver al cobro"));
    await expect.element(campo("Importe")).toHaveValue("1.000,00");
    expect(page.getByText("Esta acción no está permitida").elements()).toHaveLength(0);
    await userEvent.click(boton("Cobrar"));
    await expect.element(page.getByText("Ticket N.º 12")).toBeVisible();
    const primero = pedidoDe(cobrar, 0);
    const segundo = pedidoDe(cobrar, 1);
    expect(segundo["claveIdempotencia"]).not.toBe(primero["claveIdempotencia"]);
    expect(segundo["cuentaId"]).toBe(primero["cuentaId"]);
    expect(segundo["ejemplarId"]).toBe(primero["ejemplarId"]);
    expect(segundo["lineas"]).toEqual(primero["lineas"]);
  });

  it("otro rechazo (permiso, empresa que no opera) se sigue mostrando en la vista de cobro, no como resultado", async () => {
    await hoja({
      cobrar: () => Promise.resolve({ ok: false, error: errorDeCodigo("EMPRESA_NO_OPERA") }),
    });
    await userEvent.click(boton("Cobrar"));
    await expect.element(boton("Cobrar")).toBeVisible();
    expect(page.getByText("No se pudo cobrar. No se cobró nada.").elements()).toHaveLength(0);
  });

  it("sin conexión no se puede enviar: «Cobrar» apagado con su motivo y la franja", async () => {
    const { cobrar } = await hoja();
    simularConexion(false);
    await expect
      .element(page.getByText("Sin conexión. Cuando vuelva, podés seguir: no se envió nada."))
      .toBeVisible();
    await expect.element(boton("Cobrar")).toBeDisabled();
    await expect.element(page.getByText("No se puede enviar sin conexión.")).toBeVisible();
    expect(cobrar).not.toHaveBeenCalled();
    simularConexion(true);
    await expect.element(boton("Cobrar")).toBeEnabled();
  });
});

describe("PantallaDeCobro: el resultado y anular", () => {
  const cobrada = async (extra: Parameters<typeof hoja>[0] = {}) => {
    const h = await hoja(extra);
    await userEvent.click(boton("Cobrar"));
    await expect.element(page.getByText("Ticket N.º 12")).toBeVisible();
    return h;
  };

  it("muestra el resumen, el vuelto y las dos salidas; todavía no ofrece «Imprimir ticket» (K6)", async () => {
    const { cobrar } = await hoja({
      cobrar: () =>
        Promise.resolve({
          ok: true,
          dato: {
            ...VENTA,
            cobros: [
              {
                medioDePagoId: "m-efectivo",
                cuentaDeCobroId: null,
                importe: { moneda: "ARS", monto: "1000.00" },
              },
            ],
          },
        }),
    });
    await userEvent.fill(campo("Importe"), "1200");
    await userEvent.click(boton("Cobrar"));
    await expect.element(page.getByText("Ticket N.º 12")).toBeVisible();
    expect(cobrar).toHaveBeenCalledTimes(1);
    await expect.element(page.getByText("Efectivo")).toBeVisible();
    await expect.element(page.getByText("Vuelto")).toBeVisible();
    await expect.element(page.getByText("$ 200,00")).toBeVisible();
    await expect.element(boton("Anular")).toBeVisible();
    await expect.element(boton("Nueva venta")).toBeVisible();
    expect(page.getByRole("button", { name: /Imprimir/ }).elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Nueva venta» termina la venta", async () => {
    const { alNuevaVenta } = await cobrada();
    await userEvent.click(boton("Nueva venta"));
    expect(alNuevaVenta).toHaveBeenCalledTimes(1);
  });

  it("anular sin motivo dice «Escribí el motivo» y no envía nada", async () => {
    const { anular } = await cobrada();
    await userEvent.click(boton("Anular"));
    await userEvent.click(delCuadro("Anular"));
    await expect.element(page.getByText("Escribí el motivo")).toBeVisible();
    expect(anular).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("anular con motivo: manda el ticket, el ejemplar del resultado, un ejemplar nuevo y la clave; queda «Anulado» con su motivo", async () => {
    const { anular } = await cobrada();
    await userEvent.click(boton("Anular"));
    await userEvent.fill(campo("Motivo"), "  Se cobró de más  ");
    await userEvent.click(delCuadro("Anular"));
    await expect.element(page.getByText("Anulado", { exact: true }).first()).toBeVisible();
    await expect.element(page.getByText("Se cobró de más")).toBeVisible();
    expect(anular).toHaveBeenCalledTimes(1);
    const pedido = pedidoDe(anular, 0);
    expect(pedido).toMatchObject({
      ticketId: "ticket-1",
      ejemplarBaseId: "ejemplar-1",
      motivo: "Se cobró de más",
    });
    expect(typeof pedido["ejemplarNuevoId"]).toBe("string");
    expect(typeof pedido["claveIdempotencia"]).toBe("string");
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Anular", exact: true }).elements()).toHaveLength(0);
    await expect.element(boton("Nueva venta")).toBeVisible();
  });

  it("DOBLE TOQUE en «Anular»: una sola anulación; un corte de red reintenta con la misma clave y el mismo ejemplar", async () => {
    let intento = 0;
    const { anular } = await cobrada({
      anular: () => {
        intento += 1;
        return intento === 1
          ? Promise.reject(new Error("red"))
          : Promise.resolve({ ok: true, dato: ANULADO });
      },
    });
    await userEvent.click(boton("Anular"));
    await userEvent.fill(campo("Motivo"), "Error de carga");
    const confirmar = delCuadro("Anular");
    tocar(confirmar);
    tocar(confirmar);
    await expect.element(page.getByText("Error de carga")).toBeVisible();
    expect(anular).toHaveBeenCalledTimes(2);
    expect(pedidoDe(anular, 1)).toEqual(pedidoDe(anular, 0));
  });

  it("un rechazo al anular sale como el genérico y se puede cancelar", async () => {
    await cobrada({ anular: () => Promise.resolve(GENERICO) });
    await userEvent.click(boton("Anular"));
    await userEvent.fill(campo("Motivo"), "Error");
    await userEvent.click(delCuadro("Anular"));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await userEvent.click(delCuadro("Cancelar"));
    await expect.element(boton("Nueva venta")).toBeVisible();
    await expect.element(page.getByText("Ticket N.º 12")).toBeVisible();
  });
});
