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
 * La plantilla común de TODO caso de uso de plataforma que escribe (H5 plataforma §B.4): «guard, forma de
 * la clave, idempotencia, trabajo, auditoría y registro de la clave». La usan los dominios (M4a) y las
 * marcas, los planes y los módulos de empresa (M5). Existe una sola porque la parte que importa (que el
 * guard sea lo primero, que la repetición no escriba ni audite de nuevo y que una falla a mitad de camino
 * no deje nada) no puede escribirse dos veces sin que se desvíe.
 */

/** Lo que TODO caso de plataforma que escribe necesita de su transacción. */
export type TxBaseDePlataforma = Readonly<{
  autorizacionDePlataforma: CargaDeAutorizacionDePlataforma;
  auditoriaDePlataforma: AuditoriaDePlataforma;
  idempotencia: IdempotenciaDePlataforma;
}>;

export type DependenciasDeCasoDePlataforma<Tx extends TxBaseDePlataforma> = Readonly<{
  transacciones: Transacciones<Tx>;
  /** El catálogo y la matriz de PLATAFORMA con los que se autoriza a quien actúa. */
  reglas: ReglasDePlataforma;
}>;

/** Lo que todo caso de plataforma puede devolver además de lo propio. */
export type ErrorComunDeCasoDePlataforma =
  MotivoDeRechazo | "CLAVE_DE_IDEMPOTENCIA_INVALIDA" | "CLAVE_REUTILIZADA" | ErrorDePersistencia;

/** Una constancia de auditoría de plataforma: qué pasó, sobre qué y cómo era antes y cómo quedó. */
export type ConstanciaDePlataforma = Readonly<{
  accion: AccionDePlataforma;
  entidad: string;
  entidadId: string;
  antes: Readonly<Record<string, Dato>> | null;
  despues: Readonly<Record<string, Dato>> | null;
}>;

/** Lo que el trabajo de un caso decidió escribir: la constancia (si cambió algo) y el resultado a repetir. */
export type ResultadoDelTrabajo<S> = Readonly<{
  salida: S;
  /** `null`: no cambió nada (ya estaba), y lo idempotente no audita. */
  constancia: ConstanciaDePlataforma | null;
}>;

export type PlantillaDeCasoDePlataforma<
  Tx extends TxBaseDePlataforma,
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
  /** El trabajo, dentro de la transacción y después de la clave. */
  trabajar: (
    tx: Tx,
    valor: V,
  ) => Promise<Resultado<ResultadoDelTrabajo<S>, E | ErrorDePersistencia>>;
  /** Lo que se devuelve ante una repetición de la clave: lo guardado, marcado como «ya estaba». */
  comoRepeticion: (guardado: S) => S;
}>;

/**
 * La plantilla de todo caso de plataforma que escribe, en una transacción SERIALIZABLE y en este orden:
 *
 *  1. El guard de plataforma, leído dentro de la transacción (nada en caché).
 *  2. La forma de la clave de idempotencia y de la entrada.
 *  3. La clave: si ya se usó con la MISMA entrada se devuelve lo que dio (marcado como repetición), sin
 *     escribir nada más; con OTRA entrada es `CLAVE_REUTILIZADA`.
 *  4. El trabajo del caso (lee, decide, escribe).
 *  5. La constancia de auditoría de plataforma, en la misma transacción, solo si algo cambió; el actor lo
 *     pone el adaptador desde el contexto firmado.
 *  6. El registro de la clave con el resultado.
 *
 * Un error de negocio revierte todo: no queda constancia ni clave de algo que no ocurrió. Un contexto que no
 * es de plataforma (un actor de empresa que se coló sin tipar) lanza `RangeError` sin abrir transacción.
 */
export function ejecutarCasoDePlataforma<
  Tx extends TxBaseDePlataforma,
  S extends Dato,
  V,
  E extends string | Readonly<{ codigo: string }>,
>(
  dependencias: DependenciasDeCasoDePlataforma<Tx>,
  plantilla: PlantillaDeCasoDePlataforma<Tx, S, V, E>,
): Promise<Resultado<S, E | ErrorComunDeCasoDePlataforma>> {
  const { transacciones, reglas } = dependencias;
  const { contexto, accion, operacion, claveDeIdempotencia } = plantilla;
  // El tipo ya impide pasar el contexto de una empresa; esto cubre a quien lo salte (una llamada sin tipar):
  // falla fuerte y ANTES de abrir ninguna transacción, igual que los adaptadores de plataforma.
  if ((contexto as Readonly<{ tipo: string }>).tipo !== "PLATAFORMA") {
    throw new RangeError("plataforma: el contexto no es de plataforma");
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
        if (hecho.valor.constancia !== null) {
          await tx.auditoriaDePlataforma.registrar(hecho.valor.constancia);
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
