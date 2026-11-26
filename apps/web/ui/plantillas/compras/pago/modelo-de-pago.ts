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

/** Una fila del pago: el medio elegido y, cuando hay más de una fila, lo que paga ese medio (texto del campo de importe: canónico o vacío). */
export type FilaDeMedio = Readonly<{ id: number; medio: string; importe: string }>;

export type PagoEscrito = Readonly<{
  fecha: string;
  filas: readonly FilaDeMedio[];
  cajaId: string;
  motivo: string;
}>;

/** Con una línea en efectivo la plata sale de una caja: la pantalla pide la caja y el motivo. */
export const hayEfectivo = (filas: readonly FilaDeMedio[]): boolean =>
  filas.some((f) => f.medio === "EFECTIVO");

/** Se puede sumar otra fila mientras quede un tipo de medio sin usar (un medio de cada tipo por pago, DEC-1280). */
export const sePuedeAgregarUnMedio = (filas: readonly FilaDeMedio[]): boolean =>
  filas.length < MEDIOS_PARA_ELEGIR.length;

/** Los medios que ofrece una fila: el suyo y los que ninguna otra fila eligió (nunca dos filas con el mismo medio). */
export const mediosParaLaFila = (
  filas: readonly FilaDeMedio[],
  fila: FilaDeMedio,
): readonly MedioDePago[] =>
  MEDIOS_PARA_ELEGIR.filter((m) => m === fila.medio || !filas.some((f) => f.medio === m));

/**
 * El pago se puede enviar: hay fecha, cada fila tiene un medio de la lista sin repetirse y, con varias filas, cada una dice cuánto paga; con efectivo, también la caja y el motivo.
 * Que la suma sea el total NO se mira acá: lo decide el servidor bajo el bloqueo de la factura (la pantalla no calcula importes).
 */
export function pagoListo(p: PagoEscrito): boolean {
  if (p.fecha === "" || p.filas.length === 0) return false;
  const medios = p.filas.map((f) => f.medio);
  if (!medios.every(esUnMedioDePago) || new Set(medios).size !== medios.length) return false;
  if (p.filas.length > 1 && p.filas.some((f) => f.importe.trim() === "")) return false;
  return !hayEfectivo(p.filas) || (p.cajaId !== "" && p.motivo.trim() !== "");
}

/**
 * Lo que sale de las filas del formulario hacia el servidor: UN medio sin importe (lleva el total de la factura) o VARIOS con su importe, en el orden de las filas. Cada fila sin importe en un pago de varios
 * llega con importe vacío y el servidor la rechaza (el genérico): no se completa sola.
 */
export function pedidoDeMedios(
  medios: readonly string[],
  importes: readonly string[],
):
  | Readonly<{ medio: string }>
  | Readonly<{ medios: readonly Readonly<{ medio: string; importe: string }>[] }> {
  return medios.length === 1
    ? { medio: medios[0] ?? "" }
    : { medios: medios.map((medio, i) => ({ medio, importe: importes[i] ?? "" })) };
}
