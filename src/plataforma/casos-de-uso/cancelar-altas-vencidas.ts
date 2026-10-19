import type { ContextoDePlataforma } from "../../contexto/contexto";
import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { EmpresaId } from "../../primitivas/identificadores/marca";
import type { ErrorDePersistencia, Transacciones } from "../../puertos/transacciones";
import {
  MOTIVO_DE_ALTA_VENCIDA,
  PLAZO_DE_ALTA_EN_MS,
  altaVencida,
  decidirCancelacionDeAlta,
} from "../dominio/alta";
import { cancelarElAlta, type TxParaCancelar } from "./cancelar-alta";

/**
 * El barrido de altas vencidas (H5 §B.5.3): cancela las empresas que siguen en `PROVISIONING` pasadas las
 * 72 horas desde que se crearon. Lo dispara el cron con el actor `SISTEMA`. No pasa por el guard (el
 * sistema no es una persona con un rol) ni por la tabla de idempotencia (que es de un administrador): es
 * repetible por sí mismo, porque la segunda corrida no encuentra nada que cancelar.
 */

export const DECLARACION_DEL_BARRIDO_DE_ALTAS = {
  sinGuard:
    "lo corre el cron como el sistema, que no es una persona con un rol; la base solo le deja cancelar altas en PROVISIONING y revocar invitaciones del alta, y el barrido es repetible por sí mismo",
} as const;

/** Cuántas altas vencidas revisa una corrida; si quedan más, las toma la corrida siguiente. */
export const ALTAS_POR_CORRIDA = 100;

/** El barrido, con los dos tipos de transacción que usa: una de solo lectura y una por empresa. */
export type DependenciasDelBarrido = Readonly<{
  transacciones: Transacciones<TxParaCancelar>;
  /** Tope de altas por corrida (por defecto `ALTAS_POR_CORRIDA`). */
  limite?: number;
}>;

export type ResumenDelBarrido = Readonly<{
  /** Cuántas altas vencidas encontró la corrida (hasta el tope). */
  revisadas: number;
  canceladas: readonly EmpresaId[];
  /** Las que dejaron de estar pendientes entre que se las listó y se las procesó (la aceptaron o la cancelaron). */
  yaNoPendientes: readonly EmpresaId[];
  /** Las que fallaron; el resto de la corrida sigue. El error es el de la base, sin datos de negocio. */
  fallidas: readonly Readonly<{
    empresaId: EmpresaId;
    error: ErrorDePersistencia | "VERSION_DESACTUALIZADA";
  }>[];
}>;

/** El actor del barrido tiene que ser el sistema: un contexto de otro actor es un defecto de quien lo llama. */
function exigirElSistema(contexto: ContextoDePlataforma): void {
  if ((contexto as Readonly<{ tipo: string }>).tipo !== "PLATAFORMA") {
    throw new RangeError("barrido de altas: el contexto no es de plataforma");
  }
  if (contexto.actor.tipo !== "SISTEMA") {
    throw new RangeError("barrido de altas: lo corre el sistema, no un administrador");
  }
}

/**
 * Cancela las altas vencidas, UNA EMPRESA POR TRANSACCIÓN: una falla no frena a las demás y queda en el
 * resumen. Motivo `ALTA_VENCIDA`, constancia con actor `sistema`. Repetible: la segunda corrida no
 * encuentra nada. Aceptar y barrer a la vez: gana uno (SERIALIZABLE); el perdedor no cancela una alta que
 * ya se activó.
 */
export function armarCancelarAltasVencidas({
  transacciones,
  limite = ALTAS_POR_CORRIDA,
}: DependenciasDelBarrido) {
  return async function cancelarAltasVencidas(
    contexto: ContextoDePlataforma,
  ): Promise<Resultado<ResumenDelBarrido, ErrorDePersistencia>> {
    exigirElSistema(contexto);
    const { ahora } = contexto;
    const creadasHasta = new Date(ahora.getTime() - PLAZO_DE_ALTA_EN_MS);

    const candidatas = await transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx) => ok(await tx.empresas.listarAltasVencidas(creadasHasta, limite)),
    );
    if (!candidatas.ok) return candidatas;

    const canceladas: EmpresaId[] = [];
    const yaNoPendientes: EmpresaId[] = [];
    const fallidas: {
      empresaId: EmpresaId;
      error: ErrorDePersistencia | "VERSION_DESACTUALIZADA";
    }[] = [];
    for (const { empresa } of candidatas.valor) {
      const resultado = await transacciones.ejecutar({ contexto }, async (tx) => {
        // Se vuelve a leer ADENTRO de la transacción: lo listado puede haber cambiado mientras tanto.
        const actual = await tx.empresas.obtenerConCreadoEn(empresa.id);
        if (actual === null || !altaVencida(actual.creadoEn, ahora)) return ok(false);
        const cambio = decidirCancelacionDeAlta(actual.empresa, MOTIVO_DE_ALTA_VENCIDA);
        if (!cambio.ok) return ok(false);
        const hecho = await cancelarElAlta(tx, contexto, actual.empresa, cambio.valor);
        return hecho.ok ? ok(true) : hecho;
      });
      if (!resultado.ok) fallidas.push({ empresaId: empresa.id, error: resultado.error });
      else if (resultado.valor) canceladas.push(empresa.id);
      else yaNoPendientes.push(empresa.id);
    }
    return ok({ revisadas: candidatas.valor.length, canceladas, yaNoPendientes, fallidas });
  };
}
