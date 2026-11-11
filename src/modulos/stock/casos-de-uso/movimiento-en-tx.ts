import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { registroDeExcepcion } from "../../../capacidades/controles/decision";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeTexto,
  sumarConSigno,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { NivelDeControl } from "../../../capacidades/controles/nivel";
import { decidirExistenciaNegativa, type DecisionDeNegativo } from "../dominio/control";
import { decidirPorHuella } from "../dominio/huella";
import {
  comprobarCoherencia,
  ORIGEN_EJEMPLAR_DE_TICKET,
  ORIGEN_MANUAL,
  ORIGEN_RECEPCION,
  ordenarParaBloqueo,
  type ClaseDeMovimiento,
  type RenglonDeLibro,
} from "../dominio/movimiento";
import { buscarMotivo, origenCoherenteConElMotivo } from "../dominio/motivos";
import { esUuid } from "../persistencia/filas";
import type { Movimiento } from "../persistencia/modelo";
import { llaveDeSaldo } from "../persistencia/repositorio-de-movimientos";
import { costearMovimiento, type CostosDeclarados } from "./costos";
import type { TxDeStock } from "./contrato";
import type { ControlDeStock, DetalleDeNegativo, ErrorDeStock } from "./errores";

/** El único control que mira el libro (D125, declarado en `capacidades/controles`). */
export const CONTROL_DE_NEGATIVO: ControlDeStock = "stock.existencia_negativa";

/** Lo que identifica un movimiento que viene de otro módulo: el ejemplar de un ticket (ventas) o la recepción (compras). */
const ORIGENES_DE_OTRO_MODULO: readonly string[] = [ORIGEN_EJEMPLAR_DE_TICKET, ORIGEN_RECEPCION];

/**
 * Un movimiento ya resuelto, listo para escribir en el libro: lo arma un caso de uso (entrada, salida, transferencia, ajuste, anulación,
 * conteo) o un puerto (salida por venta, entrada por origen, reversión). La AUTORIZACIÓN y el ALCANCE los pone quien llama; acá solo se
 * guarda en `accion` la que lo causó.
 */
export type PedidoDeMovimiento = Readonly<{
  clase: ClaseDeMovimiento;
  /** Un motivo sembrado de esa clase (`motivos.ts`). */
  motivo: string;
  detalle: string | null;
  /** `null`: lo manual. Si no, el ejemplar del ticket o la recepción, con su id (UUID): es la identidad del movimiento. */
  origen: Readonly<{ tipo: string; id: string }> | null;
  /** El depósito del acto: el de origen en una transferencia. */
  depositoId: string;
  /** La acción de permiso con que el llamador autorizó este movimiento (queda guardada en el libro). */
  accion: ClaveAccion;
  anulaA: string | null;
  conteoId: string | null;
  /** Clave de idempotencia (8 a 200 caracteres `A-Za-z0-9_-`). */
  clave: string;
  /** sha256 hex del contenido canónico (`huellaDeComando`); sin el `hechoEn` que no mandó la persona. */
  huella: string;
  hechoEn: Date;
  /** SOLO la salida por venta la manda (la del ticket); en los demás va `null` y la fija la base. */
  fechaDeNegocio: string | null;
  /** Con signo, en la unidad de stock; en cualquier orden (se escriben en el orden canónico de bloqueos). */
  renglones: readonly RenglonDeLibro[];
  /** Los controles que la persona confirmó (`AVISAR`). */
  confirmaciones: readonly ControlDeStock[];
  /**
   * El costo unitario que declaró la entrada, por (depósito, artículo) (`llaveDeSaldo`). Solo lo usa una ENTRADA; sin costo declarado el renglón
   * queda `SIN_COSTO`. El resto de las clases toma su costo del promedio o del original (`costearMovimiento`).
   */
  costos?: CostosDeclarados | undefined;
}>;

export type MovimientoRegistrado = Readonly<{
  movimiento: Movimiento;
  /** `true`: ya estaba (misma clave y misma huella, o el mismo origen): no se escribió ni se auditó nada. */
  yaExistia: boolean;
  /** Los renglones que quedaron en negativo por un control que lo permitió (o que la persona confirmó). Vacío si ya existía. */
  excepciones: readonly DetalleDeNegativo[];
}>;

