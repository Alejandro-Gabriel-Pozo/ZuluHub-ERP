import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { jornadaDeSucursal, type ErrorDeJornadaNoEnAuditoria } from "../../cierre/publico";
import { decidirCorreccionDeMedio, parVigenteDelCobro } from "../dominio/correccion";
import { decidirPorHuella } from "../dominio/huella";
import {
  exigirClave,
  huellaDeCorreccion,
  type ErrorDeClave,
} from "../dominio/idempotencia-de-operacion";
import { esUuid } from "../dominio/identificadores";
import { validarParDeCobro, type ErrorDeParDeCobro, type ParDeCobro } from "../dominio/medios";
import { motivoObligatorio } from "../dominio/texto";
import {
  dejarConstancia,
  exigirAlcance,
  prepararCaso,
  repetirSiOtroGano,
  UNICAS_DE_LA_CORRECCION,
  REINTENTOS_EN_LA_SESION_DE_CAJA,
} from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeCorregirMedioDeCobro = Readonly<{
  /** La genera la pantalla al abrir el formulario: repetir el pedido (doble clic, reintento de red) no duplica la corrección. */
  claveDeIdempotencia: string;
  cobroId: string;
  /** A qué medio y cuenta pasa el cobro: cualquier otro, activo y compatible (decisión 163). */
  medioDestinoId: string;
  cuentaDestinoId: string | null;
  motivo: string;
}>;

export type SalidaDeCorregirMedioDeCobro = Readonly<{
  correccionId: string;
  /** 1 la primera vez; corregir de nuevo un cobro ya corregido es otra corrección desde el medio vigente (`secuencia + 1`). */
  secuencia: number;
  /** `true`: ya se había hecho con esta clave; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio =
  | ErrorDeClave
  | ErrorDeParDeCobro
  | ErrorDeJornadaNoEnAuditoria
  | "COBRO_NO_ENCONTRADO"
  | "MOTIVO_INVALIDO"
  | "CLAVE_REUTILIZADA"
  | "MEDIO_DEL_COBRO_SIN_CAMBIOS"
  /** Otra corrección del mismo cobro se confirmó mientras esta se decidía: el medio vigente ya no es el que vio quien pidió. */
  | Readonly<{ codigo: "MEDIO_DEL_COBRO_CAMBIO"; vigente: ParDeCobro }>;

export type ErrorAlCorregirMedioDeCobro =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio). */
const RESTRICCIONES_ADMITIDAS = [
  "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
  "MOTIVO_INVALIDO",
  "COBRO_NO_ENCONTRADO",
  "MEDIO_NO_ENCONTRADO",
  "CUENTA_DE_COBRO_NO_ENCONTRADA",
  "MEDIO_DEL_COBRO_SIN_CAMBIOS",
  "MEDIO_INACTIVO",
  "CUENTA_DE_COBRO_NO_ADMITIDA",
  "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL",
  "CUENTA_DE_COBRO_INACTIVA",
  "CUENTA_DE_COBRO_INCOMPATIBLE",
] as const;

const llaveDelPar = (par: ParDeCobro): string =>
  `${par.medioDePagoId}/${par.cuentaDeCobroId ?? ""}`;

/**
 * Corregir el medio de un cobro (e3b §4.3; decisión 163): traslada el IMPORTE COMPLETO del cobro del par (medio, cuenta) vigente a otro
 * cualquiera, con motivo; el cobro original queda como estaba y no cambia el `esperado` ni el arqueo de ninguna sesión: solo mueve la
 * conciliación del día. Contexto OPERATIVO con persona, en una transacción serializable, con el orden fijo: guard (`cobros.corregir_medio`,
 * permitido en solo lectura), la empresa opera, el cobro y el alcance sobre SU sucursal (la sucursal sale del cobro, nunca de la pantalla),
 * validación (clave, motivo, identificadores), idempotencia (la clave, ANTES de mirar el estado de la jornada: repetir el pedido devuelve la
 * misma corrección con `yaExistia` y una clave con otro contenido da `CLAVE_REUTILIZADA`), la jornada `EN_AUDITORIA`
 * (`cierre.exigirEnAuditoriaEnTx`, tomada `FOR SHARE`: el cierre concurrente espera y la que llega después lo encuentra cerrado), y las reglas:
 * el medio vigente no cambió desde que este pedido empezó (`MEDIO_DEL_COBRO_CAMBIO { vigente }`), el destino no es lo ya vigente
 * (`MEDIO_DEL_COBRO_SIN_CAMBIOS`) y es un medio y una cuenta activos y compatibles de la sucursal del cobro.
 * Dos correcciones del mismo cobro a la vez: la clave primaria `(cobro, secuencia)` deja pasar una; la otra repite su transacción, ve el medio
 * nuevo y, como ya no es el que vio al empezar, devuelve `MEDIO_DEL_COBRO_CAMBIO` (no pisa en silencio la decisión de otra persona).
 * La corrección y su auditoría `CORRECCION_DE_MEDIO_REGISTRADA` van en la misma transacción; no llevan la clave ni la huella.
 */
