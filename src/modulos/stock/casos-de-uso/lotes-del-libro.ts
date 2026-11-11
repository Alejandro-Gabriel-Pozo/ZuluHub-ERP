import { createHash } from "node:crypto";
import { cantidadConSignoDesdeTexto } from "../../../primitivas/cantidad/con-signo";
import { formatearDecimalFijo } from "../../../primitivas/cantidad/decimal-fijo";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { CALIDADES_DE_LOTE, type CalidadDeLote } from "../dominio/calidad";
import { esFechaCivil, estaVencido } from "../dominio/disponibilidad";
import { elegirLotesParaSalida, sumaDeAsignaciones, type AsignacionDeLote } from "../dominio/lotes";
import { buscarMotivo } from "../dominio/motivos";
import { DECIMALES_DE_CANTIDAD, type RenglonDeLibro } from "../dominio/movimiento";
import type { Movimiento } from "../persistencia/modelo";
import { llaveDeSaldo } from "../persistencia/repositorio-de-movimientos";
import type { ControlDeLote } from "../persistencia/repositorio-de-lotes";
import type { TxDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";

/**
 * Los lotes en el libro (E6 §3.2, «Asignación de lotes en el libro»), SOLO para los artículos con control de lote ACTIVO: sin control no se
 * escribe ninguna fila de lote y el libro se comporta como en E5. Corre DENTRO de `registrarMovimientoEnTx`, después de escribir el
 * movimiento y sus renglones (el renglón tiene que existir para tener lotes) y antes de confirmar: la base verifica al confirmar que los lotes
 * de cada renglón suman su cantidad y que Σ lotes = saldo del artículo (L3).
 *  - Entrada: trae sus lotes (`LoteDeEntrada`, que suman el renglón) o, si no los trae, va al lote «sin asignar». Busca o crea cada lote por su
 *    identidad (artículo, código, origen); con `LOTE_Y_VENCIMIENTO` falta la fecha es `VENCIMIENTO_REQUERIDO` y una fecha pasada
 *    `VENCIMIENTO_PASADO` (D118).
 *  - Salida que entrega (venta, consumo): primero el que vence antes entre los lotes DISPONIBLES; lo que falta va al «sin asignar».
 *  - Salida que descarta (merma, rotura, baja por vencimiento) y la resta de un ajuste o un conteo: la persona puede nombrar el lote; sin
 *    nombrar, vence-antes primero incluyendo lo no disponible. Descartar nunca se bloquea por calidad ni vencimiento (D27).
 *  - Transferencia: el origen elige como una salida que descarta y el destino recibe los mismos lotes. Anulación: el espejo exacto de los lotes
 *    del original (si el original no tenía lotes, se trata por su signo).
 * Cada renglón se escribe antes de elegir el siguiente: el saldo de lote ya refleja lo anterior del mismo movimiento. El saldo de (depósito,
 * artículo) lo bloqueó el renglón del libro, así que quien mueve el mismo par espera: la elección ve existencias firmes.
 */
export type LoteDeEntrada = Readonly<{
  codigo: string;
  referenciaDeOrigen?: string | null;
  fechaDeVencimiento?: string | null;
  fechaDeElaboracion?: string | null;
  /** Texto decimal exacto, positivo; todos los de un renglón suman su cantidad. */
  cantidad: string;
}>;

export type LotesDelPedido = Readonly<{
  /** Por `llaveDeSaldo(depósito, artículo)`: los lotes de cada renglón de entrada. */
  entradas?: ReadonlyMap<string, readonly LoteDeEntrada[]>;
  /** Por `llaveDeSaldo(depósito, artículo)`: el lote que la persona nombró para descartar (la baja por vencimiento). */
  nombrados?: ReadonlyMap<string, string>;
  /** `EN_CUARENTENA` si la recepción queda «con observaciones» (D118); sin dato, un lote nuevo de un artículo con calidad nace `LIBERADO`. */
  estadoInicialDeCalidad?: CalidadDeLote;
}>;

const MOTIVO_DE_INGRESO = "Ingreso del lote";
const aTexto = (unidades: bigint): string => formatearDecimalFijo(unidades, DECIMALES_DE_CANTIDAD);
const aUnidades = (texto: string): bigint => BigInt(texto.replace(".", ""));
const FORMA_DE_CANTIDAD = /^\d{1,14}(\.\d{1,4})?$/;

type FilaNueva = { movimientoId: string; renglonNumero: number; loteId: string; cantidad: string };

export async function asignarLotesDelLibro(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  datos: Readonly<{
    movimiento: Movimiento;
    /** En el orden en que se escribieron (el número de renglón es la posición + 1). */
    renglones: readonly RenglonDeLibro[];
    lotes: LotesDelPedido | undefined;
  }>,
): Promise<Resultado<null, ErrorDeStock>> {
  const { movimiento, renglones } = datos;
  const empresa = contexto.empresaId;
  const persona = contexto.personaId;
  if (persona === null) return err("SIN_PERMISO");
  const controles = await tx.lotesDeStock.controlesDe(
    empresa,
    renglones.map((r) => r.articuloId),
  );
  const activos = new Map([...controles].filter(([, c]) => c.activo));
  if (activos.size === 0) return ok(null);

  const entrega = buscarMotivo(movimiento.clase, movimiento.motivo)?.entregaMercaderia ?? false;
  const espejo =
    movimiento.clase === "ANULACION" && movimiento.anulaA !== null
      ? await tx.lotesDeStock.renglonesDeLoteDe(empresa, movimiento.anulaA)
      : [];

  const asignadas = new Map<number, readonly AsignacionDeLote[]>();
  const escribir = async (indice: number, asignaciones: readonly AsignacionDeLote[]) => {
    asignadas.set(indice, asignaciones);
    const filas: FilaNueva[] = asignaciones.map((a) => ({
      movimientoId: movimiento.id,
      renglonNumero: indice + 1,
      loteId: a.loteId,
      cantidad: aTexto(a.unidades),
    }));
    await tx.lotesDeStock.insertarRenglonesDeLote(empresa, filas);
  };
  const sinAsignar = async (articuloId: string): Promise<string> => {
    const id = await tx.lotesDeStock.sinAsignar(empresa, articuloId);
    if (id === null) throw new Error("el artículo con control de lote no tiene lote sin asignar");
    return id;
  };

  /** Una salida: elige lotes y los escribe (con el signo del renglón). */
  const salir = async (indice: number, r: RenglonDeLibro, modo: "ENTREGA" | "DESCARTE") => {
    const candidatos = await tx.lotesDeStock.candidatos(empresa, r.depositoId, r.articuloId);
    const nombrado = datos.lotes?.nombrados?.get(llaveDeSaldo(r.depositoId, r.articuloId)) ?? null;
    const elegidas = elegirLotesParaSalida(
      candidatos,
      -r.cantidad.unidades,
      modo,
      movimiento.fechaDeNegocio,
      nombrado,
    );
    await escribir(
      indice,
      elegidas.map((a) => ({ loteId: a.loteId, unidades: -a.unidades })),
    );
  };

  // Primero lo que resta (la transferencia reparte al destino lo que eligió el origen), después lo que suma.
  for (const pasada of ["RESTA", "SUMA"] as const) {
    for (const [indice, r] of renglones.entries()) {
      const control = activos.get(r.articuloId);
      if (control === undefined) continue;
      if (r.cantidad.unidades < 0n !== (pasada === "RESTA")) continue;

      const delOriginal = espejo.filter(
        (e) =>
          e.depositoId === r.depositoId &&
          e.articuloId === r.articuloId &&
          e.composicionId === r.composicionId,
      );
      if (movimiento.clase === "ANULACION" && delOriginal.length > 0) {
        await escribir(
          indice,
          delOriginal.map((e) => ({ loteId: e.loteId, unidades: -aUnidades(e.cantidad) })),
        );
      } else if (r.cantidad.unidades < 0n) {
        await salir(indice, r, entrega ? "ENTREGA" : "DESCARTE");
      } else if (movimiento.clase === "TRANSFERENCIA") {
        // El destino recibe los mismos lotes que salieron del origen, en la misma cantidad.
        const delOrigen = renglones.findIndex(
          (o) => o.articuloId === r.articuloId && o.cantidad.unidades < 0n,
        );
        const lotesDelOrigen = asignadas.get(delOrigen) ?? [];
        await escribir(
          indice,
          lotesDelOrigen.map((a) => ({ loteId: a.loteId, unidades: -a.unidades })),
        );
      } else if (movimiento.clase === "ENTRADA") {
        const propios = datos.lotes?.entradas?.get(llaveDeSaldo(r.depositoId, r.articuloId));
        if (propios === undefined || propios.length === 0) {
          await escribir(indice, [
            { loteId: await sinAsignar(r.articuloId), unidades: r.cantidad.unidades },
          ]);
        } else {
          const resultado = await lotesDeUnaEntrada(
            tx,
            contexto,
            movimiento,
            control,
            r,
            propios,
            datos.lotes,
          );
          if (!resultado.ok) return resultado;
          await escribir(indice, resultado.valor);
        }
      } else {
        // Un ajuste o un conteo que suma, o una anulación de algo que no tenía lotes: entra al «sin asignar».
        await escribir(indice, [
          { loteId: await sinAsignar(r.articuloId), unidades: r.cantidad.unidades },
        ]);
      }
      const total = sumaDeAsignaciones(
        (asignadas.get(indice) ?? []).map((a) => ({
          loteId: a.loteId,
          unidades: a.unidades < 0n ? -a.unidades : a.unidades,
        })),
      );
      if (total !== (r.cantidad.unidades < 0n ? -r.cantidad.unidades : r.cantidad.unidades)) {
        throw new RangeError("stock: los lotes de un renglón no suman su cantidad");
      }
    }
  }
  return ok(null);
}

/** Valida y resuelve los lotes de un renglón de entrada: los busca o los crea y devuelve lo que entra a cada uno. */
async function lotesDeUnaEntrada(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  movimiento: Movimiento,
  control: ControlDeLote,
  renglon: RenglonDeLibro,
  propios: readonly LoteDeEntrada[],
  lotes: LotesDelPedido | undefined,
): Promise<Resultado<readonly AsignacionDeLote[], ErrorDeStock>> {
  const persona = contexto.personaId;
  if (persona === null) return err("SIN_PERMISO");
  const asignaciones: AsignacionDeLote[] = [];
  let suma = 0n;
  const vistos = new Set<string>();
  for (const propio of propios) {
    const cantidad = FORMA_DE_CANTIDAD.test(propio.cantidad)
      ? cantidadConSignoDesdeTexto(propio.cantidad)
      : null;
    if (cantidad === null || !cantidad.ok || cantidad.valor.unidades <= 0n) {
      return err("CANTIDAD_INVALIDA");
    }
    const vence = propio.fechaDeVencimiento ?? null;
    const elabora = propio.fechaDeElaboracion ?? null;
    if (vence === null && control.modo === "LOTE_Y_VENCIMIENTO")
      return err("VENCIMIENTO_REQUERIDO");
    for (const fecha of [vence, elabora]) {
      if (fecha !== null && !esFechaCivil(fecha)) return err("VENCIMIENTO_REQUERIDO");
    }
    if (estaVencido(vence, movimiento.fechaDeNegocio)) return err("VENCIMIENTO_PASADO");
    const identidad = JSON.stringify([propio.codigo, propio.referenciaDeOrigen ?? null]);
    if (vistos.has(identidad)) return err("RENGLON_REPETIDO");
    vistos.add(identidad);
    const { lote, creado } = await tx.lotesDeStock.buscarOCrear(contexto.empresaId, {
      id: proximoId(movimiento, renglon, vistos.size),
      articuloId: renglon.articuloId,
      codigo: propio.codigo,
      referenciaDeOrigen: propio.referenciaDeOrigen ?? null,
      fechaDeElaboracion: elabora,
      fechaDeVencimiento: vence,
      esSinAsignar: false,
      fechaDePrimerIngreso: movimiento.fechaDeNegocio,
      creadoPor: persona,
      creadoEn: contexto.ahora,
    });
    if (creado && control.conCalidad) {
      await tx.lotesDeStock.registrarCalidad(contexto.empresaId, {
        loteId: lote.id,
        estado: lotes?.estadoInicialDeCalidad ?? "LIBERADO",
        motivo: MOTIVO_DE_INGRESO,
        por: persona,
        en: contexto.ahora,
      });
    }
    const unidades = cantidad.valor.unidades;
    suma += unidades;
    asignaciones.push({ loteId: lote.id, unidades });
  }
  if (suma !== renglon.cantidad.unidades) return err("RENGLONES_INVALIDOS");
  return ok(asignaciones);
}

/**
 * El id del lote lo deriva del movimiento, el renglón y la posición: determinista, así un reintento de la transacción crea el MISMO lote (no hay
 * azar en el código de stock). Es un UUID v5-like armado con sha1 del contenido.
 */
function proximoId(movimiento: Movimiento, renglon: RenglonDeLibro, posicion: number): string {
  const h = createHash("sha1")
    .update(
      `lote|${movimiento.id}|${renglon.depositoId}|${renglon.articuloId}|${renglon.composicionId ?? ""}|${posicion}`,
    )
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const ESTADOS_INICIALES_DE_CALIDAD = CALIDADES_DE_LOTE;
