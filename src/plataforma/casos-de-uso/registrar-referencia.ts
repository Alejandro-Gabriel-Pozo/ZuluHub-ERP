import type { Contexto } from "../../contexto/contexto";
import type { EmpresaId, PersonaId } from "../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ReferenciasDeError } from "../../puertos/referencias-de-error";
import type { ErrorDePersistencia, Transacciones } from "../../puertos/transacciones";
import { referenciaDeError, type ReferenciaDeError } from "../dominio/referencia";

/**
 * Registro de la referencia de error con reintento ante una colisión (soporte, paso 1, H5 §B.5.9).
 *
 * DECISIÓN (la que dejaba abierta la especificación para P4/P5): la referencia sigue siendo
 * `PD-XXXX-XXXX` (32 bits, fácil de dictar por teléfono) y lo que garantiza que no haya dos iguales es
 * una restricción de UNICIDAD en la base con REINTENTO acá, no alargar el código. Alargarlo a 64 bits
 * reduciría la chance de colisión pero no la eliminaría, y haría el código más difícil de dictar; la
 * unicidad la elimina. Con unas decenas de miles de rechazos una colisión deja de ser rara (cumpleaños
 * sobre 2^32), y cada una se resuelve con un reintento que casi nunca ocurre.
 *
 * ESTADO: la restricción todavía NO existe en la base (la migración 0004 dejó `referencia_de_error`
 * sin unicidad a propósito). Hasta que una migración posterior agregue
 * `ALTER TABLE referencia_de_error ADD CONSTRAINT referencia_de_error_referencia_uk UNIQUE (referencia)`
 * este caso de uso funciona igual y nunca reintenta, y la búsqueda de soporte devuelve todas las
 * coincidencias en lugar de una sola. El nombre de esa restricción es parte del contrato: una prueba de
 * integración la agrega en su propia base y comprueba el reintento contra la base real.
 */
export const RESTRICCION_DE_UNICIDAD_DE_REFERENCIA = "referencia_de_error_referencia_uk";

/** Cuántas referencias distintas se prueban antes de rendirse (cinco colisiones seguidas es imposible en la práctica). */
export const INTENTOS_PARA_REGISTRAR_UNA_REFERENCIA = 5;

/** Por qué se rechazó la acción: el motivo tipado, sin ningún dato de negocio. */
export type RechazoARegistrar = Readonly<{
  /** La acción rechazada, por ejemplo `usuarios.invitar`. */
  accion: string;
  /** El motivo tipado, por ejemplo `SIN_PERMISO`. */
  motivo: string;
  empresaId: EmpresaId | null;
  personaId: PersonaId | null;
}>;

export type TxDeReferencias = Readonly<{ referenciasDeError: ReferenciasDeError }>;

export type DependenciasDeReferencias = Readonly<{
  transacciones: Transacciones<TxDeReferencias>;
  /**
   * Los bytes de azar de cada referencia (`BYTES_DE_UNA_REFERENCIA`); se piden FUERA de la transacción,
   * una vez por intento. El dominio no sortea nada: la composición pasa el azar del sistema.
   */
  azar: () => Uint8Array;
}>;

const esColision = (error: ErrorDePersistencia): boolean =>
  error.tipo === "Unicidad" && error.restriccion === RESTRICCION_DE_UNICIDAD_DE_REFERENCIA;

/**
 * Sortea una referencia y la registra, cada intento en su PROPIA transacción (una colisión aborta la
 * transacción de Postgres, así que no se puede seguir dentro de ella). Se usa con el contexto de quien
 * recibió el rechazo, DESPUÉS de que la transacción del caso de uso se revirtió: el rechazo no deja
 * nada más. Devuelve la referencia que quedó guardada, para mostrársela a esa persona.
 *
 * Solo una colisión de la referencia se reintenta; cualquier otro error (acceso denegado, un CHECK…)
 * vuelve tal cual. Si se agotan los intentos devuelve la última colisión.
 */
export function armarRegistrarReferenciaDeError({
  transacciones,
  azar,
}: DependenciasDeReferencias) {
  return async function registrarReferenciaDeError(
    contexto: Contexto,
    rechazo: RechazoARegistrar,
  ): Promise<Resultado<ReferenciaDeError, ErrorDePersistencia>> {
    const intentar = async (): Promise<Resultado<ReferenciaDeError, ErrorDePersistencia>> => {
      const referencia = referenciaDeError(azar());
      return transacciones.ejecutar(
        { contexto, aislamiento: "read committed" },
        async (tx): Promise<Resultado<ReferenciaDeError, never>> => {
          await tx.referenciasDeError.registrar({ referencia, ...rechazo });
          return ok(referencia);
        },
      );
    };
    let resultado = await intentar();
    for (
      let intentos = 1;
      intentos < INTENTOS_PARA_REGISTRAR_UNA_REFERENCIA &&
      !resultado.ok &&
      esColision(resultado.error);
      intentos += 1
    ) {
      resultado = await intentar();
    }
    return resultado;
  };
}
