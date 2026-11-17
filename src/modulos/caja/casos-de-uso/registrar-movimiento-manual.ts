import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { importeATexto, type ImporteJson } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirPorHuella } from "../dominio/huella";
import {
  exigirClave,
  huellaDeMovimientoManual,
  type ErrorDeClave,
} from "../dominio/idempotencia-de-operacion";
import { sumarImportes, type ErrorDeImporte } from "../dominio/importes";
import { decidirMovimientoManual, egresoSuperaElEfectivo } from "../dominio/movimiento";
import { exigirSesionAbierta } from "../dominio/sesion";
import {
  cargarSesion,
  dejarConstancia,
  prepararCaso,
  repetirSiOtroGano,
  UNICAS_DEL_MOVIMIENTO,
  REINTENTOS_EN_LA_SESION_DE_CAJA,
} from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeRegistrarMovimientoManual = Readonly<{
  /** La genera la pantalla al abrir el formulario: repetir el pedido (doble clic, reintento de red) no duplica el movimiento. */
  claveDeIdempotencia: string;
  sesionId: string;
  sentido: "INGRESO" | "EGRESO";
  /** El monto en positivo: el egreso se guarda con signo negativo. Solo efectivo. */
  importe: ImporteJson;
  motivo: string;
}>;

export type SalidaDeRegistrarMovimientoManual = Readonly<{
  movimientoId: string;
  /** `true`: ya se había registrado con esta clave; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio =
  | ErrorDeClave
  | ErrorDeImporte
  | "MOTIVO_INVALIDO"
  | "CLAVE_REUTILIZADA"
  | "SESION_NO_ENCONTRADA"
  | "SESION_EN_CIERRE"
  | "SESION_CERRADA";

export type ErrorAlRegistrarMovimientoManual =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio). */
const RESTRICCIONES_ADMITIDAS = [
  "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
  "IMPORTE_INVALIDO",
  "MOTIVO_INVALIDO",
  "SESION_NO_ENCONTRADA",
] as const;

/**
 * Registrar un ingreso o un egreso de efectivo en una sesión abierta (e3 §3.2). Contexto OPERATIVO con persona, en una transacción
 * serializable, con el orden fijo: guard (`movimientos_caja.registrar_manual`, bloqueado en solo lectura), la empresa opera, la sesión
 * (con alcance sobre su sucursal), validación (clave, importe y motivo), idempotencia (la clave, ANTES de mirar el estado de la sesión:
 * un reintento tras el cierre devuelve lo hecho; otra huella con la misma clave → `CLAVE_REUTILIZADA`) y las reglas: solo una sesión
 * `ABIERTA` admite movimientos (`SESION_EN_CIERRE`, `SESION_CERRADA`). Un egreso mayor al efectivo esperado se PERMITE (el esperado puede
 * quedar negativo) y deja la entrada de auditoría `EGRESO_SUPERA_EFECTIVO`. El movimiento y su auditoría `MOVIMIENTO_MANUAL_REGISTRADO` van
 * en la misma transacción; la auditoría no lleva la clave ni la huella.
 */
export function armarRegistrarMovimientoManual({ transacciones, reglas }: DependenciasDeCaja) {
  return async function registrarMovimientoManual(
    contexto: ContextoOperativo,
    entrada: EntradaDeRegistrarMovimientoManual,
  ): Promise<Resultado<SalidaDeRegistrarMovimientoManual, ErrorAlRegistrarMovimientoManual>> {
    const { empresaId, ahora } = contexto;
    const ejecutar = () =>
      transacciones.ejecutar(
        { contexto, reintentos: REINTENTOS_EN_LA_SESION_DE_CAJA },
        async (
          tx,
        ): Promise<
          Resultado<
            SalidaDeRegistrarMovimientoManual,
            ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
          >
        > => {
          const previo = await prepararCaso(
            tx,
            contexto,
            reglas,
            DECLARACIONES.registrarMovimientoManual.accion,
          );
          if (!previo.ok) return previo;
          const sesion = await cargarSesion(tx, contexto, entrada.sesionId);
          if (!sesion.ok) return sesion;
          const clave = exigirClave(entrada.claveDeIdempotencia);
          if (!clave.ok) return clave;
          const movimiento = decidirMovimientoManual(entrada);
          if (!movimiento.ok) return movimiento;

          const huella = huellaDeMovimientoManual({
            sesionId: sesion.valor.id,
            clase: movimiento.valor.clase,
            importe: movimiento.valor.importe,
            motivo: movimiento.valor.motivo,
          });
          const previa = await tx.movimientos.obtenerPorClave(empresaId, clave.valor);
          const repeticion = decidirPorHuella(previa?.huella ?? null, huella);
          if (repeticion === "CLAVE_REUTILIZADA") return err("CLAVE_REUTILIZADA");
          if (previa !== null) return ok({ movimientoId: previa.id, yaExistia: true });

          const abierta = exigirSesionAbierta(sesion.valor.estado);
          if (!abierta.ok) return abierta;

          const efectivo = await tx.mediosDePago.obtenerEfectivo(empresaId);
          if (efectivo === null) throw new Error("invariante rota: una sesión sin medio efectivo");
          const delEfectivo = (await tx.movimientos.paraSumar(empresaId, sesion.valor.id)).filter(
            (m) => m.medioDePagoId === efectivo.id && m.cuentaDeCobroId === null,
          );
          const esperadoAntes = sumarImportes(delEfectivo.map((m) => m.importe));

          const movimientoId = await tx.movimientos.insertar({
            empresa: empresaId,
            sesionId: sesion.valor.id,
            clase: movimiento.valor.clase,
            medioDePagoId: efectivo.id,
            cuentaDeCobroId: null,
            importe: movimiento.valor.importe,
            motivo: movimiento.valor.motivo,
            anulaA: null,
            corrigeJornada: null,
            registradoEn: ahora,
            registradoPor: previo.valor.persona,
            claveDeIdempotencia: clave.valor,
            huella,
          });
          await dejarConstancia(tx, contexto, previo.valor.persona, {
            accion: "MOVIMIENTO_MANUAL_REGISTRADO",
            entidad: "movimiento_caja",
            entidadId: movimientoId,
            despues: {
              sesionId: sesion.valor.id,
              clase: movimiento.valor.clase,
              importe: importeATexto(movimiento.valor.importe),
              motivo: movimiento.valor.motivo,
            },
          });
          if (
            movimiento.valor.clase === "EGRESO_MANUAL" &&
            egresoSuperaElEfectivo(esperadoAntes, movimiento.valor.importe)
          ) {
            await dejarConstancia(tx, contexto, previo.valor.persona, {
              accion: "EGRESO_SUPERA_EFECTIVO",
              entidad: "movimiento_caja",
              entidadId: movimientoId,
              despues: {
                sesionId: sesion.valor.id,
                efectivoEsperadoAntes: importeATexto(esperadoAntes),
                egreso: importeATexto(movimiento.valor.importe),
              },
            });
          }
          return ok({ movimientoId, yaExistia: false });
        },
      );
    const resultado = await repetirSiOtroGano(ejecutar, UNICAS_DEL_MOVIMIENTO);
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
