import { importeATexto, type Importe } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { huellaDeCampos } from "./huella";

/**
 * La clave y la huella de las operaciones de caja que mandan clave de idempotencia (abrir sesión, ingreso o egreso, ajuste y anulación;
 * e3 §3.2 y §3.9). La clave la genera la pantalla al abrir el formulario, con la forma de `sesion_caja_clave_ck` y
 * `movimiento_caja_clave_ck` de la base; la huella es el sha256 de la operación YA VALIDADA y normalizada (el importe como texto
 * canónico, el motivo recortado): `10` y `10.00` son el mismo pedido y cualquier campo distinto es otro. Con la clave decide si un
 * reintento es el mismo pedido (devuelve lo hecho) o una clave reutilizada (`decidirPorHuella`). Puro: sin reloj ni azar. Previene que
 * un doble clic duplique la operación y que una clave reutilizada para otra cosa pase por repetición.
 */

/** La misma forma que `sesion_caja_clave_ck` y `movimiento_caja_clave_ck`: una prueba de integración compara las dos. */
const FORMA_DE_CLAVE = /^[A-Za-z0-9_-]{16,128}$/;

export type ErrorDeClave = "CLAVE_DE_IDEMPOTENCIA_INVALIDA";

/** Lo que llega de la pantalla puede ser cualquier cosa: solo un texto con la forma de la base es una clave. */
export function exigirClave(clave: unknown): Resultado<string, ErrorDeClave> {
  return typeof clave === "string" && FORMA_DE_CLAVE.test(clave)
    ? ok(clave)
    : err("CLAVE_DE_IDEMPOTENCIA_INVALIDA");
}

export function huellaDeApertura(
  entrada: Readonly<{ sucursalId: string; cajaId: string | null; fondo: Importe }>,
): string {
  return huellaDeCampos([
    "caja.abrir_sesion",
    entrada.sucursalId,
    entrada.cajaId,
    entrada.fondo.moneda,
    importeATexto(entrada.fondo),
  ]);
}

export function huellaDeMovimientoManual(
  entrada: Readonly<{
    sesionId: string;
    clase: "INGRESO_MANUAL" | "EGRESO_MANUAL";
    importe: Importe;
    motivo: string;
  }>,
): string {
  return huellaDeCampos([
    "caja.movimiento_manual",
    entrada.sesionId,
    entrada.clase,
    entrada.importe.moneda,
    importeATexto(entrada.importe),
    entrada.motivo,
  ]);
}

export function huellaDeAjuste(
  entrada: Readonly<{
    sesionId: string;
    medioDePagoId: string;
    cuentaDeCobroId: string | null;
    importe: Importe;
    motivo: string;
    corrigeJornada: FechaCivil | null;
  }>,
): string {
  return huellaDeCampos([
    "caja.ajuste",
    entrada.sesionId,
    entrada.medioDePagoId,
    entrada.cuentaDeCobroId,
    entrada.importe.moneda,
    importeATexto(entrada.importe),
    entrada.motivo,
    entrada.corrigeJornada,
  ]);
}

export function huellaDeAnulacion(
  entrada: Readonly<{ movimientoId: string; motivo: string }>,
): string {
  return huellaDeCampos(["caja.anulacion", entrada.movimientoId, entrada.motivo]);
}
