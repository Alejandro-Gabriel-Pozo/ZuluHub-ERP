import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { TipoDeComprobante } from "../dominio/comprobante-emitido";
import type { Ambiente } from "../dominio/comprobante-nuevo";
import type { PuntoDeVentaId } from "../dominio/identificadores";
import { resincronizarSerie, type ErrorDeResincronizacion } from "../dominio/numeracion";
import { datosDeSerie, empresaOpera, entidadDeSerie } from "./comun";
import type { TxDeNumeracion } from "./contrato";

/**
 * Resincronizar una serie (salida de `BLOQUEADA`): tercera parte del cuerpo transaccional de la numeración,
 * SIN guard. Reglas de quien llama: ya abrió la transacción (SERIALIZABLE) y ya autorizó la acción.
 */

export type EntradaDeResincronizarSerie = Readonly<{
  puntoDeVentaId: PuntoDeVentaId;
  tipo: TipoDeComprobante;
  ambiente: Ambiente;
  /** El último número que la persona vio en la pantalla y confirmó. */
  ultimoVistoEnArca: bigint;
  /** El último número que ARCA informa ahora (`ultimoAutorizado`, consultado FUERA de la transacción). */
  ultimoDeArca: bigint;
  /** Por qué se resincroniza: queda en la auditoría. */
  motivo: string;
}>;

export type SalidaDeResincronizarSerie = Readonly<{ ultimoNumero: bigint }>;

export type ErrorPropioAlResincronizar = "SERIE_NO_ENCONTRADA" | ErrorDeResincronizacion;

/**
 * Sacar una serie de `BLOQUEADA` (spec H7 facturación §B.4.6, QF1): `BLOQUEADA → LIBRE` con el último
 * número de ARCA, nunca hacia atrás (`resincronizarSerie` del dominio decide). Los números entre el
 * viejo y el nuevo los emitió otro sistema: no son huecos de Pedernal y la auditoría
 * `SERIE_RESINCRONIZADA` los explica (antes, después y motivo), en la misma transacción.
 *
 * Es solo el cuerpo transaccional: el permiso (`series.resincronizar`), la consulta a ARCA fuera de
 * la transacción y el reencolado de los comprobantes `PENDIENTE` de la serie son del caso de uso que
 * la llame. Repetirla encuentra la serie ya `LIBRE` y da `SERIE_NO_BLOQUEADA`, sin escribir nada.
 */
export async function resincronizarEnTx(
  tx: TxDeNumeracion,
  contexto: ContextoOperativo,
  entrada: EntradaDeResincronizarSerie,
): Promise<Resultado<SalidaDeResincronizarSerie, ErrorPropioAlResincronizar | EmpresaNoOpera>> {
  const { empresaId } = contexto;
  const opera = await empresaOpera(tx, empresaId);
  if (!opera.ok) return opera;

  const serie = await tx.series.obtener(
    empresaId,
    entrada.puntoDeVentaId,
    entrada.tipo,
    entrada.ambiente,
  );
  if (serie === null) return err("SERIE_NO_ENCONTRADA");
  const libre = resincronizarSerie(serie, entrada.ultimoVistoEnArca, entrada.ultimoDeArca);
  if (!libre.ok) return libre;
  const guardada = await tx.series.guardar(libre.valor);
  if (guardada === null) throw new Error("la serie cambió dentro de la transacción");
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: contexto.personaId,
    accion: "SERIE_RESINCRONIZADA",
    entidad: "serie_comprobante",
    entidadId: entidadDeSerie(entrada.puntoDeVentaId, entrada.tipo, entrada.ambiente),
    antes: datosDeSerie(serie),
    despues: {
      ...datosDeSerie(guardada),
      ultimoVistoEnArca: entrada.ultimoVistoEnArca.toString(),
      motivo: entrada.motivo,
    },
  });
  return ok({ ultimoNumero: guardada.ultimoNumero });
}
