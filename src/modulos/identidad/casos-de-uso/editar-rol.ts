import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import { exigirPerilla, type ErrorDePerilla } from "../../../capacidades/planes/derechos";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { claveDeNombreDeRol, nombreDeRolDesdeTexto } from "../../../primitivas/texto/nombre-de-rol";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirEdicionDeRol,
  decidirReactivacionDeRol,
  decidirTopeTecnicoDeRoles,
  type ErrorDeRolPropio,
} from "../dominio/rol-propio";
import type { DependenciasDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import {
  conjuntoValido,
  permisoYEmpresaQueOpera,
  type ConjuntoDeAccionesInvalido,
} from "./roles-comun";
import { traducirErrores } from "./traducir";

export type EntradaDeEditarRol = Readonly<{
  rolId: string;
  /** Si viene y es distinto del actual, cambia el nombre. */
  nombre?: string | undefined;
  /** El conjunto FINAL de acciones (no una lista de cambios). Si viene y es distinto del vigente, se guarda como una versión nueva. */
  acciones?: readonly string[] | undefined;
  /**
   * `true`: el rol está archivado y se lo vuelve a activar antes de aplicar lo demás (cuenta contra la perilla del plan y el tope técnico igual que un alta; si ya está activo no hace nada).
   * Sin esto, editar un rol archivado es `ROL_ARCHIVADO`.
   */
  reactivar?: boolean | undefined;
  /** La `version` del rol que vio quien edita: si cambió desde entonces, `EDICION_DESACTUALIZADA` (nadie pisa lo de otro sin saberlo). Opcional. */
  versionEsperada?: number | undefined;
}>;

export type SalidaDeEditarRol = Readonly<{
  /** `false`: el rol ya estaba así; no se escribió nada. */
  cambio: boolean;
  /** El número de la versión de acciones vigente después de la edición. */
  numeroDeVersion: number;
}>;

type ErrorPropio =
  | ErrorDeRolPropio
  | "NOMBRE_DE_ROL_INVALIDO"
  | "EDICION_DESACTUALIZADA"
  | ConjuntoDeAccionesInvalido
  | ErrorDePerilla;

export type ErrorAlEditarRol = ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio). */
const RESTRICCIONES_ADMITIDAS = [
  "NOMBRE_DE_ROL_INVALIDO",
  "NOMBRE_DE_ROL_EN_USO",
  "EDICION_DESACTUALIZADA",
] as const;

/**
 * Editar un rol propio (H4b T4): su nombre y/o su conjunto de acciones; con `reactivar` primero se vuelve a activar uno archivado (único camino de reactivación, con el mismo permiso). Solo el gerente (`roles.editar`). En una transacción serializable: guard, la empresa opera, el rol existe y
 * está activo, el nombre es válido y no es el de otro rol, y el conjunto cumple el catálogo, el plan y los pisos (`validarConjuntoDeAcciones`, con TODOS los problemas juntos). Lo que no
 * cambia no se escribe ni se audita (repetir la edición es inocuo). Un conjunto nuevo es una VERSIÓN nueva (la anterior no se toca: es historial); dos ediciones a la vez sobre el mismo rol:
 * la serializable deja pasar una y la otra repite sobre el resultado, o choca con la clave primaria de la versión. Rige desde la operación siguiente de las personas que lo tienen (el
 * conjunto se lee en cada transacción).
 */
