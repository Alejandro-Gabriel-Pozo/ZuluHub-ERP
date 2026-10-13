import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirAsignaciones } from "../dominio/asignacion";
import type { ErrorDeAsignaciones } from "../dominio/errores";
import { cargarEmpresas } from "./comun";
import type { DependenciasDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeAsignarSucursales = Readonly<{
  personaId: PersonaId;
  /** El conjunto FINAL de sucursales asignadas, no una lista de cambios. */
  sucursales: readonly SucursalId[];
}>;

export type SalidaDeAsignarSucursales = Readonly<{
  agregadas: readonly SucursalId[];
  reactivadas: readonly SucursalId[];
  quitadas: readonly SucursalId[];
}>;

/** Errores propios de este caso de uso, además de los del dominio (`ErrorDeAsignaciones`). */
type ErrorPropioAlAsignarSucursales = "MEMBRESIA_NO_ENCONTRADA" | "MEMBRESIA_INACTIVA";

export type ErrorAlAsignarSucursales =
  | ErrorDeAsignaciones
  | ErrorPropioAlAsignarSucursales
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso. */
const RESTRICCIONES_ADMITIDAS = [
  "SUCURSAL_NO_ES_DE_LA_EMPRESA",
  "MEMBRESIA_NO_ENCONTRADA",
] as const;

/**
 * Cambiar las sucursales asignadas a un miembro (H6, §B.2). Contexto OPERATIVO con persona. En una
 * transacción serializable: el guard (`usuarios.asignar_sucursales`, gerente y administrador), la
 * empresa opera, el miembro existe y está activo, y el dominio calcula la diferencia entre lo
 * asignado y el conjunto final pedido (`decidirAsignaciones`: una sucursal que no es de la empresa,
 * o desactivada y habría que asignarla).
 *
 * Las que faltan se insertan, las apagadas se vuelven a prender y las sobrantes se apagan; nunca se
 * borra nada. Un conjunto vacío es válido (se quitan todas). Pedir lo que ya hay no escribe ni
 * audita: la repetición es inocua. Lo escrito queda en UNA auditoría `ASIGNACIONES_CAMBIADAS` con el
 * antes y el después, en la misma transacción; si falla una escritura no queda ninguna.
 *
 * Gerente y administrador trabajan en todas las sucursales (F1): la asignación solo limita al
 * operador, pero se puede registrar para cualquier miembro activo. Dos ediciones a la vez sobre la
 * misma persona: la serializable deja pasar una y la otra repite sobre el resultado de la primera,
 * así que queda uno de los dos conjuntos, nunca una mezcla.
 */
export function crearAsignarSucursales({ transacciones, reglas }: DependenciasDeIdentidad) {
  return async function asignarSucursales(
    contexto: ContextoOperativo,
    entrada: EntradaDeAsignarSucursales,
  ): Promise<Resultado<SalidaDeAsignarSucursales, ErrorAlAsignarSucursales>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeAsignarSucursales,
          ErrorDeAsignaciones | ErrorPropioAlAsignarSucursales | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.asignarSucursales.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const { estados } = await cargarEmpresas(tx, [empresaId]);
        const opera = comprobarQueOpera(empresaId, estados);
        if (!opera.ok) return opera;

        const miembro = await tx.membresias.obtener(empresaId, entrada.personaId);
        if (miembro === null) return err("MEMBRESIA_NO_ENCONTRADA");
        if (!miembro.activo) return err("MEMBRESIA_INACTIVA");

        const actuales = await tx.asignaciones.deLaPersona(empresaId, miembro.personaId);
        const sucursales = await tx.sucursales.listar(empresaId);
        const cambio = decidirAsignaciones(
          actuales,
          entrada.sucursales,
          sucursales.map((s) => ({ id: s.id, activa: s.activa })),
        );
        if (!cambio.ok) return cambio;
        const { agregadas, reactivadas, quitadas } = cambio.valor;
        if (agregadas.length + reactivadas.length + quitadas.length === 0) {
          return ok(cambio.valor);
        }

        const versionDe = (sucursal: SucursalId): number => {
          const fila = actuales.find((a) => a.sucursalId === sucursal);
          if (fila === undefined)
            throw new Error(`invariante rota: no hay asignación de ${sucursal}`);
          return fila.version;
        };
        await tx.asignaciones.crear(empresaId, miembro.personaId, agregadas);
        const { personaId } = miembro;
        const escrituras = [
          ...reactivadas.map(
            (sucursal) => () =>
              tx.asignaciones.reactivar(empresaId, personaId, sucursal, versionDe(sucursal)),
          ),
          ...quitadas.map(
            (sucursal) => () =>
              tx.asignaciones.apagar(empresaId, personaId, sucursal, versionDe(sucursal)),
          ),
        ];
        // `false`: la fila ya no es la que se leyó (en serializable lo normal es el reintento, no esto).
        for (const escribir of escrituras) {
          if (!(await escribir())) return err("MEMBRESIA_NO_ENCONTRADA");
        }

        const antes = actuales
          .filter((a) => a.activa)
          .map((a) => a.sucursalId)
          .sort();
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "ASIGNACIONES_CAMBIADAS",
          entidad: "membresia",
          entidadId: miembro.personaId,
          antes: { sucursales: antes },
          despues: {
            sucursales: [...new Set(entrada.sucursales)].sort(),
            agregadas,
            reactivadas,
            quitadas,
          },
        });
        return ok(cambio.valor);
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
