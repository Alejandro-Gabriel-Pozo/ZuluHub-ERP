import { exigirAccion } from "../../../capacidades/permisos/exigir";
import { exigirSucursal } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { EstadoDeCarta } from "../dominio/carta-publica";
import { esUuid } from "../dominio/identificadores";
import type {
  DependenciasDeConsultasDeCatalogo,
  TxDeConsultasDeCatalogo,
} from "../casos-de-uso/contrato";
import type { ErrorDeCatalogo } from "../casos-de-uso/errores";
import {
  visibilidadDeLaCarta,
  type VisibilidadDeLaCarta,
} from "../casos-de-uso/visibilidad-de-la-carta";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

type R<S> = Resultado<S, ErrorDeCatalogo>;

/** La carta de una sucursal tal como la ve quien la administra. La dirección completa (el host) la arma la pantalla con el de la marca. */
export type CartaParaAdministrar = Readonly<{
  id: string;
  codigo: string;
  /** El camino de la dirección pública (`/s/carta/<código>`): el mismo que sirve la puerta de la carta. */
  rutaPublica: string;
  nombre: string;
  rubro: string | null;
  lugar: string | null;
  mensajeDePortada: string | null;
  estado: EstadoDeCarta;
  version: number;
}>;

export type VistaDeCartaPublica = Readonly<{
  /** `null` si la sucursal todavía no tiene carta. */
  carta: CartaParaAdministrar | null;
  /**
   * Si la sucursal está abierta. Una carta EN_LINEA de una sucursal cerrada NO se sirve al público (el filtro de lectura es del adaptador de la carta, T3):
   * la pantalla lo avisa con este dato.
   */
  sucursalActiva: boolean;
  visibilidad: VisibilidadDeLaCarta;
}>;

export type ProductoOcultoParaAdministrar = Readonly<{
  productoId: string;
  nombre: string;
  /** `null` = oculto en toda la empresa. */
  sucursalId: string | null;
  actualizadoPor: string | null;
  actualizadoEn: Date;
}>;

/**
 * Las consultas de la carta (carta real §6.2), de solo lectura: cada una pide `vidrieras.ver` (los tres roles). El operador solo mira SUS locales (alcance):
 * una sucursal fuera de su alcance es indistinguible de una inexistente en el error (`SUCURSAL_FUERA_DE_ALCANCE`). Lo de otra empresa no se ve nunca.
 */
export function crearConsultasDeCarta(d: DependenciasDeConsultasDeCatalogo) {
  const leer = <S>(
    contexto: ContextoOperativo,
    trabajo: (tx: TxDeConsultasDeCatalogo) => Promise<R<S>>,
  ): Promise<R<S>> =>
    d.transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<R<S>> => {
        const permiso = await exigirAccion(
          d.reglas,
          DECLARACIONES_DE_CONSULTAS.verCartaPublica.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return trabajo(tx);
      },
    );

  return {
    /** La carta de una sucursal (o «no hay»), cuántos productos saldrían y cuántos faltan y por qué. */
    verCartaPublica: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ sucursalId: string }>,
    ): Promise<R<VistaDeCartaPublica>> =>
      leer(contexto, async (tx) => {
        if (!esUuid(entrada.sucursalId)) return err("SUCURSAL_NO_ENCONTRADA");
        const sucursal = sucursalId(entrada.sucursalId);
        const dentro = exigirSucursal(await tx.autorizacion.sucursalesDelActor(contexto), sucursal);
        if (!dentro.ok) return dentro;
        const fila = await tx.sucursales.obtener(contexto.empresaId, sucursal);
        if (fila === null) return err("SUCURSAL_NO_ENCONTRADA");
        const carta = await tx.cartasPublicas.deLaSucursal(contexto.empresaId, sucursal);
        return ok({
          carta:
            carta === null
              ? null
              : {
                  id: carta.id,
                  codigo: carta.codigo,
                  rutaPublica: `/s/carta/${carta.codigo}`,
                  nombre: carta.nombre,
                  rubro: carta.rubro,
                  lugar: carta.lugar,
                  mensajeDePortada: carta.mensajeDePortada,
                  estado: carta.estado,
                  version: carta.version,
                },
          sucursalActiva: fila.activa,
          visibilidad: await visibilidadDeLaCarta(tx, {
            empresaId: contexto.empresaId,
            sucursalId: sucursal,
            ahora: contexto.ahora,
          }),
        });
      }),

    /**
     * Los productos ocultos y en qué alcance (quién y cuándo). Con una sucursal: los de toda la empresa y los de ese local. Sin sucursal: todos, y solo si el
     * alcance de quien pide es TODAS (el operador la pide siempre con su local).
     */
    productosOcultos: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ sucursalId?: string }> = {},
    ): Promise<R<readonly ProductoOcultoParaAdministrar[]>> =>
      leer(contexto, async (tx) => {
        const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
        let sucursal: string | null = null;
        if (entrada.sucursalId === undefined) {
          if (alcance !== "TODAS") return err("SUCURSAL_FUERA_DE_ALCANCE");
        } else {
          if (!esUuid(entrada.sucursalId)) return err("SUCURSAL_NO_ENCONTRADA");
          const dentro = exigirSucursal(alcance, sucursalId(entrada.sucursalId));
          if (!dentro.ok) return dentro;
          if (
            (await tx.sucursales.obtener(contexto.empresaId, sucursalId(entrada.sucursalId))) ===
            null
          )
            return err("SUCURSAL_NO_ENCONTRADA");
          sucursal = entrada.sucursalId;
        }
        const filas = await tx.disponibilidadDeProductos.ocultas(contexto.empresaId, sucursal);
        return ok(
          filas.map((f) => ({
            productoId: f.disponibilidad.productoId,
            nombre: f.nombre,
            sucursalId: f.disponibilidad.sucursalId,
            actualizadoPor: f.disponibilidad.actualizadoPor,
            actualizadoEn: f.disponibilidad.actualizadoEn,
          })),
        );
      }),
  };
}