export function armarCorregirMedioDeCobro({ transacciones, reglas }: DependenciasDeCaja) {
  return async function corregirMedioDeCobro(
    contexto: ContextoOperativo,
    entrada: EntradaDeCorregirMedioDeCobro,
  ): Promise<Resultado<SalidaDeCorregirMedioDeCobro, ErrorAlCorregirMedioDeCobro>> {
    const { empresaId, ahora } = contexto;
    // El medio vigente que vio el primer intento de ESTE pedido: si al repetirse la transacción es otro, alguien corrigió el cobro entre medio.
    let vigenteAlEmpezar: string | null = null;
    const ejecutar = () =>
      transacciones.ejecutar(
        { contexto, reintentos: REINTENTOS_EN_LA_SESION_DE_CAJA },
        async (
          tx,
        ): Promise<
          Resultado<
            SalidaDeCorregirMedioDeCobro,
            ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
          >
        > => {
          const previo = await prepararCaso(
            tx,
            contexto,
            reglas,
            DECLARACIONES.corregirMedioDeCobro.accion,
          );
          if (!previo.ok) return previo;
          const cobro = await tx.correcciones.cobroACorregir(empresaId, entrada.cobroId);
          if (cobro === null) return err("COBRO_NO_ENCONTRADO");
          const alcance = await exigirAlcance(tx, contexto, cobro.sucursalId);
          if (!alcance.ok) return alcance;

          const clave = exigirClave(entrada.claveDeIdempotencia);
          if (!clave.ok) return clave;
          const motivo = motivoObligatorio(entrada.motivo);
          if (!motivo.ok) return motivo;
          if (!esUuid(entrada.medioDestinoId)) return err("MEDIO_NO_ENCONTRADO");
          if (entrada.cuentaDestinoId !== null && !esUuid(entrada.cuentaDestinoId)) {
            return err("CUENTA_DE_COBRO_NO_ENCONTRADA");
          }

          const huella = huellaDeCorreccion({
            cobroId: cobro.cobroId,
            medioDestinoId: entrada.medioDestinoId,
            cuentaDestinoId: entrada.cuentaDestinoId,
            motivo: motivo.valor,
          });
          const previa = await tx.correcciones.obtenerPorClave(empresaId, clave.valor);
          if (decidirPorHuella(previa?.huella ?? null, huella) === "CLAVE_REUTILIZADA") {
            return err("CLAVE_REUTILIZADA");
          }
          if (previa !== null) {
            return ok({ correccionId: previa.id, secuencia: previa.secuencia, yaExistia: true });
          }

          const enAuditoria = await jornadaDeSucursal.exigirEnAuditoriaEnTx(
            tx,
            empresaId,
            cobro.sucursalId,
            cobro.fechaDeNegocio,
          );
          if (!enAuditoria.ok) return enAuditoria;

          const vigente = parVigenteDelCobro(cobro.original, cobro.correcciones);
          if (vigenteAlEmpezar === null) vigenteAlEmpezar = llaveDelPar(vigente);
          else if (vigenteAlEmpezar !== llaveDelPar(vigente)) {
            return err({ codigo: "MEDIO_DEL_COBRO_CAMBIO", vigente });
          }
          const destino: ParDeCobro = {
            medioDePagoId: entrada.medioDestinoId,
            cuentaDeCobroId: entrada.cuentaDestinoId,
          };
          const correccion = decidirCorreccionDeMedio({
            original: cobro.original,
            correcciones: cobro.correcciones,
            destino,
          });
          if (!correccion.ok) return correccion;

          const medio = await tx.mediosDePago.obtener(empresaId, destino.medioDePagoId);
          const cuenta =
            destino.cuentaDeCobroId === null
              ? null
              : await tx.cuentasDeCobro.obtener(empresaId, destino.cuentaDeCobroId);
          const par = validarParDeCobro({
            medio,
            cuentaDeCobroId: destino.cuentaDeCobroId,
            cuenta,
            sucursalDeLaCaja: cobro.sucursalId,
          });
          if (!par.ok) return par;

          const { antes, despues, secuencia } = correccion.valor;
          const correccionId = await tx.correcciones.insertar({
            empresa: empresaId,
            cobroId: cobro.cobroId,
            secuencia,
            sucursalId: cobro.sucursalId,
            fechaDeNegocio: cobro.fechaDeNegocio,
            antes,
            despues,
            motivo: motivo.valor,
            corregidoEn: ahora,
            corregidoPor: previo.valor.persona,
            claveDeIdempotencia: clave.valor,
            huella,
          });
          await dejarConstancia(tx, contexto, previo.valor.persona, {
            accion: "CORRECCION_DE_MEDIO_REGISTRADA",
            entidad: "correccion_de_medio",
            entidadId: correccionId,
            despues: {
              cobroId: cobro.cobroId,
              secuencia,
              medioAntesId: antes.medioDePagoId,
              cuentaAntesId: antes.cuentaDeCobroId,
              medioDespuesId: despues.medioDePagoId,
              cuentaDespuesId: despues.cuentaDeCobroId,
              importe: importeATexto(cobro.importe),
              motivo: motivo.valor,
            },
          });
          return ok({ correccionId, secuencia, yaExistia: false });
        },
      );
    const resultado = await repetirSiOtroGano(ejecutar, UNICAS_DE_LA_CORRECCION);
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
