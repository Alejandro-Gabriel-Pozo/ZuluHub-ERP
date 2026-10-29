import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { versionVigente } from "../dominio/vigencia";
import type { PuntoDeVentaGuardado, RepositorioDeEmisores } from "../persistencia/repositorios";
import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { situacionDelAmbiente, type SituacionDelCertificado } from "./estado-de-certificados";

/**
 * La lista de lo que falta de la configuración fiscal (D-43: «lista de lo que falta + una pantalla por tema»; D-47: se muestra el
 * emisor PRINCIPAL): el estado de las tres filas (Datos fiscales, Puntos de venta y Certificado de ARCA) con lo mínimo que la lista
 * necesita para pintarlas. Dice HECHOS, no textos: qué texto lleva cada estado («Pendiente», «Falta cargar», «Falta crear uno», D-46)
 * lo decide la pantalla cuando el dueño apruebe qué estado lleva cuál. De solo lectura y sin nada secreto: del certificado salen la
 * situación y el vencimiento, nunca la clave, el pedido (CSR), el PEM ni la huella.
 *
 * Exige `datos_fiscales.editar` (gerente, `administracion`) al guard dentro de su transacción: mirar la configuración es lo que
 * puede hacer quien la edita (ver `declaraciones.ts`). Todo se lee de la empresa del contexto: un emisor de otra empresa no existe.
 */

/**
 * `VIGENTES`: hay una versión confirmada que rige hoy (lo que pide emitir). `BORRADOR`: no rige ninguna pero hay un borrador
 * guardado sin confirmar. `SOLO_FUTUROS`: no hay borrador y las confirmadas empiezan a regir más adelante. `SIN_CARGAR`: no hay
 * nada.
 */
export type EstadoDeLosDatosFiscales = "VIGENTES" | "BORRADOR" | "SOLO_FUTUROS" | "SIN_CARGAR";

/** `CON_ACTIVOS`: al menos uno activo. `SIN_ACTIVOS`: hay pero todos están inactivos. `SIN_PUNTOS`: no hay ninguno. */
export type EstadoDeLosPuntosDeVenta = "CON_ACTIVOS" | "SIN_ACTIVOS" | "SIN_PUNTOS";

// Los tipos salen de lo que devuelve la persistencia, no del dominio: una consulta no lo importa (regla `consultas-sin-dominio`).
type Ambiente = PuntoDeVentaGuardado["ambiente"];
type EmisorId = Parameters<RepositorioDeEmisores["obtener"]>[1];

export type CertificadoParaLaLista = Readonly<{
  ambiente: Ambiente;
  situacion: SituacionDelCertificado["situacion"];
  /** Solo con certificado vigente: cuándo vence y si ya venció. */
  venceEn: Date | null;
  vencido: boolean;
}>;

export type EstadoDeLaConfiguracionFiscal = Readonly<{
  /** El emisor principal: es el que reciben las pantallas de cada tema. */
  emisorId: EmisorId;
  datosFiscales: Readonly<{ estado: EstadoDeLosDatosFiscales }>;
  puntosDeVenta: Readonly<{
    estado: EstadoDeLosPuntosDeVenta;
    total: number;
    activos: number;
    /** Los ambientes de los puntos de venta ACTIVOS (sin repetir): de cuál se necesita certificado. */
    ambientesEnUso: readonly Ambiente[];
  }>;
  /** Una situación por ambiente (homologación y producción), en ese orden. */
  certificados: readonly CertificadoParaLaLista[];
}>;

export type ErrorAlVerElEstadoDeLaConfiguracionFiscal =
  MotivoDeRechazo | "EMISOR_NO_ENCONTRADO" | ErrorDePersistencia;

export function armarEstadoDeLaConfiguracionFiscal({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeFacturacion) {
  return async function estadoDeLaConfiguracionFiscal(
    contexto: ContextoOperativo,
  ): Promise<Resultado<EstadoDeLaConfiguracionFiscal, ErrorAlVerElEstadoDeLaConfiguracionFiscal>> {
    const { empresaId, ahora } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<EstadoDeLaConfiguracionFiscal, MotivoDeRechazo | "EMISOR_NO_ENCONTRADO">
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.estadoDeLaConfiguracionFiscal.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const emisor = await tx.emisores.delPrincipal(empresaId);
        if (emisor === null) return err("EMISOR_NO_ENCONTRADO");

        const confirmadas = await tx.datosFiscales.confirmadas(empresaId, emisor.id);
        const hayBorrador = (await tx.datosFiscales.obtenerBorrador(empresaId, emisor.id)) !== null;
        const datos: EstadoDeLosDatosFiscales =
          versionVigente(confirmadas, ahora) !== null
            ? "VIGENTES"
            : hayBorrador
              ? "BORRADOR"
              : confirmadas.length > 0
                ? "SOLO_FUTUROS"
                : "SIN_CARGAR";

        const puntos = await tx.puntosDeVenta.listarDelEmisor(empresaId, emisor.id);
        const activos = puntos.filter((p) => p.estado === "ACTIVO");
        const ambientesEnUso = [...new Set(activos.map((p) => p.ambiente))].sort();

        const lecturas = await tx.lecturasDeCertificados.actualesDelEmisor(empresaId, emisor.id);
        const certificados = lecturas.map((lectura): CertificadoParaLaLista => {
          const situacion = situacionDelAmbiente(lectura, ahora);
          return situacion.situacion === "VIGENTE"
            ? {
                ambiente: situacion.ambiente,
                situacion: situacion.situacion,
                venceEn: situacion.venceEn,
                vencido: situacion.vencido,
              }
            : {
                ambiente: situacion.ambiente,
                situacion: situacion.situacion,
                venceEn: null,
                vencido: false,
              };
        });

        return ok({
          emisorId: emisor.id,
          datosFiscales: { estado: datos },
          puntosDeVenta: {
            estado:
              puntos.length === 0
                ? "SIN_PUNTOS"
                : activos.length === 0
                  ? "SIN_ACTIVOS"
                  : "CON_ACTIVOS",
            total: puntos.length,
            activos: activos.length,
            ambientesEnUso,
          },
          certificados,
        });
      },
    );
  };
}