/**
 * ¿Este pedido ya se hizo? Con la clave: la misma huella es el mismo pedido (se devuelve lo hecho) y otra huella es una clave reutilizada.
 * Con el origen (una entrada o una salida de otro módulo): el primer hecho manda, aunque cambie la clave o el contenido (la base lo
 * impone con el único de origen). Lo usan los casos de uso ANTES de resolver artículos y fechas (una repetición no depende de cómo esté el
 * catálogo hoy) y `registrarMovimientoEnTx` otra vez, para quien lo llama sin haberlo hecho.
 */
export async function buscarRepeticion(
  tx: Pick<TxDeStock, "movimientosDeStock">,
  contexto: Pick<ContextoOperativo, "empresaId">,
  pedido: Readonly<{
    clase: ClaseDeMovimiento;
    clave: string;
    huella: string;
    origen: Readonly<{ tipo: string; id: string }> | null;
  }>,
): Promise<Resultado<Movimiento | null, "CLAVE_REUTILIZADA">> {
  const guardado = await tx.movimientosDeStock.porClave(contexto.empresaId, pedido.clave);
  if (guardado !== null) {
    return decidirPorHuella(guardado.huella, pedido.huella) === "REPETIDA"
      ? ok(guardado)
      : err("CLAVE_REUTILIZADA");
  }
  if (pedido.origen !== null && (pedido.clase === "ENTRADA" || pedido.clase === "SALIDA")) {
    return ok(
      await tx.movimientosDeStock.porOrigen(
        contexto.empresaId,
        pedido.clase,
        pedido.origen.tipo,
        pedido.origen.id,
      ),
    );
  }
  return ok(null);
}

const llaveDe = (depositoId: string, articuloId: string): string =>
  llaveDeSaldo(depositoId, articuloId);

function saldoComoCantidad(texto: string): CantidadConSigno {
  const leido = cantidadConSignoDesdeTexto(texto);
  if (!leido.ok) throw new RangeError("stock: el saldo guardado no es una cantidad");
  return leido.valor;
}

/**
 * Lee los saldos de los pares que toca el movimiento, BLOQUEÁNDOLOS (`FOR UPDATE`) en el orden canónico `(depósito, artículo)`, y decide
 * contra el nivel de `stock.existencia_negativa` de la sucursal del depósito del acto. Quien resta en el mismo par dos veces (dos versiones
 * de composición) ve la existencia que dejó el renglón anterior, igual que el disparador. Solo mira las salidas y la pata de origen de una
 * transferencia (`decidirExistenciaNegativa`).
 */
async function decidirControl(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  pedido: PedidoDeMovimiento,
  ordenados: readonly RenglonDeLibro[],
): Promise<
  Resultado<Readonly<{ decision: DecisionDeNegativo; nivel: NivelDeControl }>, ErrorDeStock>
> {
  const deposito = await tx.depositos.obtener(contexto.empresaId, pedido.depositoId);
  if (deposito === null) return err("DEPOSITO_NO_ENCONTRADO");
  // `true`: el control no depende del plan (no hay perilla) y la base lo aplica igual; ver el supuesto en el informe de E5-T5.
  const nivel = await tx.niveles.nivel(
    CONTROL_DE_NEGATIVO,
    { empresaId: contexto.empresaId, sucursalId: deposito.sucursalId },
    true,
  );
  const saldos = await tx.movimientosDeStock.leerSaldos(
    contexto.empresaId,
    ordenados.map((r) => ({ depositoId: r.depositoId, articuloId: r.articuloId })),
    true,
  );
  const confirmo = pedido.confirmaciones.includes(CONTROL_DE_NEGATIVO);
  const acumulado = new Map<string, CantidadConSigno>();
  const aControlar = ordenados.map((r) => {
    const llave = llaveDe(r.depositoId, r.articuloId);
    const existenciaActual = acumulado.get(llave) ?? saldoComoCantidad(saldos.get(llave) ?? "0");
    const suma = sumarConSigno(existenciaActual, r.cantidad);
    if (!suma.ok) throw new RangeError("stock: la existencia resultante se sale del rango");
    acumulado.set(llave, suma.valor);
    return {
      depositoId: r.depositoId,
      articuloId: r.articuloId,
      cantidad: r.cantidad,
      existenciaActual,
      confirmoNegativo: confirmo,
    };
  });
  return ok({ decision: decidirExistenciaNegativa(nivel, pedido.clase, aControlar), nivel });
}

