import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeCantidad,
  cantidadConSignoDesdeTexto,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { PrecioUnitario } from "../../../primitivas/dinero/precio-unitario";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import { detalleDeStockDesdeTexto } from "../../../primitivas/texto/detalle-de-stock";
import { fechaDeNegocio } from "../../../primitivas/tiempo/fecha-de-negocio";
import { convertirCantidad } from "../../../primitivas/unidades/convertir-cantidad";
import type { CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import { datosDeJornada } from "../../empresas/publico";
import { esUnidadConocida } from "../dominio/composicion";
import { cantidadDeUnidades, type RenglonDeLibro } from "../dominio/movimiento";
import { esUuid } from "../persistencia/filas";
import type { Articulo, Deposito } from "../persistencia/modelo";
import { exigirAlcanceDeSucursal, traducir } from "./comun";
import type { TxDeStock } from "./contrato";
import { leerCostoDeclarado } from "./costos";
import type { ControlDeStock, ErrorDeStock } from "./errores";
import { CONTROL_DE_NEGATIVO } from "./movimiento-en-tx";

type R<S> = Resultado<S, ErrorDeStock>;

/**
 * Tope de renglones de un movimiento: el de la base (`renglon_numero_ck`: el número de renglón es menor que 10.000). Una transferencia
 * escribe dos por artículo.
 */
export const MAXIMO_DE_RENGLONES = 9_999;

/**
 * Un renglón tal como llega de la pantalla: el producto, la cantidad en texto decimal y la unidad en la que la escribió la persona. Una ENTRADA
 * por compra o carga inicial puede traer además `costoUnitario` (texto decimal, por unidad de `unidadId`: ver `leerRenglones`).
 */
export type RenglonPedido = Readonly<{
  productoId: string;
  cantidad: string;
  unidadId: string;
  costoUnitario?: string | undefined;
}>;

/** Un renglón que ya pasó la lista de permitidos: la cantidad es una `Cantidad` mayor que cero y la unidad una conocida. */
export type RenglonLeido = Readonly<{
  productoId: string;
  cantidad: Cantidad;
  unidadId: CodigoDeUnidad;
  /** Lo que declaró la entrada; `null` si no declaró costo (queda `SIN_COSTO`, nunca cero). */
  costoUnitario: PrecioUnitario | null;
}>;

/** Un renglón llevado a la unidad de stock de su artículo (conversión exacta o rechazada): el que se escribe en el libro. */
export type RenglonResuelto = Readonly<{
  productoId: string;
  articuloId: string;
  /** Mayor que cero, en la unidad de stock. */
  cantidad: CantidadConSigno;
  /** El costo declarado, por unidad de stock (`null`: sin costo). */
  costoUnitario: PrecioUnitario | null;
}>;

/**
 * La clave de idempotencia de lo que la pantalla manda: un UUID (lo genera la pantalla). Las claves derivadas que usa el sistema
 * (`conteo_<id>`, `anulacion_venta_<id>`) NO son UUID, así que nadie puede ocupar una escribiéndola a mano en un movimiento. Se normaliza
 * a minúsculas.
 */
export function leerClave(texto: unknown): R<string> {
  return typeof texto === "string" && esUuid(texto)
    ? ok(texto.toLowerCase())
    : err("IDENTIFICADOR_INVALIDO");
}

/** Un id de depósito, de artículo o de movimiento: UUID en minúsculas, o `null` si no lo es. */
export const leerId = (texto: unknown): string | null =>
  typeof texto === "string" && esUuid(texto) ? texto.toLowerCase() : null;

/**
 * El detalle: con lista de permitidos de una línea y largo máximo (`detalle-de-stock`). `exigido`: ajustar y anular dicen siempre por qué
 * (`DETALLE_REQUERIDO`); en una entrada o una salida es opcional, pero si viene tiene que ser válido (`DETALLE_REQUERIDO` también: «Escribí el
 * detalle»; sin texto aprobado específico, D175).
 */
export function leerDetalle(texto: unknown, exigido: boolean): R<string | null> {
  if (texto === undefined || texto === null) return exigido ? err("DETALLE_REQUERIDO") : ok(null);
  if (typeof texto !== "string") return err("DETALLE_REQUERIDO");
  const valido = detalleDeStockDesdeTexto(texto);
  return valido.ok ? ok(valido.valor) : err("DETALLE_REQUERIDO");
}

/** Las confirmaciones que acepta un comando: solo el control que declara el módulo (lista de permitidos). */
export function leerConfirmaciones(valor: unknown): R<readonly ControlDeStock[]> {
  if (valor === undefined) return ok([]);
  if (!Array.isArray(valor)) return err("IDENTIFICADOR_INVALIDO");
  const confirmaciones: ControlDeStock[] = [];
  for (const confirmacion of valor as unknown[]) {
    if (confirmacion !== CONTROL_DE_NEGATIVO) return err("IDENTIFICADOR_INVALIDO");
    confirmaciones.push(confirmacion);
  }
  return ok(confirmaciones);
}

/** Una cantidad en texto decimal con hasta 4 decimales, y mayor que cero (o también cero con `conCero`); si no, `CANTIDAD_INVALIDA`. */
export function leerCantidad(
  texto: unknown,
  conCero = false,
): Resultado<Cantidad, "CANTIDAD_INVALIDA"> {
  if (typeof texto !== "string") return err("CANTIDAD_INVALIDA");
  const leida = cantidadConSignoDesdeTexto(texto);
  if (!leida.ok || leida.valor.unidades < (conCero ? 0n : 1n)) return err("CANTIDAD_INVALIDA");
  return ok(cantidadDeUnidades(leida.valor.unidades));
}

/**
 * La lista de renglones que manda la pantalla: de 1 a `MAXIMO_DE_RENGLONES`, cada uno con producto (UUID), cantidad mayor que cero y una
 * unidad conocida. Un producto que no es UUID no tiene artículo (`ARTICULO_NO_CONTROLADO`); una unidad desconocida es un identificador malo.
 * `admiteCosto`: solo una entrada por compra o carga inicial declara `costoUnitario` (texto decimal, mayor que cero: `leerCostoDeclarado`);
 * en cualquier otro movimiento un costo mandado es `COSTO_INVALIDO` (el costo de lo que sale lo pone el promedio, no la persona).
 */
export function leerRenglones(valor: unknown, admiteCosto = false): R<readonly RenglonLeido[]> {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > MAXIMO_DE_RENGLONES) {
    return err("RENGLONES_INVALIDOS");
  }
  const leidos: RenglonLeido[] = [];
  for (const crudo of valor as unknown[]) {
    const renglon = (typeof crudo === "object" && crudo !== null ? crudo : {}) as Record<
      string,
      unknown
    >;
    const productoId = leerId(renglon["productoId"]);
    if (productoId === null) return err("ARTICULO_NO_CONTROLADO");
    const cantidad = leerCantidad(renglon["cantidad"]);
    if (!cantidad.ok) return cantidad;
    const unidadId = renglon["unidadId"];
    if (typeof unidadId !== "string" || !esUnidadConocida(unidadId)) {
      return err("IDENTIFICADOR_INVALIDO");
    }
    const declarado = renglon["costoUnitario"];
    let costoUnitario: PrecioUnitario | null = null;
    if (declarado !== undefined) {
      if (!admiteCosto) return err("COSTO_INVALIDO");
      const costo = leerCostoDeclarado(declarado);
      if (!costo.ok) return costo;
      costoUnitario = costo.valor;
    }
    leidos.push({ productoId, cantidad: cantidad.valor, unidadId, costoUnitario });
  }
  return ok(leidos);
}

