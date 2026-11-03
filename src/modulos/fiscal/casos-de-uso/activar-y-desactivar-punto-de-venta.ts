import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { PuntoDeVentaId } from "../dominio/identificadores";
import {
  activarPuntoDeVenta as activarEnElDominio,
  desactivarPuntoDeVenta as desactivarEnElDominio,
  type ErrorDePuntoDeVenta,
} from "../dominio/punto-de-venta";
import {
  exigirSucursalAbierta,
  type ErrorDeSucursalCerrada,
} from "../dominio/sucursales-de-la-emision";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import { empresaOpera } from "./comun";
import { personaQueActua } from "./comun-de-configuracion";
import type { DependenciasDeConfiguracionFiscal } from "./contrato-de-configuracion";
import { DECLARACIONES_DE_CONFIGURACION } from "./declaraciones-de-configuracion";

export type EntradaDeCambiarElEstadoDelPuntoDeVenta = Readonly<{ puntoDeVentaId: PuntoDeVentaId }>;

export type SalidaDeCambiarElEstadoDelPuntoDeVenta = Readonly<{
  /** `true`: ya estaba en ese estado; no se escribió nada ni se auditó. */
  yaEstaba: boolean;
}>;

export type ErrorPropioAlActivarPuntoDeVenta =
  ErrorDePuntoDeVenta | "PUNTO_DE_VENTA_NO_ENCONTRADO" | ErrorDeSucursalCerrada;

export type ErrorAlActivarPuntoDeVenta =
  ErrorPropioAlActivarPuntoDeVenta | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

export type ErrorAlDesactivarPuntoDeVenta =
  "PUNTO_DE_VENTA_NO_ENCONTRADO" | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Lo que la base puede rechazar al activar (otro proceso desactivó al emisor entre la lectura y la escritura). */
const ADMITIDOS_AL_ACTIVAR = ["EMISOR_INACTIVO", "PUNTO_DE_VENTA_SIN_DOMICILIO"] as const;

/**
 * Activar un punto de venta (spec H7 fiscal §B.5, §C y §G.3). Solo el gerente (`puntos_de_venta.activar`).
 * Contexto OPERATIVO con persona. En UNA transacción serializable: el guard primero, la empresa opera, el punto
 * de venta existe y el dominio decide (`activarPuntoDeVenta`): sin domicilio → `PUNTO_DE_VENTA_SIN_DOMICILIO`;
 * con el emisor inactivo → `EMISOR_INACTIVO`; ya activo → «ya estaba», éxito sin escribir ni auditar. Si no, se
 * guarda condicionado a la versión leída y se audita `PUNTO_DE_VENTA_ACTIVADO` en la misma transacción.
 *
 * Con la sucursal del punto de venta CERRADA no se activa (decisión del dueño, D-80 de `facturador-contratos-de-pantalla.md`, 2026-10-29: «No
 * dejarlo activar»): `SUCURSAL_CERRADA` (sale como `FISCAL_SUCURSAL_CERRADA`, el texto provisorio «Sucursal cerrada.»). Para activarlo hay
 * que reabrir la sucursal o mudarlo a una abierta. Desactivar se puede siempre. «Ya estaba activo» va ANTES y no mira la sucursal (la
 * repetición da lo mismo que la primera vez aunque se haya cerrado después). La sucursal se lee con `FOR SHARE` antes de escribir, como
 * el alta: el cierre espera a la activación, o la activación ve la sucursal cerrada (sin ciclos de espera). Orden: permiso, empresa,
 * punto de venta, ya estaba, sin domicilio, emisor inactivo, sucursal abierta. La base NO lo impone: la protección es de aplicación.
 * Previene: un punto de venta activo en una sucursal cerrada, por un pedido armado a mano o por la carrera con su cierre.
 * Chequeo: `fiscal-configuracion-puntos-de-venta.test.ts` y los dos órdenes de la carrera en `fiscal-configuracion-concurrencia.test.ts`.
 *
 * Que sea «ya estaba» (y no un conflicto de versión) es lo que hace inocuo el doble clic: dos activaciones
 * simultáneas, o una activación contra una desactivación, se ordenan por la serializable (la que reintenta lee
 * el estado que dejó la otra) y el estado final es el de la última, sin nada a medias. Activar con un emisor que
 * la plataforma desactiva a la vez lo frena también un disparador de la base.
 */
