import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { jornadaDeSucursal, type ErrorDeJornadaNoEnAuditoria } from "../../cierre/publico";
import { decidirPorHuella } from "../dominio/huella";
import {
  exigirClave,
  huellaDeConforme,
  type ErrorDeClave,
} from "../dominio/idempotencia-de-operacion";
import {
  dejarConstancia,
  exigirAlcance,
  prepararCaso,
  repetirSiOtroGano,
  sucursalDeLaEntrada,
  UNICAS_DEL_CONFORME,
} from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeDarConformeGeneral = Readonly<{
  /** La genera la pantalla al abrir el formulario: repetir el pedido no duplica el conforme. */
  claveDeIdempotencia: string;
  sucursalId: string;
  /** `YYYY-MM-DD`: la jornada que se está cerrando. */
  fechaDeNegocio: string;
}>;

export type SalidaDeDarConformeGeneral = Readonly<{
  conformeId: string;
  /** `true`: la jornada ya tenía su conforme general (de este pedido o de otro); no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio =
  | ErrorDeClave
  | ErrorDeJornadaNoEnAuditoria
  | "SUCURSAL_NO_ENCONTRADA"
  | "FECHA_INVALIDA"
  | "CLAVE_REUTILIZADA";

export type ErrorAlDarConformeGeneral =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el caso). */
const RESTRICCIONES_ADMITIDAS = ["CLAVE_DE_IDEMPOTENCIA_INVALIDA"] as const;

/**
 * El «conforme general» de la jornada (e3b §4.4; decisión 164): quien cierra el día acepta, con UN solo acto, lo registrado de TODOS los
 * medios que no son efectivo y que no declaró. Queda con quién y cuándo. NO cubre el efectivo (se cuenta siempre por billetes) y una
 * declaración explícita de un par gana siempre sobre él. Hay uno solo por jornada: repetirlo (la misma clave, o dos pestañas con claves
 * distintas) devuelve el que ya está con `yaExistia`. Contexto OPERATIVO con persona, en una transacción serializable, con el orden fijo: guard
 * (`declaraciones_de_total.registrar`, permitido en solo lectura), la empresa opera, alcance de sucursal, validación (fecha y clave),
 * idempotencia (la clave, ANTES de mirar el estado; después, por estado: ya hay conforme), la jornada `EN_AUDITORIA` (`FOR SHARE`) y el alta
 * con su auditoría `CONFORME_GENERAL_DADO`, en la misma transacción. Si la auditoría se cancela, el conforme sigue.
 */
export function armarDarConformeGeneral({ transacciones, reglas }: DependenciasDeCaja) {
  return async function darConformeGeneral(
    contexto: ContextoOperativo,
    entrada: EntradaDeDarConformeGeneral,
  ): Promise<Resultado<SalidaDeDarConformeGeneral, ErrorAlDarConformeGeneral>> {
    const { empresaId, ahora } = contexto;
    const ejecutar = () =>
      transacciones.ejecutar(
        { contexto },
        async (
          tx,
        ): Promise<
          Resultado<
            SalidaDeDarConformeGeneral,
            ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
          >
        > => {
          const previo = await prepararCaso(
            tx,
            contexto,
            reglas,
            DECLARACIONES.darConformeGeneral.accion,
          );
          if (!previo.ok) return previo;
          const sucursal = sucursalDeLaEntrada(entrada.sucursalId);
          if (!sucursal.ok) return sucursal;
          const alcance = await exigirAlcance(tx, contexto, sucursal.valor);
          if (!alcance.ok) return alcance;
          const fecha = fechaCivilDesdeTexto(entrada.fechaDeNegocio);
          if (!fecha.ok) return err("FECHA_INVALIDA");
          const clave = exigirClave(entrada.claveDeIdempotencia);
          if (!clave.ok) return clave;

          const huella = huellaDeConforme({
            sucursalId: sucursal.valor,
            fechaDeNegocio: fecha.valor,
          });
          const previa = await tx.declaraciones.conformePorClave(empresaId, clave.valor);
          if (decidirPorHuella(previa?.huella ?? null, huella) === "CLAVE_REUTILIZADA") {
            return err("CLAVE_REUTILIZADA");
          }
          if (previa !== null) return ok({ conformeId: previa.id, yaExistia: true });

          const enAuditoria = await jornadaDeSucursal.exigirEnAuditoriaEnTx(
            tx,
            empresaId,
            sucursal.valor,
            fecha.valor,
          );
          if (!enAuditoria.ok) return enAuditoria;

          const dado = await tx.declaraciones.conformeDeLaJornada(
            empresaId,
            sucursal.valor,
            fecha.valor,
          );
          if (dado !== null) return ok({ conformeId: dado.id, yaExistia: true });

          const conformeId = await tx.declaraciones.insertarConforme({
            empresa: empresaId,
            sucursalId: sucursal.valor,
            fechaDeNegocio: fecha.valor,
            conformePor: previo.valor.persona,
            conformeEn: ahora,
            claveDeIdempotencia: clave.valor,
            huella,
          });
          await dejarConstancia(tx, contexto, previo.valor.persona, {
            accion: "CONFORME_GENERAL_DADO",
            entidad: "conforme_de_jornada",
            entidadId: conformeId,
            despues: { sucursalId: sucursal.valor, fechaDeNegocio: fecha.valor },
          });
          return ok({ conformeId, yaExistia: false });
        },
      );
    const resultado = await repetirSiOtroGano(ejecutar, UNICAS_DEL_CONFORME);
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
