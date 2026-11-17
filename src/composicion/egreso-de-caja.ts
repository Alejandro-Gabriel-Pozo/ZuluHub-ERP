import { cajaParaCompras } from "../modulos/caja/publico";
import type { ErrorAlAnularEgreso, ErrorAlEgresar, TxDeCaja } from "../modulos/caja/publico";
import type { CodigoDeEgresoDeCaja, EgresoDeCaja, TxDeCompras } from "../modulos/compras/publico";

/**
 * El egreso de efectivo de caja para compras (E9 T10b, D-E9-7): compras declara el puerto y esta composición lo implementa con caja, que compras no puede
 * importar. La transacción de compras es, en la aplicación, la compuesta (`TxDeApp`), que además trae los repositorios de caja sobre la MISMA conexión: por eso el
 * pago y el egreso son una sola transacción. Si por un defecto de armado no los trae, se aborta antes de escribir (nunca se paga sin descontar).
 * Los errores de caja se traducen a los códigos de compras; lo que caja no distingue para esta operación (importe o motivo mal formados) es `EGRESO_DE_CAJA_RECHAZADO`.
 */
const PIEZAS_DE_CAJA = ["movimientos", "sesiones", "cajas", "mediosDePago", "cobros"] as const;

function comoTxDeCaja(tx: TxDeCompras): TxDeCaja {
  for (const pieza of PIEZAS_DE_CAJA) {
    if (!Object.hasOwn(tx, pieza)) {
      throw new Error(`la transacción de compras no trae la pieza de caja «${pieza}»`);
    }
  }
  return tx as unknown as TxDeCaja;
}

function codigoDeEgreso(error: ErrorAlEgresar): CodigoDeEgresoDeCaja {
  if (typeof error === "object") {
    return error.codigo === "SIN_SESION_ABIERTA" ? "SIN_SESION_ABIERTA" : "CAJA_EN_CIERRE";
  }
  switch (error) {
    case "CAJA_NO_ENCONTRADA":
    case "CAJA_INACTIVA":
    case "CAJA_DE_OTRA_SUCURSAL":
    case "CLAVE_REUTILIZADA":
    case "SIN_PERMISO":
      return error;
    case "JORNADA_EN_AUDITORIA":
    case "JORNADA_CERRADA":
      return "JORNADA_DE_CAJA_NO_ABIERTA";
    default:
      return "EGRESO_DE_CAJA_RECHAZADO";
  }
}

function codigoDeAnulacion(error: ErrorAlAnularEgreso): CodigoDeEgresoDeCaja {
  return error === "SIN_PERMISO" ? "SIN_PERMISO" : "EGRESO_DE_CAJA_NO_ANULABLE";
}

export function crearEgresoDeCaja(): EgresoDeCaja {
  return {
    async registrar(tx, contexto, entrada) {
      const r = await cajaParaCompras.registrarEgresoEnTx(comoTxDeCaja(tx), contexto, {
        cajaId: entrada.cajaId,
        sucursalId: entrada.sucursalId,
        origen: { tipo: "PAGO_A_PROVEEDOR", id: entrada.pagoId },
        importe: { moneda: "ARS", monto: entrada.importe },
        motivo: entrada.motivo,
      });
      return r.ok
        ? { ok: true, valor: { movimientoId: r.valor.movimientoId, yaExistia: r.valor.yaExistia } }
        : { ok: false, error: codigoDeEgreso(r.error) };
    },
    async anular(tx, contexto, entrada) {
      const r = await cajaParaCompras.anularEgresoEnTx(comoTxDeCaja(tx), contexto, {
        origen: { tipo: "PAGO_A_PROVEEDOR", id: entrada.pagoId },
        motivo: entrada.motivo,
      });
      return r.ok
        ? { ok: true, valor: { anulacionId: r.valor.anulacionId } }
        : { ok: false, error: codigoDeAnulacion(r.error) };
    },
  };
}
