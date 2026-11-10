import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { importeATexto, type ImporteJson } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { jornadaDeSucursal } from "../../cierre/publico";
import { decidirPorHuella } from "../dominio/huella";
import {
  exigirClave,
  huellaDeAjuste,
  type ErrorDeClave,
} from "../dominio/idempotencia-de-operacion";
import type { ErrorDeImporte } from "../dominio/importes";
import { validarParDeCobro, type ErrorDeParDeCobro } from "../dominio/medios";
import { decidirAjuste, type ErrorDeJornadaACorregir } from "../dominio/movimiento";
import { exigirSesionAbierta } from "../dominio/sesion";
import {
  cargarSesion,
  dejarConstancia,
  prepararCaso,
  repetirSiOtroGano,
  UNICAS_DEL_MOVIMIENTO,
} from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeRegistrarAjuste = Readonly<{
  /** La genera la pantalla al abrir el formulario: repetir el pedido (doble clic, reintento de red) no duplica el ajuste. */
  claveDeIdempotencia: string;
  sesionId: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  /** Con signo y distinto de cero: el ajuste suma o resta al esperado del medio. */
  importe: ImporteJson;
  motivo: string;
  /** `YYYY-MM-DD`: la jornada ya cerrada que este ajuste explica (e3 §3.11.3). `null` es el ajuste común de la sesión abierta. */
  corrigeJornada: string | null;
}>;

