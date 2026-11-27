import { z } from "zod";
import { exigirClave, SALIDAS_DE_LINEA } from "../modulos/comandas/publico";
import type { Resultado } from "../primitivas/resultado/resultado";
import { MAXIMO_DE_LINEAS_DEL_CARRITO } from "./entradas-de-venta-rapida";
import {
  decimal,
  entero,
  identificador,
  leer,
  texto,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";
import { PALABRA } from "./entradas-de-mesas";

/**
 * La frontera de las comandas y de la impresión del salón (S-0r; E7 §3.5): de lo que manda la pantalla a lo que aceptan enviar a cocina, pedir que salga, anular un ítem ya enviado, el orden de salida,
 * las impresoras y los trabajos de impresión. Pura: sin base ni servidor.
 *
 * Lista de permitidos: de cada pedido solo se leen las claves que declara su esquema (`z.object` descarta el resto: no se puede mandar la empresa, la persona, la sucursal ni el rótulo «Mesa 5», que
 * arma el servidor desde la mesa). Esta capa dice si el dato tiene la FORMA pedida (ids con forma de id, cantidades como texto decimal y nunca como número, palabras en mayúscula para uso, tipo de
 * documento y resultado, la salida dentro de su conjunto); si el uso o el papel existen, si el motivo vale, si la cantidad es múltiplo del paso o si el documento es de la sucursal lo decide el
 * servidor dentro de su transacción (los rangos viven una vez, en el dominio).
 *
 *  - **El id y la clave de cada intento los manda la pantalla** (el `envioId`, el `avisoId`, el `trabajoId`, la clave de idempotencia): repetir el mismo pedido devuelve lo mismo, nunca otro envío ni otro papel.
 * Chequeo: `entradas-de-comandas.test.ts`.
 */

type Pedido<T> = Resultado<T, ErrorDeEntrada>;

/** La clave de idempotencia de cada intento: la forma la define `exigirClave` de comandas (una regla, un lugar); la genera la pantalla (`useEnvioConClave`). */
const CLAVE = z.string().refine((clave) => exigirClave(clave).ok);

const FORMA_DE_ENVIAR = z.object({
  envioId: identificador,
  cuentaId: identificador,
  claveIdempotencia: CLAVE,
});
const FORMA_DE_PEDIR_QUE_SALGA = z.object({
  envioId: identificador,
  cuentaId: identificador,
  lineaIds: z.union([
    z.literal("TODAS"),
    z.array(identificador).min(1).max(MAXIMO_DE_LINEAS_DEL_CARRITO),
  ]),
  claveIdempotencia: CLAVE,
});
const FORMA_DE_ANULAR = z.object({
  cuentaId: identificador,
  lineaId: identificador,
  cantidad: decimal,
  motivo: texto,
  avisoId: identificador,
});
const FORMA_DE_CAMBIAR_SALIDA = z.object({
  cuentaId: identificador,
  lineaId: identificador,
  salida: z.enum(SALIDAS_DE_LINEA),
});
/** La nota libre de un plato (SAL-G): el texto; vacío la quita. El largo y los caracteres los valida el servidor con la primitiva (`notaDeCocinaDesdeTexto`): acá solo la forma. */
const FORMA_DE_CAMBIAR_NOTA = z.object({
  cuentaId: identificador,
  lineaId: identificador,
  nota: texto,
});
const FORMA_DE_QUITAR_SIN_ENVIAR = z.object({ cuentaId: identificador, lineaId: identificador });
const FORMA_DE_REGISTRAR_IMPRESORA = z.object({
  impresoraId: identificador,
  nombre: texto,
  uso: PALABRA,
  papelMm: entero,
});
const FORMA_DE_EDITAR_IMPRESORA = z.object({
  impresoraId: identificador,
  nombre: texto.optional(),
  uso: PALABRA.optional(),
  papelMm: entero.optional(),
  versionEsperada: entero,
});
const FORMA_DE_UNA_IMPRESORA = z.object({ impresoraId: identificador });
const FORMA_DE_IMPRIMIR = z.object({
  trabajoId: identificador,
  documentoTipo: PALABRA,
  documentoId: identificador,
  impresoraId: identificador.optional(),
  claveIdempotencia: CLAVE,
});
const FORMA_DE_DECLARAR = z.object({
  trabajoId: identificador,
  numero: entero,
  resultado: PALABRA,
});
const FORMA_DE_LOS_TRABAJOS = z.object({ documentoId: identificador });
const FORMA_DEL_DOCUMENTO = z.object({
  documentoTipo: PALABRA,
  documentoId: identificador,
  copia: z.boolean().optional(),
  impresoraId: identificador.optional(),
});

export type PedidoDeEnviar = z.output<typeof FORMA_DE_ENVIAR>;
export type PedidoDePedirQueSalga = z.output<typeof FORMA_DE_PEDIR_QUE_SALGA>;
export type PedidoDeAnular = z.output<typeof FORMA_DE_ANULAR>;
export type PedidoDeCambiarSalida = z.output<typeof FORMA_DE_CAMBIAR_SALIDA>;
export type PedidoDeCambiarNota = z.output<typeof FORMA_DE_CAMBIAR_NOTA>;
export type PedidoDeQuitarSinEnviar = z.output<typeof FORMA_DE_QUITAR_SIN_ENVIAR>;
export type PedidoDeRegistrarImpresora = z.output<typeof FORMA_DE_REGISTRAR_IMPRESORA>;
export type PedidoDeEditarImpresora = z.output<typeof FORMA_DE_EDITAR_IMPRESORA>;
export type PedidoDeUnaImpresora = z.output<typeof FORMA_DE_UNA_IMPRESORA>;
export type PedidoDeImprimir = z.output<typeof FORMA_DE_IMPRIMIR>;
export type PedidoDeDeclarar = z.output<typeof FORMA_DE_DECLARAR>;
export type PedidoDeLosTrabajos = z.output<typeof FORMA_DE_LOS_TRABAJOS>;
export type PedidoDelDocumento = z.output<typeof FORMA_DEL_DOCUMENTO>;

export const leerElPedidoDeEnviar = (crudo: unknown): Pedido<PedidoDeEnviar> =>
  leer(FORMA_DE_ENVIAR, crudo);
export const leerElPedidoDePedirQueSalga = (crudo: unknown): Pedido<PedidoDePedirQueSalga> =>
  leer(FORMA_DE_PEDIR_QUE_SALGA, crudo);
export const leerElPedidoDeAnular = (crudo: unknown): Pedido<PedidoDeAnular> =>
  leer(FORMA_DE_ANULAR, crudo);
export const leerElPedidoDeCambiarNota = (crudo: unknown): Pedido<PedidoDeCambiarNota> =>
  leer(FORMA_DE_CAMBIAR_NOTA, crudo);

export const leerElPedidoDeCambiarSalida = (crudo: unknown): Pedido<PedidoDeCambiarSalida> =>
  leer(FORMA_DE_CAMBIAR_SALIDA, crudo);
export const leerElPedidoDeQuitarSinEnviar = (crudo: unknown): Pedido<PedidoDeQuitarSinEnviar> =>
  leer(FORMA_DE_QUITAR_SIN_ENVIAR, crudo);
export const leerElPedidoDeRegistrarImpresora = (
  crudo: unknown,
): Pedido<PedidoDeRegistrarImpresora> => leer(FORMA_DE_REGISTRAR_IMPRESORA, crudo);
export const leerElPedidoDeEditarImpresora = (crudo: unknown): Pedido<PedidoDeEditarImpresora> =>
  leer(FORMA_DE_EDITAR_IMPRESORA, crudo);
export const leerElPedidoDeUnaImpresora = (crudo: unknown): Pedido<PedidoDeUnaImpresora> =>
  leer(FORMA_DE_UNA_IMPRESORA, crudo);
export const leerElPedidoDeImprimir = (crudo: unknown): Pedido<PedidoDeImprimir> =>
  leer(FORMA_DE_IMPRIMIR, crudo);
export const leerElPedidoDeDeclarar = (crudo: unknown): Pedido<PedidoDeDeclarar> =>
  leer(FORMA_DE_DECLARAR, crudo);
export const leerElPedidoDeLosTrabajos = (crudo: unknown): Pedido<PedidoDeLosTrabajos> =>
  leer(FORMA_DE_LOS_TRABAJOS, crudo);
export const leerElPedidoDelDocumento = (crudo: unknown): Pedido<PedidoDelDocumento> =>
  leer(FORMA_DEL_DOCUMENTO, crudo);
