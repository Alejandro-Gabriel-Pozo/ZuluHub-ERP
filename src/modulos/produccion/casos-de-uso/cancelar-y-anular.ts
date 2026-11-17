import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadConSignoDesdeTexto } from "../../../primitivas/cantidad/con-signo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { motivoDeOrdenDeProduccionDesdeTexto } from "../../../primitivas/texto/motivo-de-orden-de-produccion";
import { anularPorEspejoEnTx, llaveDeSaldo, ORIGEN_TRANSFORMACION } from "../../stock/publico";
import { transicionar, yaEstaba as yaEstaEnElEstado } from "../dominio/orden";
import { huellaDeAnularOrden } from "../dominio/huella";
import { esUuid } from "../dominio/identificadores";
import { autorizar, exigirAlcanceDeLasDosSucursales, traducir } from "./comun";
import type { DependenciasDeProduccion, TxDeProduccion } from "./contrato";
import type { ErrorDeProduccion } from "./errores";

type R<S> = Resultado<S, ErrorDeProduccion>;

export type EntradaDeCancelarOrden = Readonly<{ ordenId: string; motivo: string }>;
export type SalidaDeCancelarOrden = Readonly<{ yaEstaba: boolean }>;
export type EntradaDeAnularOrden = Readonly<{ ordenId: string; motivo: string }>;
export type SalidaDeAnularOrden = Readonly<{ yaEstaba: boolean }>;

/** La orden con su bloqueo y las dos sucursales en el alcance (lo común de cancelar y anular). */
async function ordenDelAlcance(tx: TxDeProduccion, contexto: ContextoOperativo, ordenId: unknown) {
  if (typeof ordenId !== "string" || !esUuid(ordenId)) return err("ORDEN_NO_ENCONTRADA" as const);
  const orden = await tx.ordenesDeProduccion.bloquear(contexto.empresaId, ordenId.toLowerCase());
  if (orden === null) return err("ORDEN_NO_ENCONTRADA" as const);
  const origen = await tx.depositos.obtener(contexto.empresaId, orden.depositoId);
  const destino = await tx.depositos.obtener(contexto.empresaId, orden.depositoDestinoId);
  if (origen === null || destino === null) return err("DEPOSITO_NO_ENCONTRADO" as const);
  const alcance = await exigirAlcanceDeLasDosSucursales(tx, contexto, [
    origen.sucursalId,
    destino.sucursalId,
  ]);
  return alcance.ok ? ok(orden) : alcance;
}

/**
 * Cancelar una orden abierta (E6 §3.2): no movió nada, así que solo cambia el estado, con motivo. Guard `transformaciones.cancelar`, las dos
 * sucursales en el alcance. Toma la fila `FOR UPDATE`: cerrar y cancelar a la vez, gana una y la otra relee (`ORDEN_YA_CERRADA`, o `yaEstaba`).
 * Repetición (`YA_ESTABA`): ya cancelada devuelve `yaEstaba` sin escribir ni auditar. Una cerrada es `ORDEN_YA_CERRADA`; una anulada, `ORDEN_ANULADA`.
 */
