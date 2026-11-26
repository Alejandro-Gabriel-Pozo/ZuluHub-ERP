import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { datosDeLosClientes } from "./datos-de-clientes";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import type { DependenciasDeEstadoDeCuenta } from "./ver-estado-de-cuenta";

/** Un cliente activo que todavía no tiene ficha de cuenta corriente, tal como se ofrece para habilitarlo. `nombre` es el nombre para mostrar (la razón social, en una persona jurídica). */
export type ClienteSinCuenta = Readonly<{
  parteId: string;
  nombre: string | null;
  /** Solo el documento de tipo CUIT; `null` si no tiene (habilitar lo rechazaría). */
  cuit: string | null;
}>;

export type ErrorAlListarClientesSinCuenta = MotivoDeRechazo | ErrorDePersistencia;

/**
 * Los clientes activos SIN ficha de cuenta corriente, para elegir a quién habilitar (CC-5, A2). Exige `cuenta_corriente.administrar` (es la lista del formulario de habilitar: quien no puede habilitar
 * no la ve). Incluye también a los que no tienen CUIT: la pantalla avisa y no deja habilitar, y el servidor igual lo rechaza al habilitar (una sola regla, la de la base). Una sola transacción de solo
 * lectura `serializable`; el aislamiento por empresa sale del contexto. Orden estable por nombre de búsqueda e id (el del directorio). Trae hasta el tope de la búsqueda de clientes.
 */
export function armarListarClientesSinCuenta(dependencias: DependenciasDeEstadoDeCuenta) {
  const { transacciones, reglas } = dependencias;
  return async function listarClientesSinCuenta(
    contexto: ContextoOperativo,
  ): Promise<Resultado<readonly ClienteSinCuenta[], ErrorAlListarClientesSinCuenta>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "serializable", soloLectura: true },
      async (tx): Promise<Resultado<readonly ClienteSinCuenta[], MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarClientesSinCuenta.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const empresa = contexto.empresaId;
        const candidatos = await tx.partes.candidatos(empresa, {
          textoNormalizado: "",
          documentoBuscado: null,
          rol: "CUSTOMER",
          incluirDesactivadas: false,
        });
        const cuentas = await tx.cuentasDeClientes.listar(empresa);
        const conCuenta = new Set(cuentas.map((c) => c.parteId));
        const sinCuenta = candidatos.filter((p) => !conCuenta.has(p.id));
        const datos = await datosDeLosClientes(
          tx,
          empresa,
          sinCuenta.map((p) => p.id),
        );
        return ok(
          sinCuenta.map((p) => ({
            parteId: p.id,
            nombre: datos.get(p.id)?.nombre ?? null,
            cuit: datos.get(p.id)?.cuit ?? null,
          })),
        );
      },
    );
  };
}
