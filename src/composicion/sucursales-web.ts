import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { accionDeUsuarios, lecturaDeUsuarios } from "./errores-de-usuarios";
import { entradaDeAltaDeSucursal } from "./entradas-de-sucursal";
import type { Web } from "./web";

/**
 * La pantalla «Sucursales» de /cuenta: la lista de las sucursales activas de la empresa y el alta de una nueva. Vive acá, y no en `apps/web`, por la misma razón que `roles-web.ts`: probarse con la base real sin levantar
 * Next. Misma traducción de errores que Usuarios y Roles (`errores-de-usuarios.ts`): todo rechazo de negocio es el genérico y los de la base salen sin detalle y con referencia.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/sucursales-web.test.ts`):
 *  - **La empresa y quien actúa salen de la sesión**; del navegador solo viaja el nombre (lista blanca en `entradas-de-sucursal.ts`).
 *  - **El permiso es de la consulta o del caso de uso** (`sucursales.ver` y `sucursales.crear`: gerente y administrador); acá no se decide ninguno.
 *  - **Toda escritura es del caso de uso** (`crearSucursal`): transacción serializable, idempotente por nombre (un doble clic deja UNA sucursal y una «Caja 1»), auditoría y caja por defecto en la misma
 *    transacción. Esta capa no agrega reglas.
 *  - **Nada de más sale**: la lista trae solo el id y el nombre (lista blanca campo por campo), solo las ACTIVAS.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016).
 */

export type DependenciasDeSucursalesWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeEmpresas"]>, "crearSucursal">;
  consultas: () => Pick<ReturnType<Web["consultasDeEmpresas"]>, "listarSucursales">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Una sucursal tal como la dibuja la lista: su id y su nombre, nada más. */
export type SucursalParaLaLista = Readonly<{ id: string; nombre: string }>;

/** Las sucursales ACTIVAS de la empresa (`sucursales.ver`), ordenadas por nombre. */
export function listarLasSucursales(
  d: DependenciasDeSucursalesWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<readonly SucursalParaLaLista[]>> {
  return lecturaDeUsuarios(
    d.respuesta,
    () => d.consultas().listarSucursales(contexto, { incluirInactivas: false }),
    (sucursales) => sucursales.map((s) => ({ id: s.id, nombre: s.nombre })),
  );
}

/** Lo que devuelve el alta: la sucursal que quedó. `yaExistia: true` NO es un error: el mismo pedido repetido (doble clic, reintento) no escribe ni audita otra vez. */
export type SucursalCreada = Readonly<{ sucursalId: string; yaExistia: boolean }>;

/**
 * Crear una sucursal (`sucursales.crear`). `crudo`: `{ nombre }`. Repetirlo con el mismo nombre (sin distinguir mayúsculas) devuelve la que ya había, sin escribir; el de una DESACTIVADA es el genérico y no escribe nada.
 */
export function crearUnaSucursal(
  d: DependenciasDeSucursalesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<SucursalCreada>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeAltaDeSucursal,
    async (entrada) => {
      const r = await d.casosDeUso().crearSucursal(contexto, { nombre: entrada.nombre });
      return r.ok ? ok({ sucursalId: r.valor.sucursalId, yaExistia: r.valor.yaExistia }) : r;
    },
    (salida) => salida,
  );
}