export type SalidaDeRegistrarAjuste = Readonly<{
  movimientoId: string;
  /** `true`: ya se había registrado con esta clave; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio =
  | ErrorDeClave
  | ErrorDeImporte
  | ErrorDeJornadaACorregir
  | ErrorDeParDeCobro
  | "MOTIVO_INVALIDO"
  | "CLAVE_REUTILIZADA"
  | "SESION_NO_ENCONTRADA"
  | "SESION_EN_CIERRE"
  | "SESION_CERRADA";

export type ErrorAlRegistrarAjuste =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio). */
const RESTRICCIONES_ADMITIDAS = [
  "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
  "IMPORTE_INVALIDO",
  "MOTIVO_INVALIDO",
  "SESION_NO_ENCONTRADA",
  "MEDIO_NO_ENCONTRADO",
  "CUENTA_DE_COBRO_NO_ENCONTRADA",
  "JORNADA_A_CORREGIR_NO_ENCONTRADA",
  "JORNADA_A_CORREGIR_NO_CERRADA",
  "JORNADA_A_CORREGIR_NO_ANTERIOR",
] as const;

/**
 * Registrar un ajuste de caja en una sesión abierta (e3 §3.2 y §3.11.3): dinero real sin otro registro, de cualquier medio, con signo y
 * motivo. Solo gerente y administrador (lo decide el catálogo de permisos). Contexto OPERATIVO con persona, en una transacción serializable,
 * con el orden fijo: guard (`movimientos_caja.ajustar`, bloqueado en solo lectura), la empresa opera, la sesión (con alcance), validación
 * (clave, importe, motivo y el enlace `corrigeJornada`, que exige una jornada de la sucursal CERRADA y anterior a la de la sesión),
 * idempotencia (la clave, ANTES de mirar el estado), la sesión `ABIERTA`, y el medio y la cuenta (activos, compatibles, de la sucursal).
 * Con `corrigeJornada` el ajuste cae igual en la sesión de hoy y en SU fecha de negocio: la jornada cerrada no cambia, solo queda enlazada.
 * El ajuste y su auditoría `AJUSTE_REGISTRADO` (con `corrigeJornada`) van en la misma transacción; no lleva la clave ni la huella.
 */
export function armarRegistrarAjuste({ transacciones, reglas }: DependenciasDeCaja) {
  return async function registrarAjuste(
    contexto: ContextoOperativo,
    entrada: EntradaDeRegistrarAjuste,
  ): Promise<Resultado<SalidaDeRegistrarAjuste, ErrorAlRegistrarAjuste>> {
    const { empresaId, ahora } = contexto;
    const ejecutar = () =>
      transacciones.ejecutar(
        { contexto },
        async (
          tx,
        ): Promise<
          Resultado<
            SalidaDeRegistrarAjuste,
            ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
          >
        > => {
          const previo = await prepararCaso(
            tx,
            contexto,
            reglas,
            DECLARACIONES.registrarAjuste.accion,
          );
          if (!previo.ok) return previo;
          const sesion = await cargarSesion(tx, contexto, entrada.sesionId);
          if (!sesion.ok) return sesion;
          const clave = exigirClave(entrada.claveDeIdempotencia);
          if (!clave.ok) return clave;

          // Una fecha que no es una fecha del calendario no puede ser una jornada que existe.
          let corrige: FechaCivil | null = null;
          if (entrada.corrigeJornada !== null) {
            const fecha = fechaCivilDesdeTexto(entrada.corrigeJornada);
            if (!fecha.ok) return err("JORNADA_A_CORREGIR_NO_ENCONTRADA");
            corrige = fecha.valor;
          }
          const estadoDeLaJornada =
            corrige === null
              ? null
              : await jornadaDeSucursal.estadoDeJornada(
                  tx,
                  empresaId,
                  sesion.valor.sucursalId,
                  corrige,
                );
          const ajuste = decidirAjuste({
            importe: entrada.importe,
            motivo: entrada.motivo,
            corrigeJornada: corrige,
            jornadaACorregir:
              estadoDeLaJornada === null || estadoDeLaJornada === "SIN_ACTIVIDAD"
                ? null
                : { estado: estadoDeLaJornada },
            fechaDeLaSesion: sesion.valor.fechaDeNegocio,
          });
          if (!ajuste.ok) return ajuste;

          const huella = huellaDeAjuste({
            sesionId: sesion.valor.id,
            medioDePagoId: entrada.medioDePagoId,
            cuentaDeCobroId: entrada.cuentaDeCobroId,
            importe: ajuste.valor.importe,
            motivo: ajuste.valor.motivo,
            corrigeJornada: ajuste.valor.corrigeJornada,
          });
          const previa = await tx.movimientos.obtenerPorClave(empresaId, clave.valor);
          const repeticion = decidirPorHuella(previa?.huella ?? null, huella);
          if (repeticion === "CLAVE_REUTILIZADA") return err("CLAVE_REUTILIZADA");
          if (previa !== null) return ok({ movimientoId: previa.id, yaExistia: true });

          const abierta = exigirSesionAbierta(sesion.valor.estado);
          if (!abierta.ok) return abierta;

          const medio = await tx.mediosDePago.obtener(empresaId, entrada.medioDePagoId);
          const cuenta =
            entrada.cuentaDeCobroId === null
              ? null
              : await tx.cuentasDeCobro.obtener(empresaId, entrada.cuentaDeCobroId);
          const par = validarParDeCobro({
            medio,
            cuentaDeCobroId: entrada.cuentaDeCobroId,
            cuenta,
            sucursalDeLaCaja: sesion.valor.sucursalId,
          });
          if (!par.ok) return par;

          const movimientoId = await tx.movimientos.insertar({
            empresa: empresaId,
            sesionId: sesion.valor.id,
            clase: "AJUSTE",
            medioDePagoId: entrada.medioDePagoId,
            cuentaDeCobroId: entrada.cuentaDeCobroId,
            importe: ajuste.valor.importe,
            motivo: ajuste.valor.motivo,
            anulaA: null,
            corrigeJornada: ajuste.valor.corrigeJornada,
            registradoEn: ahora,
            registradoPor: previo.valor.persona,
            claveDeIdempotencia: clave.valor,
            huella,
          });
          await dejarConstancia(tx, contexto, previo.valor.persona, {
            accion: "AJUSTE_REGISTRADO",
            entidad: "movimiento_caja",
            entidadId: movimientoId,
            despues: {
              sesionId: sesion.valor.id,
              medioDePagoId: entrada.medioDePagoId,
              cuentaDeCobroId: entrada.cuentaDeCobroId,
              importe: importeATexto(ajuste.valor.importe),
              motivo: ajuste.valor.motivo,
              corrigeJornada: ajuste.valor.corrigeJornada,
            },
          });
          return ok({ movimientoId, yaExistia: false });
        },
      );
    const resultado = await repetirSiOtroGano(ejecutar, UNICAS_DEL_MOVIMIENTO);
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
