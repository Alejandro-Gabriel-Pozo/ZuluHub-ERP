import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeATexto, importeCero, restar } from "../../../primitivas/dinero/importe";
import { decidirPorHuella, espejoDe, exigirClave } from "../../../primitivas/libro/publico";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { detalleDesdeTexto, huellaDeAnulacion, huellaDeImputacion } from "../dominio/asiento";
import { distribucionDelEspejo } from "../dominio/distribucion";
import type { ErrorDelLibro } from "../dominio/errores";
import type { TxDeSaldos } from "./contrato";
import { dejarConstancia, exigirActor } from "./comun";

export type AsientoAnulado = Readonly<{
  /** El id del espejo (el asiento nuevo que anula al original). */
  asientoId: string;
  yaExistia: boolean;
  imputacionesDeshechas: number;
}>;

/**
 * Anula un asiento con su ESPEJO (nada se borra): misma parte, sentido, clase y origen, el importe invertido, el detalle obligatorio y la
 * distribución del original negada exacta. Si el asiento tiene imputaciones vigentes, las DESHACE primero (renglones negativos, ordenados por
 * `saldado` y `saldante`) y después inserta el espejo, todo en la transacción del llamador. Repetido con la misma clave: un solo efecto.
 *
 * Contra una imputación que llega a la vez, la base decide con un CHECK (`saldo_de_asiento_anulado_ck`): una de las dos falla (o el adaptador
 * repite si fue un conflicto de serialización); nunca queda imputado un asiento anulado.
 */
export async function anularAsientoEnTx(
  tx: TxDeSaldos,
  contexto: ContextoOperativo,
  entrada: Readonly<{ asientoId: string; detalle: string; clave: string }>,
): Promise<Resultado<AsientoAnulado, ErrorDelLibro>> {
  const actor = exigirActor(contexto);
  if (!actor.ok) return actor;
  if (!exigirClave(entrada.clave).ok) return err("CLAVE_INVALIDA");
  const detalle = detalleDesdeTexto(entrada.detalle);
  if (!detalle.ok) return err("DETALLE_INVALIDO");
  if (detalle.valor === null) return err("DETALLE_OBLIGATORIO");
  if (!esUuidCanonico(entrada.asientoId)) return err("ASIENTO_NO_ENCONTRADO");

  const original = await tx.asientos.obtener(contexto.empresaId, entrada.asientoId);
  if (original === null) return err("ASIENTO_NO_ENCONTRADO");
  const huella = huellaDeAnulacion(original.id, detalle.valor);

  const previo = await tx.asientos.porClave(contexto.empresaId, entrada.clave);
  if (previo !== null) {
    return decidirPorHuella(previo.huella, huella) === "REPETIDA"
      ? ok({ asientoId: previo.id, yaExistia: true, imputacionesDeshechas: 0 })
      : err("CLAVE_REUTILIZADA");
  }

  const cero = importeCero(original.importe.moneda);
  const espejo = espejoDe(
    {
      id: original.id,
      parteId: original.parteId,
      sentido: original.sentido,
      clase: original.clase,
      magnitud: original.importe,
      anulaA: original.anulaA,
    },
    detalle.valor,
    (importe) => restar(cero, importe),
  );
  if (!espejo.ok) {
    return err(espejo.error === "DETALLE_OBLIGATORIO" ? "DETALLE_OBLIGATORIO" : "ESPEJO_INVALIDO");
  }
  const estado = await tx.saldos.estadoDeAsiento(contexto.empresaId, original.id);
  if (estado?.anulado === true) return err("ASIENTO_YA_ANULADO");

  // 1. Deshacer lo imputado (si hay), en el orden fijo de la base. Un renglón negativo por par, con la clave de la anulación.
  const pares = await tx.imputaciones.paresVigentesDe(contexto.empresaId, original.id);
  if (pares.length > 0) {
    const deshaceres = pares.map((p) => ({
      saldanteId: p.saldanteId,
      saldadoId: p.saldadoId,
      importe: restar(cero, p.importe),
    }));
    const huellaDeLosDeshaceres = huellaDeImputacion(
      original.parteId,
      original.sentido,
      deshaceres,
    );
    await tx.imputaciones.insertar(
      deshaceres.map((d, i) => ({
        empresa: contexto.empresaId,
        numero: i + 1,
        saldanteId: d.saldanteId,
        saldadoId: d.saldadoId,
        parteId: original.parteId,
        sentido: original.sentido,
        importe: d.importe,
        clave: entrada.clave,
        huella: huellaDeLosDeshaceres,
        registradoPor: actor.valor,
      })),
    );
  }

  // 2. El espejo con la distribución del original, negada exacta.
  const distribucionOriginal = await tx.asientos.distribucionDe(contexto.empresaId, original.id);
  const asientoId = await tx.asientos.insertar({
    empresa: contexto.empresaId,
    parteId: original.parteId,
    sentido: original.sentido,
    clase: original.clase,
    naturaleza: "ANULACION",
    importe: espejo.valor.magnitud,
    origenTipo: original.origenTipo,
    origenId: original.origenId,
    origenOrden: original.origenOrden,
    referenciaTipo: null,
    referenciaId: null,
    venceEl: null,
    detalle: detalle.valor,
    anulaA: original.id,
    clave: entrada.clave,
    huella,
    hechoEn: contexto.ahora,
    registradoPor: actor.valor,
  });
  await tx.asientos.insertarDistribucion(
    contexto.empresaId,
    asientoId,
    distribucionDelEspejo(distribucionOriginal),
  );
  await dejarConstancia(tx, contexto, actor.valor, {
    accion: "saldos.anular_asiento",
    entidad: "asiento_de_saldo",
    entidadId: asientoId,
    despues: {
      anulaA: original.id,
      parteId: original.parteId,
      sentido: original.sentido,
      clase: original.clase,
      importe: importeATexto(espejo.valor.magnitud),
      imputacionesDeshechas: pares.length,
    },
  });
  return ok({ asientoId, yaExistia: false, imputacionesDeshechas: pares.length });
}
