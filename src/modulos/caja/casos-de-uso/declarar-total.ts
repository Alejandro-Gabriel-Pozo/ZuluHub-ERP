import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { importeATexto, type ImporteJson } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { jornadaDeSucursal, type ErrorDeJornadaNoEnAuditoria } from "../../cierre/publico";
import { decidirDeclaracion } from "../dominio/correccion";
import { decidirPorHuella } from "../dominio/huella";
import {
  exigirClave,
  huellaDeDeclaracion,
  type ErrorDeClave,
} from "../dominio/idempotencia-de-operacion";
import { esUuid } from "../dominio/identificadores";
import { importeDeEntrada, type ErrorDeImporte } from "../dominio/importes";
import { validarParDeCobro, type ErrorDeParDeCobro } from "../dominio/medios";
import {
  dejarConstancia,
  exigirAlcance,
  prepararCaso,
  repetirSiOtroGano,
  sucursalDeLaEntrada,
  UNICAS_DE_LA_DECLARACION,
  REINTENTOS_EN_LA_SESION_DE_CAJA,
} from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeDeclararTotal = Readonly<{
  /** La genera la pantalla al abrir el formulario: repetir el pedido no duplica la declaración. */
  claveDeIdempotencia: string;
  sucursalId: string;
  /** `YYYY-MM-DD`: la jornada que se está cerrando. */
  fechaDeNegocio: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  /** El total que dice el resumen de la terminal, del QR o del banco: ARS, sin signo, dentro del tope. */
  importe: ImporteJson;
}>;

