import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import {
  importeAJson,
  importeATexto,
  type Importe,
  type ImporteJson,
} from "../../../primitivas/dinero/importe";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeAnulacion } from "../dominio/anulacion";
import { claveDeAnulacionDeLinea, MAXIMO_DE_LINEAS_DE_UNA_DEVOLUCION } from "../dominio/devolucion";
import { decidirPorHuella } from "../dominio/huella";
import {
  exigirClave,
  huellaDeAnulacion,
  type ErrorDeClave,
} from "../dominio/idempotencia-de-operacion";
import { sumarImportes } from "../dominio/importes";
import { motivoObligatorio } from "../dominio/texto";
import type { MovimientoConSesion } from "../persistencia/repositorio-de-movimientos";
import { anularMovimientoEnTx } from "./anular-movimiento-en-tx";
import {
  dejarConstancia,
  exigirAlcance,
  prepararCaso,
  repetirSiOtroGano,
  UNICAS_DE_LA_ANULACION,
  REINTENTOS_EN_LA_SESION_DE_CAJA,
} from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeAnularDevolucion = Readonly<{
  /** La genera la pantalla al abrir el diálogo: repetir el pedido (doble clic, dos pestañas) no anula dos veces. */
  claveDeIdempotencia: string;
  /** El pedido de devolución (el `devolucionId` que devolvió `devolverDinero`). */
  devolucionId: string;
  motivo: string;
}>;

