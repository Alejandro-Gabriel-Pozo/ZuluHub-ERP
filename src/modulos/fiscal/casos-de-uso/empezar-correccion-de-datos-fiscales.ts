import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { borradorDesdeConfirmada } from "../dominio/datos-fiscales";
import { esUuid, versionId, type EmisorId, type VersionId } from "../dominio/identificadores";
import { versionVigente } from "../dominio/vigencia";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import { empresaOpera } from "./comun";
import { personaQueActua } from "./comun-de-configuracion";
import type { DependenciasDeConfiguracionFiscal } from "./contrato-de-configuracion";
import { DECLARACIONES_DE_CONFIGURACION } from "./declaraciones-de-configuracion";
import { contenidoDelBorrador } from "./guardar-borrador-de-datos-fiscales";

export type EntradaDeEmpezarCorreccionDeDatosFiscales = Readonly<{
  emisorId: EmisorId;
  /**
   * El identificador del borrador que se crea, un uuid que genera la pantalla: es la clave de idempotencia, igual que en
   * `guardarBorradorDeDatosFiscales`.
   */
  borradorId: string;
}>;

export type SalidaDeEmpezarCorreccionDeDatosFiscales = Readonly<{
  /** El borrador con el que sigue la pantalla: el que se creó o el que ya había (puede no ser el `borradorId` pedido). */
  borradorId: VersionId;
  /** La versión del borrador (la que la pantalla manda en el próximo guardado). */
  version: number;
  /** `true`: ya había un borrador de este emisor; no se escribió nada ni se auditó. */
  yaEstaba: boolean;
}>;

export type ErrorPropioAlEmpezarLaCorreccion =
  | "ID_INVALIDO"
  | "ID_EN_USO"
  | "EMISOR_NO_ENCONTRADO"
  | "YA_HAY_BORRADOR"
  | "VERSION_CONFIRMADA_INMUTABLE"
  | "SIN_DATOS_FISCALES_VIGENTES";

export type ErrorAlEmpezarLaCorreccion =
  ErrorPropioAlEmpezarLaCorreccion | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Lo que la base puede rechazar al escribir y que es parte del contrato de este caso. */
const ADMITIDOS = ["YA_HAY_BORRADOR"] as const;

/**
 * Empezar a corregir los datos fiscales ya confirmados de un emisor (D-62, `Pedernal-docs/11-especificaciones/
 * facturador-contratos-de-pantalla.md`, confirmada por el dueño el 2026-10-29: «para corregir datos ya confirmados la pantalla
 * precarga lo vigente y se confirma de nuevo = versión nueva»): crea el borrador del emisor a partir de la versión que rige hoy
 * (`borradorDesdeConfirmada`) para que la persona cambie solo lo que cambió. Solo el gerente (`datos_fiscales.editar`, la misma
 * acción que guardar el borrador: crear uno es editar). Contexto OPERATIVO con persona. En UNA transacción serializable: el guard
 * primero, la empresa opera, la forma del `borradorId`, el emisor existe (es de esta empresa) y entonces:
 *
 *  - ya hay un borrador del emisor, sea el `borradorId` pedido (la repetición) o el de otra pestaña u otro dispositivo → se
 *    devuelve ESE borrador con `yaEstaba`, sin escribir ni auditar (el borrador es del emisor, no de la pestaña: la pantalla
 *    siempre abre el que existe);
 *  - el `borradorId` es el de una versión ya confirmada → `VERSION_CONFIRMADA_INMUTABLE`; el de un borrador de otro emisor,
 *    `ID_EN_USO`;
 *  - no hay versión que rija hoy (nada confirmado, o solo versiones futuras) → `SIN_DATOS_FISCALES_VIGENTES`: no hay nada que
 *    corregir, se empieza de cero con `guardarBorradorDeDatosFiscales`;
 *  - si no, se crea el borrador con los valores de la vigente y se audita `DATOS_FISCALES_BORRADOR_GUARDADO` con el contenido y
 *    la versión de la que parte (`desdeNumero`), todo en la misma transacción.
 *
 * Dos «empezar corrección» a la vez (otra pestaña, un doble clic): la base solo admite un borrador por emisor
 * (`datos_fiscales_borrador_uk`). Quien pierde la carrera por esa restricción (`YA_HAY_BORRADOR`) repite UNA vez la lectura en una
 * transacción nueva, que ya ve al ganador y lo devuelve: nunca se crean dos borradores y ninguno de los dos recibe un error por
 * haber llegado segundo.
 */
export function armarEmpezarCorreccionDeDatosFiscales({
  transacciones,
  reglas,
}: DependenciasDeConfiguracionFiscal) {
  return async function empezarCorreccionDeDatosFiscales(
    contexto: ContextoOperativo,
    entrada: EntradaDeEmpezarCorreccionDeDatosFiscales,
  ): Promise<Resultado<SalidaDeEmpezarCorreccionDeDatosFiscales, ErrorAlEmpezarLaCorreccion>> {
    const { empresaId, ahora } = contexto;
    const persona = personaQueActua(contexto.personaId, "empezar la corrección de datos fiscales");

    const intentar = async () =>
      traducirErroresDeFiscal(
        await transacciones.ejecutar(
          { contexto },
          async (
            tx,
          ): Promise<
            Resultado<
              SalidaDeEmpezarCorreccionDeDatosFiscales,
              ErrorPropioAlEmpezarLaCorreccion | MotivoDeRechazo | EmpresaNoOpera
            >
          > => {
            const permiso = await exigirAccion(
              reglas,
              DECLARACIONES_DE_CONFIGURACION.empezarCorreccionDeDatosFiscales.accion,
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
            if (existente !== null) {
              return ok({ borradorId: existente.id, version: existente.version, yaEstaba: true });
            }
            const previa = await tx.datosFiscales.obtener(empresaId, borradorId);
            if (previa?.estado === "CONFIRMADA") return err("VERSION_CONFIRMADA_INMUTABLE");

            const vigente = versionVigente(
              await tx.datosFiscales.confirmadas(empresaId, emisor.id),
              ahora,
            );
            if (vigente === null) return err("SIN_DATOS_FISCALES_VIGENTES");

            const nuevo = borradorDesdeConfirmada(vigente, { id: borradorId, creadoPor: persona });
            const alta = await tx.datosFiscales.crearBorrador(nuevo);
            if (!alta.ok) return alta;
            // Un `id` que ya es el borrador de OTRO emisor no es una repetición de este pedido.
            if (alta.valor.valor.emisorId !== emisor.id) return err("ID_EN_USO");
            if (!alta.valor.creado) {
              // Otro pedido con el mismo `id` ganó entre la lectura y el alta: es la repetición, y ya está hecho.
              return ok({
                borradorId,
                version: alta.valor.valor.version,
                yaEstaba: true,
              });
            }
            await tx.auditoria.registrar({
              empresaId,
              actorPersonaId: persona,
              accion: "DATOS_FISCALES_BORRADOR_GUARDADO",
              entidad: "datos_fiscales",
              entidadId: borradorId,
              despues: {
                emisorId: emisor.id,
                ...contenidoDelBorrador(alta.valor.valor),
                desdeNumero: vigente.numero,
              },
            });
            return ok({ borradorId, version: alta.valor.valor.version, yaEstaba: false });
          },
        ),
        ADMITIDOS,
      );

    const primero = await intentar();
    if (primero.ok || primero.error !== "YA_HAY_BORRADOR") return primero;
    return intentar();
  };
}
