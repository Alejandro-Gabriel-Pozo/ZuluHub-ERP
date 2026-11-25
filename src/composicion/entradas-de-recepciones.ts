import { z } from "zod";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import {
  CAUSAS_DE_CORRECCION,
  FORMA_DEL_CURSOR_DE_RECEPCIONES,
  type CausaDeCorreccion,
} from "../modulos/compras/publico";
import { formaDelRemitoEscrito, leerElRemitoEscrito, unidad } from "./entradas-de-comprar";
import {
  decimal,
  identificador,
  leer,
  texto,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";

/**
 * La frontera de las pantallas de «Recepciones» (Compras 4, recepción separada): de lo que trae el navegador a lo que reciben los casos de uso y las consultas. Lista de permitidos en todas: solo se
 * toman los campos declarados; la empresa, la persona y la sucursal NO se leen del pedido (las pone el servidor).
 *
 *  - **Recibir NO pide precio** (decisión del dueño, 25/11/2026, pregunta 2 opción «b chica»): el renglón admite el producto, la unidad de compra, la cantidad y el peso real, y NADA más. Un renglón con precio,
 *    «precio por» o unidad de precio es un pedido inválido (el genérico), no se ignora en silencio: lo recibido queda «sin costo» hasta tomar el costo de la factura. Todo como TEXTO decimal, nunca `number`.
 *  - La clave del envío (un UUID que genera la pantalla por intento) es la idempotencia: la misma clave con el mismo contenido devuelve la misma recepción.
 *  - Confirmar lleva el id y, si la sucursal tiene más de un depósito normal, el depósito elegido; anular lleva el id y el motivo escrito. El cursor de la lista sigue la forma que importa compras (una regla).
 * Previene: dinero como `number`, un precio que entra por la puerta de atrás, una recepción en la empresa o la sucursal que diga el navegador. Chequeo: `entradas-de-recepciones.test.ts`.
 */

const formaDeRenglon = z.strictObject({
  productoId: identificador,
  unidadDeCompraId: unidad,
  cantidad: decimal,
  pesoReal: decimal.nullish(),
});

const formaDeRegistrar = z.strictObject({
  clave: identificador,
  proveedorId: identificador,
  remito: formaDelRemitoEscrito.nullish(),
  renglones: z.array(formaDeRenglon).min(1),
});

export type EntradaWebDeRegistrarRecepcion = Readonly<{
  clave: string;
  proveedorId: string;
  remito: Readonly<{ puntoDeVenta: number; numero: number; fecha: string }> | null;
  renglones: readonly Readonly<{
    productoId: string;
    presentacionId: null;
    unidadDeCompraId: string;
    cantidad: string;
    pesoReal: string | null;
    precioPor: "UNIDAD";
    unidadDePrecioId: null;
    precio: null;
  }>[];
}>;

export function entradaDeRegistrarRecepcion(
  crudo: unknown,
): Resultado<EntradaWebDeRegistrarRecepcion, ErrorDeEntrada> {
  const forma = leer(formaDeRegistrar, crudo);
  if (!forma.ok) return forma;
  const remito = leerElRemitoEscrito(forma.valor.remito);
  if (!remito.ok) return remito;
  return ok({
    clave: forma.valor.clave,
    proveedorId: forma.valor.proveedorId,
    remito: remito.valor,
    renglones: forma.valor.renglones.map((r) => ({
      productoId: r.productoId,
      presentacionId: null,
      unidadDeCompraId: r.unidadDeCompraId,
      cantidad: r.cantidad,
      pesoReal: r.pesoReal ?? null,
      precioPor: "UNIDAD" as const,
      unidadDePrecioId: null,
      precio: null,
    })),
  });
}

const formaDeConfirmar = z.strictObject({
  recepcionId: identificador,
  depositoId: identificador.nullish(),
});

export type EntradaWebDeConfirmarRecepcion = Readonly<{
  recepcionId: string;
  depositoId: string | null;
}>;

export function entradaDeConfirmarRecepcion(
  crudo: unknown,
): Resultado<EntradaWebDeConfirmarRecepcion, ErrorDeEntrada> {
  const forma = leer(formaDeConfirmar, crudo);
  if (!forma.ok) return forma;
  return ok({ recepcionId: forma.valor.recepcionId, depositoId: forma.valor.depositoId ?? null });
}

const formaDeAnular = z.strictObject({ recepcionId: identificador, motivo: texto });

export type EntradaWebDeAnularRecepcion = Readonly<{ recepcionId: string; motivo: string }>;

export function entradaDeAnularRecepcion(
  crudo: unknown,
): Resultado<EntradaWebDeAnularRecepcion, ErrorDeEntrada> {
  return leer(formaDeAnular, crudo);
}

const formaDeLaFicha = z.strictObject({ recepcionId: identificador });

/** La ficha de una recepción: solo el id (un UUID). */
export function entradaDeFichaDeRecepcion(
  crudo: unknown,
): Resultado<Readonly<{ recepcionId: string }>, ErrorDeEntrada> {
  return leer(formaDeLaFicha, crudo);
}

export type EntradaWebDeListarRecepciones = Readonly<{
  /** El cursor opaco de la página anterior; `null` = primera página. */
  despuesDe: string | null;
}>;

/** La lista de recepciones: de la dirección solo se lee `despues`; un cursor mal formado rechaza el pedido (no se adivina desde dónde seguir). La sucursal la pone el servidor. */
export function entradaDeListarRecepciones(
  crudo: unknown,
): Resultado<EntradaWebDeListarRecepciones, ErrorDeEntrada> {
  const valor =
    typeof crudo === "object" && crudo !== null && Object.hasOwn(crudo, "despues")
      ? (crudo as Readonly<Record<string, unknown>>)["despues"]
      : null;
  const cursor = typeof valor === "string" ? valor : null;
  if (cursor !== null && cursor !== "" && !FORMA_DEL_CURSOR_DE_RECEPCIONES.test(cursor)) {
    return err({ codigo: "FISCAL_DATOS_INVALIDOS", campo: "despues" });
  }
  return ok({ despuesDe: cursor === "" ? null : cursor });
}

const formaDeCorregirLoRecibido = z.strictObject({
  clave: identificador,
  recepcionId: identificador,
  linea: z.number().int(),
  correccionesVistas: z.number().int(),
  cantidad: decimal,
  causa: z.enum(CAUSAS_DE_CORRECCION),
  nota: texto.nullish(),
});

export type EntradaWebDeCorregirLoRecibido = Readonly<{
  clave: string;
  recepcionId: string;
  linea: number;
  correccionesVistas: number;
  cantidad: string;
  causa: CausaDeCorreccion;
  nota: string | null;
}>;

/**
 * «Corregir lo recibido» de una línea de una recepción confirmada: la clave del envío (un UUID por intento), la recepción, la línea, la última corrección que vio quien pide, la cantidad realmente
 * recibida (texto decimal, en la unidad de stock), la causa (de la lista cerrada) y una nota opcional. Lista de permitidos: ningún otro campo pasa; la empresa y la persona no se leen del pedido.
 */
export function entradaDeCorregirLoRecibido(
  crudo: unknown,
): Resultado<EntradaWebDeCorregirLoRecibido, ErrorDeEntrada> {
  const forma = leer(formaDeCorregirLoRecibido, crudo);
  if (!forma.ok) return forma;
  return ok({
    clave: forma.valor.clave,
    recepcionId: forma.valor.recepcionId,
    linea: forma.valor.linea,
    correccionesVistas: forma.valor.correccionesVistas,
    cantidad: forma.valor.cantidad,
    causa: forma.valor.causa,
    nota: forma.valor.nota ?? null,
  });
}
