import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Dato } from "../../../puertos/sin-secretos";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  editarBorrador,
  nuevoBorrador,
  type CambiosDeBorrador,
  type DatosFiscalesBorrador,
  type ErrorDeDatosFiscales,
} from "../dominio/datos-fiscales";
import { esUuid, versionId, type EmisorId, type VersionId } from "../dominio/identificadores";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import { empresaOpera } from "./comun";
import {
  cambiosParaAuditar,
  dejarListoElDomicilio,
  personaQueActua,
  type DomicilioDeEntrada,
  type ErrorDeDomicilioDeEntrada,
} from "./comun-de-configuracion";
import type { DependenciasDeConfiguracionFiscal } from "./contrato-de-configuracion";
import { DECLARACIONES_DE_CONFIGURACION } from "./declaraciones-de-configuracion";

export type EntradaDeGuardarBorradorDeDatosFiscales = Readonly<{
  emisorId: EmisorId;
  /**
   * El identificador del borrador, un uuid que genera la pantalla: es la clave de idempotencia. Hay a lo sumo un
   * borrador por emisor; repetir el guardado con el mismo `borradorId` y el mismo contenido no escribe nada.
   */
  borradorId: string;
  /**
   * La versión del borrador que vio la pantalla. Se omite solo al crearlo; al cambiar uno que ya existe, tiene
   * que ser la vigente (control de versión optimista).
   */
  versionEsperada?: number | undefined;
  /** Lo que cambia; un campo ausente no se toca. El domicilio fiscal va aparte (`domicilio`). */
  cambios: Omit<CambiosDeBorrador, "domicilioFiscalId">;
  /** El domicilio fiscal: uno nuevo o uno existente. Omitido, el borrador conserva el que tiene. */
  domicilio?: DomicilioDeEntrada | undefined;
}>;

export type SalidaDeGuardarBorradorDeDatosFiscales = Readonly<{
  borradorId: VersionId;
  /** La versión del borrador después del guardado (la que la pantalla manda en el próximo cambio). */
  version: number;
  /** `true`: el borrador ya estaba así; no se escribió nada ni se auditó. */
  yaEstaba: boolean;
}>;

export type ErrorPropioAlGuardarElBorrador =
  | ErrorDeDatosFiscales
  | ErrorDeDomicilioDeEntrada
  | "ID_INVALIDO"
  | "ID_EN_USO"
  | "EMISOR_NO_ENCONTRADO"
  | "YA_HAY_BORRADOR"
  | "VERSION_CONFIRMADA_INMUTABLE"
  | "VERSION_DESACTUALIZADA";

export type ErrorAlGuardarElBorrador =
  ErrorPropioAlGuardarElBorrador | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Lo que la base puede rechazar al escribir y que es parte del contrato de este caso. */
const ADMITIDOS = [
  "YA_HAY_BORRADOR",
  "EMISOR_NO_ENCONTRADO",
  "DOMICILIO_NO_ENCONTRADO",
  "RAZON_SOCIAL_INVALIDA",
  "CONDICION_IVA_INVALIDA",
  "INICIO_DE_ACTIVIDADES_INVALIDO",
  "IIBB_NUMERO_INVALIDO",
  "IIBB_CONDICION_INVALIDA",
  "CALLE_INVALIDA",
  "NUMERO_INVALIDO",
  "PISO_INVALIDO",
  "DEPARTAMENTO_INVALIDO",
  "LOCALIDAD_INVALIDA",
  "PROVINCIA_INVALIDA",
  "CODIGO_POSTAL_INVALIDO",
] as const;

/** El contenido de un borrador como dato de auditoría (lo que cambia entre guardados, no la versión). */
export function contenidoDelBorrador(b: DatosFiscalesBorrador): Record<string, Dato> {
  return {
    razonSocial: b.razonSocial,
    condicionIva: b.condicionIva,
    domicilioFiscalId: b.domicilioFiscalId,
    inicioActividades: b.inicioActividades,
    iibbNumero: b.iibbNumero,
    iibbCondicion: b.iibbCondicion,
  };
}

/** Qué cambia de un borrador a otro (vacío si el contenido es el mismo). */
const diferenciaDe = (antes: DatosFiscalesBorrador, despues: DatosFiscalesBorrador) =>
  cambiosParaAuditar(contenidoDelBorrador(antes), contenidoDelBorrador(despues));

