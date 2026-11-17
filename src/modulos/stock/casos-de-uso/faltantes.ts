import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  cantidadConSignoDesdeTexto,
  negarConSigno,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import { decidirExistenciaNegativa, type DecisionDeNegativo } from "../dominio/control";
import { llaveDeSaldo } from "../persistencia/repositorio-de-movimientos";
import type { NivelDeControl } from "../../../capacidades/controles/nivel";
import { CONTROL_DE_NEGATIVO } from "./movimiento-en-tx";
import type { TxDeStock } from "./contrato";
import type { ControlDeStock } from "./errores";

/**
 * Qué faltaría para consumir algo de un depósito (E6 §3.2, `abrirOrden`): lee las existencias SIN bloquear, el nivel de `stock.existencia_negativa`
 * de la sucursal del depósito y decide con la misma función del libro (`decidirExistenciaNegativa`): una sola regla para «falta» y para «queda
 * negativo». No escribe nada: abrir una orden no mueve stock. `requeridos` son cantidades POSITIVAS en la unidad de stock (unidades mínimas).
 */
export type FaltanteDeUnaOrden = Readonly<{
  articuloId: string;
  /** Lo que hay en el depósito (texto decimal, puede ser negativo). */
  existencia: CantidadConSigno;
  /** Lo que quedaría (negativo). */
  existenciaResultante: CantidadConSigno;
}>;

export type EvaluacionDeFaltantes = Readonly<{
  decision: DecisionDeNegativo["resultado"];
  nivel: NivelDeControl;
  faltantes: readonly FaltanteDeUnaOrden[];
}>;

export async function evaluarFaltantes(
  tx: Pick<TxDeStock, "depositos" | "niveles" | "movimientosDeStock">,
  contexto: Pick<ContextoOperativo, "empresaId">,
  datos: Readonly<{
    depositoId: string;
    requeridos: readonly Readonly<{ articuloId: string; unidades: bigint }>[];
    confirmaciones: readonly ControlDeStock[];
  }>,
): Promise<EvaluacionDeFaltantes | null> {
  const deposito = await tx.depositos.obtener(contexto.empresaId, datos.depositoId);
  if (deposito === null) return null;
  const nivel = await tx.niveles.nivel(
    CONTROL_DE_NEGATIVO,
    { empresaId: contexto.empresaId, sucursalId: deposito.sucursalId },
    true,
  );
  const saldos = await tx.movimientosDeStock.leerSaldos(
    contexto.empresaId,
    datos.requeridos.map((r) => ({ depositoId: datos.depositoId, articuloId: r.articuloId })),
    false,
  );
  const confirmo = datos.confirmaciones.includes(CONTROL_DE_NEGATIVO);
  const existencias = new Map<string, CantidadConSigno>();
  const aControlar = datos.requeridos.map((r) => {
    const guardado = cantidadConSignoDesdeTexto(
      saldos.get(llaveDeSaldo(datos.depositoId, r.articuloId)) ?? "0",
    );
    if (!guardado.ok) throw new RangeError("stock: el saldo guardado no es una cantidad");
    existencias.set(r.articuloId, guardado.valor);
    const pedida = cantidadConSignoDesdeTexto(`-${unidadesATexto(r.unidades)}`);
    if (!pedida.ok) throw new RangeError("stock: la cantidad requerida no es una cantidad");
    return {
      depositoId: datos.depositoId,
      articuloId: r.articuloId,
      cantidad: pedida.valor,
      existenciaActual: guardado.valor,
      confirmoNegativo: confirmo,
    };
  });
  const decision = decidirExistenciaNegativa(nivel, "SALIDA", aControlar);
  return {
    decision: decision.resultado,
    nivel,
    faltantes: decision.negativos.map((n) => ({
      articuloId: n.articuloId,
      existencia: existencias.get(n.articuloId) ?? negarConSigno(n.existenciaResultante),
      existenciaResultante: n.existenciaResultante,
    })),
  };
}

const unidadesATexto = (unidades: bigint): string => {
  const digitos = unidades.toString().padStart(5, "0");
  return `${digitos.slice(0, -4)}.${digitos.slice(-4)}`;
};