/** Los renglones leídos como los entra a la huella: producto, cantidad normalizada y unidad (el orden lo ordena la huella). */
export const renglonesDeHuella = (leidos: readonly RenglonLeido[]) =>
  leidos.map((r) => {
    const base = [
      r.productoId,
      cantidadConSignoATexto(cantidadConSignoDesdeCantidad(r.cantidad)),
      r.unidadId,
    ] as const;
    // El costo entra a la huella SOLO si se declaró: mismo pedido con otro costo es otro pedido (`CLAVE_REUTILIZADA`), y un pedido sin costo
    // conserva la huella de siempre.
    return r.costoUnitario === null
      ? base
      : ([...base, precioUnitarioATexto(r.costoUnitario)] as const);
  });

/**
 * Lleva una cantidad a la unidad de stock de su artículo: la dimensión es la misma (`DIMENSION_DISTINTA`) y la conversión es EXACTA, nunca
 * redondea (`CONVERSION_NO_EXACTA`, D21); una cantidad que no entra en `numeric(18,4)` es `CANTIDAD_INVALIDA`. Lo usan los renglones de un
 * movimiento y lo contado en un conteo.
 */
export function aUnidadDeStock(
  cantidad: Cantidad,
  unidadId: CodigoDeUnidad,
  articulo: Pick<Articulo, "unidadDeStockId">,
): R<Cantidad> {
  if (!esUnidadConocida(articulo.unidadDeStockId)) {
    throw new RangeError(`unidad de stock desconocida en la base: ${articulo.unidadDeStockId}`);
  }
  const convertida = convertirCantidad(cantidad, unidadId, articulo.unidadDeStockId);
  if (convertida.ok) return convertida;
  return err(convertida.error === "FUERA_DE_RANGO" ? "CANTIDAD_INVALIDA" : convertida.error);
}

