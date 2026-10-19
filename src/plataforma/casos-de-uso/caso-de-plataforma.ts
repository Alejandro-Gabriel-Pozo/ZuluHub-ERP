import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type {
  ClaveAccionDePlataforma,
  ReglasDePlataforma,
} from "../../capacidades/permisos/plataforma";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type {
  AccionDePlataforma,
  AuditoriaDePlataforma,
} from "../../puertos/auditoria-de-plataforma";
import type { CargaDeAutorizacionDePlataforma } from "../../puertos/autorizacion-de-plataforma";
import type { IdempotenciaDePlataforma } from "../../puertos/idempotencia";
import type { Dato } from "../../puertos/sin-secretos";
import type { ErrorDePersistencia, Transacciones } from "../../puertos/transacciones";
import { exigirAccionDePlataforma } from "../consultas/comun";
import { claveDeIdempotenciaValida } from "../dominio/soporte/consulta";

/**
 * LA plantilla de todo caso de uso de plataforma que escribe (H5 plataforma §B.4), con la transacción que
 * el caso necesite: el guard, la clave de idempotencia, el trabajo del caso, la auditoría de plataforma y
 * el registro de la clave, todo en UNA transacción SERIALIZABLE. La usan la gestión de dominios (M4a), el
 * alta de empresas y su ciclo de vida (M6) y las marcas, los planes y los módulos de empresa (M5), sin
 * atarla a un conjunto fijo de repositorios y admitiendo más de una constancia y errores con datos (un tope
 * con su límite y su uso). Existe una sola porque el orden de los pasos es lo que garantiza que un rechazo
 * no deje nada y que repetir la clave no duplique: escrita dos veces se desvía.
 */

/** Lo mínimo que la plantilla pide a la transacción; el caso suma sus repositorios. */
export type TxDeCasoDePlataforma = Readonly<{
  autorizacionDePlataforma: CargaDeAutorizacionDePlataforma;
  auditoriaDePlataforma: AuditoriaDePlataforma;
  idempotencia: IdempotenciaDePlataforma;
}>;

export type DependenciasDeCasoDePlataforma<Tx extends TxDeCasoDePlataforma> = Readonly<{
  transacciones: Transacciones<Tx>;
  /** El catálogo y la matriz de PLATAFORMA con los que se autoriza a quien actúa. */
  reglas: ReglasDePlataforma;
}>;

/** Lo que todo caso de plataforma que escribe puede devolver además de lo propio. */
export type ErrorComunDeCasoDePlataforma =
  MotivoDeRechazo | "CLAVE_DE_IDEMPOTENCIA_INVALIDA" | "CLAVE_REUTILIZADA" | ErrorDePersistencia;

/** Una constancia de la auditoría de plataforma (el actor lo pone el adaptador desde el contexto). */
export type ConstanciaDePlataforma = Readonly<{
  accion: AccionDePlataforma;
  entidad: string;
  entidadId: string;
  antes: Readonly<Record<string, Dato>> | null;
  despues: Readonly<Record<string, Dato>> | null;
}>;

/** Lo que el trabajo de un caso decidió: lo que se devuelve y las constancias a dejar. */
export type ResultadoDelTrabajoDePlataforma<S> = Readonly<{
  salida: S;
  /** Vacío: no cambió nada (ya estaba), y lo idempotente no audita. En el orden en que se registran. */
  constancias: readonly ConstanciaDePlataforma[];
}>;

export type PlantillaDeCasoDePlataforma<
  Tx extends TxDeCasoDePlataforma,
  S extends Dato,
  V,
  E,
> = Readonly<{
  contexto: ContextoDePlataforma;
  /** La acción del catálogo de plataforma que se exige al guard. */
  accion: ClaveAccionDePlataforma;
  /** El nombre con el que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
  operacion: string;
  claveDeIdempotencia: string;
  /** Forma de la entrada, DESPUÉS del guard: lo validado y la entrada canónica que alimenta la huella. */
  validar: () => Resultado<Readonly<{ entrada: Dato; valor: V }>, E>;
  /** El trabajo, dentro de la transacción y después de la clave. Puede devolver también un error de persistencia. */
  trabajar: (
    tx: Tx,
    valor: V,
  ) => Promise<Resultado<ResultadoDelTrabajoDePlataforma<S>, E | ErrorDePersistencia>>;
  /** Lo que se devuelve ante una repetición de la clave: lo guardado, marcado como «ya estaba». */
  comoRepeticion: (guardado: S) => S;
}>;