export type SalidaDeDeclararTotal = Readonly<{
  declaracionId: string;
  /** `true`: ya se había declarado con esta clave; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio =
  | ErrorDeClave
  | ErrorDeImporte
  | ErrorDeParDeCobro
  | ErrorDeJornadaNoEnAuditoria
  | "SUCURSAL_NO_ENCONTRADA"
  | "FECHA_INVALIDA"
  | "MEDIO_NO_DECLARABLE"
  | "CLAVE_REUTILIZADA";

export type ErrorAlDeclararTotal =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio). */
const RESTRICCIONES_ADMITIDAS = [
  "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
  "IMPORTE_INVALIDO",
  "MEDIO_NO_ENCONTRADO",
  "CUENTA_DE_COBRO_NO_ENCONTRADA",
  "MEDIO_NO_DECLARABLE",
  "CUENTA_DE_COBRO_NO_ADMITIDA",
  "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL",
  "CUENTA_DE_COBRO_INCOMPATIBLE",
] as const;

/**
 * Declarar el total de un medio y cuenta distintos del efectivo (e3b §4.4; decisión 164): el total que dicen los comprobantes (el resumen de
 * la terminal, del QR o del banco). Es opcional y se puede repetir: otra declaración del mismo par es una fila nueva (`secuencia + 1`) y rige
 * la última; gana siempre sobre el «conforme general». El efectivo NO se declara (`MEDIO_NO_DECLARABLE`): su total es lo contado por billetes
 * al cerrar cada caja. Contexto OPERATIVO con persona, en una transacción serializable, con el orden fijo: guard
 * (`declaraciones_de_total.registrar`, permitido en solo lectura), la empresa opera, alcance de sucursal, validación (fecha, clave, importe),
 * idempotencia (la clave, ANTES de mirar el estado), la jornada `EN_AUDITORIA` (`FOR SHARE`) y el par: el medio y la cuenta existen, son
 * compatibles y de la sucursal; NO se exige que sigan activos (el par pudo tener actividad y desactivarse después). La declaración y su
 * auditoría `TOTAL_DECLARADO` van en la misma transacción; no llevan la clave ni la huella.
 */
export function armarDeclararTotal({ transacciones, reglas }: DependenciasDeCaja) {
  return async function declararTotal(
    contexto: ContextoOperativo,
    entrada: EntradaDeDeclararTotal,
  ): Promise<Resultado<SalidaDeDeclararTotal, ErrorAlDeclararTotal>> {
    const { empresaId, ahora } = contexto;
    const ejecutar = () =>
      transacciones.ejecutar(
        { contexto, reintentos: REINTENTOS_EN_LA_SESION_DE_CAJA },
        async (
          tx,
        ): Promise<
          Resultado<
            SalidaDeDeclararTotal,
            ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
          >
        > => {
          const previo = await prepararCaso(
            tx,
            contexto,
            reglas,
            DECLARACIONES.declararTotal.accion,
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
          const importe = importeDeEntrada(entrada.importe, "NO_NEGATIVO");
          if (!importe.ok) return importe;
          if (!esUuid(entrada.medioDePagoId)) return err("MEDIO_NO_ENCONTRADO");
          if (entrada.cuentaDeCobroId !== null && !esUuid(entrada.cuentaDeCobroId)) {
            return err("CUENTA_DE_COBRO_NO_ENCONTRADA");
          }

          const huella = huellaDeDeclaracion({
            sucursalId: sucursal.valor,
            fechaDeNegocio: fecha.valor,
            medioDePagoId: entrada.medioDePagoId,
            cuentaDeCobroId: entrada.cuentaDeCobroId,
            importe: importe.valor,
          });
          const previa = await tx.declaraciones.declaracionPorClave(empresaId, clave.valor);
          if (decidirPorHuella(previa?.huella ?? null, huella) === "CLAVE_REUTILIZADA") {
            return err("CLAVE_REUTILIZADA");
          }
          if (previa !== null) return ok({ declaracionId: previa.id, yaExistia: true });

          const enAuditoria = await jornadaDeSucursal.exigirEnAuditoriaEnTx(
            tx,
            empresaId,
            sucursal.valor,
            fecha.valor,
          );
          if (!enAuditoria.ok) return enAuditoria;

          const medio = await tx.mediosDePago.obtener(empresaId, entrada.medioDePagoId);
          const cuenta =
            entrada.cuentaDeCobroId === null
              ? null
              : await tx.cuentasDeCobro.obtener(empresaId, entrada.cuentaDeCobroId);
          const par = validarParDeCobro({
            medio,
            cuentaDeCobroId: entrada.cuentaDeCobroId,
            cuenta,
            sucursalDeLaCaja: sucursal.valor,
            exigirActivos: false,
          });
          if (!par.ok) return par;
          const declaracion = decidirDeclaracion({
            tipoDeMedio: par.valor,
            importe: entrada.importe,
            secuenciasDelPar: await tx.declaraciones.secuenciasDelPar(
              empresaId,
              sucursal.valor,
              fecha.valor,
              entrada.medioDePagoId,
              entrada.cuentaDeCobroId,
            ),
          });
          if (!declaracion.ok) return declaracion;

          const declaracionId = await tx.declaraciones.insertarDeclaracion({
            empresa: empresaId,
            sucursalId: sucursal.valor,
            fechaDeNegocio: fecha.valor,
            medioDePagoId: entrada.medioDePagoId,
            cuentaDeCobroId: entrada.cuentaDeCobroId,
            secuencia: declaracion.valor.secuencia,
            importe: declaracion.valor.importe,
            declaradoEn: ahora,
            declaradoPor: previo.valor.persona,
            claveDeIdempotencia: clave.valor,
            huella,
          });
          await dejarConstancia(tx, contexto, previo.valor.persona, {
            accion: "TOTAL_DECLARADO",
            entidad: "declaracion_de_total",
            entidadId: declaracionId,
            despues: {
              sucursalId: sucursal.valor,
              fechaDeNegocio: fecha.valor,
              medioDePagoId: entrada.medioDePagoId,
              cuentaDeCobroId: entrada.cuentaDeCobroId,
              secuencia: declaracion.valor.secuencia,
              importe: importeATexto(declaracion.valor.importe),
            },
          });
          return ok({ declaracionId, yaExistia: false });
        },
      );
    const resultado = await repetirSiOtroGano(ejecutar, UNICAS_DE_LA_DECLARACION);
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
