import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { PuntoDeVentaGuardado, RepositorioDeEmisores } from "../persistencia/repositorios";
import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import {
  aDomicilioParaLaPantalla,
  type DomicilioParaLaPantalla,
} from "./datos-fiscales-del-emisor";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * Los puntos de venta de un emisor tal como la pantalla de Puntos de venta los necesita (D-43, D-48): número, si está activo, su
 * AMBIENTE (pruebas o producción: es lo que se cambia con confirmación), su sucursal y los datos que dicen qué se le puede hacer.
 * Son TODOS los del emisor, activos o no, de menor a mayor número: criterio del ingeniero (el dueño no decidió cuáles lista esta
 * pantalla), porque para activar o editar un punto de venta hay que verlo aunque esté inactivo. D-58 y D-60 son del filtro «Punto de
 * venta» del Listado, no de esta consulta. De solo lectura.
 *
 * Exige `puntos_de_venta.editar` (gerente, `administracion`) al guard dentro de su transacción. Un emisor de otra empresa es
 * indistinguible de uno que no existe.
 */

// Los tipos salen de lo que devuelve la persistencia, no del dominio: una consulta no lo importa (regla `consultas-sin-dominio`).
type EmisorId = Parameters<RepositorioDeEmisores["obtener"]>[1];

export type PuntoDeVentaParaConfigurar = Readonly<{
  id: PuntoDeVentaGuardado["id"];
  numero: number;
  activo: boolean;
  ambiente: PuntoDeVentaGuardado["ambiente"];
  sucursal: Readonly<{ id: SucursalId; nombre: string; activa: boolean }>;
  /** Sin domicilio no se puede activar (`PUNTO_DE_VENTA_SIN_DOMICILIO`). */
  tieneDomicilio: boolean;
  /**
   * El domicilio del punto de venta (D-63), con la misma forma y lista blanca que el de Datos fiscales (`DomicilioParaLaPantalla`):
   * la pantalla lo muestra y precarga la edición con él. `null` si no tiene (entonces `tieneDomicilio` es `false`).
   */
  domicilio: DomicilioParaLaPantalla | null;
  /**
   * `true`: alguna serie del punto de venta ya se usó, así que su número ya no se puede cambiar
   * (`PUNTO_DE_VENTA_NUMERO_INMUTABLE`, con el texto aprobado de D-66).
   */
  hayNumerosUsados: boolean;
  /** La versión que la pantalla manda al editarlo o cambiarle el ambiente (control de versión optimista). */
  version: number;
}>;

export type PuntosDeVentaDelEmisor = Readonly<{
  emisorId: EmisorId;
  items: readonly PuntoDeVentaParaConfigurar[];
}>;

export type EntradaDePuntosDeVentaDelEmisor = Readonly<{ emisorId: EmisorId }>;

export type ErrorAlVerLosPuntosDeVentaDelEmisor =
  MotivoDeRechazo | "EMISOR_NO_ENCONTRADO" | ErrorDePersistencia;

export function armarPuntosDeVentaDelEmisor({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeFacturacion) {
  return async function puntosDeVentaDelEmisor(
    contexto: ContextoOperativo,
    entrada: EntradaDePuntosDeVentaDelEmisor,
  ): Promise<Resultado<PuntosDeVentaDelEmisor, ErrorAlVerLosPuntosDeVentaDelEmisor>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<Resultado<PuntosDeVentaDelEmisor, MotivoDeRechazo | "EMISOR_NO_ENCONTRADO">> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.puntosDeVentaDelEmisor.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        if ((await tx.emisores.obtener(empresaId, entrada.emisorId)) === null) {
          return err("EMISOR_NO_ENCONTRADO");
        }
        const sucursales = new Map(
          (await tx.sucursales.listar(empresaId)).map((s) => [s.id, s] as const),
        );
        const puntos = await tx.puntosDeVenta.listarDelEmisor(empresaId, entrada.emisorId);
        // Una sola lectura para todos los domicilios (sin N+1), siempre filtrada por la empresa del contexto.
        const domicilios = new Map(
          (
            await tx.domicilios.obtenerVarios(
              empresaId,
              puntos.flatMap((p) => (p.domicilioId === null ? [] : [p.domicilioId])),
            )
          ).map((d) => [d.id, aDomicilioParaLaPantalla(d)] as const),
        );
        const items: PuntoDeVentaParaConfigurar[] = [];
        for (const punto of puntos) {
          // La base lo impide (clave foránea): la sucursal de un punto de venta siempre existe y es de la empresa.
          const sucursal = sucursales.get(punto.sucursalId);
          if (sucursal === undefined)
            throw new Error("un punto de venta de una sucursal que no existe");
          // La base lo impide (clave foránea): el domicilio de un punto de venta siempre existe y es de la empresa.
          const domicilio = punto.domicilioId === null ? null : domicilios.get(punto.domicilioId);
          if (domicilio === undefined)
            throw new Error("un punto de venta de un domicilio que no existe");
          items.push({
            id: punto.id,
            numero: punto.numero,
            activo: punto.estado === "ACTIVO",
            ambiente: punto.ambiente,
            sucursal: { id: sucursal.id, nombre: sucursal.nombre, activa: sucursal.activa },
            tieneDomicilio: punto.domicilioId !== null,
            domicilio,
            hayNumerosUsados: await tx.series.hayNumerosUsadosDelPuntoDeVenta(empresaId, punto.id),
            version: punto.version,
          });
        }
        return ok({ emisorId: entrada.emisorId, items });
      },
    );
  };
}
