import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * La sucursal de la que se piden los puntos de venta. La resuelve el SERVIDOR y se la pasa a la consulta: no es un dato
 * del navegador. Su formato (un uuid) lo valida quien arma la entrada, como con el id de un comprobante.
 */
export type EntradaDeListarPuntosDeVentaDeLaSucursal = Readonly<{ sucursalId: SucursalId }>;

export type ErrorAlListarPuntosDeVentaDeLaSucursal =
  MotivoDeRechazo | ErrorDeAlcance | ErrorDePersistencia;

/** Un punto de venta para el filtro del listado: su NÚMERO, que es lo que se imprime y lo que filtra. */
export type PuntoDeVentaParaFiltrar = Readonly<{ numero: number }>;

export type PuntosDeVentaDeLaSucursal = Readonly<{ items: readonly PuntoDeVentaParaFiltrar[] }>;

/**
 * Los puntos de venta ACTIVOS de una sucursal de la empresa del contexto (el filtro «Punto de venta» del listado,
 * D-6 y D-18), de menor a mayor número y sin repetir. Pide `comprobantes.ver` al guard dentro de su transacción
 * (`read committed`, solo lectura) y recién después mira el alcance: un operador solo pide una sucursal donde tiene
 * asignación activa (`SUCURSAL_FUERA_DE_ALCANCE`); gerente y administrador, cualquiera de su empresa. Una sucursal
 * ajena a la empresa no devuelve nada: la lectura filtra por empresa y la RLS lo impone.
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
      ): Promise<Resultado<PuntosDeVentaDeLaSucursal, MotivoDeRechazo | ErrorDeAlcance>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarPuntosDeVentaDeLaSucursal.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const alcance = exigirSucursal(
          await tx.autorizacion.sucursalesDelActor(contexto),
          entrada.sucursalId,
        );
        if (!alcance.ok) return alcance;
        const numeros = await tx.lecturas.puntosDeVentaActivosDeLaSucursal(
          contexto.empresaId,
          entrada.sucursalId,
        );
        return ok({ items: numeros.map((numero) => ({ numero })) });
      },
    );
  };
}
