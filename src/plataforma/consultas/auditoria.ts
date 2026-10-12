import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import {
  filtroDeTexto,
  paginaValida,
  rangoDeFechas,
  resultadoDePagina,
  type EntradaDePagina,
  type ErrorDePagina,
  type ResultadoDePagina,
} from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type { DependenciasDeConsultasDePlataforma, FilaDeAuditoria } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA as D } from "./declaraciones";

export type EntradaDeConsultarAuditoria = EntradaDePagina &
  Readonly<{
    entidad?: string | undefined;
    entidadId?: string | undefined;
    /** Inclusivo. */
    desde?: Date | undefined;
    /** Inclusivo. */
    hasta?: Date | undefined;
  }>;

export type ErrorAlConsultarAuditoria =
  MotivoDeRechazo | ErrorDePagina | "FILTRO_INVALIDO" | "RANGO_INVALIDO" | ErrorDePersistencia;

/**
 * La auditoría de plataforma, paginada y estable (§B.5.7): filtros opcionales por entidad, id de la
 * entidad y rango de fechas; orden por id; `limite ≤ 100`. `auditoria.ver`, `read committed` y solo
 * lectura. Consultar la auditoría no deja constancia (las consultas de nivel 1 no se auditan).
 */
export function armarConsultarAuditoria({
  transacciones,
  reglas,
}: DependenciasDeConsultasDePlataforma) {
  return async function consultarAuditoria(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeConsultarAuditoria,
  ): Promise<Resultado<ResultadoDePagina<FilaDeAuditoria>, ErrorAlConsultarAuditoria>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<
          ResultadoDePagina<FilaDeAuditoria>,
          Exclude<ErrorAlConsultarAuditoria, ErrorDePersistencia>
        >
      > => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.consultarAuditoria.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const pagina = paginaValida(entrada, "ENTERO");
        if (!pagina.ok) return pagina;
        const entidad = filtroDeTexto(entrada.entidad);
        if (!entidad.ok) return entidad;
        const entidadId = filtroDeTexto(entrada.entidadId);
        if (!entidadId.ok) return entidadId;
        const rango = rangoDeFechas(entrada.desde, entrada.hasta);
        if (!rango.ok) return rango;
        const filas = await tx.soporte.consultarAuditoria(
          {
            entidad: entidad.valor,
            entidadId: entidadId.valor,
            desde: rango.valor.desde,
            hasta: rango.valor.hasta,
          },
          pagina.valor,
        );
        return ok(resultadoDePagina(filas, pagina.valor, (f) => f.id));
      },
    );
  };
}
