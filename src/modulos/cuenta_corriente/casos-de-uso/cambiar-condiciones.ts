import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirCambioDeCondiciones,
  limiteValido,
  plazoValido,
  type ErrorDeLimite,
  type ErrorDePlazo,
} from "../dominio/condiciones";
import { aCuentaPublica, type CuentaPublica } from "./cuenta-publica";
import { dejarConstancia, prepararCaso } from "./comun";
import type { DependenciasDeCuentaCorriente } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeCambiarCondiciones = Readonly<{
  cuentaId: string;
  /** La versión que la pantalla tenía al abrir la ficha (control de versión optimista). */
  versionEsperada: number;
  plazoDias: number;
  /** Texto decimal con punto y hasta 2 decimales (nunca `number`). */
  limite: string;
}>;

export type SalidaDeCambiarCondiciones = Readonly<{
  cuenta: CuentaPublica;
  /** `true`: las condiciones ya eran esas; no se escribió ni auditó nada. */
  sinCambios: boolean;
}>;

type ErrorPropio = ErrorDePlazo | ErrorDeLimite | "CUENTA_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA";

export type ErrorAlCambiarCondiciones =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

const RESTRICCIONES_ADMITIDAS = ["PLAZO_INVALIDO", "LIMITE_INVALIDO"] as const;

/**
 * Cambiar el plazo y el límite de la cuenta de un cliente (CC-1). Contexto OPERATIVO con persona, en una transacción serializable, con el orden fijo: guard
 * (`cuenta_corriente.administrar`), la empresa opera, la ficha (`CUENTA_NO_ENCONTRADA` si no existe o es de otra empresa), validación y el dominio decide:
 *  - ya son esas condiciones → ok `sinCambios` sin escribir ni auditar (aunque la versión esperada sea vieja);
 *  - la versión esperada no es la vigente → `VERSION_DESACTUALIZADA` (dos cambios a la vez con la misma versión: gana uno);
 *  - si no, `UPDATE` condicionado a la versión y auditoría `CUENTA_DEL_CLIENTE_CONDICIONES_CAMBIADAS` con el antes y el después.
 * Se puede cambiar también una cuenta suspendida. El límite solo se guarda: lo hace cumplir CC-2. Bajar el límite por debajo del saldo no toca el saldo.
 */
export function armarCambiarCondicionesDeLaCuenta({
  transacciones,
  reglas,
}: DependenciasDeCuentaCorriente) {
  return async function cambiarCondicionesDeLaCuenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarCondiciones,
  ): Promise<Resultado<SalidaDeCambiarCondiciones, ErrorAlCambiarCondiciones>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeCambiarCondiciones, ErrorPropio | MotivoDeRechazo | EmpresaNoOpera>
      > => {
        const previo = await prepararCaso(
          tx,
          contexto,
          reglas,
          DECLARACIONES.cambiarCondicionesDeLaCuenta.accion,
        );
        if (!previo.ok) return previo;
        const actual = await tx.cuentasDeClientes.obtener(empresaId, entrada.cuentaId);
        if (actual === null) return err("CUENTA_NO_ENCONTRADA");
        const plazo = plazoValido(entrada.plazoDias);
        if (!plazo.ok) return plazo;
        const limite = limiteValido(entrada.limite);
        if (!limite.ok) return limite;

        const pedido = { plazoDias: plazo.valor, limite: limite.valor };
        if (decidirCambioDeCondiciones(actual, pedido) === "SIN_CAMBIOS") {
          return ok({ cuenta: aCuentaPublica(actual), sinCambios: true });
        }
        if (entrada.versionEsperada !== actual.version) return err("VERSION_DESACTUALIZADA");

        const cambiada = await tx.cuentasDeClientes.cambiarCondiciones(
          empresaId,
          actual.id,
          actual.version,
          pedido.plazoDias,
          importeATexto(pedido.limite),
        );
        if (cambiada === null) return err("VERSION_DESACTUALIZADA");
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "CUENTA_DEL_CLIENTE_CONDICIONES_CAMBIADAS",
          entidadId: actual.id,
          antes: { plazoDias: actual.plazoDias, limite: importeATexto(actual.limite) },
          despues: { plazoDias: cambiada.plazoDias, limite: importeATexto(cambiada.limite) },
        });
        return ok({ cuenta: aCuentaPublica(cambiada), sinCambios: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
