import { expect } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { Respuesta } from "../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../src/capacidades/vocabulario/vocabulario";
import { ArmazonDeOperacion } from "../plantillas/sesion/ArmazonDeOperacion";
import {
  PantallaDeEmitirFactura,
  type PropsDePantallaDeEmitirFactura,
} from "../plantillas/facturacion/PantallaDeEmitirFactura.cliente";
import type { PuntoParaEmitir } from "../plantillas/facturacion/modelo-de-emision";
import type { EmitirLaFactura } from "../plantillas/facturacion/useEnvioDeLaEmision.cliente";

/** Apoyo de las pruebas en Chromium de Emitir una factura (8B, por pasos): puntos de venta, servidor falso y ayudas. No es una prueba. */

export const ID_FACTURA = "3d4e5f60-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
export const PUNTO_1: PuntoParaEmitir = {
  id: "6a1f0c2e-3b4d-4e5f-8a7b-9c0d1e2f3a4b",
  numero: 1,
  ambiente: "PRODUCCION",
};
export const PUNTO_2_PRUEBAS: PuntoParaEmitir = {
  id: "7b2a1d3f-4c5e-4f60-9b8c-0d1e2f3a4b5c",
  numero: 2,
  ambiente: "HOMOLOGACION",
};

export const listo: Respuesta<{ comprobanteId: string }> = {
  ok: true,
  dato: { comprobanteId: ID_FACTURA },
};

/** Una acción del servidor falsa que anota cada pedido y contesta lo que se le diga. */
export function servidorFalso(
  contestar: (llamada: number) => Promise<Respuesta<{ comprobanteId: string }>> = () =>
    Promise.resolve(listo),
) {
  const pedidos: Record<string, unknown>[] = [];
  const emitir: EmitirLaFactura = (entrada) => {
    pedidos.push(entrada as Record<string, unknown>);
    return contestar(pedidos.length);
  };
  return { pedidos, emitir };
}

export const enArmazon = (props: Partial<PropsDePantallaDeEmitirFactura> = {}) => (
  <ArmazonDeOperacion
    titulo={texto({}, "fiscal.pantalla.emitir_titulo")}
    actual="comprobantes"
    marca="Hotel del Lago"
    empresa="Café del Puerto"
    modulos={[
      {
        clave: "comprobantes",
        href: "/facturacion/comprobantes",
        etiqueta: "Comprobantes",
        icono: "comprobantes",
      },
    ]}
  >
    <PantallaDeEmitirFactura
      discriminaIva
      puntosDeVenta={[PUNTO_1]}
      emitir={servidorFalso().emitir}
      irA={() => undefined}
      esperaEntreVerificacionesMs={20}
      {...props}
    />
  </ArmazonDeOperacion>
);

export const boton = (nombre: string) => page.getByRole("button", { name: nombre });
export const campo = (etiqueta: string) => page.getByLabelText(etiqueta, { exact: true });

const visible = (el: Element): boolean =>
  el.closest("[hidden]") === null && el.checkVisibility({ visibilityProperty: true });

/** Cada texto visible llega a 16 px, cada control visible a 48 px de alto y la página no se corre hacia el costado. */
export function legibleYTocable(): void {
  const chicos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
    const tieneTexto = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
    );
    if (!tieneTexto || !visible(el)) continue;
    const tamano = Number.parseFloat(getComputedStyle(el).fontSize);
    if (tamano < 16) chicos.push(`${el.tagName.toLowerCase()} ${tamano}px: ${el.textContent}`);
  }
  expect(chicos).toEqual([]);
  const bajos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>(
    "button, a[href], select, input:not([type=hidden]), textarea",
  )) {
    if (!visible(el)) continue;
    const caja = el.getBoundingClientRect();
    // El campo de un importe (`CampoImporte`) lleva el borde en su envoltura: el toque de 48 px es el de la envoltura entera.
    const alto = el.matches("input")
      ? Math.max(caja.height, el.parentElement?.getBoundingClientRect().height ?? 0)
      : caja.height;
    if (alto < 48) bajos.push(`${el.tagName.toLowerCase()} ${alto}px: ${el.textContent}`);
    if (el.matches("button") && caja.width < 48)
      bajos.push(`ancho ${caja.width}px: ${el.textContent}`);
  }
  expect(bajos).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

export async function alPaso2(): Promise<void> {
  await userEvent.click(boton("Siguiente"));
  await expect.element(page.getByRole("region", { name: "Renglones" })).toBeVisible();
}

/** Completa el renglón de la posición dada (desde 1) en el paso 2. */
export async function escribirRenglon(
  posicion: number,
  datos: { descripcion: string; cantidad?: string; precio: string; iva?: string },
): Promise<void> {
  const grupo = page.getByRole("group", { name: `Renglón ${posicion}` });
  await userEvent.type(grupo.getByLabelText("Descripción"), datos.descripcion);
  if (datos.cantidad !== undefined) {
    await userEvent.clear(grupo.getByLabelText("Cantidad"));
    await userEvent.type(grupo.getByLabelText("Cantidad"), datos.cantidad);
  }
  await userEvent.type(grupo.getByLabelText(/^Precio/), datos.precio);
  if (datos.iva !== undefined) {
    await userEvent.selectOptions(grupo.getByLabelText("IVA", { exact: true }), datos.iva);
  }
}

/** Llega al paso 3 con un cliente (consumidor final, o el DNI de Juan Pérez) y un renglón de 2 × $ 4.500,00. */
export async function llegarARevisar(
  quien: "consumidor" | "dni" = "consumidor",
  iva: string | undefined = "21",
): Promise<void> {
  if (quien === "dni") {
    await userEvent.selectOptions(campo("Documento"), "DNI");
    await userEvent.type(campo("DNI"), "27345678");
    await userEvent.type(campo("Nombre o razón social"), "Juan Pérez");
    await userEvent.selectOptions(campo("Condición frente al IVA"), "CONSUMIDOR_FINAL");
  }
  await alPaso2();
  await escribirRenglon(1, {
    descripcion: "Medialunas (docena)",
    cantidad: "2",
    precio: "4500",
    ...(iva === undefined ? {} : { iva }),
  });
  await userEvent.click(boton("Siguiente"));
  await expect.element(page.getByText("Revisá y emití")).toBeVisible();
}
