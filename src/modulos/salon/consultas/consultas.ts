import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import { sucursalId, type SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { cargarEstadosDeLaEmpresa } from "../../empresas/publico";
import { esUuid } from "../../ventas/publico";
import type { Mesa } from "../persistencia/repositorio-de-mesas";
import type { DependenciasDeConsultasDeSalon, TxDeConsultasDeSalon } from "./contrato";

export type ErrorDeConsultaDeSalon =
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDeAlcance
  | ErrorDePersistencia
  | "IDENTIFICADOR_INVALIDO";

type R<S> = Resultado<S, ErrorDeConsultaDeSalon>;

export type EntradaDeListarMesas = Readonly<{
  sucursalId: string;
  incluirInactivas?: boolean | undefined;
}>;

/** El guard (`mesas.ver`), que la empresa opere y el alcance de sucursales de quien pide: lo primero de toda consulta. */
async function previo(
  tx: TxDeConsultasDeSalon,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeConsultasDeSalon,
): Promise<Resultado<"TODAS" | readonly SucursalId[], MotivoDeRechazo | EmpresaNoOpera>> {
  const permiso = await exigirAccion(dependencias.reglas, "mesas.ver", () =>
    tx.autorizacion.delActor(contexto),
  );
  if (!permiso.ok) return permiso;
  const opera = comprobarQueOpera(
    contexto.empresaId,
    await cargarEstadosDeLaEmpresa(tx, contexto.empresaId),
  );
  if (!opera.ok) return opera;
  return ok(await tx.autorizacion.sucursalesDelActor(contexto));
}

export function crearConsultasDeSalon(dependencias: DependenciasDeConsultasDeSalon) {
  return {
    /** La lista de administración de las mesas de la sucursal, por número (sin las desactivadas salvo que se pidan). */
    listarMesas: (contexto: ContextoOperativo, entrada: EntradaDeListarMesas): Promise<R<Mesa[]>> =>
      dependencias.transacciones.ejecutar<Mesa[], ErrorDeConsultaDeSalon>(
        { contexto, aislamiento: "read committed", soloLectura: true },
        async (tx) => {
          const alcance = await previo(tx, contexto, dependencias);
          if (!alcance.ok) return alcance;
          if (!esUuid(entrada.sucursalId)) return err("IDENTIFICADOR_INVALIDO");
          const permitida = exigirSucursal(alcance.valor, sucursalId(entrada.sucursalId));
          if (!permitida.ok) return permitida;
          return ok(
            await tx.mesas.listar(
              contexto.empresaId,
              sucursalId(entrada.sucursalId),
              entrada.incluirInactivas === true,
            ),
          );
        },
      ),
  };
}

export type ConsultasDeSalon = ReturnType<typeof crearConsultasDeSalon>;
