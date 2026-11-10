import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDeStock } from "./errores";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadConSignoDesdeTexto, negarConSigno } from "../../../primitivas/cantidad/con-signo";
import { err, ok } from "../../../primitivas/resultado/resultado";
import { huellaDeComando } from "../dominio/huella";
import {
  ORIGEN_EJEMPLAR_DE_TICKET,
  ORIGEN_RECEPCION,
  type RenglonDeLibro,
} from "../dominio/movimiento";
import type { TxDeStock } from "./contrato";
import { costosDeclaradosDe } from "./costos";
import { buscarRepeticion, registrarMovimientoEnTx } from "./movimiento-en-tx";
import {
  comprobarFecha,
  leerClave,
  leerDetalle,
  leerId,
  leerRenglones,
  renglonesDeHuella,
  resolverRenglones,
} from "./movimientos-comun";
import type {
  EntradaDeEntradaPorOrigen,
  EntradaDeReversionPorOrigen,
  SalidaDeEntradaPorOrigen,
  SalidaDeReversionPorOrigen,
} from "./tipos-de-puertos";
import { estadoDelModuloDeStock } from "./lectura-de-venta";
import { cargarDepositoNormal, claveDeLaReversionDeVenta } from "./salida-por-venta";

type R<S> = Resultado<S, ErrorDeStock>;

// ---- la reversión ----------------------------------------------------------------------------------------------------------------

/**
 * Revierte la salida de un ejemplar (E5 §3.3, `ReversionDeStock.revertirPorOrigen`): una anulación ESPEJO de la salida (mismo depósito, mismos
 * artículos y versiones de receta, cantidades opuestas y el MISMO costo congelado de la salida), con la clave
 * derivada `anulacion_venta_<ejemplarId>` y el mismo origen que la salida. Corre en la transacción del llamador y no autoriza. Sin salida
 * previa no hay nada que revertir: `habiaSalida: false`, sin error y sin escribir. Una sola anulación por movimiento: si ya estaba revertida
 * devuelve la existente con `yaExistia`. No mira si el módulo está activo: revertir lo ya descontado siempre se puede. Una anulación nunca se
 * bloquea por existencia negativa.
 */
export async function revertirPorOrigen(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  entrada: EntradaDeReversionPorOrigen,
): Promise<R<SalidaDeReversionPorOrigen>> {
  const origen = (typeof entrada.origen === "object" ? entrada.origen : null) as {
    tipo: unknown;
    id: unknown;
  } | null;
  const ejemplarId = leerId(origen?.id);
  if (origen === null || origen.tipo !== ORIGEN_EJEMPLAR_DE_TICKET || ejemplarId === null) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  const detalle = leerDetalle(entrada.detalle, true);
  if (!detalle.ok) return detalle;
  const salida = await tx.movimientosDeStock.porOrigen(
    contexto.empresaId,
    "SALIDA",
    ORIGEN_EJEMPLAR_DE_TICKET,
    ejemplarId,
  );
  if (salida === null) return ok({ anulacionId: null, habiaSalida: false, yaExistia: false });
  const previa = await tx.movimientosDeStock.anulacionDe(contexto.empresaId, salida.id);
  if (previa !== null) return ok({ anulacionId: previa.id, habiaSalida: true, yaExistia: true });

  const guardados = await tx.movimientosDeStock.renglonesDe(contexto.empresaId, salida.id);
  const espejo: RenglonDeLibro[] = guardados.map((r) => {
    const cantidad = cantidadConSignoDesdeTexto(r.cantidad);
    if (!cantidad.ok) throw new RangeError("stock: el renglón guardado no es una cantidad");
    return {
      depositoId: r.depositoId,
      articuloId: r.articuloId,
      composicionId: r.composicionId,
      cantidad: negarConSigno(cantidad.valor),
    };
  });
  const registrado = await registrarMovimientoEnTx(tx, contexto, {
    clase: "ANULACION",
    motivo: "ANULACION",
    detalle: detalle.valor,
    origen: { tipo: ORIGEN_EJEMPLAR_DE_TICKET, id: ejemplarId },
    depositoId: salida.depositoId,
    accion: entrada.accion,
    anulaA: salida.id,
    conteoId: null,
    clave: claveDeLaReversionDeVenta(ejemplarId),
    huella: huellaDeComando("reversion_de_venta", [ejemplarId, salida.id], []),
    hechoEn: contexto.ahora,
    fechaDeNegocio: null,
    renglones: espejo,
    confirmaciones: [],
  });
  if (!registrado.ok) return registrado;
  return ok({
    anulacionId: registrado.valor.movimiento.id,
    habiaSalida: true,
    yaExistia: registrado.valor.yaExistia,
  });
}

