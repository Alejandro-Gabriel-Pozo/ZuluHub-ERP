import { importeATexto, type Importe } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { DatosDelCobroValidos } from "./datos-del-cobro";
import { huellaDeCampos } from "./huella";
import { esUuid } from "./identificadores";

/**
 * La identidad de un cobro (e3 §3.5): `(empresa, origen_tipo, origen_id, origen_orden)`, única en la base. El mismo origen y el mismo
 * orden son el mismo cobro (doble clic, reintento de red): el segundo no duplica. La clave de idempotencia la arma caja, no la manda
 * quien llama. Dos cobros de un mismo ticket con medios distintos son dos órdenes (1, 2…).
 */

/** Qué documento originó el cobro (ej. `{ tipo: "ventas.cobranza_de_ticket", id }`). Caja no lo interpreta. */
export type ReferenciaOpaca = Readonly<{ tipo: string; id: string }>;

const FORMA_DEL_TIPO_DE_ORIGEN = /^[a-z_]+\.[a-z_]+$/;
export const LARGO_MAXIMO_DEL_TIPO_DE_ORIGEN = 64;
export const ORDEN_MINIMO_DE_COBRO = 1;
export const ORDEN_MAXIMO_DE_COBRO = 50;

/**
 * El origen y la posición del cobro dentro de él: tipo con la forma `modulo.cosa` de hasta 64 caracteres, id `uuid`, orden entero de
 * 1 a 50. Es `cobro_origen_tipo_ck` y `cobro_origen_orden_ck` de la base. Previene: un origen que la base rechazaría tarde.
 */
export function validarOrigen(
  origen: ReferenciaOpaca,
  orden: number,
): Resultado<null, "ORIGEN_INVALIDO"> {
  const valido =
    origen.tipo.length <= LARGO_MAXIMO_DEL_TIPO_DE_ORIGEN &&
    FORMA_DEL_TIPO_DE_ORIGEN.test(origen.tipo) &&
    esUuid(origen.id) &&
    Number.isInteger(orden) &&
    orden >= ORDEN_MINIMO_DE_COBRO &&
    orden <= ORDEN_MAXIMO_DE_COBRO;
  return valido ? ok(null) : err("ORIGEN_INVALIDO");
}

/** `cobro_<origen.id>_<orden>`: cumple `^[A-Za-z0-9_-]{16,128}$` (la forma de `clave_idempotencia` de la base). */
export function claveDelCobro(origen: ReferenciaOpaca, orden: number): string {
  return `cobro_${origen.id}_${orden}`;
}

/** Lo que identifica el pedido de cobro, SIN la clave (que se deriva del origen y el orden): entra a la huella. */
export type EntradaDeCobro = Readonly<{
  origen: ReferenciaOpaca;
  origenOrden: number;
  cajaId: string;
  sucursalId: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  importe: Importe;
  datos: DatosDelCobroValidos;
}>;

/** sha256 de la entrada canónica sin la clave. Cambiar CUALQUIER campo (importe, medio, un dato) da otra huella. */
export function huellaDelCobro(entrada: EntradaDeCobro): string {
  const { origen, datos } = entrada;
  return huellaDeCampos([
    "caja.cobro",
    origen.tipo,
    origen.id,
    entrada.origenOrden,
    entrada.cajaId,
    entrada.sucursalId,
    entrada.medioDePagoId,
    entrada.cuentaDeCobroId,
    entrada.importe.moneda,
    importeATexto(entrada.importe),
    datos.cupon,
    datos.ultimos4,
    datos.marcaDeTarjetaId,
    datos.cuotas,
    datos.dni,
  ]);
}
