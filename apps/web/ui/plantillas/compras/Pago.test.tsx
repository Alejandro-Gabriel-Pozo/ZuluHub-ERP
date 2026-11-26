import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { conReinicio, tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PantallaDeFichaDeCompra } from "./ficha/PantallaDeFichaDeCompra";
import type { FichaDeCompraParaLaPantalla } from "./ficha/modelo-de-ficha-de-compra";
import { FormularioDeDeclararPago } from "./pago/FormularioDeDeclararPago.cliente";
import { HojaDeAnularPago } from "./pago/HojaDeAnularPago.cliente";
import {
  DECLARAR_PAGO_INICIAL,
  type ResultadoDeAnularPago,
  type ResultadoDeDeclararPago,
} from "./pago/resultado-de-pago";
import { textosDeCompras } from "./textos-de-compras";

/**
 * «Declarar pago» y anular el pago de una factura (Compras PR 8) en un navegador real: el formulario no se envía sin medio, con efectivo pide la caja abierta y el motivo, el importe NO es un campo (no viaja), un doble
 * toque es UN solo envío y el error del servidor queda debajo con el genérico; la hoja de anular pide el motivo y un doble toque es un solo envío; la ficha ofrece «Declarar pago» y «Anular» a quien tiene permiso y a
 * nadie más, y quien opera ve el pago sin botones. Sin violaciones de accesibilidad (axe).
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const UUID = "0b0b0b0b-1111-4222-8333-444444444444";
const PAGO = "0d0d0d0d-1111-4222-8333-444444444444";
const pesos = (monto: string) => ({ moneda: "ARS", monto });
const GENERICO = {
  codigo: "COMPRAS_ACCION_NO_PERMITIDA",
  clave: "compras.error.sin_permiso",
  presentacion: "AVISO",
} as never;
type AccionDeDeclarar = (
  previo: ResultadoDeDeclararPago,
  datos: FormData,
) => Promise<ResultadoDeDeclararPago>;
type AccionDeAnular = (
  previo: ResultadoDeAnularPago,
  datos: FormData,
) => Promise<ResultadoDeAnularPago>;

const textosDelFormulario = () => {
  const t = textosDeCompras();
  return {
    importe: t.importe,
    fecha: t.fecha,
    medio: t.medio,
    caja: t.caja,
    motivo: t.motivo,
    sinElegir: t.sinElegir,
    declararPago: t.declararPago,
    agregarMedio: t.agregarMedio,
    quitar: t.quitar,
    medios: {
      EFECTIVO: t.medioDePago("EFECTIVO"),
      TARJETA_DEBITO: t.medioDePago("TARJETA_DEBITO"),
      TARJETA_CREDITO: t.medioDePago("TARJETA_CREDITO"),
      TRANSFERENCIA: t.medioDePago("TRANSFERENCIA"),
      QR: t.medioDePago("QR"),
      OTRO: t.medioDePago("OTRO"),
    },
  };
};
const CAJAS = [
  { cajaId: "c1c1c1c1-1111-4222-8333-444444444444", nombre: "Caja 1" },
  { cajaId: "c2c2c2c2-1111-4222-8333-444444444444", nombre: "Caja 2" },
];

const ficha = (cambios: Record<string, unknown> = {}) =>
  ({
    recepcionId: UUID,
    numero: 5,
    proveedor: "Carnes del Sur",
    fechaNegocio: "2026-10-31",
    estado: "RECIBIDA_Y_FACTURADA",
    remito: null,
    registradaPor: "ana@ejemplo.com",
    registradaEn: "2026-11-01T00:14:00.000Z",
    anulacion: null,
    lineas: [],
    total: null,
    factura: {
      comprobanteId: "0c0c0c0c-1111-4222-8333-444444444444",
      letra: "A",
      puntoDeVenta: 2,
      numero: 1187,
      fecha: "2026-10-31",
      vencimientoDePago: null,
      totalSegunLaFactura: pesos("2420.00"),
      netoAPagar: pesos("2420.00"),
    },
    pagos: [],
    ...cambios,
  }) as FichaDeCompraParaLaPantalla;
const PAGADA = {
  pagos: [
    {
      id: PAGO,
      fechaDePago: "2026-11-24",
      medio: "TRANSFERENCIA",
      importe: pesos("2420.00"),
      estado: "VIGENTE",
      declaradoPor: "ana@ejemplo.com",
      declaradoEn: "2026-11-24T12:14:00.000Z",
      anuladoPor: null,
      anuladoEn: null,
      motivoDeAnulacion: null,
    },
  ],
};

describe("FormularioDeDeclararPago", () => {
  it("el importe se muestra pero no es un campo; «Declarar pago» queda apagado sin medio; con transferencia viajan solo la fecha y el medio; sin violaciones de accesibilidad", async () => {
    const accion = vi.fn<AccionDeDeclarar>(() => Promise.resolve(DECLARAR_PAGO_INICIAL));
    await render(
      <FormularioDeDeclararPago
        accion={accion}
        importe="$ 2.420,00"
        hoy="2026-11-24"
        cajas={CAJAS}
        textos={textosDelFormulario()}
      />,
    );
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    await expect.element(page.getByText("Importe: $ 2.420,00")).toBeVisible();
    expect(page.getByLabelText("Importe").elements()).toHaveLength(0);
    const enviar = page.getByRole("button", { name: "Declarar pago" });
    await expect.element(enviar).toBeDisabled();
    await expect.element(page.getByLabelText("Fecha")).toHaveValue("2026-11-24");
    expect(page.getByLabelText("Caja").elements()).toHaveLength(0);
    await userEvent.selectOptions(page.getByLabelText("Medio"), "TRANSFERENCIA");
    await expect.element(enviar).toBeEnabled();
    tocar(enviar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(datos.get("fecha")).toBe("2026-11-24");
    expect(datos.get("medio")).toBe("TRANSFERENCIA");
    expect([...datos.keys()].sort()).toEqual(["fecha", "medio"]);
  });

  it("con efectivo aparecen la caja (solo las abiertas que llegan) y el motivo, y el botón espera a los dos; viajan la caja y el motivo", async () => {
    const accion = vi.fn<AccionDeDeclarar>(() => Promise.resolve(DECLARAR_PAGO_INICIAL));
    await render(
      <FormularioDeDeclararPago
        accion={accion}
        importe="$ 2.420,00"
        hoy="2026-11-24"
        cajas={CAJAS}
        textos={textosDelFormulario()}
      />,
    );
    await userEvent.selectOptions(page.getByLabelText("Medio"), "EFECTIVO");
    const enviar = page.getByRole("button", { name: "Declarar pago" });
    await expect.element(enviar).toBeDisabled();
    await userEvent.selectOptions(page.getByLabelText("Caja"), CAJAS[1]?.cajaId ?? "");
    await expect.element(enviar).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Motivo"), "Pago de la factura");
    await expect.element(enviar).toBeEnabled();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    tocar(enviar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(datos.get("medio")).toBe("EFECTIVO");
    expect(datos.get("cajaId")).toBe(CAJAS[1]?.cajaId);
    expect(datos.get("motivo")).toBe("Pago de la factura");
  });

  it("«Agregar medio» suma una fila con su importe; cada medio sale una sola vez; «Quitar» la saca; con varios viajan los medios con su importe, la caja y el motivo; sin violaciones de accesibilidad", async () => {
    const accion = vi.fn<AccionDeDeclarar>(() => Promise.resolve(DECLARAR_PAGO_INICIAL));
    await render(
      <FormularioDeDeclararPago
        accion={accion}
        importe="$ 2.420,00"
        hoy="2026-11-24"
        cajas={CAJAS}
        textos={textosDelFormulario()}
      />,
    );
    expect(page.getByRole("button", { name: "Quitar" }).elements()).toHaveLength(0);
    await userEvent.selectOptions(page.getByLabelText("Medio"), "EFECTIVO");
    tocar(page.getByRole("button", { name: "Agregar medio" }));
    await expect.element(page.getByLabelText("Medio 2")).toBeVisible();
    const segundo = page.getByLabelText("Medio 2").element() as HTMLSelectElement;
    expect([...segundo.options].map((o) => o.value)).not.toContain("EFECTIVO");
    await userEvent.selectOptions(page.getByLabelText("Medio 2"), "QR");
    const enviar = page.getByRole("button", { name: "Declarar pago" });
    await userEvent.selectOptions(page.getByLabelText("Caja"), CAJAS[0]?.cajaId ?? "");
    await userEvent.fill(page.getByLabelText("Motivo"), "Pago de la factura");
    await expect.element(enviar).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Importe 1"), "1000");
    await userEvent.fill(page.getByLabelText("Importe 2"), "1420");
    await expect.element(enviar).toBeEnabled();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    tocar(enviar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(datos.getAll("medio")).toEqual(["EFECTIVO", "QR"]);
    expect(datos.getAll("importe")).toEqual(["1000.00", "1420.00"]);
    expect(datos.get("cajaId")).toBe(CAJAS[0]?.cajaId);
  });

  it("al quitar la segunda fila vuelve el pago de un solo medio, sin importe que escribir", async () => {
    const accion = vi.fn<AccionDeDeclarar>(() => Promise.resolve(DECLARAR_PAGO_INICIAL));
    await render(
      <FormularioDeDeclararPago
        accion={accion}
        importe="$ 2.420,00"
        hoy="2026-11-24"
        cajas={CAJAS}
        textos={textosDelFormulario()}
      />,
    );
    await userEvent.selectOptions(page.getByLabelText("Medio"), "TRANSFERENCIA");
    tocar(page.getByRole("button", { name: "Agregar medio" }));
    await expect.element(page.getByLabelText("Medio 2")).toBeVisible();
    tocar(page.getByRole("button", { name: "Quitar" }).nth(1));
    await vi.waitFor(() => expect(page.getByLabelText("Importe").elements()).toHaveLength(0));
    const enviar = page.getByRole("button", { name: "Declarar pago" });
    await expect.element(enviar).toBeEnabled();
    tocar(enviar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(datos.getAll("medio")).toEqual(["TRANSFERENCIA"]);
    expect(datos.getAll("importe")).toEqual([]);
  });

  it("volver a otro medio saca la caja y el motivo del envío", async () => {
    const accion = vi.fn<AccionDeDeclarar>(() => Promise.resolve(DECLARAR_PAGO_INICIAL));
    await render(
      <FormularioDeDeclararPago
        accion={accion}
        importe="$ 2.420,00"
        hoy="2026-11-24"
        cajas={CAJAS}
        textos={textosDelFormulario()}
      />,
    );
    await userEvent.selectOptions(page.getByLabelText("Medio"), "EFECTIVO");
    await userEvent.selectOptions(page.getByLabelText("Caja"), CAJAS[0]?.cajaId ?? "");
    await userEvent.fill(page.getByLabelText("Motivo"), "Pago");
    await userEvent.selectOptions(page.getByLabelText("Medio"), "QR");
    tocar(page.getByRole("button", { name: "Declarar pago" }));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect([...(accion.mock.calls[0]?.[1] as FormData).keys()].sort()).toEqual(["fecha", "medio"]);
  });

  it("doble toque en «Declarar pago» = un solo envío; el error del servidor queda debajo con el genérico", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn<AccionDeDeclarar>(async () => {
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { estado: "ERROR", error: GENERICO };
    });
    await render(
      <FormularioDeDeclararPago
        accion={accion}
        importe="$ 2.420,00"
        hoy="2026-11-24"
        cajas={CAJAS}
        textos={textosDelFormulario()}
      />,
    );
    await userEvent.selectOptions(page.getByLabelText("Medio"), "TRANSFERENCIA");
    const enviar = page.getByRole("button", { name: "Declarar pago" });
    tocar(enviar);
    await expect.element(enviar).toHaveAttribute("aria-busy", "true");
    tocar(enviar);
    tocar(enviar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("tras un error del servidor, y DESPUÉS del reinicio que React dispara, el pago conserva la fecha, el medio, la caja y el motivo que se escribieron", async () => {
    const accion = vi.fn<AccionDeDeclarar>(() =>
      Promise.resolve({ estado: "ERROR", error: GENERICO }),
    );
    await render(
      <FormularioDeDeclararPago
        accion={accion}
        importe="$ 2.420,00"
        hoy="2026-11-24"
        cajas={CAJAS}
        textos={textosDelFormulario()}
      />,
    );
    await userEvent.fill(page.getByLabelText("Fecha"), "2026-11-20");
    await userEvent.selectOptions(page.getByLabelText("Medio"), "EFECTIVO");
    await userEvent.selectOptions(page.getByLabelText("Caja"), CAJAS[1]!.cajaId);
    await userEvent.fill(page.getByLabelText("Motivo"), "Pago a proveedor");
    const cancelado = await conReinicio(() => {
      tocar(page.getByRole("button", { name: "Declarar pago" }));
    });
    expect(cancelado).toBe(true);
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(page.getByLabelText("Fecha")).toHaveValue("2026-11-20");
    await expect.element(page.getByLabelText("Medio")).toHaveValue("EFECTIVO");
    await expect.element(page.getByLabelText("Caja")).toHaveValue(CAJAS[1]!.cajaId);
    await expect.element(page.getByLabelText("Motivo")).toHaveValue("Pago a proveedor");
  });
});

describe("HojaDeAnularPago", () => {
  const textos = { anular: "Anular", motivo: "Motivo", cancelar: "Cancelar", cerrar: "Cerrar" };

  it("pide el motivo, «Anular» queda apagado sin él y un doble toque es UN solo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn<AccionDeAnular>(async () => {
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { estado: "ERROR", error: GENERICO };
    });
    await render(<HojaDeAnularPago accion={accion} textos={textos} />);
    await userEvent.click(page.getByRole("button", { name: "Anular" }));
    const dialogo = page.getByRole("dialog");
    await expect.element(dialogo).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    const confirmar = dialogo.getByRole("button", { name: "Anular" });
    await expect.element(confirmar).toBeDisabled();
    await userEvent.fill(dialogo.getByLabelText("Motivo"), "Se pagó dos veces");
    await expect.element(confirmar).toBeEnabled();
    tocar(confirmar);
    await expect.element(confirmar).toHaveAttribute("aria-busy", "true");
    tocar(confirmar);
    tocar(confirmar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect((accion.mock.calls[0]?.[1] as FormData).get("motivo")).toBe("Se pagó dos veces");
    liberar();
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("tras un error del servidor, y DESPUÉS del reinicio, la hoja conserva el motivo escrito", async () => {
    const accion = vi.fn<AccionDeAnular>(() =>
      Promise.resolve({ estado: "ERROR", error: GENERICO }),
    );
    await render(<HojaDeAnularPago accion={accion} textos={textos} />);
    await userEvent.click(page.getByRole("button", { name: "Anular" }));
    const dialogo = page.getByRole("dialog");
    await userEvent.fill(dialogo.getByLabelText("Motivo"), "Se pagó dos veces");
    const cancelado = await conReinicio(() => {
      tocar(dialogo.getByRole("button", { name: "Anular" }));
    });
    expect(cancelado).toBe(true);
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(dialogo.getByLabelText("Motivo")).toHaveValue("Se pagó dos veces");
  });
});

describe("la ficha de la compra con el pago de la factura", () => {
  const acciones = {
    corregir: false,
    anular: false,
    pagar: true,
    anularPago: true,
    verNotas: false,
  };
  const anularPago = () => () => Promise.resolve({ estado: "INICIAL" } as ResultadoDeAnularPago);

  it("sin pago y con permiso ofrece «Declarar pago» hacia la pantalla del pago; sin permiso, nada", async () => {
    await render(
      <PantallaDeFichaDeCompra
        ficha={ficha()}
        textos={textosDeCompras()}
        acciones={acciones}
        accionDeAnularPago={anularPago}
      />,
    );
    await expect
      .element(page.getByRole("link", { name: "Declarar pago" }))
      .toHaveAttribute("href", `/compras/${UUID}/pago`);
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });

  it("quien opera ve el pago (medio, fecha, importe, quién y cuándo) sin «Declarar pago» ni «Anular»", async () => {
    await render(
      <PantallaDeFichaDeCompra
        ficha={ficha(PAGADA)}
        textos={textosDeCompras()}
        accionDeAnularPago={anularPago}
      />,
    );
    await expect.element(page.getByText("Transferencia · 24/11/2026")).toBeVisible();
    await expect.element(page.getByText("$ 2.420,00", { exact: true }).first()).toBeVisible();
    await expect.element(page.getByText("ana@ejemplo.com · 24/11/2026 09:14")).toBeVisible();
    expect(page.getByRole("link", { name: "Declarar pago" }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Anular" }).elements()).toHaveLength(0);
  });

  it("con el pago vigente y permiso ofrece «Anular» y ya no «Declarar pago»; un pago anulado queda a la vista con «Anulado» y su motivo", async () => {
    await render(
      <PantallaDeFichaDeCompra
        ficha={ficha(PAGADA)}
        textos={textosDeCompras()}
        acciones={acciones}
        accionDeAnularPago={anularPago}
      />,
    );
    await expect.element(page.getByRole("button", { name: "Anular" })).toBeVisible();
    expect(page.getByRole("link", { name: "Declarar pago" }).elements()).toHaveLength(0);
  });

  it("un pago anulado se ve con «Anulado», su motivo, y vuelve a ofrecerse «Declarar pago»", async () => {
    const anulado = {
      pagos: [
        {
          ...PAGADA.pagos[0],
          estado: "ANULADO",
          anuladoPor: "bea@ejemplo.com",
          anuladoEn: "2026-11-24T13:00:00.000Z",
          motivoDeAnulacion: "Se pagó mal",
        },
      ],
    };
    await render(
      <PantallaDeFichaDeCompra
        ficha={ficha(anulado)}
        textos={textosDeCompras()}
        acciones={acciones}
        accionDeAnularPago={anularPago}
      />,
    );
    await expect.element(page.getByText("Anulado")).toBeVisible();
    await expect.element(page.getByText("Se pagó mal")).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Declarar pago" })).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });
});
