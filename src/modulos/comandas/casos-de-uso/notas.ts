import type { ContextoOperativo } from "../../../contexto/contexto";
import { accionesDeCaso } from "../../../capacidades/permisos/declaracion";
import { notaDeCocinaDesdeTexto } from "../../../primitivas/texto/nota-de-cocina";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { cuentaPorId, lineaPorId } from "../../ventas/publico";
import { decidirCambiarSalida } from "../dominio/envio";
import {
  exigirAlcance,
  exigirJornadaAbierta,
  exigirUuid,
  prepararComando,
  traducir,
} from "./comun";
import type { DependenciasDeComandas, TxDeComandas } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import type { ErrorDeComandas } from "./errores";

type R<S> = Resultado<S, ErrorDeComandas>;

export type EntradaDeCambiarNota = Readonly<{
  cuentaId: string;
  lineaId: string;
  /** El texto de la nota; `null` o vacío la quita. */
  nota: string | null;
}>;
export type SalidaDeCambiarNota = Readonly<{ nota: string | null; yaEstaba: boolean }>;

/**
 * `cambiarNota` (SAL-G): la nota libre de un plato («sin cebolla»), SOLO mientras no se envió (`UPDATE … WHERE envio_id IS NULL`: si otro lo envió a la vez, `LINEA_YA_ENVIADA` y la nota no cambia; el envío copia la nota
 * viva con un bloqueo, así lo que se imprime es siempre lo guardado). Pedir la nota que ya tiene devuelve `yaEstaba`. Vacío o `null` la quita. No toca precio, stock ni ticket. Mismo molde y mismos permisos que `cambiarSalida`.
 * Una nota inválida (largo, caracteres) es `NOTA_INVALIDA` y no escribe nada.
 */
async function cambiar(
  tx: TxDeComandas,
  dependencias: DependenciasDeComandas,
  contexto: ContextoOperativo,
  entrada: EntradaDeCambiarNota,
): Promise<R<SalidaDeCambiarNota>> {
  const { empresaId } = contexto;
  const persona = await prepararComando(
    tx,
    contexto,
    dependencias.reglas,
    accionesDeCaso(DECLARACIONES.cambiarNota),
  );
  if (!persona.ok) return persona;
  const ids = exigirUuid(entrada.cuentaId, entrada.lineaId);
  if (!ids.ok) return ids;
  const quita = entrada.nota === null || entrada.nota.trim() === "";
  const validada = quita ? null : notaDeCocinaDesdeTexto(entrada.nota);
  if (validada !== null && !validada.ok) return err("NOTA_INVALIDA");
  const nota = validada === null ? null : validada.valor;
  const cuenta = await cuentaPorId(tx, empresaId, entrada.cuentaId);
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  const linea = await lineaPorId(tx, empresaId, entrada.lineaId);
  if (linea === null || linea.cuentaId !== cuenta.id) return err("LINEA_NO_ENCONTRADA");
  const jornada = await exigirJornadaAbierta(tx, contexto, cuenta.sucursalId);
  if (!jornada.ok) return jornada;
  await tx.envios.asegurarFilas(empresaId, cuenta.id, [linea.id]);
  const fila = await tx.envios.filaDeComanda(empresaId, linea.id);
  const decision = decidirCambiarSalida({
    vigente: linea.estado === "VIGENTE",
    envioId: fila === null ? null : fila.envioId,
  });
  if (!decision.ok) return err(decision.error);
  if (fila !== null && fila.nota === nota) return ok({ nota, yaEstaba: true });
  if (!(await tx.envios.cambiarNota(empresaId, linea.id, nota))) return err("LINEA_YA_ENVIADA");
  return ok({ nota, yaEstaba: false });
}

export function armarCambiarNota(dependencias: DependenciasDeComandas) {
  return async function cambiarNota(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarNota,
  ): Promise<R<SalidaDeCambiarNota>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      cambiar(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}
