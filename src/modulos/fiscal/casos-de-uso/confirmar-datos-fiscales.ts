import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  confirmarDatosFiscales as confirmarEnElDominio,
  type DatosFiscalesConfirmados,
  type ErrorDeDatosFiscales,
} from "../dominio/datos-fiscales";
import { esUuid, versionId, type EmisorId, type VersionId } from "../dominio/identificadores";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import { empresaOpera } from "./comun";
import { personaQueActua } from "./comun-de-configuracion";
import type { DependenciasDeConfiguracionFiscal } from "./contrato-de-configuracion";
import { DECLARACIONES_DE_CONFIGURACION } from "./declaraciones-de-configuracion";

export type EntradaDeConfirmarDatosFiscales = Readonly<{
  emisorId: EmisorId;
  /** El borrador que se confirma (un uuid: es el mismo `id` que le puso la pantalla al guardarlo). */
  borradorId: string;
  /** La versión del borrador que vio la pantalla: se confirma lo que la persona tenía delante. */
  versionEsperada: number;
  /** Desde cuándo rige: no antes de ahora; puede ser futura. */
  vigenteDesde: Date;
  motivo: string;
}>;

export type SalidaDeConfirmarDatosFiscales = Readonly<{
  borradorId: VersionId;
  /** El número de la versión confirmada (máximo + 1 entre las del emisor). */
  numero: number;
  vigenteDesde: Date;
  /** `true`: ya estaba confirmada; no se escribió nada ni se auditó. */
  yaEstaba: boolean;
}>;

export type ErrorPropioAlConfirmarDatosFiscales =
  | ErrorDeDatosFiscales
  | "ID_INVALIDO"
  | "INSTANTE_INVALIDO"
  | "EMISOR_NO_ENCONTRADO"
  | "DATOS_FISCALES_NO_ENCONTRADOS"
  | "VERSION_DESACTUALIZADA"
  | "NUMERO_DE_VERSION_INVALIDO";

export type ErrorAlConfirmarDatosFiscales =
  ErrorPropioAlConfirmarDatosFiscales | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Lo que la base puede rechazar al confirmar y que es parte del contrato de este caso. */
const ADMITIDOS = ["NUMERO_DE_VERSION_INVALIDO", "MOTIVO_OBLIGATORIO"] as const;

const salidaDe = (c: DatosFiscalesConfirmados, yaEstaba: boolean) =>
  ok<SalidaDeConfirmarDatosFiscales>({
    borradorId: c.id,
    numero: c.numero,
    vigenteDesde: c.vigenteDesde,
    yaEstaba,
  });

/**
 * Confirmar los datos fiscales de un emisor (spec H7 fiscal §B.3, §C y §G.2): el borrador pasa a una versión
 * CONFIRMADA e inmutable, con su número, su vigencia, quién la confirmó y por qué. Solo el gerente
 * (`datos_fiscales.confirmar`). Contexto OPERATIVO con persona. En UNA transacción serializable: el guard primero,
 * la empresa opera, la forma del `borradorId` y de la vigencia, el emisor existe y entonces:
 *
 *  - el borrador no existe en este emisor → `DATOS_FISCALES_NO_ENCONTRADOS`;
 *  - ya está confirmado → «ya estaba»: éxito con su número y su vigencia, sin escribir (confirmar dos veces es
 *    una repetición, no un error);
 *  - sigue en borrador pero la versión esperada no es la vigente → `VERSION_DESACTUALIZADA` (alguien lo cambió
 *    después de que la persona lo vio: no se confirma lo que no vio);
 *  - si no, el dominio decide (`DATOS_FISCALES_INCOMPLETOS` con lo que falta, `MOTIVO_OBLIGATORIO`,
 *    `VIGENCIA_RETROACTIVA`) y se confirma con `UPDATE` condicionado al estado y a la versión, y la auditoría
 *    `DATOS_FISCALES_CONFIRMADOS` va en la misma transacción.
 *
 * El número es el máximo + 1 bajo serializable: dos confirmaciones del mismo emisor nunca repiten número (la
 * perdedora reintenta, ve la confirmada y devuelve «ya estaba» si era el mismo borrador).
 */
export function armarConfirmarDatosFiscales({
  transacciones,
  reglas,
}: DependenciasDeConfiguracionFiscal) {
  return async function confirmarDatosFiscales(
    contexto: ContextoOperativo,
    entrada: EntradaDeConfirmarDatosFiscales,
  ): Promise<Resultado<SalidaDeConfirmarDatosFiscales, ErrorAlConfirmarDatosFiscales>> {
    const { empresaId } = contexto;
    const persona = personaQueActua(contexto.personaId, "confirmar los datos fiscales");
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeConfirmarDatosFiscales,
          ErrorPropioAlConfirmarDatosFiscales | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONFIGURACION.confirmarDatosFiscales.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;
        if (!esUuid(entrada.borradorId)) return err("ID_INVALIDO");
        if (Number.isNaN(entrada.vigenteDesde.getTime())) return err("INSTANTE_INVALIDO");
        const borradorId = versionId(entrada.borradorId);

        const emisor = await tx.emisores.obtener(empresaId, entrada.emisorId);
        if (emisor === null) return err("EMISOR_NO_ENCONTRADO");
        const version = await tx.datosFiscales.obtener(empresaId, borradorId);
        // Una versión de otro emisor de la misma empresa no es de este: para quien pregunta, no existe.
        const emisorDeLaVersion =
          version === null
            ? null
            : version.estado === "CONFIRMADA"
              ? version.confirmada.emisorId
              : version.borrador.emisorId;
        if (version === null || emisorDeLaVersion !== emisor.id) {
          return err("DATOS_FISCALES_NO_ENCONTRADOS");
        }
        if (version.estado === "CONFIRMADA") return salidaDe(version.confirmada, true);

        const borrador = version.borrador;
        if (borrador.version !== entrada.versionEsperada) return err("VERSION_DESACTUALIZADA");
        const existentes = await tx.datosFiscales.confirmadas(empresaId, emisor.id);
        const confirmada = confirmarEnElDominio(borrador, existentes, {
          ahora: contexto.ahora,
          vigenteDesde: entrada.vigenteDesde,
          motivo: entrada.motivo,
          confirmadaPor: persona,
        });
        if (!confirmada.ok) return confirmada;

        const guardada = await tx.datosFiscales.confirmar(confirmada.valor);
        if (guardada === null) return err("VERSION_DESACTUALIZADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "DATOS_FISCALES_CONFIRMADOS",
          entidad: "datos_fiscales",
          entidadId: guardada.id,
          antes: { estado: "BORRADOR" },
          despues: {
            estado: "CONFIRMADA",
            emisorId: guardada.emisorId,
            numero: guardada.numero,
            razonSocial: guardada.razonSocial,
            condicionIva: guardada.condicionIva,
            domicilioFiscalId: guardada.domicilioFiscalId,
            inicioActividades: guardada.inicioActividades,
            iibbNumero: guardada.iibbNumero,
            iibbCondicion: guardada.iibbCondicion,
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
