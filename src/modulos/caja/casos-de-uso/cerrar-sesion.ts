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
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirArqueo,
  hayDiferenciaDeArqueo,
  repiteElCierre,
  type ConteoDeEfectivo,
  type ErrorDeArqueo,
  type TotalDeclarado,
} from "../dominio/arqueo";
import { sumarImportes } from "../dominio/importes";
import { cargarSesion, dejarConstancia, prepararCaso } from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeCerrarSesion = Readonly<{
  sesionId: string;
  /** El efectivo se cuenta SIEMPRE, por billetes y monedas. `null` = no lo contó (`CONTEO_DE_EFECTIVO_FALTANTE`). */
  conteo: ConteoDeEfectivo | null;
  /** El total que dicen los comprobantes de cada línea que no es efectivo; gana sobre el conforme general. */
  otros: readonly TotalDeclarado[];
  /** Acepta lo registrado de TODAS las líneas no efectivo que no declaró. No cubre el efectivo. */
  conformeGeneral: boolean;
  observacion: string | null;
}>;

/** Una línea del arqueo, con los importes como texto decimal (ADR-006). */
export type LineaDeArqueoDeSalida = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  esperado: ImporteJson;
  /** Efectivo: billetes + monedas; demás medios: el total declarado; `null` si la línea quedó conforme. */
  contado: ImporteJson | null;
  contadoMonedas: ImporteJson | null;
  conforme: boolean;
  /** contado − esperado; `null` si es conforme (la línea muestra «conforme», no una diferencia). */
  diferencia: ImporteJson | null;
}>;

export type SalidaDeCerrarSesion = Readonly<{
  arqueo: readonly LineaDeArqueoDeSalida[];
  /** `true`: ya estaba cerrada con ese mismo conteo; no se escribió nada. */
  yaEstabaCerrada: boolean;
}>;

type ErrorPropio =
  "SESION_NO_ENCONTRADA" | "SESION_CERRADA" | "CONFORME_NO_ADMITIDO_EN_EFECTIVO" | ErrorDeArqueo;

export type ErrorAlCerrarSesion =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio). */
const RESTRICCIONES_ADMITIDAS = [
  "CONFORME_NO_ADMITIDO_EN_EFECTIVO",
  "CONTEO_DE_EFECTIVO_FALTANTE",
  "OBSERVACION_INVALIDA",
  "SESION_CERRADA",
] as const;

const jsonONulo = (importe: Importe | null): ImporteJson | null =>
  importe === null ? null : importeAJson(importe);

/** Lo mismo para una línea recién calculada que para una guardada: lo que ve quien cierra. */
function lineaDeSalida(
  l: Readonly<{
    medioDePagoId: string;
    cuentaDeCobroId: string | null;
    esperado: Importe;
    contado: Importe | null;
    contadoMonedas: Importe | null;
    conforme: boolean;
    diferencia: Importe | null;
  }>,
): LineaDeArqueoDeSalida {
  return {
    medioDePagoId: l.medioDePagoId,
    cuentaDeCobroId: l.cuentaDeCobroId,
    esperado: importeAJson(l.esperado),
    contado: jsonONulo(l.contado),
    contadoMonedas: jsonONulo(l.contadoMonedas),
    conforme: l.conforme,
    diferencia: jsonONulo(l.diferencia),
  };
}

/**
 * Cerrar la sesión de una caja con el conteo (e3 §3.2; decisiones 123 y 164). Contexto OPERATIVO con persona, en una transacción
 * serializable: guard (`sesiones_caja.cerrar`, permitido en solo lectura), la empresa opera, la sesión (con alcance) y:
 *  - ya cerrada: idempotente POR ESTADO. El mismo conteo y el mismo conforme (comparados contra el arqueo guardado) → `yaEstabaCerrada:
 *    true` con el arqueo guardado y sin escribir ni auditar; cualquier otro contenido → `SESION_CERRADA` (una cerrada no se reabre);
 *  - el arqueo se calcula ACÁ, en la transacción, con los movimientos de la sesión: el efectivo se cuenta por billetes y monedas (no admite
 *    conforme), los demás medios se declaran o los cubre el conforme general, y el esperado de cada línea es la suma exacta en `bigint`;
 *  - en la misma transacción: la sesión pasa a `CERRADA` (un solo `UPDATE`, sin savepoints: la base compara el `xmin` de la sesión con el
 *    de la transacción de nivel superior), se guardan el arqueo y el detalle de billetes, y se audita `SESION_CAJA_CERRADA` con el
 *    resumen (y `CIERRE_CON_DIFERENCIA` si alguna línea contada difiere de lo esperado: nadie aprueba el arqueo). Al confirmar, la base
 *    recalcula el esperado de cada línea y verifica que el arqueo cuadre: si no, no se cierra nada.
 * Cobrar contra cerrar: este `UPDATE` espera a los cobros en vuelo, y un cobro que llega después ve la sesión cerrada y no escribe.
 */
