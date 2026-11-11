import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { lineaPorId, lineasDeCuenta } from "../../ventas/publico";
import { puedeCobrarse, type SalidaDeLinea } from "../dominio/envio";
import { exigirUuid } from "./comun";
import type { TxDeComandas } from "./contrato";
import type { ErrorDeComandas } from "./errores";

type R<S> = Resultado<S, ErrorDeComandas>;

/**
 * Las funciones de comandas que usa el SALÓN dentro de SU transacción (E7 §3.4): sin guard propio (el permiso lo exigió quien llama), sobre la misma
 * conexión, siempre por empresa. Lo que escriben es atómico con lo que escribe el salón.
 */
export type EstadoDeComandaDeLinea = Readonly<{
  lineaId: string;
  salida: SalidaDeLinea;
  envioId: string | null;
  numeroDeEnvio: number | null;
}>;

/**
 * `registrarLineaDeComandaEnTx`: deja la fila de comanda de una línea recién agregada (`AHORA` por defecto). Idempotente: la misma fila no cambia nada; con
 * otra salida y la línea sin enviar, la actualiza; con la línea ya enviada, `LINEA_YA_ENVIADA`.
 */
export async function registrarLineaDeComandaEnTx(
  tx: TxDeComandas,
  contexto: ContextoOperativo,
  entrada: Readonly<{ cuentaId: string; lineaId: string; salida: SalidaDeLinea }>,
): Promise<R<Readonly<{ yaExistia: boolean }>>> {
  const ids = exigirUuid(entrada.cuentaId, entrada.lineaId);
  if (!ids.ok) return ids;
  if (entrada.salida !== "AHORA" && entrada.salida !== "DESPUES") return err("SALIDA_INVALIDA");
  const { empresaId } = contexto;
  const linea = await lineaPorId(tx, empresaId, entrada.lineaId);
  if (linea === null || linea.cuentaId !== entrada.cuentaId) return err("LINEA_NO_ENCONTRADA");
  if (linea.estado !== "VIGENTE") return err("LINEA_NO_VIGENTE");
  const previa = await tx.envios.filaDeComanda(empresaId, linea.id);
  if (previa === null) {
    await tx.envios.insertarFila(empresaId, {
      lineaId: linea.id,
      cuentaId: entrada.cuentaId,
      salida: entrada.salida,
      envioId: null,
    });
    return ok({ yaExistia: false });
  }
  if (previa.salida === entrada.salida) return ok({ yaExistia: true });
  if (!(await tx.envios.cambiarSalida(empresaId, linea.id, entrada.salida))) {
    return err("LINEA_YA_ENVIADA");
  }
  return ok({ yaExistia: false });
}

/** El estado de comanda de las líneas VIGENTES de la cuenta: una línea vigente sin fila cuenta como «sale ahora» sin enviar (fail closed). */
export async function estadoDeComandaDeLineas(
  tx: TxDeComandas,
  empresaId: EmpresaId,
  cuentaId: string,
): Promise<EstadoDeComandaDeLinea[]> {
  const filas = new Map(
    (await tx.envios.filasDeCuenta(empresaId, cuentaId)).map((f) => [f.lineaId, f]),
  );
  return (await lineasDeCuenta(tx, empresaId, cuentaId))
    .filter((l) => l.estado === "VIGENTE")
    .map((l) => ({
      lineaId: l.id,
      salida: filas.get(l.id)?.salida ?? "AHORA",
      envioId: filas.get(l.id)?.envioId ?? null,
      numeroDeEnvio: filas.get(l.id)?.numeroDeEnvio ?? null,
    }));
}

/** Cuántos platos vigentes quedan sin enviar y cuántos esperan (D86 y D114: con alguno, no se cobra la mesa). */
export async function platosPendientesEnTx(
  tx: TxDeComandas,
  empresaId: EmpresaId,
  cuentaId: string,
): Promise<Readonly<{ paraEnviar: number; enEspera: number; puedeCobrarse: boolean }>> {
  const estado = await estadoDeComandaDeLineas(tx, empresaId, cuentaId);
  const sinEnviar = estado.filter((l) => l.envioId === null);
  return {
    paraEnviar: sinEnviar.filter((l) => l.salida === "AHORA").length,
    enEspera: sinEnviar.filter((l) => l.salida === "DESPUES").length,
    puedeCobrarse: puedeCobrarse(estado.map((l) => ({ ...l, vigente: true }))).ok,
  };
}

/**
 * `copiarEstadoDeComandaEnTx`: la línea nueva (copia de otra por unir, dividir o anular una parte) conserva la `salida` y el `envio_id` de la origen
 * (lo enviado sigue enviado y no se reimprime). Si la origen no tiene fila, la nueva nace sin enviar `AHORA`.
 */
export async function copiarEstadoDeComandaEnTx(
  tx: TxDeComandas,
  contexto: ContextoOperativo,
  entrada: Readonly<{ lineaOrigenId: string; lineaNuevaId: string; cuentaDestinoId: string }>,
): Promise<R<null>> {
  const ids = exigirUuid(entrada.lineaOrigenId, entrada.lineaNuevaId, entrada.cuentaDestinoId);
  if (!ids.ok) return ids;
  const origen = await tx.envios.filaDeComanda(contexto.empresaId, entrada.lineaOrigenId);
  await tx.envios.insertarFila(contexto.empresaId, {
    lineaId: entrada.lineaNuevaId,
    cuentaId: entrada.cuentaDestinoId,
    salida: origen === null ? "AHORA" : origen.salida,
    envioId: origen === null ? null : origen.envioId,
  });
  return ok(null);
}

/** El resumen de comandas de varias cuentas en UNA consulta (el mapa de mesas no hace una por mesa). */
export const resumenDeComandasPorCuentas = (
  tx: TxDeComandas,
  empresaId: EmpresaId,
  cuentaIds: readonly string[],
) =>
  tx.envios.resumenPorCuentas(
    empresaId,
    cuentaIds.filter((id) => exigirUuid(id).ok),
  );
