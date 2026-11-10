import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirCambioDeEstado, decidirDesactivacionDeMedio } from "../dominio/configuracion";
import { dejarConstancia, prepararCaso } from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeCambiarEstadoDeMedioDePago = Readonly<{ medioDePagoId: string }>;

export type SalidaDeDesactivarMedioDePago = Readonly<{
  /** `true`: ya estaba inactivo; no se escribió nada. */
  yaEstabaInactivo: boolean;
}>;
export type SalidaDeReactivarMedioDePago = Readonly<{
  /** `true`: ya estaba activo; no se escribió nada. */
  yaEstabaActivo: boolean;
}>;

type ErrorComun = "MEDIO_NO_ENCONTRADO" | MotivoDeRechazo | EmpresaNoOpera;

export type ErrorAlDesactivarMedioDePago =
  ErrorComun | "EFECTIVO_NO_SE_DESACTIVA" | ErrorDePersistencia;
export type ErrorAlReactivarMedioDePago = ErrorComun | ErrorDePersistencia;

/**
 * Desactivar un medio de pago (e3 §3.2). Contexto OPERATIVO con persona, en una transacción serializable: guard
 * (`medios_de_pago.desactivar`), la empresa opera y el dominio decide (`decidirDesactivacionDeMedio`): el efectivo no se desactiva nunca
 * (`EFECTIVO_NO_SE_DESACTIVA`); ya inactivo → `yaEstabaInactivo: true` sin escribir ni auditar. Desactivar un medio no toca lo ya
 * cobrado con él: solo deja de ofrecerse en los cobros nuevos. Auditoría `MEDIO_DE_PAGO_DESACTIVADO`.
 */
export function armarDesactivarMedioDePago({ transacciones, reglas }: DependenciasDeCaja) {
  return async function desactivarMedioDePago(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarEstadoDeMedioDePago,
  ): Promise<Resultado<SalidaDeDesactivarMedioDePago, ErrorAlDesactivarMedioDePago>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeDesactivarMedioDePago, ErrorComun | "EFECTIVO_NO_SE_DESACTIVA">
      > => {
        const previo = await prepararCaso(
          tx,
          contexto,
          reglas,
          DECLARACIONES.desactivarMedioDePago.accion,
        );
        if (!previo.ok) return previo;
        const actual = await tx.mediosDePago.obtener(empresaId, entrada.medioDePagoId);
        if (actual === null) return err("MEDIO_NO_ENCONTRADO");
        const decision = decidirDesactivacionDeMedio(actual);
        if (!decision.ok) return decision;
        if (decision.valor === "YA_ESTABA") return ok({ yaEstabaInactivo: true });
        const cambiado = await tx.mediosDePago.cambiarActivo(
          empresaId,
          actual.id,
          actual.version,
          false,
        );
        if (cambiado === null) return err("MEDIO_NO_ENCONTRADO");
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "MEDIO_DE_PAGO_DESACTIVADO",
          entidad: "medio_de_pago",
          entidadId: actual.id,
          antes: { tipo: actual.tipo, nombre: actual.nombre, activo: true },
          despues: { tipo: cambiado.tipo, nombre: cambiado.nombre, activo: false },
        });
        return ok({ yaEstabaInactivo: false });
      },
    );
  };
}

/** Reactivar un medio de pago (e3 §3.2): lo mismo, hacia activo; ya activo → `yaEstabaActivo: true`. Auditoría `MEDIO_DE_PAGO_REACTIVADO`. */
export function armarReactivarMedioDePago({ transacciones, reglas }: DependenciasDeCaja) {
  return async function reactivarMedioDePago(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarEstadoDeMedioDePago,
  ): Promise<Resultado<SalidaDeReactivarMedioDePago, ErrorAlReactivarMedioDePago>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto },
      async (tx): Promise<Resultado<SalidaDeReactivarMedioDePago, ErrorComun>> => {
        const previo = await prepararCaso(
          tx,
          contexto,
          reglas,
          DECLARACIONES.reactivarMedioDePago.accion,
        );
        if (!previo.ok) return previo;
        const actual = await tx.mediosDePago.obtener(empresaId, entrada.medioDePagoId);
        if (actual === null) return err("MEDIO_NO_ENCONTRADO");
        if (decidirCambioDeEstado(actual.activo, true) === "YA_ESTABA") {
          return ok({ yaEstabaActivo: true });
        }
        const cambiado = await tx.mediosDePago.cambiarActivo(
          empresaId,
          actual.id,
          actual.version,
          true,
        );
        if (cambiado === null) return err("MEDIO_NO_ENCONTRADO");
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "MEDIO_DE_PAGO_REACTIVADO",
          entidad: "medio_de_pago",
          entidadId: actual.id,
          antes: { tipo: actual.tipo, nombre: actual.nombre, activo: false },
          despues: { tipo: cambiado.tipo, nombre: cambiado.nombre, activo: true },
        });
        return ok({ yaEstabaActivo: false });
      },
    );
  };
}
