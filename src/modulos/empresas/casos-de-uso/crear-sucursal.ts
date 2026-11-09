import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  cambiosDeContactoValidos,
  type CambiosDeContacto,
  type ContactoDeSucursal,
} from "../dominio/contacto-de-sucursal";
import {
  decidirAltaConNombreOcupado,
  nombreDeSucursalValido,
  type ErrorDeSucursal,
} from "../dominio/sucursal";
import type { ErrorDeGancho } from "../ganchos-de-sucursal";
import { cargarEstadosDeLaEmpresa } from "./comun";
import type { DependenciasDeEmpresas } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeCrearSucursal = Readonly<{
  nombre: string;
  /**
   * Contacto de la sucursal (D-98), los tres opcionales: omitido, `null` o en blanco = sin dato. Solo se
   * escribe en una sucursal NUEVA: si ya existía una con ese nombre, no se compara ni se pisa su contacto.
   */
  telefono?: string | null | undefined;
  correo?: string | null | undefined;
  web?: string | null | undefined;
}>;

export type SalidaDeCrearSucursal = Readonly<{
  sucursalId: SucursalId;
  /** `true`: ya había una sucursal activa con ese nombre; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropioAlCrearSucursal = Extract<
  ErrorDeSucursal,
  | "NOMBRE_DE_SUCURSAL_INVALIDO"
  | "TELEFONO_DE_SUCURSAL_INVALIDO"
  | "CORREO_DE_SUCURSAL_INVALIDO"
  | "WEB_DE_SUCURSAL_INVALIDA"
  | "SUCURSAL_INACTIVA_CON_ESE_NOMBRE"
>;

export type ErrorAlCrearSucursal =
  | ErrorPropioAlCrearSucursal
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDeGancho
  | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso. */
const RESTRICCIONES_ADMITIDAS = [
  "NOMBRE_DE_SUCURSAL_INVALIDO",
  "TELEFONO_DE_SUCURSAL_INVALIDO",
  "CORREO_DE_SUCURSAL_INVALIDO",
  "WEB_DE_SUCURSAL_INVALIDA",
] as const;

/** Solo los datos de contacto que la sucursal nueva tiene (los vacíos no entran a la auditoría). */
function contactoCargado(contacto: ContactoDeSucursal): CambiosDeContacto {
  return {
    ...(contacto.telefono === null ? {} : { telefono: contacto.telefono }),
    ...(contacto.correo === null ? {} : { correo: contacto.correo }),
    ...(contacto.web === null ? {} : { web: contacto.web }),
  };
}

/**
 * Crear una sucursal en la empresa del contexto (H6, §B.1). Contexto OPERATIVO con persona. En una
 * transacción serializable: el guard (`sucursales.crear`), la empresa opera, el nombre y el contacto
 * pedido (opcional) son válidos y entonces `INSERT ... ON CONFLICT DO NOTHING`:
 *
 *  - se insertó → auditoría `SUCURSAL_CREADA` en la misma transacción, con el contacto cargado;
 *  - ya había una activa con ese nombre (sin distinguir mayúsculas) → se devuelve esa
 *    (`yaExistia: true`) sin escribir: un doble clic o un reintento deja una sola sucursal;
 *  - ya había una desactivada con ese nombre → `SUCURSAL_INACTIVA_CON_ESE_NOMBRE` (se la reactiva).
 *
 * Si se insertó, después de la auditoría corren los ganchos de sucursal (decisión 165), en orden y en la
 * misma transacción: el primero que falla revierte todo (no queda la sucursal). Una repetición no los invoca.
 *
 * Dos altas simultáneas del mismo nombre: la que espera ve la otra al reintentar (serializable) y
 * devuelve `yaExistia`. El id lo genera la base.
 */
export function armarCrearSucursal({
  transacciones,
  reglas,
  ganchosDeSucursal = [],
}: DependenciasDeEmpresas) {
  return async function crearSucursal(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearSucursal,
  ): Promise<Resultado<SalidaDeCrearSucursal, ErrorAlCrearSucursal>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCrearSucursal,
          ErrorPropioAlCrearSucursal | MotivoDeRechazo | EmpresaNoOpera | ErrorDeGancho
        >
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.crearSucursal.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = comprobarQueOpera(empresaId, await cargarEstadosDeLaEmpresa(tx, empresaId));
        if (!opera.ok) return opera;
        const nombre = nombreDeSucursalValido(entrada.nombre);
        if (!nombre.ok) return nombre;
        const contacto = cambiosDeContactoValidos(entrada);
        if (!contacto.ok) return contacto;

        const alta = await tx.sucursales.crearSiNoExiste(empresaId, nombre.valor, contacto.valor);
        if (!alta.creada) {
          const decision = decidirAltaConNombreOcupado(alta.sucursal);
          if (!decision.ok) return decision;
          return ok({ sucursalId: alta.sucursal.id, yaExistia: true });
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "SUCURSAL_CREADA",
          entidad: "sucursal",
          entidadId: alta.sucursal.id,
          despues: {
            nombre: alta.sucursal.nombre,
            activa: true,
            ...contactoCargado(alta.sucursal.contacto),
          },
        });
        for (const gancho of ganchosDeSucursal) {
          const resultadoDelGancho = await gancho.alCrearSucursalEnTx(tx, contexto, {
            sucursalId: alta.sucursal.id,
            nombre: alta.sucursal.nombre,
          });
          if (!resultadoDelGancho.ok) return resultadoDelGancho;
        }
        return ok({ sucursalId: alta.sucursal.id, yaExistia: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
