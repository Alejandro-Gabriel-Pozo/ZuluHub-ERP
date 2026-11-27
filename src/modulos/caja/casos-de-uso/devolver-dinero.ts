import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { importeAJson, importeATexto, type ImporteJson } from "../../../primitivas/dinero/importe";
import { esUuidCanonico, sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  claveDeLinea,
  decidirDevolucion,
  devolucionIdDe,
  huellaDeLaDevolucion,
  ORIGENES_DEVOLUBLES,
  validarLineasDeDevolucion,
  type ErrorDeDevolucion,
  type LineaDeDevolucionEntrada,
} from "../dominio/devolucion";
import { decidirPorHuella } from "../dominio/huella";
import { exigirClave, type ErrorDeClave } from "../dominio/idempotencia-de-operacion";
import { MEDIOS_ADMITIDOS_POR_CATEGORIA } from "../dominio/movimiento-de-dinero";
import { motivoObligatorio } from "../dominio/texto";
import type { ErrorAlEgresar } from "../egreso/contrato";
import { origenDeSalidaPorClave, registrarEgresoEnTx } from "../egreso/egreso-por-origen";
import {
  dejarConstancia,
  exigirAlcance,
  prepararCaso,
  repetirSiOtroGano,
  REINTENTOS_EN_LA_SESION_DE_CAJA,
} from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

/** El origen que se devuelve hoy: la cobranza de un ticket de ventas (`ORIGENES_DEVOLUBLES` es la lista cerrada, igual que la de la base). */
const ORIGEN_DE_LA_COBRANZA = ORIGENES_DEVOLUBLES[0];

export type EntradaDeDevolverDinero = Readonly<{
  /** La genera la pantalla al abrir el formulario: repetir el pedido (doble clic, reintento de red) no devuelve la plata dos veces. */
  claveDeIdempotencia: string;
  /** La caja abierta de la sucursal de donde sale la plata. La sucursal sale de la caja, nunca de la pantalla. */
  cajaId: string;
  /** La cobranza del ticket que se devuelve (`ventas.cobranza_de_ticket`). */
  cobranzaId: string;
  /** De 1 a 10 líneas, una por par (medio, cuenta): cada una es un egreso de caja y su acto. Todas o ninguna. */
  lineas: readonly LineaDeDevolucionEntrada[];
  motivo: string;
}>;

export type AvisoDeDevolverDinero = "EFECTIVO_NO_ALCANZA";