export function armarCancelarOrden(dependencias: DependenciasDeProduccion) {
  return async function cancelarOrden(
    contexto: ContextoOperativo,
    entrada: EntradaDeCancelarOrden,
  ): Promise<R<SalidaDeCancelarOrden>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCancelarOrden>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "transformaciones.cancelar",
        ]);
        if (!permiso.ok) return permiso;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        const motivo =
          typeof entrada.motivo === "string"
            ? motivoDeOrdenDeProduccionDesdeTexto(entrada.motivo)
            : null;
        if (motivo === null || !motivo.ok) return err("MOTIVO_REQUERIDO");
        const orden = await ordenDelAlcance(tx, contexto, entrada.ordenId);
        if (!orden.ok) return orden;
        if (yaEstaEnElEstado(orden.valor.estado, "CANCELAR")) return ok({ yaEstaba: true });
        const transicion = transicionar(orden.valor.estado, "CANCELAR");
        if (!transicion.ok) return err(transicion.error);
        await tx.ordenesDeProduccion.cancelar(contexto.empresaId, orden.valor.id, {
          motivo: motivo.valor,
          por: persona,
          en: contexto.ahora,
        });
        await tx.auditoria.registrar({
          empresaId: contexto.empresaId,
          actorPersonaId: contexto.personaId,
          accion: "ORDEN_DE_PRODUCCION_CANCELADA",
          entidad: "orden_de_produccion",
          entidadId: orden.valor.id,
          antes: { estado: "ABIERTA" },
          despues: { estado: "CANCELADA", motivo: motivo.valor },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}

/**
 * Anular una orden cerrada (E6 §3.2, D95): deshace el consumo y el producto con dos anulaciones ESPEJO (mismos lotes y mismo costo congelado que los
 * originales, aunque el lote ya esté vencido: anular no se bloquea) y deja la orden `ANULADA`; el costo congelado y los movimientos originales
 * quedan como estaban. Guard `transformaciones.anular`, las dos sucursales en el alcance, motivo obligatorio. Si lo obtenido ya no está entero en
 * el depósito de destino (o en su lote), `PRODUCTO_YA_USADO` y no se toca nada (el saldo se bloquea antes de decidir: una venta del producto a la vez
 * espera o se repite). Repetición (`YA_ESTABA`): ya anulada devuelve `yaEstaba`; una abierta es `ORDEN_NO_CERRADA`, una cancelada `ORDEN_CANCELADA`.
 * La idempotencia es por estado (no hay clave guardada: la orden no la tiene y el espejo es único por movimiento).
 */
export function armarAnularOrden(dependencias: DependenciasDeProduccion) {
  return async function anularOrden(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularOrden,
  ): Promise<R<SalidaDeAnularOrden>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeAnularOrden>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "transformaciones.anular",
        ]);
        if (!permiso.ok) return permiso;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        const motivo =
          typeof entrada.motivo === "string"
            ? motivoDeOrdenDeProduccionDesdeTexto(entrada.motivo)
            : null;
        if (motivo === null || !motivo.ok) return err("MOTIVO_REQUERIDO");
        const encontrada = await ordenDelAlcance(tx, contexto, entrada.ordenId);
        if (!encontrada.ok) return encontrada;
        const orden = encontrada.valor;
        if (yaEstaEnElEstado(orden.estado, "ANULAR")) return ok({ yaEstaba: true });
        const transicion = transicionar(orden.estado, "ANULAR");
        if (!transicion.ok) return err(transicion.error);
        if (
          orden.movimientoDeConsumoId === null ||
          orden.movimientoDeProductoId === null ||
          orden.cantidadObtenida === null
        ) {
          throw new Error("producción: una orden cerrada sin sus movimientos");
        }
        const consumo = await tx.movimientosDeStock.obtener(empresaId, orden.movimientoDeConsumoId);
        const producto = await tx.movimientosDeStock.obtener(
          empresaId,
          orden.movimientoDeProductoId,
        );
        if (consumo === null || producto === null) {
          throw new Error("producción: los movimientos de una orden cerrada no están");
        }

        // ¿Lo obtenido sigue entero? Se bloquea el saldo del producto (y de su lote) ANTES de decidir.
        const obtenido = cantidadConSignoDesdeTexto(orden.cantidadObtenida);
        if (!obtenido.ok) throw new RangeError("producción: cantidad obtenida inválida");
        const saldos = await tx.movimientosDeStock.leerSaldos(
          empresaId,
          [{ depositoId: orden.depositoDestinoId, articuloId: orden.articuloId }],
          true,
        );
        const hay = cantidadConSignoDesdeTexto(
          saldos.get(llaveDeSaldo(orden.depositoDestinoId, orden.articuloId)) ?? "0",
        );
        if (!hay.ok) throw new RangeError("producción: el saldo guardado no es una cantidad");
        if (hay.valor.unidades < obtenido.valor.unidades) return err("PRODUCTO_YA_USADO");
        for (const l of await tx.lotesDeStock.renglonesDeLoteDe(empresaId, producto.id)) {
          const entro = cantidadConSignoDesdeTexto(l.cantidad);
          if (!entro.ok) throw new RangeError("producción: cantidad de lote inválida");
          const queda = await tx.lotesDeStock.bloquearSaldoDeLote(
            empresaId,
            l.depositoId,
            l.loteId,
          );
          if (queda < entro.valor.unidades) return err("PRODUCTO_YA_USADO");
        }

        const huella = huellaDeAnularOrden(orden.id, motivo.valor);
        const origen = { tipo: ORIGEN_TRANSFORMACION, id: orden.id } as const;
        const espejoDelProducto = await anularPorEspejoEnTx(tx, contexto, {
          movimiento: producto,
          accion: "transformaciones.anular",
          detalle: motivo.valor,
          clave: `anulacion-orden-${orden.id}-producto`,
          huella,
          origen,
        });
        if (!espejoDelProducto.ok) return espejoDelProducto;
        const espejoDelConsumo = await anularPorEspejoEnTx(tx, contexto, {
          movimiento: consumo,
          accion: "transformaciones.anular",
          detalle: motivo.valor,
          clave: `anulacion-orden-${orden.id}-consumo`,
          huella,
          origen,
        });
        if (!espejoDelConsumo.ok) return espejoDelConsumo;
        await tx.ordenesDeProduccion.anular(empresaId, orden.id, {
          motivo: motivo.valor,
          anulacionDeConsumoId: espejoDelConsumo.valor.movimiento.id,
          anulacionDeProductoId: espejoDelProducto.valor.movimiento.id,
          por: persona,
          en: contexto.ahora,
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "ORDEN_DE_PRODUCCION_ANULADA",
          entidad: "orden_de_produccion",
          entidadId: orden.id,
          antes: { estado: "CERRADA" },
          despues: { estado: "ANULADA", motivo: motivo.valor },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}
