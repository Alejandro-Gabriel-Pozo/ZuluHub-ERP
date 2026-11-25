import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  importeATexto,
  importeCero,
  restar,
  type Importe,
} from "../../../primitivas/dinero/importe";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { decidirPorHuella, exigirClave } from "../../../primitivas/libro/publico";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { huellaDeImputacion } from "../dominio/asiento";
import type { ErrorDelLibro } from "../dominio/errores";
import type { TxDeSaldos } from "./contrato";
import { dejarConstancia, exigirActor } from "./comun";

export type ImputacionRegistrada = Readonly<{
  imputacionIds: readonly string[];
  yaExistia: boolean;
}>;

/** Cuántos renglones admite UNA operación de imputación (el `numero` de la base va de 1 a 1000). */
export const RENGLONES_MAXIMOS_POR_IMPUTACION = 1000;

const MONEDA_DEL_LIBRO = "ARS";

/**
 * Imputa un asiento que resta (el SALDANTE: pago, nota de crédito, crédito a favor, retención) contra uno o varios que suman (los SALDADOS:
 * cargos), todo en UNA operación idempotente por su clave. Dentro de la transacción del llamador.
 *
 *  - Los renglones se ordenan por `saldadoId` ASCENDENTE antes de escribir: dos operaciones que se cruzan toman los bloqueos en el mismo orden
 *    (menos interbloqueos). El `numero` de cada renglón sale de ese orden, así que el mismo pedido da siempre los mismos renglones.
 *  - Nada de «leer, decidir, escribir»: los topes (lo imputado nunca pasa el importe de un asiento, ni queda en negativo) los imponen los CHECK
 *    de la base (`CREDITO_INSUFICIENTE`); acá no se compara contra lo pendiente. Dos pagos a la vez que juntos pasan lo adeudado: uno falla.
 *  - Idempotencia: la misma clave con la misma huella devuelve lo hecho; con otra huella, `CLAVE_REUTILIZADA`.
 */
export async function imputarEnTx(
  tx: TxDeSaldos,
  contexto: ContextoOperativo,
  entrada: Readonly<{
    saldanteId: string;
    repartos: ReadonlyArray<Readonly<{ saldadoId: string; importe: Importe }>>;
    clave: string;
  }>,
): Promise<Resultado<ImputacionRegistrada, ErrorDelLibro>> {
  const renglones = [...entrada.repartos].sort((a, b) =>
    a.saldadoId < b.saldadoId ? -1 : a.saldadoId > b.saldadoId ? 1 : 0,
  );
  if (
    renglones.length === 0 ||
    renglones.length > RENGLONES_MAXIMOS_POR_IMPUTACION ||
    new Set(renglones.map((r) => r.saldadoId)).size !== renglones.length ||
    renglones.some(
      (r) =>
        !esUuidCanonico(r.saldadoId) ||
        r.importe.moneda !== MONEDA_DEL_LIBRO ||
        r.importe.unidades <= 0n,
    )
  ) {
    return err("IMPUTACION_INVALIDA");
  }
  return operar(
    tx,
    contexto,
    entrada.saldanteId,
    entrada.clave,
    renglones.map((r) => ({ saldadoId: r.saldadoId, importe: r.importe })),
    "saldos.imputar",
  );
}

/**
 * Deshace (total o parcialmente) lo imputado entre un par: un renglón de importe NEGATIVO. La base no deja deshacer más de lo imputado entre ese
 * par (`DESHACER_SUPERA_LO_IMPUTADO`), por más deshaceres que lleguen a la vez.
 */
export async function deshacerImputacionEnTx(
  tx: TxDeSaldos,
  contexto: ContextoOperativo,
  entrada: Readonly<{ saldanteId: string; saldadoId: string; importe: Importe; clave: string }>,
): Promise<Resultado<ImputacionRegistrada, ErrorDelLibro>> {
  if (
    !esUuidCanonico(entrada.saldadoId) ||
    entrada.importe.moneda !== MONEDA_DEL_LIBRO ||
    entrada.importe.unidades <= 0n
  ) {
    return err("IMPUTACION_INVALIDA");
  }
  return operar(
    tx,
    contexto,
    entrada.saldanteId,
    entrada.clave,
    [
      {
        saldadoId: entrada.saldadoId,
        importe: restar(importeCero(entrada.importe.moneda), entrada.importe),
      },
    ],
    "saldos.deshacer_imputacion",
  );
}

async function operar(
  tx: TxDeSaldos,
  contexto: ContextoOperativo,
  saldanteId: string,
  clave: string,
  renglones: ReadonlyArray<Readonly<{ saldadoId: string; importe: Importe }>>,
  accion: string,
): Promise<Resultado<ImputacionRegistrada, ErrorDelLibro>> {
  const actor = exigirActor(contexto);
  if (!actor.ok) return actor;
  if (!exigirClave(clave).ok) return err("CLAVE_INVALIDA");
  if (!esUuidCanonico(saldanteId)) return err("ASIENTO_NO_ENCONTRADO");

  // La parte y el sentido salen del asiento saldante (nunca de un dato que mande quien llama); uno de otra empresa no existe.
  const saldante = await tx.asientos.obtener(contexto.empresaId, saldanteId);
  if (saldante === null) return err("ASIENTO_NO_ENCONTRADO");
  const huella = huellaDeImputacion(
    saldante.parteId,
    saldante.sentido,
    renglones.map((r) => ({ saldanteId, saldadoId: r.saldadoId, importe: r.importe })),
  );

  const previas = await tx.imputaciones.porClave(contexto.empresaId, clave);
  if (previas.length > 0) {
    return decidirPorHuella(previas[0]?.huella ?? null, huella) === "REPETIDA"
      ? ok({ imputacionIds: previas.map((p) => p.id), yaExistia: true })
      : err("CLAVE_REUTILIZADA");
  }

  const ids = await tx.imputaciones.insertar(
    renglones.map((r, i) => ({
      empresa: contexto.empresaId,
      numero: i + 1,
      saldanteId,
      saldadoId: r.saldadoId,
      parteId: saldante.parteId,
      sentido: saldante.sentido,
      importe: r.importe,
      clave,
      huella,
      registradoPor: actor.valor,
    })),
  );
  await dejarConstancia(tx, contexto, actor.valor, {
    accion,
    entidad: "imputacion_de_saldo",
    entidadId: ids[0] as string,
    despues: {
      parteId: saldante.parteId,
      sentido: saldante.sentido,
      saldanteId,
      renglones: renglones.map((r) => ({
        saldadoId: r.saldadoId,
        importe: importeATexto(r.importe),
      })),
    },
  });
  return ok({ imputacionIds: ids, yaExistia: false });
}