export type SalidaDeDevolverDinero = Readonly<{
  devolucionId: string;
  actos: readonly Readonly<{ movimientoDeDineroId: string; movimientoId: string }>[];
  /** Lo que todavía se puede devolver de la cobranza, ya descontado este pedido. */
  quedaPorDevolver: ImporteJson;
  /** El efectivo esperado no alcanzaba para alguna línea en efectivo: la devolución entra igual y queda la constancia (no bloquea). */
  avisos: readonly AvisoDeDevolverDinero[];
  /** `true`: ya se había hecho con esta clave; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio =
  | ErrorDeClave
  | ErrorDeDevolucion
  | ErrorAlEgresar
  | "CAJA_NO_ENCONTRADA"
  | "COBRANZA_NO_ENCONTRADA"
  | "COBRANZA_DE_OTRA_SUCURSAL"
  | "SIN_COBRO_PARA_DEVOLVER"
  | "CLAVE_REUTILIZADA";

export type ErrorAlDevolverDinero =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Restricciones que forman parte del contrato (red de seguridad: antes decide el dominio y la base las repite). */
const RESTRICCIONES_ADMITIDAS = [
  "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
  "IMPORTE_INVALIDO",
  "MOTIVO_INVALIDO",
] as const;

/**
 * La restricción con que la base (DM-1, `movimiento_de_dinero_validar_alta`) rechaza una devolución que no cabe en lo cobrado: dos devoluciones a la vez que no caben juntas, la
 * segunda llega acá y es el mismo error que la ayuda temprana. No está en el mapa de `traducirErrores` porque ese mapa es el de las tablas de configuración de caja y su prueba
 * exige que cada nombre exista en ellas.
 */
const TOPE_DE_LA_BASE = "devolucion_supera_lo_cobrado";

/** Las restricciones únicas con las que chocan dos pedidos con la misma clave a la vez: la del egreso y la del acto. */
const UNICAS_DE_LA_DEVOLUCION = [
  "movimiento_caja_clave_uk",
  "movimiento_de_dinero_clave_uk",
  "movimiento_de_dinero_movimiento_uk",
] as const;

/**
 * Devolver dinero de un ticket cobrado, por el medio que corresponde (decisiones del dueño del 26/11/2026 sobre la devolución con medio; DEC-VEN-004). En UNA transacción
 * serializable, con el orden fijo: guard `devoluciones.registrar` y que la empresa opere, la caja y el alcance de su sucursal, validación (clave, motivo, forma de las líneas),
 * idempotencia por clave y huella ANTES de mirar el estado de la sesión o lo devolvible (repetir un pedido ya hecho devuelve lo hecho aunque el tope se haya consumido con él
 * mismo; otra huella con la misma clave → `CLAVE_REUTILIZADA`), la cobranza (existe en la empresa, es de la sucursal de la caja, algo para devolver y la suma no lo supera:
 * ayuda temprana, la cerradura es la base de DM-1) y, por cada línea EN ORDEN, el egreso (`registrarEgresoEnTx`: sesión y jornada abiertas, medio y cuenta válidos) y su acto.
 * Todas las líneas, su auditoría `DEVOLUCION_REGISTRADA` (sin nombres ni datos de tarjeta) o nada. Un efectivo que no alcanza avisa y deja constancia, no bloquea (el esperado es un
 * cálculo). NO consulta ni exige nada de Facturación: devolver antes o después de la nota de crédito es indistinto.
 */
export function armarDevolverDinero({ transacciones, reglas }: DependenciasDeCaja) {
  return async function devolverDinero(
    contexto: ContextoOperativo,
    entrada: EntradaDeDevolverDinero,
  ): Promise<Resultado<SalidaDeDevolverDinero, ErrorAlDevolverDinero>> {
    const { empresaId } = contexto;
    const ejecutar = () =>
      transacciones.ejecutar(
        { contexto, reintentos: REINTENTOS_EN_LA_SESION_DE_CAJA },
        async (
          tx,
        ): Promise<
          Resultado<
            SalidaDeDevolverDinero,
            ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
          >
        > => {
          const previo = await prepararCaso(
            tx,
            contexto,
            reglas,
            DECLARACIONES.devolverDinero.accion,
          );
          if (!previo.ok) return previo;
          if (!esUuidCanonico(entrada.cajaId)) return err("CAJA_NO_ENCONTRADA");
          const caja = await tx.cajas.obtener(empresaId, entrada.cajaId);
          if (caja === null) return err("CAJA_NO_ENCONTRADA");
          const alcance = await exigirAlcance(tx, contexto, caja.sucursalId);
          if (!alcance.ok) return alcance;
          const clave = exigirClave(entrada.claveDeIdempotencia);
          if (!clave.ok) return clave;
          const motivo = motivoObligatorio(entrada.motivo);
          if (!motivo.ok) return motivo;
          const forma = validarLineasDeDevolucion(entrada.lineas);
          if (!forma.ok) return forma;
          if (!esUuidCanonico(entrada.cobranzaId)) return err("COBRANZA_NO_ENCONTRADA");

          const devolucionId = devolucionIdDe(clave.valor);
          const huella = huellaDeLaDevolucion({
            cobranzaId: entrada.cobranzaId,
            // La sesión todavía no se conoce al buscar por clave: la huella lleva la caja que pidió quien devuelve.
            sesionId: entrada.cajaId,
            lineas: forma.valor.lineas,
            motivo: motivo.valor,
          });
          const previa = await tx.movimientosDeDinero.porClave(
            empresaId,
            claveDeLinea(clave.valor, 1),
          );
          if (previa !== null) {
            if (decidirPorHuella(previa.huella, huella) === "CLAVE_REUTILIZADA") {
              return err("CLAVE_REUTILIZADA");
            }
            const hechos = await tx.movimientosDeDinero.deLaDevolucion(empresaId, devolucionId);
            return ok({
              devolucionId,
              actos: hechos.map((a) => ({
                movimientoDeDineroId: a.id,
                movimientoId: a.movimientoId as string,
              })),
              quedaPorDevolver: importeAJson(
                await tx.movimientosDeDinero.devolvibleDeOrigen(
                  empresaId,
                  ORIGEN_DE_LA_COBRANZA,
                  entrada.cobranzaId,
                ),
              ),
              avisos: [],
              yaExistia: true,
            });
          }

          // La cobranza: sin cobros de la empresa no existe (otra empresa es inexistente para esta); con cobros de otra sucursal, no es de esta caja.
          const cobros = await tx.cobros.deOrigen(empresaId, {
            tipo: ORIGEN_DE_LA_COBRANZA,
            id: entrada.cobranzaId,
          });
          if (cobros.length === 0) return err("COBRANZA_NO_ENCONTRADA");
          for (const sesionDelCobro of new Set(cobros.map((c) => c.sesionId))) {
            const sesion = await tx.sesiones.obtener(empresaId, sesionDelCobro);
            if (sesion === null) throw new Error("invariante rota: un cobro sin su sesión");
            if (sesion.sucursalId !== caja.sucursalId) return err("COBRANZA_DE_OTRA_SUCURSAL");
          }
          const devolvible = await tx.movimientosDeDinero.devolvibleDeOrigen(
            empresaId,
            ORIGEN_DE_LA_COBRANZA,
            entrada.cobranzaId,
          );
          if (devolvible.unidades <= 0n) return err("SIN_COBRO_PARA_DEVOLVER");
          const decidida = decidirDevolucion({ devolvible, lineas: entrada.lineas });
          if (!decidida.ok) return decidida;

          const actos: { movimientoDeDineroId: string; movimientoId: string }[] = [];
          let efectivoNoAlcanza = false;
          let orden = 1;
          for (const linea of decidida.valor.lineas) {
            const claveDeLaLinea = claveDeLinea(clave.valor, orden);
            const egreso = await registrarEgresoEnTx(tx, contexto, {
              cajaId: entrada.cajaId,
              sucursalId: caja.sucursalId,
              origen: origenDeSalidaPorClave(claveDeLaLinea),
              importe: importeAJson(linea.importe),
              motivo: motivo.valor,
              medio: {
                medioDePagoId: linea.medioDePagoId,
                cuentaDeCobroId: linea.cuentaDeCobroId,
                tiposAdmitidos: MEDIOS_ADMITIDOS_POR_CATEGORIA.DEVOLUCION_DE_UN_COBRO,
              },
            });
            if (!egreso.ok) return egreso;
            // El egreso es de ESTE pedido (su clave sale de la del pedido): si ya existía sin acto, la base estaría rota (el acto y el egreso nacen juntos).
            if (egreso.valor.yaExistia) {
              throw new Error("invariante rota: un egreso de devolución sin su acto");
            }
            if (egreso.valor.superaElEfectivo) efectivoNoAlcanza = true;
            const movimientoDeDineroId = await tx.movimientosDeDinero.insertar({
              empresa: empresaId,
              sucursalId: sucursalId(caja.sucursalId),
              sesionId: egreso.valor.sesionId,
              sentido: "SALIDA",
              importe: linea.importe,
              categoria: "DEVOLUCION_DE_UN_COBRO",
              concepto: null,
              motivo: motivo.valor,
              terceroNombre: null,
              terceroPersonaId: null,
              referencia: null,
              devuelveA: null,
              devuelveOrigen: {
                tipo: ORIGEN_DE_LA_COBRANZA,
                id: entrada.cobranzaId,
                devolucionId,
              },
              movimientoId: egreso.valor.movimientoId,
              claveDeIdempotencia: claveDeLaLinea,
              huella,
              registradoEn: contexto.ahora,
              registradoPor: previo.valor.persona,
            });
            actos.push({ movimientoDeDineroId, movimientoId: egreso.valor.movimientoId });
            orden += 1;
          }

          await dejarConstancia(tx, contexto, previo.valor.persona, {
            accion: "DEVOLUCION_REGISTRADA",
            entidad: "movimiento_de_dinero",
            entidadId: (actos[0] as (typeof actos)[number]).movimientoDeDineroId,
            despues: {
              devolucionId,
              cobranzaId: entrada.cobranzaId,
              importeTotal: importeATexto(decidida.valor.total),
              motivo: motivo.valor,
              lineas: decidida.valor.lineas.map((l) => ({
                medioDePagoId: l.medioDePagoId,
                importe: importeATexto(l.importe),
              })),
            },
          });
          return ok({
            devolucionId,
            actos,
            quedaPorDevolver: importeAJson(
              await tx.movimientosDeDinero.devolvibleDeOrigen(
                empresaId,
                ORIGEN_DE_LA_COBRANZA,
                entrada.cobranzaId,
              ),
            ),
            avisos: efectivoNoAlcanza ? (["EFECTIVO_NO_ALCANZA"] as const) : [],
            yaExistia: false,
          });
        },
      );
    const resultado = await repetirSiOtroGano(ejecutar, UNICAS_DE_LA_DEVOLUCION);
    if (
      !resultado.ok &&
      typeof resultado.error === "object" &&
      "tipo" in resultado.error &&
      resultado.error.tipo === "Check" &&
      resultado.error.restriccion === TOPE_DE_LA_BASE
    ) {
      return err("DEVOLUCION_SUPERA_LO_COBRADO");
    }
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
