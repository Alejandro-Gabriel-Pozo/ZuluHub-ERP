import { exigirSucursal } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { alcanceParaMirar, exigirPermisoDeConsulta, type ErrorDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { fichaDe, type FichaDeSesion } from "./ficha-de-sesion";

export type EntradaDeUltimaSesionDeLaCaja = Readonly<{ cajaId: string }>;

export type ErrorAlVerLaUltimaSesion = ErrorDeConsulta | "CAJA_NO_ENCONTRADA" | ErrorDePersistencia;

/**
 * La última sesión CERRADA de una caja con su arqueo (la ficha de siempre, `fichaDe`: una regla, un lugar), o `null` si la caja nunca se cerró: es el resumen que muestra
 * la pantalla «Caja» cuando está cerrada. `cajas.ver`, `read committed`, alcance de la sucursal de la caja; una caja inexistente o de otra empresa es `CAJA_NO_ENCONTRADA`.
 */
export function armarUltimaSesionDeLaCaja({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeCaja) {
  return async function ultimaSesionDeLaCaja(
    contexto: ContextoOperativo,
    entrada: EntradaDeUltimaSesionDeLaCaja,
  ): Promise<Resultado<FichaDeSesion | null, ErrorAlVerLaUltimaSesion>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<Resultado<FichaDeSesion | null, ErrorDeConsulta | "CAJA_NO_ENCONTRADA">> => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.ultimaSesionDeLaCaja.accion,
        );
        if (!permiso.ok) return permiso;
        const caja = await tx.cajas.obtener(contexto.empresaId, entrada.cajaId);
        if (caja === null) return err("CAJA_NO_ENCONTRADA");
        const dentro = exigirSucursal(await alcanceParaMirar(tx, contexto), caja.sucursalId);
        if (!dentro.ok) return dentro;
        const sesion = await tx.sesiones.ultimaCerradaDeLaCaja(contexto.empresaId, caja.id);
        if (sesion === null) return ok(null);
        return ok(fichaDe(sesion, await tx.arqueos.deLaSesion(contexto.empresaId, sesion.id)));
      },
    );
  };
}