// ---- la entrada por origen ------------------------------------------------------------------------------------------------------

/**
 * La entrada de mercadería por origen (E5 §3.3, `EntradaPorOrigen.registrarEntrada`): la recepción de una compra (E9). Corre en la transacción del
 * llamador y no autoriza. La IDENTIDAD es el origen (la recepción): una segunda llamada de la misma recepción, aunque traiga otra clave, devuelve la
 * entrada existente con `yaExistia` (la base lo impone con el único de origen). El motivo es `COMPRA`; el depósito es de uso normal y está activo;
 * cantidades exactas en la unidad de stock (conversión exacta o rechazada). Cada renglón puede declarar `costoUnitario` (por unidad de stock, mayor
 * que cero; `COSTO_INVALIDO` si no): entra al promedio del depósito; sin él queda sin costo. Con el módulo apagado
 * devuelve el motivo y no escribe.
 */
export async function registrarEntradaPorOrigen(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  entrada: EntradaDeEntradaPorOrigen,
): Promise<R<SalidaDeEntradaPorOrigen>> {
  const estado = await estadoDelModuloDeStock(tx, contexto, reglas);
  if (estado !== "ACTIVO") return err(estado);
  const clave = leerClave(entrada.clave);
  if (!clave.ok) return clave;
  const origen = (typeof entrada.origen === "object" ? entrada.origen : null) as {
    tipo: unknown;
    id: unknown;
  } | null;
  const recepcionId = leerId(origen?.id);
  if (origen === null || origen.tipo !== ORIGEN_RECEPCION || recepcionId === null) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  if (entrada.motivo !== "COMPRA") return err("MOTIVO_NO_PERMITIDO");
  const leidos = leerRenglones(entrada.renglones, true);
  if (!leidos.ok) return leidos;
  const deposito = await cargarDepositoNormal(tx, contexto, entrada.depositoId);
  if (!deposito.ok) return deposito;

  const hechoEnPedido =
    entrada.hechoEn instanceof Date && !Number.isNaN(entrada.hechoEn.getTime())
      ? entrada.hechoEn.toISOString()
      : null;
  const huella = huellaDeComando(
    "entrada_por_origen",
    [deposito.valor.id, entrada.motivo, ORIGEN_RECEPCION, recepcionId, hechoEnPedido],
    renglonesDeHuella(leidos.valor),
  );
  const referencia = { tipo: ORIGEN_RECEPCION, id: recepcionId } as const;
  const repetido = await buscarRepeticion(tx, contexto, {
    clase: "ENTRADA",
    clave: clave.valor,
    huella,
    origen: referencia,
  });
  if (!repetido.ok) return repetido;
  if (repetido.valor !== null) return ok({ movimientoId: repetido.valor.id, yaExistia: true });

  const hechoEn = await comprobarFecha(tx, contexto, deposito.valor, entrada.hechoEn);
  if (!hechoEn.ok) return hechoEn;
  const resueltos = await resolverRenglones(tx, contexto, leidos.valor);
  if (!resueltos.ok) return resueltos;
  const registrado = await registrarMovimientoEnTx(tx, contexto, {
    clase: "ENTRADA",
    motivo: "COMPRA",
    detalle: null,
    origen: referencia,
    depositoId: deposito.valor.id,
    accion: entrada.accion,
    anulaA: null,
    conteoId: null,
    clave: clave.valor,
    huella,
    hechoEn: hechoEn.valor,
    fechaDeNegocio: null,
    renglones: resueltos.valor.map((r) => ({
      depositoId: deposito.valor.id,
      articuloId: r.articuloId,
      composicionId: null,
      cantidad: r.cantidad,
    })),
    confirmaciones: [],
    costos: costosDeclaradosDe(deposito.valor.id, resueltos.valor),
  });
  if (!registrado.ok) return registrado;
  return ok({
    movimientoId: registrado.valor.movimiento.id,
    yaExistia: registrado.valor.yaExistia,
  });
}
