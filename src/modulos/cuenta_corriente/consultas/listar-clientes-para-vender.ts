import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { EstadoDeCuenta } from "../dominio/condiciones";
import { datosDeLosClientes } from "./datos-de-clientes";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import type { DependenciasDeEstadoDeCuenta } from "./ver-estado-de-cuenta";

/**
 * Un cliente de la lista de «Vender a cuenta corriente» (CC-5, B1): solo lo que ve quien vende para ELEGIR. Nunca el saldo, el límite, el vencido ni los movimientos: eso lo ve, de UN cliente ya elegido,
 * quien tiene `consultar_al_vender` (con constancia).
 */
export type ClienteParaElegirAlVender = Readonly<{
  parteId: string;
  nombre: string | null;
  cuit: string | null;
  plazoDias: number;
  /** Una cuenta suspendida se muestra (para que se vea por qué no se puede) y el servidor igual rechaza cargarle una venta. */
  estado: EstadoDeCuenta;
}>;

export type ErrorAlListarClientesParaVender = MotivoDeRechazo | ErrorDePersistencia;

/**
 * Los clientes ACTIVOS de la empresa con ficha de cuenta corriente (habilitada o suspendida), para elegir a quién se le vende a cuenta. Exige `cuenta_corriente.cargar_a_cuenta` (la acción de quien cierra
 * una cuenta a nombre de un cliente; quien no puede cargar a cuenta no ve la lista). Una sola transacción `serializable` de solo lectura: el aislamiento por empresa sale del contexto. Un cliente
 * desactivado o anonimizado no figura. Orden estable: por nombre (sin nombre al final) y por id.
 */
export function armarListarClientesParaVender(dependencias: DependenciasDeEstadoDeCuenta) {
  const { transacciones, reglas } = dependencias;
  return async function listarClientesParaVender(
    contexto: ContextoOperativo,
  ): Promise<Resultado<readonly ClienteParaElegirAlVender[], ErrorAlListarClientesParaVender>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "serializable", soloLectura: true },
      async (tx): Promise<Resultado<readonly ClienteParaElegirAlVender[], MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarClientesParaVender.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const empresa = contexto.empresaId;
        const cuentas = await tx.cuentasDeClientes.listar(empresa);
        const partes = await tx.partes.obtenerVarias(
          empresa,
          cuentas.map((c) => c.parteId),
        );
        const activas = new Set(partes.filter((p) => p.estado === "ACTIVA").map((p) => p.id));
        const visibles = cuentas.filter((c) => activas.has(c.parteId));
        const datos = await datosDeLosClientes(
          tx,
          empresa,
          visibles.map((c) => c.parteId),
        );
        const lista = visibles.map((c) => ({
          parteId: c.parteId,
          nombre: datos.get(c.parteId)?.nombre ?? null,
          cuit: datos.get(c.parteId)?.cuit ?? null,
          plazoDias: c.plazoDias,
          estado: c.estado,
        }));
        return ok(
          lista.sort((a, b) => {
            if ((a.nombre === null) !== (b.nombre === null)) return a.nombre === null ? 1 : -1;
            const porNombre = (a.nombre ?? "").localeCompare(b.nombre ?? "", "es");
            return porNombre !== 0 ? porNombre : a.parteId < b.parteId ? -1 : 1;
          }),
        );
      },
    );
  };
}