export function armarCerrarSesion({ transacciones, reglas }: DependenciasDeCaja) {
  return async function cerrarSesion(
    contexto: ContextoOperativo,
    entrada: EntradaDeCerrarSesion,
  ): Promise<Resultado<SalidaDeCerrarSesion, ErrorAlCerrarSesion>> {
    const { empresaId, ahora } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCerrarSesion,
          ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
        >
      > => {
        const previo = await prepararCaso(tx, contexto, reglas, DECLARACIONES.cerrarSesion.accion);
        if (!previo.ok) return previo;
        const sesion = await cargarSesion(tx, contexto, entrada.sesionId);
        if (!sesion.ok) return sesion;

        const efectivo = await tx.mediosDePago.obtenerEfectivo(empresaId);
        if (efectivo === null) throw new Error("invariante rota: una sesión sin medio efectivo");
        const decision = decidirArqueo({
          efectivoId: efectivo.id,
          movimientos: await tx.movimientos.paraSumar(empresaId, sesion.valor.id),
          conteo: entrada.conteo,
          otros: entrada.otros,
          conformeGeneral: entrada.conformeGeneral,
          observacion: entrada.observacion,
          cierraPor: previo.valor.persona,
          cierraEn: ahora,
        });

        const estado = sesion.valor.estado;
        if (estado === "CERRADA") {
          const guardado = await tx.arqueos.deLaSesion(empresaId, sesion.valor.id);
          if (!decision.ok || !repiteElCierre(guardado, decision.valor)) {
            return err("SESION_CERRADA");
          }
          return ok({
            arqueo: guardado.lineas.map(lineaDeSalida),
            yaEstabaCerrada: true,
          });
        }
        if (!decision.ok) return decision;
        const { lineas, billetes, observacion } = decision.valor;

        const cerrada = await tx.sesiones.cerrar(
          empresaId,
          sesion.valor.id,
          estado,
          previo.valor.persona,
          ahora,
          observacion,
        );
        if (!cerrada) return err("SESION_NO_ENCONTRADA");
        await tx.arqueos.guardar(empresaId, sesion.valor.id, lineas, billetes);

        const conDiferencia = hayDiferenciaDeArqueo(lineas);
        const deEfectivo = lineas.filter((l) => l.medioDePagoId === efectivo.id);
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "SESION_CAJA_CERRADA",
          entidad: "sesion_caja",
          entidadId: sesion.valor.id,
          antes: { estado },
          despues: {
            estado: "CERRADA",
            lineas: lineas.length,
            lineasConformes: lineas.filter((l) => l.conforme).length,
            efectivoEsperado: importeATexto(sumarImportes(deEfectivo.map((l) => l.esperado))),
            efectivoContado: importeATexto(
              sumarImportes(deEfectivo.flatMap((l) => (l.contado === null ? [] : [l.contado]))),
            ),
            conDiferencia,
          },
        });
        if (conDiferencia) {
          await dejarConstancia(tx, contexto, previo.valor.persona, {
            accion: "CIERRE_CON_DIFERENCIA",
            entidad: "sesion_caja",
            entidadId: sesion.valor.id,
            despues: {
              lineasConDiferencia: lineas.filter(
                (l) => l.diferencia !== null && l.diferencia.unidades !== 0n,
              ).length,
            },
          });
        }
        return ok({
          arqueo: lineas.map(lineaDeSalida),
          yaEstabaCerrada: false,
        });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
