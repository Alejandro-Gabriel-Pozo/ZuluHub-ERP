import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { TextoCifrado } from "../../../puertos/cifrado-de-secretos";
import type { Ambiente } from "../dominio/comprobante-nuevo";
import type { CertificadoId, EmisorId } from "../dominio/identificadores";

/**
 * La forma de un certificado de ARCA y de sus entradas y salidas (spec H7 facturación §B.6). Viven aparte del
 * repositorio solo para que este archivo no crezca (tope de 400 líneas, G5): el repositorio las vuelve a exportar y
 * quien las usa las sigue pidiendo a `repositorio-de-certificados`.
 */

export const ESTADOS_DE_CERTIFICADO = [
  "PEDIDO_GENERADO",
  "VIGENTE",
  "REEMPLAZADO",
  "DESCARTADO",
] as const;
export type EstadoDeCertificado = (typeof ESTADOS_DE_CERTIFICADO)[number];

/** El pedido de certificado que Pedernal genera: la clave queda cifrada y el pedido (CSR) es público. */
export type PedidoDeCertificado = Readonly<{
  id: CertificadoId;
  empresaId: EmpresaId;
  emisorId: EmisorId;
  ambiente: Ambiente;
  alias: string;
  cuitTitular: Cuit;
  pedidoPem: string;
  clave: TextoCifrado;
  creadoPor: PersonaId;
}>;

/** Lo que un certificado muestra de sí: nunca la clave. */
export type CertificadoGuardado = Readonly<{
  id: CertificadoId;
  empresaId: EmpresaId;
  emisorId: EmisorId;
  ambiente: Ambiente;
  alias: string;
  cuitTitular: Cuit;
  estado: EstadoDeCertificado;
  pedidoPem: string;
  certificadoPem: string | null;
  huellaSha256: string | null;
  venceEn: Date | null;
  /** La primera llamada exitosa a ARCA con este certificado; se anota una sola vez. */
  autorizacionVerificadaEn: Date | null;
  creadoPor: PersonaId;
  creadoEn: Date;
  version: number;
}>;

/** El certificado que pegó el gerente, ya validado: lo que nace al pasar de `PEDIDO_GENERADO` a `VIGENTE`. */
export type CargaDeCertificado = Readonly<{
  certificadoPem: string;
  /** SHA-256 en hexadecimal minúscula (64 caracteres). */
  huellaSha256: string;
  venceEn: Date;
}>;

export type ActivacionDeCertificado = Readonly<{
  certificado: CertificadoGuardado;
  /** El que era `VIGENTE` para ese `(emisor, ambiente)` y quedó `REEMPLAZADO` en la misma transacción. */
  reemplazado: CertificadoGuardado | null;
}>;
