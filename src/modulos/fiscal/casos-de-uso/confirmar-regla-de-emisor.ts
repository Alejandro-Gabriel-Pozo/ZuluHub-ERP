import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { esUuid, versionId, type VersionId } from "../dominio/identificadores";
import {
  confirmarReglaDeEmisor as confirmarEnElDominio,
  reglaDeEmisorVigente,
  type VersionGuardadaDeReglaDeEmisor,
} from "../dominio/resolucion-de-emisor";
import type { ErrorDeConfirmacion } from "../dominio/vigencia";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import { empresaOpera } from "./comun";
import { personaQueActua } from "./comun-de-configuracion";
import type { DependenciasDeConfiguracionFiscal } from "./contrato-de-configuracion";
import { DECLARACIONES_DE_CONFIGURACION } from "./declaraciones-de-configuracion";

export type EntradaDeConfirmarReglaDeEmisor = Readonly<{
  /** El identificador de la versión, un uuid que genera la pantalla: es la clave de idempotencia. */
  versionId: string;
  /** Si al facturar se puede elegir el emisor a mano (permitido por defecto). */
  permitirEleccionManual: boolean;
  /** Desde cuándo rige: no antes de ahora; puede ser futura. */
  vigenteDesde: Date;
  motivo: string;
}>;

export type SalidaDeConfirmarReglaDeEmisor = Readonly<{
  versionId: VersionId;
  /** El número de la versión confirmada (máximo + 1 entre las de la empresa). */
  numero: number;
  vigenteDesde: Date;
  /** `true`: esta misma versión ya estaba confirmada; no se escribió nada ni se auditó. */
  yaEstaba: boolean;
}>;

export type ErrorPropioAlConfirmarLaRegla =
  | ErrorDeConfirmacion
  | "ID_INVALIDO"
  | "ID_EN_USO"
  | "INSTANTE_INVALIDO"
  | "YA_HAY_BORRADOR"
  | "NUMERO_DE_VERSION_INVALIDO";

export type ErrorAlConfirmarLaRegla =
  ErrorPropioAlConfirmarLaRegla | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Lo que la base puede rechazar al confirmar y que es parte del contrato de este caso. */
const ADMITIDOS = ["NUMERO_DE_VERSION_INVALIDO", "YA_HAY_BORRADOR", "MOTIVO_OBLIGATORIO"] as const;

const salidaDe = (v: VersionGuardadaDeReglaDeEmisor, yaEstaba: boolean) =>
  ok<SalidaDeConfirmarReglaDeEmisor>({
    versionId: v.id,
    numero: v.numero,
    vigenteDesde: v.vigenteDesde,
    yaEstaba,
  });

/** ¿Pide lo mismo que esa versión ya confirmada? (Todo lo que el gerente manda, con el motivo recortado.) */
const pideLoMismo = (v: VersionGuardadaDeReglaDeEmisor, e: EntradaDeConfirmarReglaDeEmisor) =>
  v.permitirEleccionManual === e.permitirEleccionManual &&
  v.vigenteDesde.getTime() === e.vigenteDesde.getTime() &&
  v.motivo === e.motivo.trim();

/**
 * Confirmar una versión de la regla de resolución del emisor (spec H7 fiscal §B.6 y §C). Solo el gerente
 * (`emisores.confirmar_regla`). Contexto OPERATIVO con persona. Hoy la regla tiene un solo campo, así que crear el
 * borrador y confirmarlo es UN paso: en UNA transacción serializable, el guard primero, la empresa opera, la forma
 * del `versionId` y de la vigencia y entonces:
 *
 *  - ya hay una versión con ese `versionId` → si pide lo mismo, es la repetición (éxito, `yaEstaba`, sin escribir
 *    ni auditar); si pide otra cosa, `ID_EN_USO` (un `id` no se reusa para otra decisión);
 *  - si no, el dominio decide (`MOTIVO_OBLIGATORIO`, `VIGENCIA_RETROACTIVA`), se crea el borrador, se confirma con
 *    el número siguiente y se audita `REGLA_DE_EMISOR_CONFIRMADA` (con la regla que regía antes) en la misma
 *    transacción.
 *
 * La versión confirmada no se edita: para cambiarla se confirma otra (gana la de mayor vigencia y, a igual
 * vigencia, el número mayor). Dos confirmaciones simultáneas con ids distintos: la serializable aborta a una y su
 * reintento toma el número siguiente; no repiten número ni dejan un borrador a medias.
 */
export function armarConfirmarReglaDeEmisor({
  transacciones,
  reglas,
}: DependenciasDeConfiguracionFiscal) {
  return async function confirmarReglaDeEmisor(
    contexto: ContextoOperativo,
    entrada: EntradaDeConfirmarReglaDeEmisor,
  ): Promise<Resultado<SalidaDeConfirmarReglaDeEmisor, ErrorAlConfirmarLaRegla>> {
    const { empresaId } = contexto;
    const persona = personaQueActua(contexto.personaId, "confirmar la regla del emisor");
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeConfirmarReglaDeEmisor,
          ErrorPropioAlConfirmarLaRegla | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONFIGURACION.confirmarReglaDeEmisor.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;
        if (!esUuid(entrada.versionId)) return err("ID_INVALIDO");
        if (Number.isNaN(entrada.vigenteDesde.getTime())) return err("INSTANTE_INVALIDO");
        const id = versionId(entrada.versionId);

        const previa = await tx.reglasDeEmisor.obtener(empresaId, id);
        if (previa !== null) {
          if (previa.estado === "CONFIRMADA" && pideLoMismo(previa.confirmada, entrada)) {
            return salidaDe(previa.confirmada, true);
          }
          return err("ID_EN_USO");
        }

        const existentes = await tx.reglasDeEmisor.confirmadas(empresaId);
        const confirmada = confirmarEnElDominio(
          { permitirEleccionManual: entrada.permitirEleccionManual },
          existentes,
          {
            id,
            empresaId,
            ahora: contexto.ahora,
            vigenteDesde: entrada.vigenteDesde,
            motivo: entrada.motivo,
            confirmadaPor: persona,
          },
        );
        if (!confirmada.ok) return confirmada;

        const borrador = await tx.reglasDeEmisor.crearBorrador({
          id,
          empresaId,
          permitirEleccionManual: entrada.permitirEleccionManual,
          creadoPor: persona,
        });
        if (!borrador.ok) return borrador;
        if (!borrador.valor.creado) return err("ID_EN_USO");
        const guardada = await tx.reglasDeEmisor.confirmar(
          confirmada.valor,
          borrador.valor.valor.version,
        );
        // Recién creado en esta misma transacción: nadie pudo cambiarlo ni confirmarlo en el medio.
        if (guardada === null)
          throw new Error("invariante rota: el borrador recién creado se perdió");

        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "REGLA_DE_EMISOR_CONFIRMADA",
          entidad: "regla_emisor",
          entidadId: guardada.id,
          antes: reglaDeEmisorVigente(existentes, contexto.ahora),
          despues: {
            numero: guardada.numero,
            permitirEleccionManual: guardada.permitirEleccionManual,
            vigenteDesde: guardada.vigenteDesde.toISOString(),
            motivo: guardada.motivo,
          },
        });
        return salidaDe(guardada, false);
      },
    );
    return traducirErroresDeFiscal(resultado, ADMITIDOS);
  };
}
