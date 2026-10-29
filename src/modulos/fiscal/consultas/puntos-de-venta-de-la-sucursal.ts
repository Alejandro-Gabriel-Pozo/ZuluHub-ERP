import type { ErrorDeSucursalElegida } from "../../../capacidades/permisos/alcance";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { sucursalDelPedido } from "./sucursal-del-pedido";

/**
 * La sucursal que la persona dice haber elegido (`null`: todavía no eligió), la misma que recibe el listado. No es un dato
 * del navegador sin verificar: la consulta la resuelve igual que el listado (`sucursalDelPedido`). Su formato (un uuid) lo
 * valida quien arma la entrada, como con el id de un comprobante.
 */
export type EntradaDeListarPuntosDeVentaDeLaSucursal = Readonly<{
  sucursalElegida: SucursalId | null;
}>;

export type ErrorAlListarPuntosDeVentaDeLaSucursal =
  MotivoDeRechazo | ErrorDeSucursalElegida | ErrorDePersistencia;

/** Un punto de venta para el filtro del listado: su NÚMERO, que es lo que se imprime y lo que filtra. */
export type PuntoDeVentaParaFiltrar = Readonly<{ numero: number }>;

export type PuntosDeVentaDeLaSucursal = Readonly<{ items: readonly PuntoDeVentaParaFiltrar[] }>;

/**
 * Los puntos de venta ACTIVOS de una sucursal de la empresa del contexto (el filtro «Punto de venta» del listado,
 * D-6 y D-18), de menor a mayor número y sin repetir. Pide `comprobantes.ver` al guard dentro de su transacción
 * (`read committed`, solo lectura) y recién después resuelve la sucursal con la misma regla que el listado (D-34, D-36 y D-37):
 * gerente y administrador pueden pedir cualquiera de su empresa, abierta o CERRADA (para ver su historial; una cerrada
 * normalmente no tiene puntos de venta activos y da una lista vacía); un operador, solo las que tiene asignadas
 * (`SUCURSAL_FUERA_DE_ALCANCE` con otra). Sin elección: con una sola ABIERTA, esa; con varias, o solo cerradas,
 * `SUCURSAL_NO_ELEGIDA`.
 */
export function armarListarPuntosDeVentaDeLaSucursal({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeFacturacion) {
  return async function listarPuntosDeVentaDeLaSucursal(
    contexto: ContextoOperativo,
    entrada: EntradaDeListarPuntosDeVentaDeLaSucursal,
  ): Promise<Resultado<PuntosDeVentaDeLaSucursal, ErrorAlListarPuntosDeVentaDeLaSucursal>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<PuntosDeVentaDeLaSucursal, MotivoDeRechazo | ErrorDeSucursalElegida>
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarPuntosDeVentaDeLaSucursal.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const sucursal = await sucursalDelPedido(tx, contexto, entrada.sucursalElegida);
        if (!sucursal.ok) return sucursal;
        const numeros = await tx.lecturas.puntosDeVentaActivosDeLaSucursal(
          contexto.empresaId,
          sucursal.valor.id,
        );
        return ok({ items: numeros.map((numero) => ({ numero })) });
      },
    );
  };
}
