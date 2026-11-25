import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  agregarElDeposito,
  cambiarElEstadoDelDeposito,
  editarElDeposito,
  listarLosDepositos,
  USOS_DE_DEPOSITO,
  verElDeposito,
  type DependenciasDeDepositosWeb,
  type DepositoParaLaPantalla,
  type DepositosParaLaPantalla,
} from "../../../src/composicion/depositos-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { RUTAS_DE_DEPOSITOS } from "../ui/plantillas/stock/depositos/modelo-de-depositos";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { aLaLista, textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";
import { laSucursalDeStock } from "./stock";

/**
 * «Depósitos» de stock: la lectura de la lista, la de un depósito y las acciones de agregar, editar, desactivar y reactivar. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa y llaman a `src/composicion/depositos-web.ts`.
 * La sucursal la fija el SERVIDOR (`laSucursalDeStock`), nunca el navegador. El permiso, el nombre repetido y el «de venta» único los decide el servidor dentro de la transacción: la
 * pantalla no replica ninguna regla. Repetir: el `id` lo genera la página al abrir el formulario y viaja ligado a la acción; el mismo `id` con el mismo contenido no duplica. Editar lleva la versión que se vio (ligada
 * a la acción por la página, no en un campo): con una versión vieja el servidor rechaza. Desactivar y reactivar lo ya hecho no escriben.
 */

const dependencias: DependenciasDeDepositosWeb = {
  casosDeUso: web.casosDeUsoDeStock,
  consultas: web.consultasDeStock,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Los depósitos de la sucursal elegida, también los desactivados. */
export async function cargarLosDepositos(
  contexto: ContextoOperativo,
): Promise<Respuesta<DepositosParaLaPantalla>> {
  const sucursal = await laSucursalDeStock(contexto);
  if (!sucursal.ok) return sucursal;
  return listarLosDepositos(dependencias, contexto, sucursal.dato);
}

/** Un depósito de la sucursal elegida (para editarlo): uno que no es de esa sucursal o de la persona sale como el genérico. */
export async function cargarElDeposito(
  contexto: ContextoOperativo,
  depositoId: string,
): Promise<Respuesta<DepositoParaLaPantalla>> {
  const sucursal = await laSucursalDeStock(contexto);
  if (!sucursal.ok) return sucursal;
  return verElDeposito(dependencias, contexto, sucursal.dato, depositoId);
}

export async function agregarElDepositoDeLaSucursal(
  id: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa(async (contexto) => {
      const sucursal = await laSucursalDeStock(contexto);
      if (!sucursal.ok) return sucursal;
      return agregarElDeposito(dependencias, contexto, sucursal.dato, {
        id,
        nombre: textoDe(datos, "nombre"),
        uso: textoDe(datos, "uso"),
        deVenta: datos.get("deVenta") === "on",
      });
    }),
    RUTAS_DE_DEPOSITOS.lista,
  );
}

/** Guarda el nombre y si es «de venta» con la versión que se vio; si sale bien vuelve a la lista, si no devuelve el error ya traducido. */
export async function guardarElDeposito(
  depositoId: string,
  versionEsperada: number,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      editarElDeposito(dependencias, contexto, {
        depositoId,
        nombre: textoDe(datos, "nombre"),
        deVenta: datos.get("deVenta") === "on",
        versionEsperada,
      }),
    ),
    RUTAS_DE_DEPOSITOS.lista,
  );
}

/** Desactiva (`activo: false`) o reactiva (`activo: true`) el depósito; si sale bien vuelve a la lista, si no devuelve el error ya traducido. */
export async function cambiarElEstadoDelDepositoDeLaSucursal(
  depositoId: string,
  activo: boolean,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      cambiarElEstadoDelDeposito(dependencias, contexto, { depositoId }, activo),
    ),
    RUTAS_DE_DEPOSITOS.lista,
  );
}

/** Los usos que se ofrecen al agregar un depósito: los del servidor (una regla, un lugar), para que la página no importe la composición. */
export const USOS_PARA_ELEGIR: readonly string[] = USOS_DE_DEPOSITO;
