import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirCambioDeEstado } from "../dominio/configuracion";
import { dejarConstancia, exigirAlcance, prepararCaso } from "./comun";
import type { DependenciasDeCaja, TxDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeCambiarEstadoDeCuentaDeCobro = Readonly<{ cuentaDeCobroId: string }>;

export type SalidaDeDesactivarCuentaDeCobro = Readonly<{
  /** `true`: ya estaba inactiva; no se escribió nada. */
  yaEstabaInactiva: boolean;
}>;
export type SalidaDeReactivarCuentaDeCobro = Readonly<{
  /** `true`: ya estaba activa; no se escribió nada. */
  yaEstabaActiva: boolean;
}>;

type ErrorComun =
  "CUENTA_DE_COBRO_NO_ENCONTRADA" | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance;

export type ErrorAlCambiarElEstadoDeUnaCuentaDeCobro = ErrorComun | ErrorDePersistencia;

/** Lo común de desactivar y reactivar: cambia `activa` y audita, o dice que ya estaba como se pide. */
async function cambiarEstado(
  tx: TxDeCaja,
  contexto: ContextoOperativo,
  reglas: DependenciasDeCaja["reglas"],
  accion: "desactivarCuentaDeCobro" | "reactivarCuentaDeCobro",
  cuentaDeCobroId: string,
  seQuiereActiva: boolean,
): Promise<Resultado<{ yaEstaba: boolean }, ErrorComun>> {
  const previo = await prepararCaso(tx, contexto, reglas, DECLARACIONES[accion].accion);
  if (!previo.ok) return previo;
  const { empresaId } = contexto;
  const actual = await tx.cuentasDeCobro.obtener(empresaId, cuentaDeCobroId);
  if (actual === null) return err("CUENTA_DE_COBRO_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, actual.sucursalId);
  if (!alcance.ok) return alcance;
  if (decidirCambioDeEstado(actual.activa, seQuiereActiva) === "YA_ESTABA") {
    return ok({ yaEstaba: true });
  }
  const cambiada = await tx.cuentasDeCobro.cambiarActiva(
    empresaId,
    actual.id,
    actual.version,
    seQuiereActiva,
  );
  if (cambiada === null) return err("CUENTA_DE_COBRO_NO_ENCONTRADA");
  await dejarConstancia(tx, contexto, previo.valor.persona, {
    accion: seQuiereActiva ? "CUENTA_DE_COBRO_REACTIVADA" : "CUENTA_DE_COBRO_DESACTIVADA",
    entidad: "cuenta_de_cobro",
    entidadId: actual.id,
    antes: { nombre: actual.nombre, activa: !seQuiereActiva },
    despues: { nombre: cambiada.nombre, activa: seQuiereActiva },
  });
  return ok({ yaEstaba: false });
}

/**
 * Desactivar una cuenta de cobro (e3 §3.2 y §3.3). Contexto OPERATIVO con persona, en una transacción serializable: guard
 * (`cuentas_de_cobro.desactivar`), la empresa opera, alcance sobre la sucursal de la cuenta; ya inactiva → `yaEstabaInactiva: true` sin
 * escribir ni auditar. Desactivarla no toca lo ya cobrado, y con la cuenta opcional (decisión 151) desactivar todas no deja medios sin
 * poder cobrar. Auditoría `CUENTA_DE_COBRO_DESACTIVADA`.
 */
export function armarDesactivarCuentaDeCobro({ transacciones, reglas }: DependenciasDeCaja) {
  return async function desactivarCuentaDeCobro(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarEstadoDeCuentaDeCobro,
  ): Promise<Resultado<SalidaDeDesactivarCuentaDeCobro, ErrorAlCambiarElEstadoDeUnaCuentaDeCobro>> {
    const resultado = await transacciones.ejecutar({ contexto }, (tx) =>
      cambiarEstado(
        tx,
        contexto,
        reglas,
        "desactivarCuentaDeCobro",
        entrada.cuentaDeCobroId,
        false,
      ),
    );
    return resultado.ok ? ok({ yaEstabaInactiva: resultado.valor.yaEstaba }) : resultado;
  };
}

/** Reactivar una cuenta de cobro (e3 §3.2): lo mismo, hacia activa; ya activa → `yaEstabaActiva: true`. Auditoría `CUENTA_DE_COBRO_REACTIVADA`. */
export function armarReactivarCuentaDeCobro({ transacciones, reglas }: DependenciasDeCaja) {
  return async function reactivarCuentaDeCobro(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarEstadoDeCuentaDeCobro,
  ): Promise<Resultado<SalidaDeReactivarCuentaDeCobro, ErrorAlCambiarElEstadoDeUnaCuentaDeCobro>> {
    const resultado = await transacciones.ejecutar({ contexto }, (tx) =>
      cambiarEstado(tx, contexto, reglas, "reactivarCuentaDeCobro", entrada.cuentaDeCobroId, true),
    );
    return resultado.ok ? ok({ yaEstabaActiva: resultado.valor.yaEstaba }) : resultado;
  };
}
