import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import { exigirPerilla, type ErrorDePerilla } from "../../../capacidades/planes/derechos";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirCambioDeEstado } from "../dominio/configuracion";
import { dejarConstancia, exigirAlcance, prepararCaso } from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeCambiarEstadoDeCaja = Readonly<{ cajaId: string }>;

export type SalidaDeDesactivarCaja = Readonly<{
  /** `true`: ya estaba inactiva; no se escribió nada. */
  yaEstabaInactiva: boolean;
}>;
export type SalidaDeReactivarCaja = Readonly<{
  /** `true`: ya estaba activa; no se escribió nada. */
  yaEstabaActiva: boolean;
}>;

type ErrorComun = "CAJA_NO_ENCONTRADA" | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance;

export type ErrorAlDesactivarCaja = ErrorComun | "CAJA_CON_SESION_VIGENTE" | ErrorDePersistencia;
export type ErrorAlReactivarCaja = ErrorComun | ErrorDePerilla | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (la base los lanza con un disparador). */
const RESTRICCIONES_DE_DESACTIVAR = ["CAJA_CON_SESION_VIGENTE"] as const;

/**
 * Desactivar una caja (e3 §3.2). Contexto OPERATIVO con persona, en una transacción serializable: guard (`cajas.desactivar`), la empresa
 * opera, alcance sobre la sucursal de la caja y el dominio decide: ya inactiva → `yaEstabaInactiva: true` sin escribir ni auditar. Una
 * caja con una sesión sin cerrar no se desactiva (`CAJA_CON_SESION_VIGENTE`, lo impone un disparador de la base). Nada se borra: la caja
 * conserva su nombre. La auditoría `CAJA_DESACTIVADA` va en la misma transacción.
 */
export function armarDesactivarCaja({ transacciones, reglas }: DependenciasDeCaja) {
  return async function desactivarCaja(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarEstadoDeCaja,
  ): Promise<Resultado<SalidaDeDesactivarCaja, ErrorAlDesactivarCaja>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (tx): Promise<Resultado<SalidaDeDesactivarCaja, ErrorComun>> => {
        const previo = await prepararCaso(
          tx,
          contexto,
          reglas,
          DECLARACIONES.desactivarCaja.accion,
        );
        if (!previo.ok) return previo;
        const actual = await tx.cajas.obtener(empresaId, entrada.cajaId);
        if (actual === null) return err("CAJA_NO_ENCONTRADA");
        const alcance = await exigirAlcance(tx, contexto, actual.sucursalId);
        if (!alcance.ok) return alcance;
        if (decidirCambioDeEstado(actual.activa, false) === "YA_ESTABA") {
          return ok({ yaEstabaInactiva: true });
        }
        const cambiada = await tx.cajas.cambiarActiva(empresaId, actual.id, actual.version, false);
        if (cambiada === null) return err("CAJA_NO_ENCONTRADA");
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "CAJA_DESACTIVADA",
          entidad: "caja",
          entidadId: actual.id,
          antes: { nombre: actual.nombre, activa: true },
          despues: { nombre: cambiada.nombre, activa: false },
        });
        return ok({ yaEstabaInactiva: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_DE_DESACTIVAR);
  };
}

/**
 * Reactivar una caja (e3 §3.2). Lo mismo que desactivar, pero ya activa → `yaEstabaActiva: true` sin escribir ni auditar y, si la
 * reactiva, las cajas ACTIVAS de la sucursal (contadas en esta transacción) tienen que estar por debajo del límite del plan
 * (`cajas_por_sucursal`): si no, `LIMITE_DEL_PLAN`. Auditoría `CAJA_REACTIVADA`.
 */
export function armarReactivarCaja({ transacciones, reglas }: DependenciasDeCaja) {
  return async function reactivarCaja(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarEstadoDeCaja,
  ): Promise<Resultado<SalidaDeReactivarCaja, ErrorAlReactivarCaja>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto },
      async (tx): Promise<Resultado<SalidaDeReactivarCaja, ErrorComun | ErrorDePerilla>> => {
        const previo = await prepararCaso(tx, contexto, reglas, DECLARACIONES.reactivarCaja.accion);
        if (!previo.ok) return previo;
        const actual = await tx.cajas.obtener(empresaId, entrada.cajaId);
        if (actual === null) return err("CAJA_NO_ENCONTRADA");
        const alcance = await exigirAlcance(tx, contexto, actual.sucursalId);
        if (!alcance.ok) return alcance;
        if (decidirCambioDeEstado(actual.activa, true) === "YA_ESTABA") {
          return ok({ yaEstabaActiva: true });
        }
        const derechos = await tx.derechos.deLaEmpresa(contexto);
        const enUso = await tx.cajas.contarActivas(empresaId, actual.sucursalId);
        const tope = exigirPerilla(
          derechos,
          "cajas_por_sucursal",
          { empresaId, sucursalId: actual.sucursalId },
          enUso,
        );
        if (!tope.ok) return tope;
        const cambiada = await tx.cajas.cambiarActiva(empresaId, actual.id, actual.version, true);
        if (cambiada === null) return err("CAJA_NO_ENCONTRADA");
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "CAJA_REACTIVADA",
          entidad: "caja",
          entidadId: actual.id,
          antes: { nombre: actual.nombre, activa: false },
          despues: { nombre: cambiada.nombre, activa: true },
        });
        return ok({ yaEstabaActiva: false });
      },
    );
  };
}