/**
 * Lleva cada renglón a la unidad de stock de su artículo: el artículo existe y está activo (`ARTICULO_NO_CONTROLADO`), la dimensión es
 * la misma (`DIMENSION_DISTINTA`) y la conversión es EXACTA, nunca redondea (`CONVERSION_NO_EXACTA`, D21); una cantidad que no entra en
 * `numeric(18,4)` es `CANTIDAD_INVALIDA`.
 */
export async function resolverRenglones(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  leidos: readonly RenglonLeido[],
): Promise<R<readonly RenglonResuelto[]>> {
  const articulos = await tx.articulosDeStock.porProductos(
    contexto.empresaId,
    leidos.map((r) => r.productoId),
  );
  const porProducto = new Map(articulos.map((a) => [a.productoId, a]));
  const resueltos: RenglonResuelto[] = [];
  for (const r of leidos) {
    const articulo = porProducto.get(r.productoId);
    if (articulo === undefined || !articulo.activo) return err("ARTICULO_NO_CONTROLADO");
    const convertida = aUnidadDeStock(r.cantidad, r.unidadId, articulo);
    if (!convertida.ok) return convertida;
    // El costo es por unidad de stock (SUPUESTO (DEC-0075) S-T10-3): con otra unidad habría que convertirlo y redondearlo, y eso es una decisión de dinero.
    if (r.costoUnitario !== null && r.unidadId !== articulo.unidadDeStockId) {
      return err("COSTO_INVALIDO");
    }
    resueltos.push({
      productoId: r.productoId,
      articuloId: articulo.id,
      cantidad: cantidadConSignoDesdeCantidad(convertida.valor),
      costoUnitario: r.costoUnitario,
    });
  }
  return ok(resueltos);
}

/** Un renglón del libro sin composición, con el signo de su movimiento: `entrada` suma, lo demás resta o suma según el caso. */
export const renglonDeLibro = (
  depositoId: string,
  articuloId: string,
  cantidad: CantidadConSigno,
): RenglonDeLibro => ({ depositoId, articuloId, composicionId: null, cantidad });

/**
 * El depósito del acto: existe, y su sucursal está en el alcance de quien pide (el operador, solo las suyas). Un id que no es UUID o un
 * depósito de otra empresa no existen para quien pide (la RLS). `inexistente` es el error que corresponde a ese rol del depósito.
 */
