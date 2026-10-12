import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import { campoConPosibleSecreto, type Dato } from "../../puertos/sin-secretos";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import {
  paginaValida,
  resultadoDePagina,
  type EntradaDePagina,
  type ErrorDePagina,
  type ResultadoDePagina,
} from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type { DependenciasDeConsultasDePlataforma, FilaDeTrabajoFallido } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA as D } from "./declaraciones";

/**
 * Un trabajo fallido para soporte. `datos` ya se guardó sin secretos (la cola los rechaza por el nombre
 * de los campos); aun así, si alguno parece un secreto NO se devuelve: `datos` queda `null` y
 * `datosOcultos` lo avisa. Es una segunda barrera por si algo escribió sin pasar por la cola.
 */
export type VistaDeTrabajoFallido = Omit<FilaDeTrabajoFallido, "datos"> &
  Readonly<{ datos: Dato; datosOcultos: boolean }>;

function conDatosSeguros(fila: FilaDeTrabajoFallido): VistaDeTrabajoFallido {
  const oculta = campoConPosibleSecreto(fila.datos) !== null;
  return { ...fila, datos: oculta ? null : fila.datos, datosOcultos: oculta };
}

export type ErrorAlListarTrabajosFallidos = MotivoDeRechazo | ErrorDePagina | ErrorDePersistencia;

/**
 * Los trabajos en estado `FALLIDO`: tipo, empresa, intentos, último error y datos (§B.5.9, nivel 1).
 * `trabajos.ver_fallidos`. No devuelve la clave de idempotencia ni los datos con apariencia de secreto.
 */
export function armarListarTrabajosFallidos({
  transacciones,
  reglas,
}: DependenciasDeConsultasDePlataforma) {
  return async function listarTrabajosFallidos(
    contexto: ContextoDePlataforma,
    entrada: EntradaDePagina,
  ): Promise<Resultado<ResultadoDePagina<VistaDeTrabajoFallido>, ErrorAlListarTrabajosFallidos>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<ResultadoDePagina<VistaDeTrabajoFallido>, MotivoDeRechazo | ErrorDePagina>
      > => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.listarTrabajosFallidos.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const pagina = paginaValida(entrada, "UUID");
        if (!pagina.ok) return pagina;
        const filas = await tx.soporte.listarTrabajosFallidos(pagina.valor);
        return ok(resultadoDePagina(filas.map(conDatosSeguros), pagina.valor, (f) => f.id));
      },
    );
  };
}