/**
 * Los pasos, en este orden y dentro de una sola transacción SERIALIZABLE:
 *
 *  1. El guard de plataforma, leído dentro de la transacción (nada en caché).
 *  2. La forma de la clave de idempotencia y de la entrada.
 *  3. La clave: si ya se usó con la MISMA entrada se devuelve lo que dio (marcado como repetición) sin
 *     escribir nada más; con OTRA entrada es `CLAVE_REUTILIZADA`.
 *  4. El trabajo del caso (lee, decide, escribe).
 *  5. Las constancias de auditoría de plataforma, en la misma transacción.
 *  6. El registro de la clave con el resultado.
 *
 * Un error de negocio revierte todo: no queda constancia ni clave de algo que no ocurrió. Una repetición
 * simultánea de la misma clave puede chocar con lo que el original acaba de confirmar antes de mirar la
 * clave: `repetirSiHuboChoqueDeUnicidad` la repite UNA vez y la segunda pasada ve la clave del ganador. Un
 * contexto que no es de plataforma (una llamada sin tipar) lanza `RangeError` sin abrir transacción.
 */
export function ejecutarCasoDePlataforma<Tx extends TxDeCasoDePlataforma, S extends Dato, V, E>(
  dependencias: DependenciasDeCasoDePlataforma<Tx>,
  plantilla: PlantillaDeCasoDePlataforma<Tx, S, V, E>,
): Promise<Resultado<S, E | ErrorComunDeCasoDePlataforma>> {
  const { transacciones, reglas } = dependencias;
  const { contexto, accion, operacion, claveDeIdempotencia } = plantilla;
  if ((contexto as Readonly<{ tipo: string }>).tipo !== "PLATAFORMA") {
    throw new RangeError("caso de plataforma: el contexto no es de plataforma");
  }
  return repetirSiHuboChoqueDeUnicidad(() =>
    transacciones.ejecutar(
      { contexto },
      async (tx): Promise<Resultado<S, E | ErrorComunDeCasoDePlataforma>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        if (!claveDeIdempotenciaValida(claveDeIdempotencia)) {
          return err("CLAVE_DE_IDEMPOTENCIA_INVALIDA");
        }
        const forma = plantilla.validar();
        if (!forma.ok) return forma;
        const { entrada, valor } = forma.valor;

        const previa = await tx.idempotencia.consultar(operacion, claveDeIdempotencia, entrada);
        if (previa.tipo === "CLAVE_REUTILIZADA") return err("CLAVE_REUTILIZADA");
        // Lo guardado lo escribió este mismo caso (la operación está en la clave): es una `S`.
        if (previa.tipo === "REPETIDA") return ok(plantilla.comoRepeticion(previa.resultado as S));

        const hecho = await plantilla.trabajar(tx, valor);
        if (!hecho.ok) return hecho;
        for (const constancia of hecho.valor.constancias) {
          await tx.auditoriaDePlataforma.registrar(constancia);
        }
        await tx.idempotencia.registrar(
          operacion,
          claveDeIdempotencia,
          entrada,
          hecho.valor.salida,
        );
        return ok(hecho.valor.salida);
      },
    ),
  );
}

const esChoqueDeUnicidad = (resultado: Resultado<unknown, unknown>): boolean =>
  !resultado.ok &&
  typeof resultado.error === "object" &&
  resultado.error !== null &&
  "tipo" in resultado.error &&
  resultado.error.tipo === "Unicidad";

/**
 * Repite UNA vez, en una transacción nueva, lo que terminó en un choque de unicidad. Una repetición con la
 * misma clave que corre a la vez que su original puede chocar con lo que el original acaba de confirmar (el
 * host, el número o la clave misma) ANTES de llegar a mirar la clave; Postgres no lo convierte siempre en un
 * conflicto de serialización que el adaptador reintente. La segunda pasada empieza con una foto nueva: ve la
 * clave del ganador y devuelve su resultado (`REPETIDA`). Si el choque era real (otro pedido, otra clave), la
 * segunda pasada vuelve a chocar y el motivo sale tal cual.
 */
export async function repetirSiHuboChoqueDeUnicidad<T, E>(
  intento: () => Promise<Resultado<T, E>>,
): Promise<Resultado<T, E>> {
  const primero = await intento();
  return esChoqueDeUnicidad(primero) ? intento() : primero;
}
