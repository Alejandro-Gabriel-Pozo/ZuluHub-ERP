import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirCambioDeEstado,
  motivoValido,
  type ErrorDeMotivo,
  type EstadoDeCuenta,
} from "../dominio/condiciones";
import { aCuentaPublica, type CuentaPublica } from "./cuenta-publica";
import { dejarConstancia, prepararCaso } from "./comun";
import type { DependenciasDeCuentaCorriente } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeSuspenderCuenta = Readonly<{
  cuentaId: string;
  /** La versión que la pantalla tenía al abrir la ficha (control de versión optimista). */
  versionEsperada: number;
  motivo: string;
}>;

export type EntradaDeReactivarCuenta = Readonly<{ cuentaId: string; versionEsperada: number }>;

export type SalidaDeCambiarEstado = Readonly<{
  cuenta: CuentaPublica;
  /** `true`: la cuenta ya estaba en ese estado; no se escribió ni auditó nada. */
  yaEstaba: boolean;
}>;

type ErrorPropio = ErrorDeMotivo | "CUENTA_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA";

type ErrorDeReactivar =
  | ErrorPropio
  | "PARTE_NO_ENCONTRADA"
  | "PARTE_NO_ACTIVA"
  | "PARTE_NO_ES_CLIENTE"
  | "PARTE_SIN_CUIT_O_RAZON_SOCIAL";

export type ErrorAlSuspenderCuenta =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;
export type ErrorAlReactivarCuenta =
  ErrorDeReactivar | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

const RESTRICCIONES_AL_SUSPENDER = ["MOTIVO_INVALIDO"] as const;
const RESTRICCIONES_AL_REACTIVAR = [
  "PARTE_NO_ENCONTRADA",
  "PARTE_NO_ACTIVA",
  "PARTE_NO_ES_CLIENTE",
  "PARTE_SIN_CUIT_O_RAZON_SOCIAL",
] as const;

/**
 * Suspender o reactivar la cuenta de un cliente: el mismo camino con el estado pedido. Contexto OPERATIVO con persona, en una transacción serializable, con el
 * orden fijo: guard (`cuenta_corriente.administrar`), la empresa opera, la ficha (de otra empresa o inexistente: `CUENTA_NO_ENCONTRADA`, sin oráculo), validación
 * (suspender exige motivo) y el dominio decide (`decidirCambioDeEstado`):
 *  - ya está en el estado pedido → ok `yaEstaba` sin escribir ni auditar (repetir el pedido es idempotente, aunque la versión esperada sea vieja);
 *  - la versión esperada no es la vigente → `VERSION_DESACTUALIZADA`;
 *  - si no, `UPDATE` condicionado a la versión y auditoría con el antes y el después. Reactivar vuelve a exigir que el cliente pueda deber (disparador de la base).
 * Dos cambios simultáneos con la misma versión: gana uno; el otro, tras el reintento serializable, ve el estado nuevo.
 * La suspensión NO borra ni toca el saldo: el cliente sigue debiendo lo que debe. Qué impide la suspensión (cargar nuevas ventas a cuenta) lo hace CC-2.
 */
function armarCambioDeEstado(
  { transacciones, reglas }: DependenciasDeCuentaCorriente,
  pedido: EstadoDeCuenta,
) {
  const declaracion =
    pedido === "SUSPENDIDA"
      ? DECLARACIONES.suspenderCuentaDelCliente
      : DECLARACIONES.reactivarCuentaDelCliente;
  const admitidos =
    pedido === "SUSPENDIDA" ? RESTRICCIONES_AL_SUSPENDER : RESTRICCIONES_AL_REACTIVAR;
  return async function cambiarEstado(
    contexto: ContextoOperativo,
    entrada: Readonly<{ cuentaId: string; versionEsperada: number; motivo?: string }>,
  ): Promise<
    Resultado<
      SalidaDeCambiarEstado,
      ErrorDeReactivar | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia
    >
  > {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeCambiarEstado, ErrorDeReactivar | MotivoDeRechazo | EmpresaNoOpera>
      > => {
        const previo = await prepararCaso(tx, contexto, reglas, declaracion.accion);
        if (!previo.ok) return previo;
        const actual = await tx.cuentasDeClientes.obtener(empresaId, entrada.cuentaId);
        if (actual === null) return err("CUENTA_NO_ENCONTRADA");
        let motivo: string | null = null;
        if (pedido === "SUSPENDIDA") {
          const valido = motivoValido(entrada.motivo);
          if (!valido.ok) return valido;
          motivo = valido.valor;
        }

        if (decidirCambioDeEstado(actual.estado, pedido) === "YA_ESTABA") {
          return ok({ cuenta: aCuentaPublica(actual), yaEstaba: true });
        }
        if (entrada.versionEsperada !== actual.version) return err("VERSION_DESACTUALIZADA");

        const cambiada = await tx.cuentasDeClientes.cambiarEstado(
          empresaId,
          actual.id,
          actual.version,
          pedido,
          motivo,
        );
        if (cambiada === null) return err("VERSION_DESACTUALIZADA");
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion:
            pedido === "SUSPENDIDA"
              ? "CUENTA_DEL_CLIENTE_SUSPENDIDA"
              : "CUENTA_DEL_CLIENTE_REACTIVADA",
          entidadId: actual.id,
          antes: { estado: actual.estado, motivo: actual.motivoDeSuspension },
          despues: { estado: cambiada.estado, motivo: cambiada.motivoDeSuspension },
        });
        return ok({ cuenta: aCuentaPublica(cambiada), yaEstaba: false });
      },
    );
    return traducirErrores(resultado, admitidos);
  };
}

export function armarSuspenderCuentaDelCliente(dependencias: DependenciasDeCuentaCorriente) {
  const cambiar = armarCambioDeEstado(dependencias, "SUSPENDIDA");
  return (
    contexto: ContextoOperativo,
    entrada: EntradaDeSuspenderCuenta,
  ): Promise<Resultado<SalidaDeCambiarEstado, ErrorAlSuspenderCuenta>> =>
    cambiar(contexto, entrada) as Promise<Resultado<SalidaDeCambiarEstado, ErrorAlSuspenderCuenta>>;
}

export function armarReactivarCuentaDelCliente(dependencias: DependenciasDeCuentaCorriente) {
  const cambiar = armarCambioDeEstado(dependencias, "HABILITADA");
  return (
    contexto: ContextoOperativo,
    entrada: EntradaDeReactivarCuenta,
  ): Promise<Resultado<SalidaDeCambiarEstado, ErrorAlReactivarCuenta>> =>
    cambiar(contexto, entrada);
}
