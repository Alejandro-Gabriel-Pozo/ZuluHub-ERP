import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadConSignoDesdeTexto, negarConSigno } from "../../../primitivas/cantidad/con-signo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { huellaDeComando } from "../dominio/huella";
import { MOTIVO_DE_DEVOLUCION_A_PROVEEDOR } from "../dominio/motivos";
import { ORIGEN_DEVOLUCION_A_PROVEEDOR, type RenglonDeLibro } from "../dominio/movimiento";
import type { TxDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";
import { estadoDelModuloDeStock } from "./lectura-de-venta";
import { buscarRepeticion, registrarMovimientoEnTx } from "./movimiento-en-tx";
import {
  cargarDeposito,
  comprobarFecha,
  leerClave,
  leerConfirmaciones,
  leerDetalle,
  leerId,
  leerRenglones,
  renglonDeLibro,
  renglonesDeHuella,
  resolverRenglones,
} from "./movimientos-comun";
import type {
  EntradaDeAnulacionPorOrigen,
  EntradaDeSalidaPorOrigen,
  SalidaDeAnulacionPorOrigen,
  SalidaDeSalidaPorOrigen,
} from "./tipos-de-puertos";

type R<S> = Resultado<S, ErrorDeStock>;

/** La clave de la anulación espejo de la salida de una devolución (una sola por devolución). */
export const claveDeLaAnulacionDeLaDevolucion = (devolucionId: string): string =>
  `anulacion_devolucion_${devolucionId}`;

function leerOrigen(valor: unknown): string | null {
  const origen = (typeof valor === "object" ? valor : null) as {
    tipo: unknown;
    id: unknown;
  } | null;
  return origen !== null && origen.tipo === ORIGEN_DEVOLUCION_A_PROVEEDOR
    ? leerId(origen.id)
    : null;
}

/**
 * La salida de mercadería por devolución al proveedor (E9 N4, `SalidaPorOrigen.registrarSalida`): corre en la transacción del llamador y no autoriza (la acción de compras que devuelve queda
 * guardada en el libro). La IDENTIDAD es el origen (la devolución): una segunda llamada de la misma devolución, aunque traiga otra clave, devuelve la salida existente con `yaExistia` (lo impone el
 * único de origen de la base). El motivo es `DEVOLUCION_A_PROVEEDOR`; el depósito es de cualquier uso (la base deja salir por devolución de cuarentena y de rechazo), está activo y en el alcance de quien
 * devuelve; cantidades exactas en la unidad de stock; el control `stock.existencia_negativa` decide si se puede devolver más de lo que hay (`PERMITIR` audita, `AVISAR` pide confirmación).
 * Con el módulo apagado devuelve el motivo y no escribe (la devolución sin stock no existe).
 */
export async function registrarSalidaPorOrigen(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  entrada: EntradaDeSalidaPorOrigen,
): Promise<R<SalidaDeSalidaPorOrigen>> {
  const estado = await estadoDelModuloDeStock(tx, contexto, reglas);
  if (estado !== "ACTIVO") return err(estado);
  const clave = leerClave(entrada.clave);
  if (!clave.ok) return clave;
  const devolucionId = leerOrigen(entrada.origen);
  if (devolucionId === null) return err("IDENTIFICADOR_INVALIDO");
  if (entrada.motivo !== MOTIVO_DE_DEVOLUCION_A_PROVEEDOR) return err("MOTIVO_NO_PERMITIDO");
  const confirmaciones = leerConfirmaciones(entrada.confirmaciones);
  if (!confirmaciones.ok) return confirmaciones;
  const leidos = leerRenglones(entrada.renglones);
  if (!leidos.ok) return leidos;
  const deposito = await cargarDeposito(tx, contexto, entrada.depositoId);
  if (!deposito.ok) return deposito;
  if (!deposito.valor.activo) return err("DEPOSITO_INACTIVO");

  const hechoEnPedido =
    entrada.hechoEn instanceof Date && !Number.isNaN(entrada.hechoEn.getTime())
      ? entrada.hechoEn.toISOString()
      : null;
  const huella = huellaDeComando(
    "salida_por_origen",
    [deposito.valor.id, entrada.motivo, ORIGEN_DEVOLUCION_A_PROVEEDOR, devolucionId, hechoEnPedido],
    renglonesDeHuella(leidos.valor),
  );
  const referencia = { tipo: ORIGEN_DEVOLUCION_A_PROVEEDOR, id: devolucionId } as const;
  const repetido = await buscarRepeticion(tx, contexto, {
    clase: "SALIDA",
    clave: clave.valor,
    huella,
    origen: referencia,
  });
  if (!repetido.ok) return repetido;
  if (repetido.valor !== null) {
    return ok({
      movimientoId: repetido.valor.id,
      yaExistia: true,
      excepciones: [],
      renglones: await renglonesDe(tx, contexto, repetido.valor.id),
    });
  }

  const hechoEn = await comprobarFecha(tx, contexto, deposito.valor, entrada.hechoEn);
  if (!hechoEn.ok) return hechoEn;
  const resueltos = await resolverRenglones(tx, contexto, leidos.valor);
  if (!resueltos.ok) return resueltos;
  const registrado = await registrarMovimientoEnTx(tx, contexto, {
    clase: "SALIDA",
    motivo: MOTIVO_DE_DEVOLUCION_A_PROVEEDOR,
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
    renglones: resueltos.valor.map((r) =>
      renglonDeLibro(deposito.valor.id, r.articuloId, negarConSigno(r.cantidad)),
    ),
    confirmaciones: confirmaciones.valor,
  });
  if (!registrado.ok) return registrado;
  return ok({
    movimientoId: registrado.valor.movimiento.id,
    yaExistia: registrado.valor.yaExistia,
    excepciones: registrado.valor.excepciones,
    renglones: await renglonesDe(tx, contexto, registrado.valor.movimiento.id),
  });
}

async function renglonesDe(tx: TxDeStock, contexto: ContextoOperativo, movimientoId: string) {
  const guardados = await tx.movimientosDeStock.renglonesDe(contexto.empresaId, movimientoId);
  return guardados.map((r) => ({
    numero: r.numero,
    depositoId: r.depositoId,
    articuloId: r.articuloId,
  }));
}

/**
 * Anula la salida de una devolución (`SalidaPorOrigen.anular`): una anulación ESPEJO (mismo depósito y artículos, cantidades opuestas y el MISMO costo congelado de la salida), con la clave derivada
 * `anulacion_devolucion_<id>` y el mismo origen. Corre en la transacción del llamador y no autoriza. Sin salida previa no hay nada que anular: `habiaSalida: false`, sin error y sin escribir. Una sola
 * anulación por movimiento: si ya estaba anulada devuelve la existente con `yaExistia`. No mira si el módulo está activo (anular lo ya descontado siempre se puede) y una anulación nunca se bloquea
 * por existencia negativa.
 */
export async function anularSalidaPorOrigen(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  entrada: EntradaDeAnulacionPorOrigen,
): Promise<R<SalidaDeAnulacionPorOrigen>> {
  const devolucionId = leerOrigen(entrada.origen);
  if (devolucionId === null) return err("IDENTIFICADOR_INVALIDO");
  const detalle = leerDetalle(entrada.detalle, true);
  if (!detalle.ok) return detalle;
  const salida = await tx.movimientosDeStock.porOrigen(
    contexto.empresaId,
    "SALIDA",
    ORIGEN_DEVOLUCION_A_PROVEEDOR,
    devolucionId,
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
    origen: { tipo: ORIGEN_DEVOLUCION_A_PROVEEDOR, id: devolucionId },
    depositoId: salida.depositoId,
    accion: entrada.accion,
    anulaA: salida.id,
    conteoId: null,
    clave: claveDeLaAnulacionDeLaDevolucion(devolucionId),
    huella: huellaDeComando("anulacion_de_devolucion", [devolucionId, salida.id], []),
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