export type SalidaDeAnularDevolucion = Readonly<{
  /** Un movimiento de anulación (el espejo) por cada línea de la devolución, en el orden de las líneas. */
  anulaciones: readonly string[];
  /** Lo que se puede volver a devolver de la cobranza, ya liberado lo anulado. */
  quedaPorDevolver: ImporteJson;
  /** `true`: ya se había anulado con esta clave; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio =
  | ErrorDeClave
  | Exclude<ErrorDeAnulacion, "MOVIMIENTO_YA_ANULADO">
  | "DEVOLUCION_NO_ENCONTRADA"
  | "DEVOLUCION_YA_ANULADA"
  | "CLAVE_REUTILIZADA";

export type ErrorAlAnularDevolucion =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Restricciones que forman parte del contrato (red de seguridad: antes decide el dominio y la base las repite). `MOVIMIENTO_YA_ANULADO` sale como `DEVOLUCION_YA_ANULADA`. */
const RESTRICCIONES_ADMITIDAS = [
  "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
  "MOTIVO_INVALIDO",
  "MOVIMIENTO_YA_ANULADO",
] as const;

/**
 * Anular una devolución (DEC-VEN-004): TODAS sus líneas o ninguna, con la misma anulación espejo de siempre (`anularMovimientoEnTx`: mismo medio y cuenta, importe opuesto) sobre
 * el egreso de cada línea, en una transacción serializable. Exige `devoluciones.registrar` (no `movimientos_caja.anular_de_otros`), motivo obligatorio y que la sesión del
 * pedido siga ABIERTA con su jornada abierta (la cerradura es el disparador de `movimiento_caja`). El pedido se lee entero por `devolucion_id` y se verifica su integridad
 * (todas las líneas de la misma sesión, sucursal y cobranza); si no cierra, falla cerrado. Idempotencia por clave y huella ANTES de mirar el estado (repetir devuelve lo hecho);
 * ya anulada con otra clave → `DEVOLUCION_YA_ANULADA`. Los actos no se tocan (solo inserción): se leen como anulados porque su egreso lo está, y el tope se libera solo (DM-1).
 * Previene: anular a medias una devolución en varios medios (el medio quedaría descontado y la plata no devuelta) y anular dos veces por un doble clic.
 */
export function armarAnularDevolucion({ transacciones, reglas }: DependenciasDeCaja) {
  return async function anularDevolucion(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularDevolucion,
  ): Promise<Resultado<SalidaDeAnularDevolucion, ErrorAlAnularDevolucion>> {
    const { empresaId } = contexto;
    const ejecutar = () =>
      transacciones.ejecutar(
        { contexto, reintentos: REINTENTOS_EN_LA_SESION_DE_CAJA },
        async (
          tx,
        ): Promise<
          Resultado<
            SalidaDeAnularDevolucion,
            ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
          >
        > => {
          const previo = await prepararCaso(
            tx,
            contexto,
            reglas,
            DECLARACIONES.anularDevolucion.accion,
          );
          if (!previo.ok) return previo;
          const clave = exigirClave(entrada.claveDeIdempotencia);
          if (!clave.ok) return clave;
          const motivo = motivoObligatorio(entrada.motivo);
          if (!motivo.ok) return motivo;
          if (!esUuidCanonico(entrada.devolucionId)) return err("DEVOLUCION_NO_ENCONTRADA");

          const actos = await tx.movimientosDeDinero.deLaDevolucion(
            empresaId,
            entrada.devolucionId,
          );
          const primero = actos[0];
          if (primero === undefined) return err("DEVOLUCION_NO_ENCONTRADA");
          const alcance = await exigirAlcance(tx, contexto, primero.sucursalId);
          if (!alcance.ok) return alcance;

          // La integridad del pedido: las líneas de un `devolucion_id` son de UNA cobranza, UNA sesión y UNA sucursal, con su egreso cada una. La base no lo impide (cada alta se
          // valida sola), así que acá falla cerrado: anular un pedido armado a mano o mezclado dejaría una anulación a medias.
          const origen = primero.devuelveOrigen;
          const integro =
            origen !== null &&
            actos.length <= MAXIMO_DE_LINEAS_DE_UNA_DEVOLUCION &&
            new Set(actos.map((a) => a.movimientoId)).size === actos.length &&
            actos.every(
              (a) =>
                a.categoria === "DEVOLUCION_DE_UN_COBRO" &&
                a.movimientoId !== null &&
                a.sesionId === primero.sesionId &&
                a.sucursalId === primero.sucursalId &&
                a.devuelveOrigen !== null &&
                a.devuelveOrigen.tipo === origen.tipo &&
                a.devuelveOrigen.id === origen.id,
            );
          if (!integro)
            throw new Error("invariante rota: una devolución con líneas que no cierran");

          const originales: MovimientoConSesion[] = [];
          for (const acto of actos) {
            const egreso = await tx.movimientos.obtener(empresaId, acto.movimientoId as string);
            if (egreso === null) throw new Error("invariante rota: un acto sin su egreso");
            originales.push(egreso);
          }

          // Idempotencia: la anulación de la línea 1 con esta clave. Misma huella → lo hecho; otra → `CLAVE_REUTILIZADA`.
          const huellaDeLaLinea = (egreso: MovimientoConSesion) =>
            huellaDeAnulacion({ movimientoId: egreso.id, motivo: motivo.valor });
          const clavesDeAnulacion = originales.map((_, i) =>
            claveDeAnulacionDeLinea(clave.valor, i + 1),
          );
          const previa = await tx.movimientos.obtenerPorClave(
            empresaId,
            clavesDeAnulacion[0] as string,
          );
          const cobranza = origen;
          const quedaPorDevolver = async (): Promise<ImporteJson> =>
            importeAJson(
              await tx.movimientosDeDinero.devolvibleDeOrigen(
                empresaId,
                cobranza.tipo,
                cobranza.id,
              ),
            );
          if (previa !== null) {
            const repeticion = decidirPorHuella(
              previa.huella,
              huellaDeLaLinea(originales[0] as MovimientoConSesion),
            );
            if (repeticion === "CLAVE_REUTILIZADA") return err("CLAVE_REUTILIZADA");
            const hechas: string[] = [];
            for (const claveDeLaLinea of clavesDeAnulacion) {
              const hecha = await tx.movimientos.obtenerPorClave(empresaId, claveDeLaLinea);
              if (hecha === null) {
                throw new Error("invariante rota: una anulación de devolución a medias");
              }
              hechas.push(hecha.id);
            }
            return ok({
              anulaciones: hechas,
              quedaPorDevolver: await quedaPorDevolver(),
              yaExistia: true,
            });
          }
          for (const original of originales) {
            if ((await tx.movimientos.anulacionDe(empresaId, original.id)) !== null) {
              return err("DEVOLUCION_YA_ANULADA");
            }
          }

          const anulaciones: string[] = [];
          for (const [i, original] of originales.entries()) {
            const anulada = await anularMovimientoEnTx(tx, contexto, previo.valor.persona, {
              original,
              claveDeIdempotencia: clavesDeAnulacion[i] as string,
              huella: huellaDeLaLinea(original),
              motivo: motivo.valor,
              // Quien tiene `devoluciones.registrar` anula la devolución sea de quien sea: el permiso de esta puerta es el que manda.
              puedeAnularDeOtros: true,
              constanciaExtra: { devolucionId: entrada.devolucionId },
            });
            if (!anulada.ok) {
              const error = anulada.error;
              return error === "MOVIMIENTO_YA_ANULADO" ? err("DEVOLUCION_YA_ANULADA") : err(error);
            }
            anulaciones.push(anulada.valor.anulacionId);
          }
          const total: Importe = sumarImportes(actos.map((a) => a.importe));
          await dejarConstancia(tx, contexto, previo.valor.persona, {
            accion: "DEVOLUCION_ANULADA",
            entidad: "movimiento_de_dinero",
            entidadId: primero.id,
            despues: {
              devolucionId: entrada.devolucionId,
              cobranzaId: cobranza.id,
              importeTotal: importeATexto(total),
              motivo: motivo.valor,
            },
          });
          return ok({ anulaciones, quedaPorDevolver: await quedaPorDevolver(), yaExistia: false });
        },
      );
    const resultado = await repetirSiOtroGano(ejecutar, UNICAS_DE_LA_ANULACION);
    const traducida = traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
    if (traducida.ok) return traducida;
    const error = traducida.error;
    return error === "MOVIMIENTO_YA_ANULADO" ? err("DEVOLUCION_YA_ANULADA") : err(error);
  };
}