/**
 * Guardar el borrador de los datos fiscales de un emisor (spec H7 fiscal §C y §G.2), con su domicilio fiscal si
 * es nuevo. Solo el gerente (`datos_fiscales.editar`). Contexto OPERATIVO con persona. En UNA transacción
 * serializable: el guard primero, la empresa opera, la forma de los identificadores, el emisor existe (es de esta
 * empresa) y entonces:
 *
 *  - no hay borrador y el `borradorId` está libre → se crea (con el domicilio nuevo, si viene) y se audita
 *    `DATOS_FISCALES_BORRADOR_GUARDADO`;
 *  - hay borrador con ese `borradorId` → si lo pedido deja el mismo contenido, es la repetición: éxito sin
 *    escribir (aunque la versión esperada haya quedado vieja); si no, la versión esperada tiene que ser la
 *    vigente (`VERSION_DESACTUALIZADA`) y el cambio se guarda y se audita con el antes y el después;
 *  - hay un borrador con OTRO `borradorId` (lo empezó otra pestaña u otro dispositivo) → `YA_HAY_BORRADOR`: se vuelve a abrir el que
 *    existe, no se pisa;
 *  - el `borradorId` es el de una versión ya confirmada → `VERSION_CONFIRMADA_INMUTABLE`.
 *
 * El domicilio, el borrador y la auditoría se confirman juntos o ninguno. Dos guardados a la vez (dos pestañas del
 * mismo gerente, o un doble clic): la serializable aborta a uno y su reintento ve lo del otro (`YA_HAY_BORRADOR`,
 * `VERSION_DESACTUALIZADA` o la repetición); nunca se crean dos borradores (`datos_fiscales_borrador_uk`).
 */
export function armarGuardarBorradorDeDatosFiscales({
  transacciones,
  reglas,
}: DependenciasDeConfiguracionFiscal) {
  return async function guardarBorradorDeDatosFiscales(
    contexto: ContextoOperativo,
    entrada: EntradaDeGuardarBorradorDeDatosFiscales,
  ): Promise<Resultado<SalidaDeGuardarBorradorDeDatosFiscales, ErrorAlGuardarElBorrador>> {
    const { empresaId } = contexto;
    const persona = personaQueActua(contexto.personaId, "guardar el borrador de datos fiscales");
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeGuardarBorradorDeDatosFiscales,
          ErrorPropioAlGuardarElBorrador | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONFIGURACION.guardarBorradorDeDatosFiscales.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;
        if (!esUuid(entrada.borradorId)) return err("ID_INVALIDO");
        const borradorId = versionId(entrada.borradorId);

        const emisor = await tx.emisores.obtener(empresaId, entrada.emisorId);
        if (emisor === null) return err("EMISOR_NO_ENCONTRADO");
        const existente = await tx.datosFiscales.obtenerBorrador(empresaId, emisor.id);
        if (existente !== null && existente.id !== borradorId) return err("YA_HAY_BORRADOR");
        if (existente === null) {
          const previa = await tx.datosFiscales.obtener(empresaId, borradorId);
          if (previa?.estado === "CONFIRMADA") return err("VERSION_CONFIRMADA_INMUTABLE");
        }

        const domicilio =
          entrada.domicilio === undefined
            ? null
            : await dejarListoElDomicilio(tx, empresaId, entrada.domicilio);
        if (domicilio !== null && !domicilio.ok) return domicilio;

        const base =
          existente ??
          nuevoBorrador({ id: borradorId, empresaId, emisorId: emisor.id, creadoPor: persona });
        const editado = editarBorrador(base, {
          ...entrada.cambios,
          ...(domicilio === null ? {} : { domicilioFiscalId: domicilio.valor }),
        });
        if (!editado.ok) return editado;
        const nuevo = editado.valor;

        if (existente === null) {
          const alta = await tx.datosFiscales.crearBorrador(nuevo);
          if (!alta.ok) return alta;
          // Un `id` que ya es el borrador de OTRO emisor no es una repetición de este pedido.
          if (alta.valor.valor.emisorId !== emisor.id) return err("ID_EN_USO");
          if (!alta.valor.creado) {
            // Otro guardado del mismo `id` ganó entre la lectura y el alta: es la repetición si dejó lo mismo.
            return Object.keys(diferenciaDe(alta.valor.valor, nuevo).despues).length === 0
              ? ok({ borradorId, version: alta.valor.valor.version, yaEstaba: true })
              : err("VERSION_DESACTUALIZADA");
          }
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "DATOS_FISCALES_BORRADOR_GUARDADO",
            entidad: "datos_fiscales",
            entidadId: borradorId,
            despues: { emisorId: emisor.id, ...contenidoDelBorrador(alta.valor.valor) },
          });
          return ok({ borradorId, version: alta.valor.valor.version, yaEstaba: false });
        }

        const diferencia = diferenciaDe(existente, nuevo);
        if (Object.keys(diferencia.despues).length === 0) {
          return ok({ borradorId, version: existente.version, yaEstaba: true });
        }
        if (entrada.versionEsperada !== existente.version) return err("VERSION_DESACTUALIZADA");
        const guardado = await tx.datosFiscales.guardarBorrador(nuevo);
        if (guardado === null) return err("VERSION_DESACTUALIZADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "DATOS_FISCALES_BORRADOR_GUARDADO",
          entidad: "datos_fiscales",
          entidadId: borradorId,
          antes: { emisorId: emisor.id, ...diferencia.antes },
          despues: { emisorId: emisor.id, ...diferencia.despues },
        });
        return ok({ borradorId, version: guardado.version, yaEstaba: false });
      },
    );
    return traducirErroresDeFiscal(resultado, ADMITIDOS);
  };
}
