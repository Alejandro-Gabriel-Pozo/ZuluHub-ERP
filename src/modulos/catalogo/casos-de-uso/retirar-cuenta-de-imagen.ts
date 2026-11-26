import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { motivoDeRetiroDeCuentaDeImagenDesdeTexto } from "../../../primitivas/texto/motivo-de-retiro-de-cuenta-de-imagen";
import type { CuentaDeImagenDeclarada } from "../dominio/cuenta-de-imagen";
import { esUuid } from "../dominio/identificadores";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeRetirarCuentaDeImagen = Readonly<{
  id: string;
  motivo: string;
  /** La versión que vio quien retira: si otra persona cambió la cuenta antes, `VERSION_DESACTUALIZADA`. */
  versionEsperada: number;
}>;

export type SalidaDeRetirarCuentaDeImagen = Readonly<{
  cuenta: CuentaDeImagenDeclarada;
  /** `true` si no se escribió nada: ya estaba retirada. */
  yaEstaba: boolean;
}>;

/**
 * Retirar una cuenta de imagen declarada, con motivo (0102). No se borra: queda RETIRADA con quién, cuándo y por qué, y no vuelve a activarse (volver a declararla es una fila
 * nueva y deja su propio rastro). Los logos de las cartas que usaban esa cuenta dejan de mostrarse EN EL ACTO (el servidor trae solo de cuentas activas): no se toca ninguna
 * carta. Exige `vidrieras.administrar_cuentas_de_imagen` y alcance TODAS. Retirar dos veces es lo mismo que una (`yaEstaba`, sin escribir ni auditar); control de versión
 * optimista: dos retiros a la vez, o un retiro sobre una cuenta que cambió, no se pisan. Auditoría: `CUENTA_DE_IMAGEN_RETIRADA` en la misma transacción.
 */
export function armarRetirarCuentaDeImagen(dependencias: DependenciasDeCatalogo) {
  return async function retirarCuentaDeImagen(
    contexto: ContextoOperativo,
    entrada: EntradaDeRetirarCuentaDeImagen,
  ): Promise<R<SalidaDeRetirarCuentaDeImagen>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeRetirarCuentaDeImagen>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          DECLARACIONES.retirarCuentaDeImagen.accion,
        ]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        // Quien declara o retira queda registrado: sin persona (el sistema) no se puede.
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        if (!esUuid(entrada.id)) return err("CUENTA_DE_IMAGEN_NO_ENCONTRADA");
        if (!Number.isSafeInteger(entrada.versionEsperada)) return err("VERSION_DESACTUALIZADA");
        const motivo = motivoDeRetiroDeCuentaDeImagenDesdeTexto(entrada.motivo);
        if (!motivo.ok) return err("MOTIVO_DE_RETIRO_INVALIDO");

        const actual = await tx.cuentasDeImagen.bloquear(empresaId, entrada.id);
        if (actual === null) return err("CUENTA_DE_IMAGEN_NO_ENCONTRADA");
        if (actual.estado === "RETIRADA") return ok({ cuenta: actual, yaEstaba: true });
        if (actual.version !== entrada.versionEsperada) return err("VERSION_DESACTUALIZADA");
        const retirada = await tx.cuentasDeImagen.retirar(
          empresaId,
          actual.id,
          actual.version,
          persona,
          motivo.valor,
        );
        if (retirada === null) return err("VERSION_DESACTUALIZADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "CUENTA_DE_IMAGEN_RETIRADA",
          entidad: "cuenta_de_imagen_declarada",
          entidadId: retirada.id,
          antes: { proveedor: actual.proveedor, cuenta: actual.cuenta, estado: actual.estado },
          despues: {
            proveedor: retirada.proveedor,
            cuenta: retirada.cuenta,
            estado: retirada.estado,
            motivo: motivo.valor,
          },
        });
        return ok({ cuenta: retirada, yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}
