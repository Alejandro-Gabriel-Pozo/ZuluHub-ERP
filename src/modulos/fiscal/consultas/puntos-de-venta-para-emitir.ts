import type { ErrorDeSucursalElegida } from "../../../capacidades/permisos/alcance";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { PuntoDeVentaGuardado } from "../persistencia/repositorios";
import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import type { EntradaDeListarPuntosDeVentaDeLaSucursal } from "./puntos-de-venta-de-la-sucursal";
import { sucursalDelPedido } from "./sucursal-del-pedido";

/**
 * Un punto de venta para elegir al emitir (D-86): lo que pide la emisión para identificarlo (`id`), su número (lo que se imprime) y
 * su ambiente (pruebas o producción: el paso final marca los de pruebas, D-87). Nada más: ni el emisor, ni el domicilio, ni la
 * versión, ni la sucursal. Esos datos los ve hoy solo quien tiene `puntos_de_venta.editar` (`puntos-de-venta-del-emisor.ts`), y esta
 * lectura no los ablanda.
 */
export type PuntoDeVentaParaEmitir = Readonly<{
  id: PuntoDeVentaGuardado["id"];
  numero: number;
  ambiente: PuntoDeVentaGuardado["ambiente"];
}>;

export type PuntosDeVentaParaEmitir = Readonly<{ items: readonly PuntoDeVentaParaEmitir[] }>;

export type ErrorAlListarPuntosDeVentaParaEmitir =
  MotivoDeRechazo | ErrorDeSucursalElegida | ErrorDePersistencia;

/**
 * Los puntos de venta ACTIVOS de una sucursal de la empresa del contexto, para elegir uno al emitir (D-6 y D-86), de menor a mayor
 * número. Pide `comprobantes.emitir_manual` al guard dentro de su transacción (`read committed`, solo lectura) y recién después
 * resuelve la sucursal con la MISMA regla que el listado y el filtro de puntos de venta (`sucursalDelPedido`: D-34, D-36 y D-37):
 * gerente y administrador pueden pedir cualquiera de su empresa; un operador, solo las que tiene asignadas
 * (`SUCURSAL_FUERA_DE_ALCANCE` con otra); sin elección, con una sola abierta esa, y con varias `SUCURSAL_NO_ELEGIDA`. La sucursal la
 * pone el servidor, no el navegador. Nunca trae puntos de venta de otra empresa ni de otra sucursal.
 *
 * Una sucursal CERRADA no ofrece ninguno, aunque sus puntos de venta sigan activos (D-50 y D-81: no emite): lista vacía, sin
 * error. Los dados de baja no se ofrecen. (El filtro del Listado, que sí los muestra, es `puntos-de-venta-de-la-sucursal.ts`.)
 */
export function armarListarPuntosDeVentaParaEmitir({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeFacturacion) {
  return async function listarPuntosDeVentaParaEmitir(
    contexto: ContextoOperativo,
    entrada: EntradaDeListarPuntosDeVentaDeLaSucursal,
  ): Promise<Resultado<PuntosDeVentaParaEmitir, ErrorAlListarPuntosDeVentaParaEmitir>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<Resultado<PuntosDeVentaParaEmitir, MotivoDeRechazo | ErrorDeSucursalElegida>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarPuntosDeVentaParaEmitir.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const sucursal = await sucursalDelPedido(tx, contexto, entrada.sucursalElegida);
        if (!sucursal.ok) return sucursal;
        if (!sucursal.valor.activa) return ok({ items: [] });
        const puntos = await tx.puntosDeVenta.listarDeLaSucursal(
          contexto.empresaId,
          sucursal.valor.id,
        );
        return ok({
          items: puntos
            .filter((punto) => punto.estado === "ACTIVO")
            .sort((a, b) => a.numero - b.numero)
            .map(({ id, numero, ambiente }) => ({ id, numero, ambiente })),
        });
      },
    );
  };
}
