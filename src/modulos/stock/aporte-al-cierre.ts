import { createHash } from "node:crypto";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import {
  MAXIMO_DE_REFERENCIAS,
  type AporteAlCierreDelDia,
  type ControlDelDia,
  type ErrorDeAporte,
  type JornadaRef,
} from "../cierre/publico";
import { situacionDeVencimiento } from "./dominio/vencimientos";
import type { LecturasDeLotes } from "./persistencia/lecturas-de-lotes";
import type { LecturasDelLibro } from "./persistencia/lecturas-del-libro";
import type { RepositorioDeConteos } from "./persistencia/repositorio-de-conteos";

/**
 * LO QUE STOCK REVISA AL CIERRE DEL DÍA (E5 §3.3; D163; E6 §3.5): implementa `AporteAlCierreDelDia` de `cierre`, que la composición registra (`cierre` no
 * conoce a stock). Solo lee y reporta. Tres controles, todos `INFORMA` (no bloquean ni piden reconocimiento: un conteo a medio hacer o una
 * existencia en negativo son cosas para mirar, no para frenar el día):
 *  - `stock.conteos_abiertos`: los conteos físicos `ABIERTO` de los depósitos de la sucursal;
 *  - `stock.existencias_negativas`: los saldos en negativo de los depósitos de la sucursal (el control `PERMITIR` o la confirmación los dejaron así);
 *  - `stock.lotes_vencidos_con_existencia` (E6): los lotes cuya fecha de vencimiento es anterior a la fecha de negocio de la jornada y todavía tienen existencia
 *    en la sucursal (un vencimiento vale hasta el final de su fecha): se dan de baja con motivo, no se venden ni se usan.
 * No tiene impedimentos para empezar a contar el día y `congelarEnTx` no escribe (los movimientos ya son inmutables y con quién y cuándo). Los
 * controles son del estado de la sucursal AHORA (no de una fecha de negocio): la jornada que se cierra solo dice de qué sucursal es. Determinista:
 * con los mismos datos, la misma huella (sin reloj ni azar); el detalle que entra en la huella y en las referencias son hasta
 * `MAXIMO_DE_REFERENCIAS` filas en orden fijo, y la cantidad es el total exacto. Si una lectura falla, `APORTE_NO_DISPONIBLE`: el día no se cierra con
 * un dato que no se pudo leer.
 */
export type TxDeAporteDeStock = Readonly<{
  conteosDeStock: Pick<RepositorioDeConteos, "contarAbiertosDe" | "listar">;
  movimientosDeStock: Pick<LecturasDelLibro, "contarNegativasDe" | "existencias">;
  lotesDeStock: Pick<LecturasDeLotes, "saldosDeLote">;
}>;

/** Las claves de los controles de stock en el cierre (`modulo.control`): las que ve la pantalla del cierre y guarda `cierre`. */
export const CONTROLES_DE_STOCK = {
  CONTEOS_ABIERTOS: "stock.conteos_abiertos",
  EXISTENCIAS_NEGATIVAS: "stock.existencias_negativas",
  LOTES_VENCIDOS_CON_EXISTENCIA: "stock.lotes_vencidos_con_existencia",
} as const;

type FilaDelDetalle = Readonly<{ referencia: string; datos: string }>;

/** sha256 (hex) del total y del detalle en el orden recibido (ya fijo): si cambia una fila o el total, cambia la huella. */
const huellaDelDetalle = (total: number, filas: readonly FilaDelDetalle[]): string =>
  createHash("sha256")
    .update(JSON.stringify([total, filas.map((f) => [f.referencia, f.datos])]))
    .digest("hex");

function control(clave: string, total: number, filas: readonly FilaDelDetalle[]): ControlDelDia {
  return {
    modulo: "stock",
    clave,
    severidad: "INFORMA",
    cantidad: total,
    huellaDelDetalle: huellaDelDetalle(total, filas),
    referencias: filas.map((f) => f.referencia),
  };
}

async function leerControles(tx: TxDeAporteDeStock, jornada: JornadaRef): Promise<ControlDelDia[]> {
  const { empresaId, sucursalId } = jornada;
  const [abiertos, cuantosAbiertos, negativas, cuantasNegativas, saldosDeLotes] = await Promise.all(
    [
      tx.conteosDeStock.listar(empresaId, {
        alcance: [sucursalId],
        estado: "ABIERTO",
        limite: MAXIMO_DE_REFERENCIAS,
      }),
      tx.conteosDeStock.contarAbiertosDe(empresaId, sucursalId),
      tx.movimientosDeStock.existencias(empresaId, {
        alcance: "TODAS",
        sucursalId,
        soloNegativas: true,
        limite: MAXIMO_DE_REFERENCIAS,
      }),
      tx.movimientosDeStock.contarNegativasDe(empresaId, sucursalId),
      tx.lotesDeStock.saldosDeLote(empresaId, {
        alcance: "TODAS",
        sucursalId,
        conExistencia: true,
      }),
    ],
  );
  // Vencido = vence antes de la fecha de negocio de la jornada; el sin asignar no vence. Existencia positiva: lo negativo ya lo mira el otro control.
  const vencidos = saldosDeLotes.filter(
    (l) =>
      situacionDeVencimiento(l.lote.fechaDeVencimiento, jornada.fechaDeNegocio, 0)?.tipo ===
        "VENCIDO" && !l.existencia.startsWith("-"),
  );
  return [
    control(
      CONTROLES_DE_STOCK.CONTEOS_ABIERTOS,
      cuantosAbiertos,
      abiertos.map((c) => ({ referencia: `stock.conteo:${c.id}`, datos: c.depositoId })),
    ),
    control(
      CONTROLES_DE_STOCK.EXISTENCIAS_NEGATIVAS,
      cuantasNegativas,
      negativas.map((n) => ({
        referencia: `stock.existencia:${n.depositoId}:${n.articuloId}`,
        datos: n.existencia,
      })),
    ),
    control(
      CONTROLES_DE_STOCK.LOTES_VENCIDOS_CON_EXISTENCIA,
      vencidos.length,
      vencidos.slice(0, MAXIMO_DE_REFERENCIAS).map((l) => ({
        referencia: `stock.lote:${l.lote.id}:${l.depositoId}`,
        datos: `${l.lote.fechaDeVencimiento ?? ""}:${l.existencia}`,
      })),
    ),
  ];
}

async function protegido<T>(leer: () => Promise<T>): Promise<Resultado<T, ErrorDeAporte>> {
  try {
    return ok(await leer());
  } catch {
    return err("APORTE_NO_DISPONIBLE");
  }
}

export const aporteDeStock: AporteAlCierreDelDia<TxDeAporteDeStock> = {
  modulo: "stock",
  /** Stock no impide empezar a contar el día. */
  impedimentos() {
    return Promise.resolve(ok([]));
  },
  /**
   * ¿Hay algo de stock que el cierre tendría que revisar? (decisión 178): un conteo abierto o una existencia en negativo en la sucursal. Sin nada
   * de eso desactivar la sucursal no pierde nada de stock. Un fallo de lectura es `APORTE_NO_DISPONIBLE` (falla cerrado).
   */
  async hayMovimiento(tx, jornada) {
    return protegido(async () => (await leerControles(tx, jornada)).some((c) => c.cantidad > 0));
  },
  async controles(tx, jornada) {
    return protegido(() => leerControles(tx, jornada));
  },
  congelarEnTx() {
    return Promise.resolve(ok(null));
  },
};
