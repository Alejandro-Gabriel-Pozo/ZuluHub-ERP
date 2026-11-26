import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { conReinicio, tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { FormularioDeCorregirLinea } from "./correccion/FormularioDeCorregirLinea.cliente";
import {
  CORREGIR_INICIAL,
  type ResultadoDeAnular,
  type ResultadoDeCorregir,
} from "./correccion/resultado-de-correccion";
import { PantallaDeFichaDeCompra } from "./ficha/PantallaDeFichaDeCompra";
import type { FichaDeCompraParaLaPantalla } from "./ficha/modelo-de-ficha-de-compra";
import { textosDeCompras } from "./textos-de-compras";

/**
 * «Corregir» y «Anular» una compra (Compras PR 10) en un navegador real: la ficha ofrece «Corregir» (solo en la línea con precio) y «Anular» a quien tiene permiso y a nadie más; el formulario de corregir
 * lleva el precio como texto canónico y el motivo, no se envía sin los dos y un doble toque es un solo envío; la hoja de anular pide el motivo, un doble toque es un solo envío y, si la compra ya se consumió,
 * junto al genérico va «Corregir». Sin violaciones de accesibilidad (axe).
 */
// La hoja de «Anular» recarga la ficha con el enrutador de Next: acá se reemplaza (precedente de «Tickets del día»).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const UUID = "0b0b0b0b-1111-4222-8333-444444444444";
const pesos = (monto: string) => ({ moneda: "ARS", monto });
const linea = (numero: number, cambios: Record<string, unknown> = {}) => ({
  numero,
  producto: numero === 1 ? "Bife de chorizo" : "Aceite",
  cantidadDeCompra: "2.0000",
  presentacion: null,
  unidadDeCompraId: "KILOGRAMO",
  cantidadEnStock: "2000.0000",
  unidadDeStockId: "GRAMO",
  importe: pesos("2000.00"),
  costoPorUnidadDeStock: pesos("1.000000"),
  precioPor: { tipo: "UNIDAD" as const, unidadId: "KILOGRAMO" },
  correccionesVistas: 0,
  correcciones: [],
  ...cambios,
});
const ficha = (cambios: Record<string, unknown> = {}) =>
  ({
    recepcionId: UUID,
    numero: 5,
    proveedor: "Carnes del Sur",
    fechaNegocio: "2026-10-31",
    estado: "RECIBIDA_SIN_FACTURAR",
    remito: null,
    registradaPor: "ana@ejemplo.com",
    registradaEn: "2026-11-01T00:14:00.000Z",
    anulacion: null,
    lineas: [linea(1), linea(2, { importe: null, costoPorUnidadDeStock: null, precioPor: null })],
    total: null,
    factura: null,
    pagos: [],
    ...cambios,
  }) as FichaDeCompraParaLaPantalla;

type AccionDeAnular = (previo: ResultadoDeAnular, datos: FormData) => Promise<ResultadoDeAnular>;
type AccionDeCorregir = (
  previo: ResultadoDeCorregir,
  datos: FormData,
) => Promise<ResultadoDeCorregir>;
const GENERICO = {
  codigo: "COMPRAS_ACCION_NO_PERMITIDA",
  clave: "compras.error.sin_permiso",
  presentacion: "AVISO",
} as never;

describe("la ficha de una compra con «Corregir» y «Anular»", () => {
  it("sin permisos no hay ni «Corregir» ni «Anular»", async () => {
    await render(<PantallaDeFichaDeCompra ficha={ficha()} textos={textosDeCompras()} />);
    expect(page.getByRole("link", { name: "Corregir" }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Anular" }).elements()).toHaveLength(0);
  });

  it("con permisos: «Corregir» solo en la línea con precio, que lleva a su formulario, y «Anular» al pie; sin violaciones de accesibilidad", async () => {
    await render(
      <PantallaDeFichaDeCompra
        ficha={ficha()}
        textos={textosDeCompras()}
        acciones={{
          corregir: true,
          anular: true,
          pagar: false,
          anularPago: false,
          verNotas: false,
        }}
        accionDeAnular={() => Promise.resolve({ estado: "INICIAL" })}
      />,
    );
    const enlaces = page.getByRole("link", { name: "Corregir" }).elements();
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0]?.getAttribute("href")).toBe(`/compras/${UUID}/corregir/1`);
    await expect.element(page.getByRole("button", { name: "Anular" })).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });

  it("una compra anulada no ofrece «Anular» ni «Corregir»", async () => {
    await render(
      <PantallaDeFichaDeCompra
        ficha={ficha({
          estado: "ANULADA",
          anulacion: {
            motivo: "Se cargó mal",
            hechaPor: null,
            hechaEn: "2026-11-02T10:00:00.000Z",
          },
        })}
        textos={textosDeCompras()}
        acciones={{
          corregir: true,
          anular: true,
          pagar: false,
          anularPago: false,
          verNotas: false,
        }}
        accionDeAnular={() => Promise.resolve({ estado: "INICIAL" })}
      />,
    );
    expect(page.getByRole("link", { name: "Corregir" }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Anular" }).elements()).toHaveLength(0);
  });

  it("la hoja de «Anular»: pide el motivo, «Anular» queda apagado sin él, y un doble toque es UN solo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn<AccionDeAnular>(async () => {
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { estado: "ERROR", error: GENERICO, consumida: false };
    });
    await render(
      <PantallaDeFichaDeCompra
        ficha={ficha()}
        textos={textosDeCompras()}
        acciones={{
          corregir: false,
          anular: true,
          pagar: false,
          anularPago: false,
          verNotas: false,
        }}
        accionDeAnular={accion}
      />,
    );
    await userEvent.click(page.getByRole("button", { name: "Anular" }));
    const dialogo = page.getByRole("dialog");
    await expect.element(dialogo).toBeVisible();
    const confirmar = dialogo.getByRole("button", { name: "Anular" });
    await expect.element(confirmar).toBeDisabled();
    await userEvent.fill(dialogo.getByLabelText("Motivo"), "Se cargó mal");
    await expect.element(confirmar).toBeEnabled();
    tocar(confirmar);
    await expect.element(confirmar).toHaveAttribute("aria-busy", "true");
    tocar(confirmar);
    tocar(confirmar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect((accion.mock.calls[0]?.[1] as FormData).get("motivo")).toBe("Se cargó mal");
    liberar();
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("la hoja de «Anular» conserva el motivo escrito tras un error del servidor, también DESPUÉS del reinicio de React", async () => {
    const accion = vi.fn<AccionDeAnular>(() =>
      Promise.resolve({ estado: "ERROR", error: GENERICO, consumida: false }),
    );
    await render(
      <PantallaDeFichaDeCompra
        ficha={ficha()}
        textos={textosDeCompras()}
        acciones={{
          corregir: false,
          anular: true,
          pagar: false,
          anularPago: false,
          verNotas: false,
        }}
        accionDeAnular={accion}
      />,
    );
    await userEvent.click(page.getByRole("button", { name: "Anular" }));
    const dialogo = page.getByRole("dialog");
    await userEvent.fill(dialogo.getByLabelText("Motivo"), "Se cargó mal");
    const cancelado = await conReinicio(() => {
      tocar(dialogo.getByRole("button", { name: "Anular" }));
    });
    expect(cancelado).toBe(true);
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(dialogo.getByLabelText("Motivo")).toHaveValue("Se cargó mal");
  });

  it("si la compra ya se consumió, junto al genérico va «Corregir» (a la primera línea que se puede corregir)", async () => {
    const accion = vi.fn<AccionDeAnular>(() =>
      Promise.resolve({ estado: "ERROR", error: GENERICO, consumida: true }),
    );
    await render(
      <PantallaDeFichaDeCompra
        ficha={ficha()}
        textos={textosDeCompras()}
        acciones={{
          corregir: true,
          anular: true,
          pagar: false,
          anularPago: false,
          verNotas: false,
        }}
        accionDeAnular={accion}
      />,
    );
    await userEvent.click(page.getByRole("button", { name: "Anular" }));
    const dialogo = page.getByRole("dialog");
    await userEvent.fill(dialogo.getByLabelText("Motivo"), "Quiero anularla");
    await userEvent.click(dialogo.getByRole("button", { name: "Anular" }));
    await expect.element(dialogo.getByText("Esta acción no está permitida")).toBeVisible();
    await expect
      .element(dialogo.getByRole("link", { name: "Corregir" }))
      .toHaveAttribute("href", `/compras/${UUID}/corregir/1`);
  });
});

describe("FormularioDeCorregirLinea", () => {
  const textos = { precio: "Precio por Kilogramo", motivo: "Motivo", corregir: "Corregir" };

  it("Precio y Motivo; «Corregir» apagado hasta tener los dos; el precio viaja como texto canónico; sin violaciones de accesibilidad", async () => {
    const accion = vi.fn<AccionDeCorregir>(() => Promise.resolve(CORREGIR_INICIAL));
    await render(<FormularioDeCorregirLinea accion={accion} textos={textos} />);
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    const enviar = page.getByRole("button", { name: "Corregir" });
    await expect.element(enviar).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Precio por Kilogramo"), "1200");
    await expect.element(enviar).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Motivo"), "Subió el precio");
    await expect.element(enviar).toBeEnabled();
    tocar(enviar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(datos.get("precio")).toBe("1200.00");
    expect(datos.get("motivo")).toBe("Subió el precio");
    expect([...datos.keys()].sort()).toEqual(["motivo", "precio"]);
  });

  it("doble toque en «Corregir» = un solo envío; el error del servidor queda debajo", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn<AccionDeCorregir>(async () => {
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { estado: "ERROR", error: GENERICO };
    });
    await render(<FormularioDeCorregirLinea accion={accion} textos={textos} />);
    await userEvent.fill(page.getByLabelText("Precio por Kilogramo"), "1200");
    await userEvent.fill(page.getByLabelText("Motivo"), "Subió el precio");
    const enviar = page.getByRole("button", { name: "Corregir" });
    tocar(enviar);
    await expect.element(enviar).toHaveAttribute("aria-busy", "true");
    tocar(enviar);
    tocar(enviar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("tras un error del servidor, y DESPUÉS del reinicio, conserva el precio y el motivo escritos", async () => {
    const accion = vi.fn<AccionDeCorregir>(() =>
      Promise.resolve({ estado: "ERROR", error: GENERICO }),
    );
    await render(<FormularioDeCorregirLinea accion={accion} textos={textos} />);
    await userEvent.fill(page.getByLabelText("Precio por Kilogramo"), "1200");
    await userEvent.fill(page.getByLabelText("Motivo"), "Subió el precio");
    const cancelado = await conReinicio(() => {
      tocar(page.getByRole("button", { name: "Corregir" }));
    });
    expect(cancelado).toBe(true);
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(page.getByLabelText("Precio por Kilogramo")).toHaveValue("1.200,00");
    await expect.element(page.getByLabelText("Motivo")).toHaveValue("Subió el precio");
  });
});
