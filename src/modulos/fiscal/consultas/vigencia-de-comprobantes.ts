import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { motivoDeNoVigencia, type MotivoDeNoVigencia } from "../dominio/acreditacion";
import type { ComprobanteParaVigencia } from "../persistencia/lecturas-de-vigencia";
import type { DependenciasDeConsultasDeFacturacion, TxDeConsultasDeFacturacion } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/** Cuántos comprobantes se preguntan por vez: la lectura es una sola por lote y no admite una lista sin tope. */
export const LIMITE_DE_IDS_DE_VIGENCIA = 100;

/** Los ids son de forma uuid: quien arma la entrada lo valida (como con el detalle), de sus propias columnas `uuid`. */
export type EntradaDeVigenciaDeComprobantes = Readonly<{
  comprobanteIds: readonly ComprobanteParaVigencia["id"][];
}>;

export type VigenciaDeUnComprobante = Readonly<{
  comprobanteId: ComprobanteParaVigencia["id"];
  vigente: boolean;
  /** `null` si sigue vigente. */
  motivoNoVigente: MotivoDeNoVigencia | null;
}>;

export type ErrorAlPedirLaVigencia =
  MotivoDeRechazo | "DEMASIADOS_IDS" | "IDS_REPETIDOS" | ErrorDePersistencia;

/**
 * D-F-1: ¿cada uno de esos comprobantes de la empresa del contexto sigue valiendo? Lo pregunta quien factura un documento para saber si
 * puede emitir otro (`DESCARTADO`, `RECHAZADO` o acreditado por completo con notas AUTORIZADAS: `motivoDeNoVigencia`, una sola regla en
 * `dominio/acreditacion.ts`). Pide `comprobantes.ver` al guard dentro de su transacción (`read committed`, solo lectura: se puede aunque el
 * módulo esté en solo lectura). Una lectura por lote (hasta `LIMITE_DE_IDS_DE_VIGENCIA` ids, sin repetir) filtrada por empresa: un id de otra
 * empresa o inexistente NO figura en la salida, y no se distingue el uno del otro (quien llama lo trata como inconsistencia). La salida
 * conserva el orden de la entrada. No mira sucursales: quien la llama ya resolvió qué documento es de quién.
 */
/** Lo que el cuerpo necesita de la transacción: el guard y las dos lecturas del lote. */
type TxDeVigencia = Pick<TxDeConsultasDeFacturacion, "autorizacion" | "lecturas">;

/**
 * El cuerpo de la consulta, DENTRO de la transacción de quien llama y con el guard primero (como `emitirFacturaDeOrigenEnTx`): ventas lo corre
 * en su propia transacción (de lectura o de escritura) para decidir si un documento ya está facturado, con la misma conexión y el mismo contexto
 * firmado. Es el único otro cuerpo de transacción que sale del módulo, y lleva su guard adentro.
 */
export async function vigenciaDeComprobantesEnTx(
  tx: TxDeVigencia,
  contexto: ContextoOperativo,
  entrada: EntradaDeVigenciaDeComprobantes,
  reglas: ReglasDeEmpresa,
): Promise<
  Resultado<
    readonly VigenciaDeUnComprobante[],
    MotivoDeRechazo | "DEMASIADOS_IDS" | "IDS_REPETIDOS"
  >
> {
  const permiso = await exigirAccion(
    reglas,
    DECLARACIONES_DE_CONSULTAS.vigenciaDeComprobantes.accion,
    () => tx.autorizacion.delActor(contexto),
  );
  if (!permiso.ok) return permiso;
  const { comprobanteIds } = entrada;
  if (comprobanteIds.length > LIMITE_DE_IDS_DE_VIGENCIA) return err("DEMASIADOS_IDS");
  if (new Set(comprobanteIds).size !== comprobanteIds.length) return err("IDS_REPETIDOS");
  const { empresaId } = contexto;
  const comprobantes = await tx.lecturas.paraVigencia(empresaId, comprobanteIds);
  const notas = await tx.lecturas.notasQueCitanA(
    empresaId,
    comprobantes.map((c) => c.id),
  );
  const porId = new Map(comprobantes.map((c) => [c.id, c]));
  const salida: VigenciaDeUnComprobante[] = [];
  for (const id of comprobanteIds) {
    const comprobante = porId.get(id);
    if (comprobante === undefined) continue;
    const motivo = motivoDeNoVigencia(comprobante, notas.get(id) ?? []);
    salida.push({ comprobanteId: id, vigente: motivo === null, motivoNoVigente: motivo });
  }
  return ok(salida);
}

export function armarVigenciaDeComprobantes({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeFacturacion) {
  return async function vigenciaDeComprobantes(
    contexto: ContextoOperativo,
    entrada: EntradaDeVigenciaDeComprobantes,
  ): Promise<Resultado<readonly VigenciaDeUnComprobante[], ErrorAlPedirLaVigencia>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      (tx) => vigenciaDeComprobantesEnTx(tx, contexto, entrada, reglas),
    );
  };
}