export async function cargarDeposito(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  id: unknown,
  inexistente:
    "DEPOSITO_NO_ENCONTRADO" | "DEPOSITO_DE_DESTINO_NO_ENCONTRADO" = "DEPOSITO_NO_ENCONTRADO",
): Promise<R<Deposito>> {
  const depositoId = leerId(id);
  if (depositoId === null) return err(inexistente);
  const deposito = await tx.depositos.obtener(contexto.empresaId, depositoId);
  if (deposito === null) return err(inexistente);
  const alcance = await exigirAlcanceDeSucursal(tx, contexto, deposito.sucursalId);
  if (!alcance.ok) return alcance;
  return ok(deposito);
}

/**
 * Cuándo ocurrió: `hechoEn` opcional, por defecto el `ahora` del contexto. No puede ser posterior al `ahora` (SUPUESTO (DEC-0076), `FECHA_FUTURA_NO_ADMITIDA`)
 * ni anterior al inicio de la jornada vigente de la sucursal del depósito (S-2, `FECHA_PASADA_NO_ADMITIDA`): como las jornadas son tramos
 * seguidos, equivale a que su fecha de negocio sea la de hoy (`fechaDeNegocio` de `primitivas/tiempo` con la zona de la empresa y el corte de la
 * sucursal, la misma fórmula que fija la base). Sin `hechoEn` no hace falta mirar la jornada.
 */
export async function comprobarFecha(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  deposito: Deposito,
  hechoEn: unknown,
): Promise<R<Date>> {
  if (hechoEn === undefined) return ok(contexto.ahora);
  if (!(hechoEn instanceof Date) || !(hechoEn.getTime() <= contexto.ahora.getTime())) {
    return err("FECHA_FUTURA_NO_ADMITIDA");
  }
  const datos = await datosDeJornada(tx, deposito.sucursalId);
  if (!datos.ok) return err("SUCURSAL_NO_ENCONTRADA");
  const hoy = fechaDeNegocio(contexto.ahora, datos.valor.zonaHoraria, datos.valor.horaDeCorte);
  // Una zona o un corte inválidos son una configuración rota (la base los valida al guardarlos): se frena, no se mueve stock en una jornada inventada.
  if (!hoy.ok)
    throw new Error(`la sucursal ${deposito.sucursalId} no se puede fechar: ${hoy.error}`);
  const pedida = fechaDeNegocio(hechoEn, datos.valor.zonaHoraria, datos.valor.horaDeCorte);
  return !pedida.ok || pedida.valor < hoy.valor ? err("FECHA_PASADA_NO_ADMITIDA") : ok(hechoEn);
}

const RESTRICCION_BLOQUEADA = "stock_existencia_negativa_bloqueada";
const RESTRICCION_SIN_CONFIRMAR = "stock_existencia_negativa_sin_confirmar";

/**
 * `traducir` de los comandos de movimientos, más los dos errores del control de existencia negativa que la base repite en el disparador
 * del renglón (`stock_existencia_negativa_*`). El caso de uso decide el control ANTES de escribir, con los saldos bloqueados y con el
 * detalle (`registrarMovimientoEnTx`); la base es la red de seguridad si alguien escribe sin pasar por ahí o cambió el nivel en medio:
 * como esa transacción ya está abortada no hay saldos que leer, así que el error sale con el detalle vacío. Cualquier otra restricción
 * sigue por `ERRORES_DE_STOCK_POR_RESTRICCION` (la cuarentena, `MOTIVO_NO_PERMITIDO`; el depósito inactivo, `DEPOSITO_INACTIVO`...).
 */
export function traducirMovimiento<T>(resultado: R<T>): R<T> {
  if (resultado.ok) return resultado;
  const error = resultado.error;
  if (typeof error === "object" && "tipo" in error && error.tipo === "Check") {
    if (error.restriccion === RESTRICCION_BLOQUEADA) {
      return err({ error: "CONTROL_BLOQUEA", control: CONTROL_DE_NEGATIVO, detalle: [] });
    }
    if (error.restriccion === RESTRICCION_SIN_CONFIRMAR) {
      return err({
        error: "CONTROL_REQUIERE_CONFIRMACION",
        control: CONTROL_DE_NEGATIVO,
        detalle: [],
      });
    }
  }
  return traducir(resultado);
}