/** Los saldos que quedarían (o quedaron) en negativo, con el producto de cada artículo, para el detalle de los errores del control. */
async function detalleDeNegativos(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  decision: DecisionDeNegativo,
): Promise<readonly DetalleDeNegativo[]> {
  const articulos = await tx.articulosDeStock.porIds(
    contexto.empresaId,
    decision.negativos.map((n) => n.articuloId),
  );
  const productoDe = new Map(articulos.map((a) => [a.id, a.productoId]));
  return decision.negativos.map((n) => ({
    productoId: productoDe.get(n.articuloId) ?? n.articuloId,
    depositoId: n.depositoId,
    existenciaResultante: cantidadConSignoATexto(n.existenciaResultante),
  }));
}

/**
 * Escribe UN movimiento del libro DENTRO de la transacción del llamador (la de un caso de uso de stock, o la de otro módulo como el cierre
 * de una cuenta: es lo que reutilizan la salida por venta, la reversión por origen y la entrada por origen). NO autoriza ni mira el
 * alcance: lo hizo quien llama, y deja en `accion` el permiso con que lo hizo. Hace, en este orden:
 *  1. repetición: misma clave y misma huella (o mismo origen) devuelve el movimiento anterior con `yaExistia: true` sin escribir ni
 *     auditar; misma clave con otra huella es `CLAVE_REUTILIZADA`;
 *  2. coherencia del pedido (motivo de la clase, origen, signos, sin renglones repetidos, transferencia entre dos depósitos y de suma cero);
 *  3. los renglones en el orden canónico de bloqueos `(depósito, artículo, composición)`, y el control de existencia negativa leyendo el
 *     nivel de la base (`PERMITIR` sin fila) con los saldos ya bloqueados: `CONTROL_BLOQUEA` o `CONTROL_REQUIERE_CONFIRMACION` rechazan el
 *     movimiento entero, con el detalle de los saldos;
 *  4. la cabecera y los renglones (el saldo lo aplica el disparador de la base, y el movimiento se verifica entero al confirmar);
 *  5. el costo de cada renglón y el promedio de cada par, en la misma transacción (`costearMovimiento`: costo declarado, promedio congelado,
 *     el de origen en una transferencia, el original en una anulación);
 *  6. por cada renglón que quedó en negativo porque el control lo permitió o la persona lo confirmó, un registro de auditoría en la misma
 *     transacción. El movimiento en sí NO se audita aparte: es su propio registro (solo inserción, con autor, acción y motivo).
 * Los errores de la base (una clave repetida por una carrera, un depósito inactivo, la cuarentena) salen como excepciones de la
 * transacción: el que arma la transacción las traduce con `traducirMovimiento`.
 */