export function armarActivarPuntoDeVenta({
  transacciones,
  reglas,
}: DependenciasDeConfiguracionFiscal) {
  return async function activarPuntoDeVenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarElEstadoDelPuntoDeVenta,
  ): Promise<Resultado<SalidaDeCambiarElEstadoDelPuntoDeVenta, ErrorAlActivarPuntoDeVenta>> {
    const { empresaId } = contexto;
    const persona = personaQueActua(contexto.personaId, "activar un punto de venta");
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCambiarElEstadoDelPuntoDeVenta,
          ErrorPropioAlActivarPuntoDeVenta | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONFIGURACION.activarPuntoDeVenta.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;

        const actual = await tx.puntosDeVenta.obtener(empresaId, entrada.puntoDeVentaId);
        if (actual === null) return err("PUNTO_DE_VENTA_NO_ENCONTRADO");
        const emisor = await tx.emisores.obtener(empresaId, actual.emisorId);
        // La clave foránea compuesta garantiza que el emisor existe y es de la empresa.
        if (emisor === null)
          throw new Error(`el emisor ${actual.emisorId} del punto de venta no existe`);

        const decision = activarEnElDominio(actual, emisor);
        if (!decision.ok) return decision;
        if (!decision.valor.cambio) return ok({ yaEstaba: true });

        // La sucursal del punto de venta, ANTES de escribir, con `FOR SHARE` (ver arriba). La clave foránea compuesta garantiza que existe
        // y es de la empresa.
        const sucursal = await tx.sucursalBloqueada.obtenerBloqueandoElCierre(
          empresaId,
          actual.sucursalId,
        );
        if (sucursal === null)
          throw new Error(`la sucursal ${actual.sucursalId} del punto de venta no existe`);
        const abierta = exigirSucursalAbierta(sucursal);
        if (!abierta.ok) return abierta;

        const guardado = await tx.puntosDeVenta.guardar(decision.valor.puntoDeVenta);
        if (guardado === null) return err("PUNTO_DE_VENTA_NO_ENCONTRADO");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "PUNTO_DE_VENTA_ACTIVADO",
          entidad: "punto_de_venta",
          entidadId: actual.id,
          antes: { estado: "INACTIVO" },
          despues: { estado: "ACTIVO", emisorId: actual.emisorId, numero: actual.numero },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducirErroresDeFiscal(resultado, ADMITIDOS_AL_ACTIVAR);
  };
}

/**
 * Desactivar un punto de venta (spec H7 fiscal §B.5, §C y §G.3). Solo el gerente
 * (`puntos_de_venta.desactivar`). Contexto OPERATIVO con persona. En UNA transacción serializable: el guard
 * primero, la empresa opera y el punto de venta existe. Ya inactivo → «ya estaba» (éxito sin escribir ni
 * auditar: el doble clic). Si no, se guarda condicionado a la versión leída y se audita
 * `PUNTO_DE_VENTA_DESACTIVADO`. Nada se borra: el punto de venta conserva su número, su domicilio y sus series,
 * y se puede volver a activar. Desactivar cierra algo ya dado, así que sigue disponible cuando el módulo queda
 * en solo lectura.
 */
export function armarDesactivarPuntoDeVenta({
  transacciones,
  reglas,
}: DependenciasDeConfiguracionFiscal) {
  return async function desactivarPuntoDeVenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarElEstadoDelPuntoDeVenta,
  ): Promise<Resultado<SalidaDeCambiarElEstadoDelPuntoDeVenta, ErrorAlDesactivarPuntoDeVenta>> {
    const { empresaId } = contexto;
    const persona = personaQueActua(contexto.personaId, "desactivar un punto de venta");
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCambiarElEstadoDelPuntoDeVenta,
          "PUNTO_DE_VENTA_NO_ENCONTRADO" | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONFIGURACION.desactivarPuntoDeVenta.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;

        const actual = await tx.puntosDeVenta.obtener(empresaId, entrada.puntoDeVentaId);
        if (actual === null) return err("PUNTO_DE_VENTA_NO_ENCONTRADO");

        const decision = desactivarEnElDominio(actual);
        if (!decision.cambio) return ok({ yaEstaba: true });

        const guardado = await tx.puntosDeVenta.guardar(decision.puntoDeVenta);
        if (guardado === null) return err("PUNTO_DE_VENTA_NO_ENCONTRADO");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "PUNTO_DE_VENTA_DESACTIVADO",
          entidad: "punto_de_venta",
          entidadId: actual.id,
          antes: { estado: "ACTIVO" },
          despues: { estado: "INACTIVO", emisorId: actual.emisorId, numero: actual.numero },
        });
        return ok({ yaEstaba: false });
      },
    );
  };
}
