import type { ClaveDeTexto } from "../../../../../../src/capacidades/vocabulario/catalogo";

/**
 * El modelo de vista de «Declarar pago» (Compras PR 8; maqueta `compra-pago.html`). Puro: sin React ni servidor. NO calcula ningún importe (el total lo copia el servidor y la pantalla solo lo muestra) ni replica
 * ninguna regla de negocio (la fecha no futura, la caja abierta, el pago único los decide el servidor y devuelve el genérico). Lo único que decide es cuándo el botón se puede tocar: el medio elegido y, con
 * efectivo, la caja y el motivo escritos. La interfaz no importa los módulos (las apps entran por `apps/web/servidor`): la lista de medios se declara acá y `test/web/modelo-de-pago.test.ts` falla si difiere de la del
 * dominio (`MEDIOS_DE_PAGO` de compras, que a su vez compara `compras-fuente-unica.test.ts` con los tipos de medio de la caja). Previene: un medio que la pantalla ofrece y el servidor rechaza, o al revés.
 */

export const MEDIOS_PARA_ELEGIR = [
  "EFECTIVO",
  "TARJETA_DEBITO",
  "TARJETA_CREDITO",
  "TRANSFERENCIA",
  "QR",
  "OTRO",
] as const;
export type MedioDePago = (typeof MEDIOS_PARA_ELEGIR)[number];

/** La clave de texto de cada medio: los mismos tipos de medio de la caja (`caja.medios.tipo.*`). */
export const CLAVE_DE_TEXTO_DEL_MEDIO: Readonly<Record<MedioDePago, ClaveDeTexto>> = {
  EFECTIVO: "caja.medios.tipo.efectivo",
  TARJETA_DEBITO: "caja.medios.tipo.tarjeta_debito",
  TARJETA_CREDITO: "caja.medios.tipo.tarjeta_credito",
  TRANSFERENCIA: "caja.medios.tipo.transferencia",
  QR: "caja.medios.tipo.qr",
  OTRO: "caja.medios.tipo.otro",
};

export const esUnMedioDePago = (valor: string): valor is MedioDePago =>
  (MEDIOS_PARA_ELEGIR as readonly string[]).includes(valor);

export type PagoEscrito = Readonly<{
  fecha: string;
  medio: string;
  cajaId: string;
  motivo: string;
}>;

/** El pago se puede enviar: hay fecha y medio de la lista y, con efectivo, la caja y el motivo. */
export function pagoListo(p: PagoEscrito): boolean {
  if (p.fecha === "" || !esUnMedioDePago(p.medio)) return false;
  return p.medio !== "EFECTIVO" || (p.cajaId !== "" && p.motivo.trim() !== "");
}