export async function registrarMovimientoEnTx(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  pedido: PedidoDeMovimiento,
): Promise<Resultado<MovimientoRegistrado, ErrorDeStock>> {
  const persona = contexto.personaId;
  if (persona === null) return err("SIN_PERMISO");
  const origenTipo = pedido.origen === null ? ORIGEN_MANUAL : pedido.origen.tipo;
  if (
    pedido.origen !== null &&
    (!ORIGENES_DE_OTRO_MODULO.includes(pedido.origen.tipo) || !esUuid(pedido.origen.id))
  ) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  if (
    buscarMotivo(pedido.clase, pedido.motivo) === null ||
    !origenCoherenteConElMotivo(pedido.clase, pedido.motivo, origenTipo)
  ) {
    return err("MOTIVO_NO_PERMITIDO");
  }

  const repetido = await buscarRepeticion(tx, contexto, pedido);
  if (!repetido.ok) return repetido;
  if (repetido.valor !== null) {
    return ok({ movimiento: repetido.valor, yaExistia: true, excepciones: [] });
  }

  const coherente = comprobarCoherencia(pedido.clase, pedido.renglones);
  if (!coherente.ok) {
    switch (coherente.error) {
      case "SIN_RENGLONES":
        return err("RENGLONES_INVALIDOS");
      case "RENGLON_REPETIDO":
        return err("RENGLON_REPETIDO");
      case "TRANSFERENCIA_NO_ENTRE_DOS_DEPOSITOS":
        return err("TRANSFERENCIA_AL_MISMO_DEPOSITO");
      default:
        // Un signo que no es el de su clase o una transferencia que no suma cero la arma mal quien llama: es un defecto, no un error de la persona.
        throw new RangeError(
          `stock: el pedido del movimiento no es coherente (${coherente.error})`,
        );
    }
  }
  const ordenados = ordenarParaBloqueo(pedido.renglones);

  let decision: DecisionDeNegativo = { resultado: "PASA", negativos: [] };
  let nivelVigente: NivelDeControl = "PERMITIR";
  if (pedido.clase === "SALIDA" || pedido.clase === "TRANSFERENCIA") {
    const decidido = await decidirControl(tx, contexto, pedido, ordenados);
    if (!decidido.ok) return decidido;
    decision = decidido.valor.decision;
    nivelVigente = decidido.valor.nivel;
    if (decision.resultado === "BLOQUEA" || decision.resultado === "REQUIERE_CONFIRMACION") {
      return err({
        error:
          decision.resultado === "BLOQUEA" ? "CONTROL_BLOQUEA" : "CONTROL_REQUIERE_CONFIRMACION",
        control: CONTROL_DE_NEGATIVO,
        detalle: await detalleDeNegativos(tx, contexto, decision),
      });
    }
  }
  const confirmados = new Set(
    decision.negativos.filter((n) => n.confirmado).map((n) => llaveDe(n.depositoId, n.articuloId)),
  );
  const movimiento = await tx.movimientosDeStock.registrar(
    contexto.empresaId,
    {
      clase: pedido.clase,
      motivo: pedido.motivo,
      detalle: pedido.detalle,
      origenTipo,
      origenId: pedido.origen === null ? null : pedido.origen.id,
      depositoId: pedido.depositoId,
      accion: pedido.accion,
      anulaA: pedido.anulaA,
      conteoId: pedido.conteoId,
      clave: pedido.clave,
      huella: pedido.huella,
      hechoEn: pedido.hechoEn,
      fechaDeNegocio: pedido.fechaDeNegocio,
      registradoPor: persona,
    },
    ordenados.map((r) => ({
      depositoId: r.depositoId,
      articuloId: r.articuloId,
      cantidad: cantidadConSignoATexto(r.cantidad),
      composicionId: r.composicionId,
      confirmoNegativo: confirmados.has(llaveDe(r.depositoId, r.articuloId)),
    })),
  );

  await costearMovimiento(tx, contexto.empresaId, {
    movimientoId: movimiento.id,
    clase: pedido.clase,
    anulaA: pedido.anulaA,
    renglones: ordenados,
    declarados: pedido.costos ?? new Map(),
  });

  const excepciones =
    decision.negativos.length === 0 ? [] : await detalleDeNegativos(tx, contexto, decision);
  // Con un control que permite (o avisa y se confirmó) cada renglón que queda en negativo es una excepción y queda en la auditoría.
  if (nivelVigente !== "BLOQUEAR") {
    for (const [indice, negativo] of decision.negativos.entries()) {
      const registro = registroDeExcepcion(
        {
          control: CONTROL_DE_NEGATIVO,
          nivel: nivelVigente,
          confirmado: pedido.confirmaciones.includes(CONTROL_DE_NEGATIVO),
        },
        { entidad: "movimiento_de_stock", entidadId: movimiento.id },
      );
      await tx.auditoria.registrar({
        empresaId: contexto.empresaId,
        actorPersonaId: persona,
        accion: registro.accion,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        despues: {
          ...registro.despues,
          depositoId: negativo.depositoId,
          productoId: excepciones[indice]?.productoId ?? negativo.articuloId,
          existenciaResultante: cantidadConSignoATexto(negativo.existenciaResultante),
        },
      });
    }
  }
  return ok({ movimiento, yaExistia: false, excepciones });
}
