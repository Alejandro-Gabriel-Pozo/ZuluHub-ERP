import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type Importe, type ImporteJson } from "../../../primitivas/dinero/importe";
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

export type EntradaDeFichaDeSesion = Readonly<{ sesionId: string }>;

export type LineaDeArqueoDeLaFicha = Readonly<{
  medioDePagoId: string;
  medioTipo: TipoDeMedio;
  medioNombre: string | null;
  cuentaDeCobroId: string | null;
  cuentaNombre: string | null;
  esperado: ImporteJson;
  /** Efectivo: billetes + monedas; demás medios: el total declarado; `null` si la línea quedó conforme. */
  contado: ImporteJson | null;
  /** Solo la línea del efectivo. */
  monedas: ImporteJson | null;
  conforme: boolean;
  conformePor: string | null;
  conformeEn: string | null;
  /** contado − esperado; `null` si es conforme (la línea muestra «conforme», no una diferencia). */
  diferencia: ImporteJson | null;
}>;

export type FichaDeSesion = Readonly<{
  sesion: SesionDeConsulta;
  zonaHoraria: string;
  horaDeCorte: string;
  observacion: string | null;
  /** Vacíos mientras la sesión no se cerró. */
  arqueo: readonly LineaDeArqueoDeLaFicha[];
  /** El detalle del conteo de efectivo, de mayor a menor denominación. */
  billetes: readonly Readonly<{ denominacion: number; cantidad: number }>[];
}>;

export type ErrorAlVerLaFicha = ErrorDeConsultaDeSesion | ErrorDePersistencia;

const jsonONulo = (importe: Importe | null): ImporteJson | null =>
  importe === null ? null : importeAJson(importe);

/**
 * La ficha de una sesión (e3 §3.10): sus datos, el sello de la jornada con que se abrió, la observación y, si se cerró, el arqueo línea
 * por línea con el detalle de billetes y las monedas. `cajas.ver`, `read committed`, alcance de la sucursal.
 */
export function armarFichaDeSesion({ transacciones, reglas }: DependenciasDeConsultasDeCaja) {
  return async function fichaDeSesion(
    contexto: ContextoOperativo,
    entrada: EntradaDeFichaDeSesion,
  ): Promise<Resultado<FichaDeSesion, ErrorAlVerLaFicha>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<FichaDeSesion, ErrorDeConsultaDeSesion>> => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.fichaDeSesion.accion,
        );
        if (!permiso.ok) return permiso;
        const sesion = await sesionParaMirar(tx, contexto, entrada.sesionId);
        if (!sesion.ok) return sesion;
        const arqueo = await tx.arqueos.deLaSesion(contexto.empresaId, sesion.valor.id);
        return ok({
          sesion: sesionDeConsulta(sesion.valor),
          zonaHoraria: sesion.valor.zonaHoraria,
          horaDeCorte: sesion.valor.horaDeCorte,
          observacion: sesion.valor.observacion,
          arqueo: arqueo.lineas.map((l) => ({
            medioDePagoId: l.medioDePagoId,
            medioTipo: l.medioTipo,
            medioNombre: l.medioNombre,
            cuentaDeCobroId: l.cuentaDeCobroId,
            cuentaNombre: l.cuentaNombre,
            esperado: importeAJson(l.esperado),
            contado: jsonONulo(l.contado),
            monedas: jsonONulo(l.contadoMonedas),
            conforme: l.conforme,
            conformePor: l.conformePor,
            conformeEn: l.conformeEn === null ? null : l.conformeEn.toISOString(),
            diferencia: jsonONulo(l.diferencia),
          })),
          billetes: arqueo.billetes,
        });
      },
    );
  };
}
