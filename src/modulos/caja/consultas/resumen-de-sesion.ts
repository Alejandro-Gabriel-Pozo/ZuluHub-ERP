import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { TipoDeMedio } from "../estados";
import {
  exigirPermisoDeConsulta,
  sesionDeConsulta,
  sesionParaMirar,
  type ErrorDeConsultaDeSesion,
  type SesionDeConsulta,
} from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type EntradaDeResumenDeSesion = Readonly<{ sesionId: string }>;

/** Una línea del esperado: un medio y, si el cobro la trae, una cuenta de cobro («sin cuenta» es `cuentaDeCobroId: null`). */
export type LineaEsperadaDeSesion = Readonly<{
  medioDePagoId: string;
  medioTipo: TipoDeMedio;
  medioNombre: string | null;
  cuentaDeCobroId: string | null;
  cuentaNombre: string | null;
  esperado: ImporteJson;
}>;

export type ResumenDeSesion = Readonly<{
  sesion: SesionDeConsulta;
  /** El esperado por medio y cuenta: la suma exacta de los movimientos de la sesión (el fondo y las anulaciones incluidos). */
  lineas: readonly LineaEsperadaDeSesion[];
}>;

export type ErrorAlResumirSesion = ErrorDeConsultaDeSesion | ErrorDePersistencia;

/**
 * El esperado por medio y cuenta de una sesión, en cualquier estado (e3 §3.10). `cajas.ver`, `read committed`, alcance de la sucursal de
 * la caja de la sesión. Las sumas las hace la base en `numeric`: exactas al centavo.
 */
export function armarResumenDeSesion({ transacciones, reglas }: DependenciasDeConsultasDeCaja) {
  return async function resumenDeSesion(
    contexto: ContextoOperativo,
    entrada: EntradaDeResumenDeSesion,
  ): Promise<Resultado<ResumenDeSesion, ErrorAlResumirSesion>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<ResumenDeSesion, ErrorDeConsultaDeSesion>> => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.resumenDeSesion.accion,
        );
        if (!permiso.ok) return permiso;
        const sesion = await sesionParaMirar(tx, contexto, entrada.sesionId);
        if (!sesion.ok) return sesion;
        const lineas = await tx.movimientos.esperadoPorLinea(contexto.empresaId, sesion.valor.id);
        return ok({
          sesion: sesionDeConsulta(sesion.valor),
          lineas: lineas.map((l) => ({
            medioDePagoId: l.medioDePagoId,
            medioTipo: l.medioTipo,
            medioNombre: l.medioNombre,
            cuentaDeCobroId: l.cuentaDeCobroId,
            cuentaNombre: l.cuentaNombre,
            esperado: importeAJson(l.esperado),
          })),
        });
      },
    );
  };
}
