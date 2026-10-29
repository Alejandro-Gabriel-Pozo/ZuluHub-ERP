import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { versionVigente } from "../dominio/vigencia";
import type {
  DomicilioGuardado,
  RepositorioDeEmisores,
  VersionDeDatosFiscales,
} from "../persistencia/repositorios";
import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * Los datos fiscales de un emisor tal como la pantalla de Datos fiscales los necesita para mostrarlos y editarlos a mano (D-43):
 * la versión que rige hoy y el borrador en curso, cada uno con su domicilio fiscal. Los de Ingresos Brutos NO salen: D-45 los deja
 * fuera de la primera versión de la pantalla y el backend los guarda vacíos. Trae también el CUIT del emisor, solo para mostrarlo
 * (D-65, confirmada por el dueño el 2026-10-29: «Datos fiscales muestra el CUIT de la empresa, solo para leer»; el CUIT es del emisor,
 * no de los datos que se versionan): para el principal es el de la empresa (`emisor.cuit`, el repositorio ya lo resuelve). De solo lectura.
 *
 * Exige `datos_fiscales.editar` (gerente, `administracion`) al guard dentro de su transacción. Un emisor de otra empresa es
 * indistinguible de uno que no existe.
 */

// Los tipos salen de lo que devuelve la persistencia, no del dominio: una consulta no lo importa (regla `consultas-sin-dominio`).
type Confirmada = Extract<VersionDeDatosFiscales, { estado: "CONFIRMADA" }>["confirmada"];
type Borrador = Extract<VersionDeDatosFiscales, { estado: "BORRADOR" }>["borrador"];
type EmisorId = Parameters<RepositorioDeEmisores["obtener"]>[1];

export type DomicilioParaLaPantalla = Readonly<{
  id: DomicilioGuardado["id"];
  calle: string;
  numero: string;
  piso: string | null;
  departamento: string | null;
  localidad: string;
  /** El código de la provincia (`AR-B`): la pantalla lo muestra con su lista de provincias. */
  provincia: string;
  codigoPostal: string | null;
}>;

export type DatosFiscalesVigentes = Readonly<{
  /** El id de la versión confirmada. */
  id: Confirmada["id"];
  numero: number;
  vigenteDesde: Date;
  razonSocial: string;
  condicionIva: Confirmada["condicionIva"];
  domicilio: DomicilioParaLaPantalla;
  /** Fecha civil `AAAA-MM-DD`. */
  inicioActividades: string;
}>;

export type BorradorDeDatosFiscales = Readonly<{
  /** El id del borrador: es la clave de idempotencia con la que se sigue guardando. */
  id: Borrador["id"];
  /** La versión que la pantalla manda al seguir guardando (control de versión optimista). */
  version: number;
  razonSocial: string | null;
  condicionIva: Borrador["condicionIva"];
  domicilio: DomicilioParaLaPantalla | null;
  inicioActividades: string | null;
}>;

export type DatosFiscalesDelEmisor = Readonly<{
  emisorId: EmisorId;
  /** El CUIT del emisor: 11 dígitos, sin guiones. Solo para leer. */
  cuit: string;
  vigente: DatosFiscalesVigentes | null;
  borrador: BorradorDeDatosFiscales | null;
}>;

export type EntradaDeDatosFiscalesDelEmisor = Readonly<{ emisorId: EmisorId }>;

export type ErrorAlVerLosDatosFiscales =
  MotivoDeRechazo | "EMISOR_NO_ENCONTRADO" | ErrorDePersistencia;

const aDomicilioParaLaPantalla = ({
  id,
  domicilio,
}: DomicilioGuardado): DomicilioParaLaPantalla => ({
  id,
  calle: domicilio.calle,
  numero: domicilio.numero,
  piso: domicilio.piso,
  departamento: domicilio.departamento,
  localidad: domicilio.localidad,
  provincia: domicilio.provincia,
  codigoPostal: domicilio.codigoPostal,
});

export function armarDatosFiscalesDelEmisor({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeFacturacion) {
  return async function datosFiscalesDelEmisor(
    contexto: ContextoOperativo,
    entrada: EntradaDeDatosFiscalesDelEmisor,
  ): Promise<Resultado<DatosFiscalesDelEmisor, ErrorAlVerLosDatosFiscales>> {
    const { empresaId, ahora } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<Resultado<DatosFiscalesDelEmisor, MotivoDeRechazo | "EMISOR_NO_ENCONTRADO">> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.datosFiscalesDelEmisor.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const emisor = await tx.emisores.obtener(empresaId, entrada.emisorId);
        if (emisor === null) return err("EMISOR_NO_ENCONTRADO");
        // La base lo impide (clave foránea): el domicilio de una versión siempre existe y es de la empresa.
        const domicilioDe = async (
          id: DomicilioGuardado["id"],
        ): Promise<DomicilioParaLaPantalla> => {
          const domicilio = await tx.domicilios.obtener(empresaId, id);
          if (domicilio === null) throw new Error("un domicilio fiscal que no existe");
          return aDomicilioParaLaPantalla(domicilio);
        };

        const regente = versionVigente(
          await tx.datosFiscales.confirmadas(empresaId, entrada.emisorId),
          ahora,
        );
        const vigente: DatosFiscalesVigentes | null =
          regente === null
            ? null
            : {
                id: regente.id,
                numero: regente.numero,
                vigenteDesde: regente.vigenteDesde,
                razonSocial: regente.razonSocial,
                condicionIva: regente.condicionIva,
                domicilio: await domicilioDe(regente.domicilioFiscalId),
                inicioActividades: regente.inicioActividades,
              };

        const enCurso = await tx.datosFiscales.obtenerBorrador(empresaId, entrada.emisorId);
        const borrador: BorradorDeDatosFiscales | null =
          enCurso === null
            ? null
            : {
                id: enCurso.id,
                version: enCurso.version,
                razonSocial: enCurso.razonSocial,
                condicionIva: enCurso.condicionIva,
                domicilio:
                  enCurso.domicilioFiscalId === null
                    ? null
                    : await domicilioDe(enCurso.domicilioFiscalId),
                inicioActividades: enCurso.inicioActividades,
              };
        return ok({ emisorId: entrada.emisorId, cuit: emisor.cuit, vigente, borrador });
      },
    );
  };
}
