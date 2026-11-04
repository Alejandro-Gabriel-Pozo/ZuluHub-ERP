import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ErrorDeSucursalElegida } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
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
import { sucursalDelPedido } from "./sucursal-del-pedido";
import { resumenDe, type PaginaDeComprobantes } from "./vistas";

/**
 * El pedido de la pantalla más la sucursal que la persona dice haber elegido (`null`: todavía no eligió). La resuelve el
 * servidor, no la manda el navegador: quien arma la entrada la toma de la sesión del servidor, y la consulta la verifica
 * contra el alcance del actor y solo así filtra (D-18). Obligatoria a propósito: quien llama decide pasar `null`.
 */
export type EntradaDeListarComprobantes = PedidoDeListado &
  Readonly<{ sucursalElegida: SucursalId | null }>;

export type ErrorAlListarComprobantes =
  MotivoDeRechazo | ErrorDeCriterios | ErrorDeSucursalElegida | ErrorDePersistencia;

/**
 * Una página de los comprobantes de la empresa del contexto, los más nuevos primero (pantalla del facturador,
 * H7 facturación §B.4.9). Pide `comprobantes.ver` al guard dentro de su transacción (`read committed`, solo
 * lectura) y recién después mira el pedido. Se pagina por clave `(creado_en, id)`, sin `OFFSET`: `siguiente` es la
 * clave de la última fila de la página, o `null` si no queda nada. Por defecto oculta los `DESCARTADO`. Lista SOLO los de la sucursal que la persona eligió y que el servidor verifica
 * (`sucursalDelPedido`): la elegida si es de su alcance, la única que tiene si no eligió, o un error tipado
 * (`SUCURSAL_NO_ELEGIDA`, `SUCURSAL_FUERA_DE_ALCANCE`); nunca las de todas. Cada fila trae
 * su `acreditacion` (D-16) con UNA consulta más para toda la página, no una por fila; el documento del receptor y el
 * número del punto de venta vienen en la misma consulta de la página, sin otra por fila. La respuesta dice qué sucursal usó
 * (`sucursal`: id, nombre y si está abierta), que sale de la misma lectura de sucursales con la que se verificó: sin otra consulta.
 */
export function armarListarComprobantes({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeFacturacion) {
  return async function listarComprobantes(
    contexto: ContextoOperativo,
    { sucursalElegida, ...pedido }: EntradaDeListarComprobantes,
  ): Promise<Resultado<PaginaDeComprobantes, ErrorAlListarComprobantes>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<PaginaDeComprobantes, MotivoDeRechazo | ErrorDeCriterios | ErrorDeSucursalElegida>
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarComprobantes.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const criterios = criteriosDeListado(pedido);
        if (!criterios.ok) return criterios;
        // Solo los comprobantes de UNA sucursal que el servidor verificó: sin elección válida no se lista nada.
        const sucursal = await sucursalDelPedido(tx, contexto, sucursalElegida);
        if (!sucursal.ok) return sucursal;
        const pagina = await tx.lecturas.listar(contexto.empresaId, {
          ...criterios.valor,
          sucursalId: sucursal.valor.id,
        });
        // Las notas de TODA la página en una sola consulta (sin una por fila): de ellas sale la etiqueta de cada una.
        const notas = await tx.lecturas.notasQueCitanA(
          contexto.empresaId,
          pagina.filas.map((f) => f.id),
        );
        const ultima = pagina.filas.at(-1);
        return ok({
          items: pagina.filas.map((f) => resumenDe(f, notas.get(f.id) ?? [])),
          siguiente: pagina.hayMas && ultima !== undefined ? claveDePagina(ultima) : null,
          sucursal: sucursal.valor,
        });
      },
    );
  };
}
