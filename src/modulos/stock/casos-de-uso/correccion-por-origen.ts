import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { negarConSigno } from "../../../primitivas/cantidad/con-signo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { huellaDeComando } from "../dominio/huella";
import { MOTIVO_DE_CORRECCION_DE_RECEPCION } from "../dominio/motivos";
import { ORIGEN_CORRECCION_DE_RECEPCION } from "../dominio/movimiento";
import type { TxDeStock } from "./contrato";
import { costosDeclaradosDe } from "./costos";
import type { ErrorDeStock } from "./errores";
import { estadoDelModuloDeStock } from "./lectura-de-venta";
import { buscarRepeticion, registrarMovimientoEnTx } from "./movimiento-en-tx";
import {
  cargarDeposito,
  comprobarFecha,
  leerClave,
  leerConfirmaciones,
  leerId,
  leerRenglones,
  renglonDeLibro,
  renglonesDeHuella,
  resolverRenglones,
} from "./movimientos-comun";
import { cargarDepositoDeEntrada } from "./salida-por-venta";
import type {
  EntradaDeCorreccionDeRecepcion,
  SalidaDeCorreccionDeRecepcion,
} from "./tipos-de-puertos";

type R<S> = Resultado<S, ErrorDeStock>;

/**
 * La entrada o la salida de stock por la corrección de lo recibido de una recepción separada (E9 N3, `CorreccionDeRecepcion.registrar`): corre en la transacción del llamador y no autoriza
 * (la acción de compras que corrige queda guardada en el libro). La IDENTIDAD es el origen (la corrección): una segunda llamada de la misma corrección, aunque traiga otra clave, devuelve el
 * movimiento existente con `yaExistia` (lo impone el único de origen de la base). El motivo es `CORRECCION_DE_RECEPCION`; el depósito está activo (y la salida, en el alcance de quien corrige);
 * cantidades exactas en la unidad de stock. La entrada puede declarar el costo de la línea; la salida sale al promedio vigente (lo ya vendido conserva su costo) y el control
 * `stock.existencia_negativa` decide si se puede sacar más de lo que hay. Con el módulo apagado devuelve el motivo y no escribe.
 */
export async function registrarCorreccionDeRecepcion(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  entrada: EntradaDeCorreccionDeRecepcion,
): Promise<R<SalidaDeCorreccionDeRecepcion>> {
  const estado = await estadoDelModuloDeStock(tx, contexto, reglas);
  if (estado !== "ACTIVO") return err(estado);
  const clave = leerClave(entrada.clave);
  if (!clave.ok) return clave;
  const origen = (typeof entrada.origen === "object" ? entrada.origen : null) as {
    tipo: unknown;
    id: unknown;
  } | null;
  const correccionId = leerId(origen?.id);
  if (origen === null || origen.tipo !== ORIGEN_CORRECCION_DE_RECEPCION || correccionId === null) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  const sentido = entrada.sentido;
  if (sentido !== "ENTRADA" && sentido !== "SALIDA") return err("IDENTIFICADOR_INVALIDO");
  const confirmaciones = leerConfirmaciones(entrada.confirmaciones);
  if (!confirmaciones.ok) return confirmaciones;
  const leidos = leerRenglones(entrada.renglones, sentido === "ENTRADA");
  if (!leidos.ok) return leidos;
  const deposito =
    sentido === "ENTRADA"
      ? await cargarDepositoDeEntrada(tx, contexto, entrada.depositoId)
      : await cargarDeposito(tx, contexto, entrada.depositoId);
  if (!deposito.ok) return deposito;
  if (!deposito.valor.activo) return err("DEPOSITO_INACTIVO");

  const hechoEnPedido =
    entrada.hechoEn instanceof Date && !Number.isNaN(entrada.hechoEn.getTime())
      ? entrada.hechoEn.toISOString()
      : null;
  const huella = huellaDeComando(
    "correccion_de_recepcion",
    [deposito.valor.id, sentido, ORIGEN_CORRECCION_DE_RECEPCION, correccionId, hechoEnPedido],
    renglonesDeHuella(leidos.valor),
  );
  const referencia = { tipo: ORIGEN_CORRECCION_DE_RECEPCION, id: correccionId } as const;
  const repetido = await buscarRepeticion(tx, contexto, {
    clase: sentido,
    clave: clave.valor,
    huella,
    origen: referencia,
  });
  if (!repetido.ok) return repetido;
  if (repetido.valor !== null) {
    return ok({ movimientoId: repetido.valor.id, yaExistia: true, excepciones: [] });
  }

  const hechoEn = await comprobarFecha(tx, contexto, deposito.valor, entrada.hechoEn);
  if (!hechoEn.ok) return hechoEn;
  const resueltos = await resolverRenglones(tx, contexto, leidos.valor);
  if (!resueltos.ok) return resueltos;
  const registrado = await registrarMovimientoEnTx(tx, contexto, {
    clase: sentido,
    motivo: MOTIVO_DE_CORRECCION_DE_RECEPCION,
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
      renglonDeLibro(
        deposito.valor.id,
        r.articuloId,
        sentido === "ENTRADA" ? r.cantidad : negarConSigno(r.cantidad),
      ),
    ),
    confirmaciones: confirmaciones.valor,
    ...(sentido === "ENTRADA"
      ? { costos: costosDeclaradosDe(deposito.valor.id, resueltos.valor) }
      : {}),
  });
  if (!registrado.ok) return registrado;
  return ok({
    movimientoId: registrado.valor.movimiento.id,
    yaExistia: registrado.valor.yaExistia,
    excepciones: registrado.valor.excepciones,
  });
}
