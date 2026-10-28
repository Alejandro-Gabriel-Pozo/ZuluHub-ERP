import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import {
  claveDePagina,
  criteriosDeListado,
  type ErrorDeCriterios,
  type PedidoDeListado,
} from "./criterios-de-listado";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { resumenDe, type PaginaDeComprobantes } from "./vistas";

export type EntradaDeListarComprobantes = PedidoDeListado;

export type ErrorAlListarComprobantes = MotivoDeRechazo | ErrorDeCriterios | ErrorDePersistencia;

/**
 * Una página de los comprobantes de la empresa del contexto, los más nuevos primero (pantalla del facturador,
 * H7 facturación §B.4.9). Pide `comprobantes.ver` al guard dentro de su transacción (`read committed`, solo
 * lectura) y recién después mira el pedido. Se pagina por clave `(creado_en, id)`, sin `OFFSET`: `siguiente` es la
 * clave de la última fila de la página, o `null` si no queda nada. Por defecto oculta los `DESCARTADO`. Cada fila trae
 * su `acreditacion` (D-16) con UNA consulta más para toda la página, no una por fila.
 */
export function armarListarComprobantes({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeFacturacion) {
  return async function listarComprobantes(
    contexto: ContextoOperativo,
    entrada: EntradaDeListarComprobantes,
  ): Promise<Resultado<PaginaDeComprobantes, ErrorAlListarComprobantes>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<PaginaDeComprobantes, MotivoDeRechazo | ErrorDeCriterios>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarComprobantes.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const criterios = criteriosDeListado(entrada);
        if (!criterios.ok) return criterios;
        const pagina = await tx.lecturas.listar(contexto.empresaId, criterios.valor);
        // Las notas de TODA la página en una sola consulta (sin una por fila): de ellas sale la etiqueta de cada una.
        const notas = await tx.lecturas.notasQueCitanA(
          contexto.empresaId,
          pagina.filas.map((f) => f.id),
        );
        const ultima = pagina.filas.at(-1);
        return ok({
          items: pagina.filas.map((f) => resumenDe(f, notas.get(f.id) ?? [])),
          siguiente: pagina.hayMas && ultima !== undefined ? claveDePagina(ultima) : null,
        });
      },
    );
  };
}