export function crearEditarRol({ transacciones, reglas }: DependenciasDeIdentidad) {
  return async function editarRol(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarRol,
  ): Promise<Resultado<SalidaDeEditarRol, ErrorAlEditarRol>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<Resultado<SalidaDeEditarRol, ErrorPropio | MotivoDeRechazo | EmpresaNoOpera>> => {
        const previo = await permisoYEmpresaQueOpera(
          tx,
          contexto,
          reglas,
          DECLARACIONES.editarRol.accion,
        );
        if (!previo.ok) return previo;
        let rol = await tx.roles.obtener(empresaId, entrada.rolId);
        if (
          rol !== null &&
          entrada.versionEsperada !== undefined &&
          entrada.versionEsperada !== rol.version
        ) {
          return err("EDICION_DESACTUALIZADA");
        }
        let reactivado = false;
        if (entrada.reactivar === true) {
          const reactivacion = decidirReactivacionDeRol(rol);
          if (!reactivacion.ok) return reactivacion;
          if (reactivacion.valor === "REACTIVAR" && rol !== null) {
            const enUso = await tx.roles.contarActivos(empresaId);
            const perilla = exigirPerilla(
              await tx.derechos.deLaEmpresa(contexto),
              "roles_propios_por_empresa",
              { empresaId },
              enUso,
            );
            if (!perilla.ok) return perilla;
            const tope = decidirTopeTecnicoDeRoles(enUso);
            if (!tope.ok) return tope;
            if (!(await tx.roles.cambiarActivo(empresaId, rol.id, true, rol.version))) {
              return err("EDICION_DESACTUALIZADA");
            }
            rol = await tx.roles.obtener(empresaId, entrada.rolId);
            reactivado = true;
          }
        }
        let nombre: string | undefined;
        if (entrada.nombre !== undefined) {
          const valido = nombreDeRolDesdeTexto(entrada.nombre);
          if (!valido.ok) return err("NOMBRE_DE_ROL_INVALIDO");
          nombre = valido.valor;
        }
        const derechos = await tx.derechos.deLaEmpresa(contexto);
        const pisos = await tx.roles.pisos();
        let acciones: readonly string[] | undefined;
        if (entrada.acciones !== undefined) {
          const valido = conjuntoValido(
            entrada.acciones,
            reglas,
            derechos.modulosHabilitados,
            pisos,
          );
          if (!valido.ok) return valido;
          acciones = valido.valor;
        }
        const decision = decidirEdicionDeRol({
          rol,
          nombre,
          conEseNombre:
            nombre === undefined
              ? null
              : await tx.roles.obtenerPorNombre(empresaId, claveDeNombreDeRol(nombre)),
          acciones,
        });
        if (!decision.ok) return decision;
        if (rol === null) throw new Error("invariante rota: el dominio dejó pasar un rol nulo");
        const { cambiaElNombre, cambiaLasAcciones } = decision.valor;
        if (contexto.personaId === null) {
          throw new Error("invariante rota: el guard dejó pasar un contexto sin persona");
        }
        if (reactivado) {
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: contexto.personaId,
            accion: "ROL_REACTIVADO",
            entidad: "rol_de_empresa",
            entidadId: rol.id,
            antes: { activo: false },
            despues: { activo: true },
          });
        }
        if (!cambiaElNombre && !cambiaLasAcciones) {
          return ok({ cambio: reactivado, numeroDeVersion: rol.numeroDeVersion });
        }

        if (cambiaElNombre && nombre !== undefined) {
          const escrito = await tx.roles.cambiarNombre(
            empresaId,
            rol.id,
            nombre,
            claveDeNombreDeRol(nombre),
            rol.version,
          );
          if (!escrito) return err("EDICION_DESACTUALIZADA");
        }
        let numeroDeVersion = rol.numeroDeVersion;
        if (cambiaLasAcciones && acciones !== undefined) {
          numeroDeVersion = rol.numeroDeVersion + 1;
          await tx.roles.agregarVersion(
            empresaId,
            rol.id,
            numeroDeVersion,
            acciones,
            contexto.personaId,
            contexto.ahora,
          );
        }
        const antes = new Set(rol.acciones);
        const despues = new Set(acciones ?? rol.acciones);
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "ROL_EDITADO",
          entidad: "rol_de_empresa",
          entidadId: rol.id,
          antes: { nombre: rol.nombre, numeroDeVersion: rol.numeroDeVersion },
          despues: {
            nombre: nombre ?? rol.nombre,
            numeroDeVersion,
            agregadas: [...despues].filter((a) => !antes.has(a)).sort(),
            quitadas: [...antes].filter((a) => !despues.has(a)).sort(),
          },
        });
        return ok({ cambio: true, numeroDeVersion });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
