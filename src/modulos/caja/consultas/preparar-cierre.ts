import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson } from "../../../primitivas/dinero/importe";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { EstadoDeSesion } from "../estados";
import { exigirPermisoDeConsulta, sesionParaMirar, type ErrorDeConsultaDeSesion } from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import type { LineaEsperadaDeSesion } from "./resumen-de-sesion";

export type EntradaDePrepararCierre = Readonly<{ sesionId: string }>;

export type LineaParaCerrar = LineaEsperadaDeSesion &
  Readonly<{
    /** La línea del efectivo: se cuenta SIEMPRE por billetes y monedas y no admite «conforme». */
    contarConBilletes: boolean;
  }>;

export type CierrePreparado = Readonly<{
  sesionId: string;
  estado: EstadoDeSesion;
  /** Las líneas que tiene que cubrir el cierre: el efectivo (siempre) y cada medio con cuenta que tuvo movimientos. */
  lineas: readonly LineaParaCerrar[];
}>;

export type ErrorAlPrepararCierre = ErrorDeConsultaDeSesion | ErrorDePersistencia;

/**
 * Lo que hay que contar para cerrar una sesión (e3 §3.10): las líneas esperadas, con cuáles se cuentan por billetes. `cajas.ver`,
 * `read committed`, alcance de la sucursal. No escribe: cerrar es `cerrarSesion`, que recalcula todo dentro de su transacción.
 */
export function armarPrepararCierre({ transacciones, reglas }: DependenciasDeConsultasDeCaja) {
  return async function prepararCierre(
    contexto: ContextoOperativo,
    entrada: EntradaDePrepararCierre,
  ): Promise<Resultado<CierrePreparado, ErrorAlPrepararCierre>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<CierrePreparado, ErrorDeConsultaDeSesion>> => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.prepararCierre.accion,
        );
        if (!permiso.ok) return permiso;
        const sesion = await sesionParaMirar(tx, contexto, entrada.sesionId);
        if (!sesion.ok) return sesion;
        const lineas = await tx.movimientos.esperadoPorLinea(contexto.empresaId, sesion.valor.id);
        return ok({
          sesionId: sesion.valor.id,
          estado: sesion.valor.estado,
          lineas: lineas.map((l) => ({
            medioDePagoId: l.medioDePagoId,
            medioTipo: l.medioTipo,
            medioNombre: l.medioNombre,
            cuentaDeCobroId: l.cuentaDeCobroId,
            cuentaNombre: l.cuentaNombre,
            esperado: importeAJson(l.esperado),
            contarConBilletes: l.medioTipo === "EFECTIVO",
          })),
        });
      },
    );
  };
}
