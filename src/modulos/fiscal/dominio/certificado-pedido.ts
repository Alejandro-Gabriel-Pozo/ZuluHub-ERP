import { cuitDesdeTexto, type Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Ambiente } from "./comprobante-nuevo";
import { certificadoId, type CertificadoId, type EmisorId } from "./identificadores";

/**
 * El pedido de un certificado de ARCA (spec H7 facturación §B.4 y §B.6, tramo F7): lo que la persona pide y las
 * reglas puras de su forma. Generar la clave y el pedido (CSR) es del adaptador; acá solo se decide si el pedido
 * sirve y cómo se nombra el titular en el certificado.
 */

/** El alias del certificado (`CN`): letras y dígitos, de 1 a 30. Es la regla de la base (`certificado_alias_ck`). */
const ALIAS = /^[A-Za-z0-9]{1,30}$/;
/** La forma de un uuid en minúscula: el `id` es el que genera la pantalla y es la clave de la idempotencia. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** La organización (`O`): hasta 64 caracteres (el tope de X.520) y sin caracteres de control. */
const ORGANIZACION = /^[^\p{Cc}]{1,64}$/u;

export type EntradaDePedidoDeCertificado = Readonly<{
  /** El identificador del certificado, un uuid: repetir el pedido con el mismo `id` es la repetición. */
  id: string;
  emisorId: EmisorId;
  ambiente: Ambiente;
  alias: string;
  /** El CUIT del titular (de 11 dígitos, con o sin guiones). */
  cuitTitular: string;
  organizacion: string;
}>;

export type PedidoDeCertificadoValido = Readonly<{
  id: CertificadoId;
  emisorId: EmisorId;
  ambiente: Ambiente;
  alias: string;
  cuitTitular: Cuit;
  /** Sin blancos en los extremos. */
  organizacion: string;
}>;

export type ErrorDePedidoDeCertificado =
  "ID_INVALIDO" | "ALIAS_INVALIDO" | "CUIT_INVALIDO" | "ORGANIZACION_INVALIDA";

/**
 * Valida la forma del pedido. Orden de los errores: el `id`, el alias, el CUIT y la organización. Que el CUIT sea
 * el del emisor lo decide el caso de uso (el dominio no conoce al emisor).
 */
export function armarPedidoDeCertificado(
  entrada: EntradaDePedidoDeCertificado,
): Resultado<PedidoDeCertificadoValido, ErrorDePedidoDeCertificado> {
  if (!UUID.test(entrada.id)) return err("ID_INVALIDO");
  if (!ALIAS.test(entrada.alias)) return err("ALIAS_INVALIDO");
  const cuit = cuitDesdeTexto(entrada.cuitTitular);
  if (!cuit.ok) return err("CUIT_INVALIDO");
  const organizacion = entrada.organizacion.trim();
  if (!ORGANIZACION.test(organizacion)) return err("ORGANIZACION_INVALIDA");
  return ok({
    id: certificadoId(entrada.id),
    emisorId: entrada.emisorId,
    ambiente: entrada.ambiente,
    alias: entrada.alias,
    cuitTitular: cuit.valor,
    organizacion,
  });
}

/**
 * El `serialNumber` del sujeto del certificado: `CUIT` y los 11 dígitos, tal como lo pide ARCA en el pedido y como
 * vuelve en el certificado que emite (`serialNumber=CUIT 20123456786`). Es lo que ata un certificado a su titular:
 * se escribe al pedirlo y se compara al cargarlo.
 */
export const numeroDeSerieDeCuit = (cuit: Cuit): string => `CUIT ${cuit}`;
