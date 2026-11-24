import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { decidirPorHuella } from "../../../primitivas/libro/publico";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { armarAsiento, type EntradaDeAsiento } from "../dominio/asiento";
import type { ErrorDelLibro } from "../dominio/errores";
import type { TxDeSaldos } from "./contrato";
import { dejarConstancia, exigirActor } from "./comun";

export type AsientoRegistrado = Readonly<{ asientoId: string; yaExistia: boolean }>;

/**
 * Registra un asiento del libro con su distribución por centro de costo, DENTRO de la transacción del llamador.
 *
 *  - IDEMPOTENCIA primero: la misma clave con la misma huella devuelve lo hecho (`yaExistia`, sin escribir ni auditar); con otra huella es
 *    `CLAVE_REUTILIZADA`. Un mismo origen con otra clave: el PRIMERO manda (devuelve el existente).
 *  - Dos pedidos iguales a la vez: el segundo choca con la restricción única y la base lo informa como conflicto de serialización (el adaptador
 *    repite todo y ve `yaExistia`) o como `CLAVE_YA_USADA`/`ORIGEN_YA_REGISTRADO` (el llamador repite el caso completo una vez).
 *  - Los topes, el signo de la clase y el cuadre de la distribución los impone la base; acá solo se valida antes lo que se puede decir antes.
 *  - Auditoría en la misma transacción. Atomicidad: o queda el asiento con su distribución y sus saldos, o nada.
 * El asiento va AL FINAL de la transacción del llamador: el saldo de la parte se turna entre asientos de una misma parte hasta que confirma.
 */
export async function registrarAsientoEnTx(
  tx: TxDeSaldos,
  contexto: ContextoOperativo,
  entrada: EntradaDeAsiento,
): Promise<Resultado<AsientoRegistrado, ErrorDelLibro>> {
  const actor = exigirActor(contexto);
  if (!actor.ok) return actor;
  const pedido = armarAsiento(entrada);
  if (!pedido.ok) return pedido;
  const p = pedido.valor;

  const porClave = await tx.asientos.porClave(contexto.empresaId, p.clave);
  if (porClave !== null) {
    return decidirPorHuella(porClave.huella, p.huella) === "REPETIDA"
      ? ok({ asientoId: porClave.id, yaExistia: true })
      : err("CLAVE_REUTILIZADA");
  }
  const porOrigen = await tx.asientos.porOrigen(
    contexto.empresaId,
    p.origenTipo,
    p.origenId,
    p.origenOrden,
  );
  if (porOrigen !== null) return ok({ asientoId: porOrigen.id, yaExistia: true });

  const asientoId = await tx.asientos.insertar({
    empresa: contexto.empresaId,
    parteId: p.parteId,
    sentido: p.sentido,
    clase: p.clase,
    naturaleza: "ORIGINAL",
    importe: p.importe,
    origenTipo: p.origenTipo,
    origenId: p.origenId,
    origenOrden: p.origenOrden,
    referenciaTipo: p.referenciaTipo,
    referenciaId: p.referenciaId,
    venceEl: p.venceEl,
    detalle: p.detalle,
    anulaA: null,
    clave: p.clave,
    huella: p.huella,
    hechoEn: p.hechoEn,
    registradoPor: actor.valor,
  });
  await tx.asientos.insertarDistribucion(contexto.empresaId, asientoId, p.distribucion);
  await dejarConstancia(tx, contexto, actor.valor, {
    accion: "saldos.registrar_asiento",
    entidad: "asiento_de_saldo",
    entidadId: asientoId,
    despues: {
      parteId: p.parteId,
      sentido: p.sentido,
      clase: p.clase,
      importe: importeATexto(p.importe),
      origenTipo: p.origenTipo,
      origenId: p.origenId,
      origenOrden: p.origenOrden,
      venceEl: p.venceEl,
      centrosDeCosto: p.distribucion.length,
    },
  });
  return ok({ asientoId, yaExistia: false });
}
