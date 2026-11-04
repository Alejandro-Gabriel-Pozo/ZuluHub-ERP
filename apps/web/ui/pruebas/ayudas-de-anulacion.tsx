import { expect } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { Respuesta } from "../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../src/capacidades/vocabulario/vocabulario";
import { ArmazonDeOperacion } from "../plantillas/sesion/ArmazonDeOperacion";
import type { FacturaParaAnular } from "../plantillas/facturacion/eleccion-de-anulacion";
import {
  PantallaDeAnularComprobante,
  type PropsDePantallaDeAnularComprobante,
} from "../plantillas/facturacion/PantallaDeAnularComprobante.cliente";
import type { EmitirLaNota } from "../plantillas/facturacion/useEnvioDeLaAnulacion.cliente";

/** Apoyo de las pruebas en Chromium de la pantalla de anular por importe (la factura del prototipo 12A y sus ayudas). No es una prueba. */

export const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const ID_NOTA = "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c";

export const factura: FacturaParaAnular = {
  id: ID,
  tipo: "FACTURA_B",
  estado: "AUTORIZADO",
  numero: "00001-00000123",
  concepto: "PRODUCTOS",
  servicio: null,
  importes: { total: "90750.00" },
  alicuotas: [
    { alicuota: "21", total: "60500.00" },
    { alicuota: "10.5", total: "30250.00" },
  ],
  receptor: { nombre: "Juan Pérez", documento: { tipo: "DNI", numero: "12345678" } },
  notasQueLoCitan: [
    {
      id: "n1",
      tipo: "NOTA_CREDITO_B",
      numero: "00001-00000012",
      total: "50000.00",
      estado: "AUTORIZADO",
    },
    {
      id: "n2",
      tipo: "NOTA_CREDITO_B",
      numero: "00001-00000013",
      total: "25000.00",
      estado: "EN_VALIDACION",
    },
  ],
  acreditado: "75000.00",
};
export const facturaC: FacturaParaAnular = {
  ...factura,
  tipo: "FACTURA_C",
  numero: "00002-00000045",
  importes: { total: "45000.00" },
  alicuotas: [],
  receptor: { nombre: "Marta Gómez", documento: { tipo: "DNI", numero: "23456789" } },
  notasQueLoCitan: [],
  acreditado: "0.00",
};

export const listo: Respuesta<{ comprobanteId: string }> = {
  ok: true,
  dato: { comprobanteId: ID_NOTA },
};

/** Una acción del servidor falsa que anota cada pedido y contesta lo que se le diga. */
export function servidorFalso(
  contestar: (llamada: number) => Promise<Respuesta<{ comprobanteId: string }>> = () =>
    Promise.resolve(listo),
) {
  const pedidos: Record<string, unknown>[] = [];
  const emitir: EmitirLaNota = (entrada) => {
    pedidos.push(entrada as Record<string, unknown>);
    return contestar(pedidos.length);
  };
  return { pedidos, emitir };
}

export const enArmazon = (props: Partial<PropsDePantallaDeAnularComprobante> = {}) => (
  <ArmazonDeOperacion
    titulo={texto({}, "fiscal.pantalla.anular_titulo")}
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
    <PantallaDeAnularComprobante
      factura={factura}
      limiteDelMotivo={200}
      emitir={servidorFalso().emitir}
      irA={() => undefined}
      esperaEntreVerificacionesMs={20}
      {...props}
    />
  </ArmazonDeOperacion>
);

export const boton = (nombre: string) => page.getByRole("button", { name: nombre });
export const motivo = () => page.getByLabelText("Motivo (obligatorio)");
/** El campo de una alícuota: está dentro de su grupo («IVA 21 %»). */
export const campo = (alicuota: string) =>
  page.getByRole("group", { name: alicuota }).getByLabelText("Importe a anular (con IVA incluido)");

export async function irAlPaso2(): Promise<void> {
  await userEvent.click(boton("Siguiente"));
  await expect.element(motivo()).toBeVisible();
}
export async function anularUnaParte(): Promise<void> {
  await userEvent.click(boton("Anular solo una parte"));
  await expect.element(page.getByText("Elegí qué anular")).toBeVisible();
}
/** Escribe el motivo y deja listo el botón final. */
export async function conMotivo(escrito = "Error de carga"): Promise<void> {
  await irAlPaso2();
  await userEvent.type(motivo(), escrito);
}
