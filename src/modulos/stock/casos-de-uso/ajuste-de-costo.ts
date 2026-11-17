import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import { cantidadATexto, cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { corregirPromedio, ESTADO_DE_COSTO_INICIAL, type EstadoDeCosto } from "../dominio/costo";
import { llaveDeSaldo } from "../persistencia/repositorio-de-movimientos";
import type { TxDeStock } from "./contrato";
import { estadoDesdeGuardado, leerCostoDeclarado } from "./costos";
import type { ErrorDeStock } from "./errores";
import { estadoDelModuloDeStock } from "./lectura-de-venta";
import { leerId } from "./movimientos-comun";

type R<S> = Resultado<S, ErrorDeStock>;

export const ORIGEN_CORRECCION_DE_COMPRA = "CORRECCION_DE_COMPRA";

/** Lo que pide el ajuste del costo de una compra corregida (E9 T11): el depósito y el producto de la línea, el costo de antes y de ahora, y lo que entró. */
export type EntradaDeAjusteDeCosto = Readonly<{
  origen: Readonly<{ tipo: typeof ORIGEN_CORRECCION_DE_COMPRA; id: string }>;
  depositoId: string;
  productoId: string;
  /** Costo por unidad de stock con el que entró la compra (texto decimal, hasta 6 decimales); `null` si entró sin costo. */
  costoAnterior: string | null;
  /** El costo corregido, mayor que cero. */
  costoNuevo: string;
  /** Lo que entró con esa compra, en la unidad de stock (texto decimal, hasta 4 decimales), mayor que cero. */
  cantidadQueEntro: string;
}>;

export type SalidaDeAjusteDeCosto = Readonly<{
  /** El promedio del depósito antes y después (`null` si el par nunca tuvo costo). */
  costoAntes: string | null;
  costoDespues: string | null;
  /** Cuánto se estimó que queda de esa compra (el menor entre lo que entró y lo que hay): sobre eso se aplicó la diferencia. */
  cantidadQueQueda: string;
}>;

const LEER_CANTIDAD = (valor: unknown) => {
  if (typeof valor !== "string") return null;
  try {
    const cantidad = cantidadDesdeTexto(valor);
    return cantidad.unidades > 0n ? cantidad : null;
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
};

/**
 * El ajuste de costo de una compra corregida (E9 T11, D-E9-3, fórmula A de la P-2): corre en la transacción del llamador y no autoriza (el permiso es el de la
 * acción de compras). Toma la existencia y el estado del costo del par (depósito, artículo) bloqueándolos en ese orden, igual que cualquier movimiento, y aplica
 * `corregirPromedio`: la diferencia de costo sobre lo que queda de la compra; LO YA CONSUMIDO CONSERVA SU COSTO CONGELADO (no se reescribe ningún renglón del libro).
 * No tiene clave propia: el llamador la protege con la clave de su corrección (una sola vez por corrección). Deja la auditoría `COSTO_AJUSTADO` con el antes y el
 * después. Con el módulo apagado, un depósito o artículo que no existe o una forma inválida devuelve el motivo y no escribe.
 */
export async function ajustarCostoPorOrigen(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  entrada: EntradaDeAjusteDeCosto,
): Promise<R<SalidaDeAjusteDeCosto>> {
  const estadoDelModulo = await estadoDelModuloDeStock(tx, contexto, reglas);
  if (estadoDelModulo !== "ACTIVO") return err(estadoDelModulo);
  if (contexto.personaId === null) return err("SIN_PERMISO");
  const origenId = leerId(entrada.origen.id);
  const depositoId = leerId(entrada.depositoId);
  const productoId = leerId(entrada.productoId);
  if (
    entrada.origen.tipo !== ORIGEN_CORRECCION_DE_COMPRA ||
    origenId === null ||
    depositoId === null ||
    productoId === null
  ) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  const costoNuevo = leerCostoDeclarado(entrada.costoNuevo);
  if (!costoNuevo.ok) return costoNuevo;
  const costoAnterior =
    entrada.costoAnterior === null ? ok(null) : leerCostoDeclarado(entrada.costoAnterior);
  if (!costoAnterior.ok) return costoAnterior;
  const cantidadQueEntro = LEER_CANTIDAD(entrada.cantidadQueEntro);
  if (cantidadQueEntro === null) return err("CANTIDAD_INVALIDA");

  const articulo = await tx.articulosDeStock.porProducto(contexto.empresaId, productoId);
  if (articulo === null) return err("ARTICULO_NO_CONTROLADO");
  const deposito = await tx.depositos.obtener(contexto.empresaId, depositoId);
  if (deposito === null) return err("DEPOSITO_NO_ENCONTRADO");
  const par = { depositoId, articuloId: articulo.id };
  const saldos = await tx.movimientosDeStock.leerSaldos(contexto.empresaId, [par], true);
  const existencia = cantidadDesdeTexto(saldos.get(llaveDeSaldo(depositoId, articulo.id)) ?? "0");
  const guardados = await tx.costosDeStock.bloquearEstados(contexto.empresaId, [par]);
  const guardado = guardados.get(llaveDeSaldo(depositoId, articulo.id));
  const antes: EstadoDeCosto =
    guardado === undefined ? ESTADO_DE_COSTO_INICIAL : estadoDesdeGuardado(guardado);

  const despues = corregirPromedio(antes, {
    costoAnterior: costoAnterior.valor,
    costoNuevo: costoNuevo.valor,
    cantidadQueEntro,
    existenciaActual: existencia,
  });
  if (!despues.ok) return err("COSTO_INVALIDO");
  const cantidadQueQueda =
    cantidadQueEntro.unidades < existencia.unidades ? cantidadQueEntro : existencia;
  if (despues.valor !== antes) {
    const nuevo = {
      // Un estado cambiado siempre tiene promedio: la corrección no lo borra y una entrada con costo lo crea.
      costoUnitario: precioUnitarioATexto(
        despues.valor.promedio as NonNullable<typeof despues.valor.promedio>,
      ),
      cantidadValorizada: cantidadATexto(despues.valor.cantidadValorizada),
    };
    if (guardado === undefined) await tx.costosDeStock.crearEstado(contexto.empresaId, par, nuevo);
    else await tx.costosDeStock.cambiarEstado(contexto.empresaId, par, nuevo);
  }
  const texto = (e: EstadoDeCosto) =>
    e.promedio === null ? null : precioUnitarioATexto(e.promedio);
  const salida = {
    costoAntes: texto(antes),
    costoDespues: texto(despues.valor),
    cantidadQueQueda: cantidadATexto(cantidadQueQueda),
  };
  await tx.auditoria.registrar({
    empresaId: contexto.empresaId,
    actorPersonaId: contexto.personaId,
    accion: "COSTO_AJUSTADO",
    entidad: "costo_de_articulo",
    entidadId: articulo.id,
    antes: { costoUnitario: salida.costoAntes },
    despues: {
      depositoId,
      origenTipo: entrada.origen.tipo,
      origenId,
      costoDespues: salida.costoDespues,
      costoAnterior: entrada.costoAnterior,
      costoNuevo: entrada.costoNuevo,
      cantidadQueQueda: salida.cantidadQueQueda,
    },
  });
  return ok(salida);
}
