import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  agregarLaCuentaDeCobro,
  desactivarLaCuentaDeCobro,
  editarLaCuentaDeCobro,
  listarLasCuentasDeCobro,
  reactivarLaCuentaDeCobro,
  type CuentaParaLaPantalla,
  type DependenciasDeCuentasDeCobroWeb,
} from "../../../src/composicion/cuentas-de-cobro-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { RUTAS_DE_CUENTAS } from "../ui/plantillas/caja/modelo-de-cuentas-de-cobro";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { aLaLista, textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";
import { sucursalesParaElegir, type SucursalParaElegir } from "./sucursal-elegida";

/**
 * «Cuentas de cobro» de la configuración de caja: la lectura de la lista y las acciones de agregar, editar, desactivar y reactivar. Finas a propósito (ADR-015, punto 2):
 * resuelven QUIÉN y DÓNDE actúa (`conLaEmpresa`) y llaman a `src/composicion/cuentas-de-cobro-web.ts`. El permiso y la validez los decide el servidor, dentro de la transacción;
 * la sucursal del formulario se valida contra el alcance de la persona en el caso de uso (una ajena o inexistente es el genérico). El id y la versión no viajan en el formulario:
 * los fija la página al armar la acción (`bind`). Repetir no duplica: agregar lo que ya existe devuelve lo existente; desactivar y reactivar no escriben si ya estaba así.
 */

const dependencias: DependenciasDeCuentasDeCobroWeb = {
  casosDeUso: web.casosDeUsoDeCaja,
  consultas: web.consultasDeCaja,
  respuesta: dependenciasDeSesion.respuesta,
};

export type CuentasConSucursales = Readonly<{
  cuentas: readonly CuentaParaLaPantalla[];
  /** Las sucursales que la persona puede elegir (abiertas y cerradas): para decir a cuál pertenece cada cuenta. */
  sucursales: readonly SucursalParaElegir[];
}>;

/** Las cuentas a las que llega la persona, también las desactivadas, con los nombres de sus sucursales. */
export async function cargarLasCuentas(
  contexto: ContextoOperativo,
): Promise<Respuesta<CuentasConSucursales>> {
  const cuentas = await listarLasCuentasDeCobro(dependencias, contexto);
  if (!cuentas.ok) return cuentas;
  const sucursales = await sucursalesParaElegir(contexto);
  if (!sucursales.ok) return sucursales;
  return { ok: true, dato: { cuentas: cuentas.dato.cuentas, sucursales: sucursales.dato } };
}

export async function agregarLaCuenta(datos: FormData): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      agregarLaCuentaDeCobro(dependencias, contexto, {
        tipo: textoDe(datos, "tipo"),
        nombre: textoDe(datos, "nombre"),
        identificadorExterno: textoDe(datos, "identificadorExterno"),
        sucursalId: textoDe(datos, "sucursalId"),
      }),
    ),
    RUTAS_DE_CUENTAS.lista,
  );
}

export async function editarLaCuenta(
  cuentaDeCobroId: string,
  versionEsperada: number,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      editarLaCuentaDeCobro(dependencias, contexto, {
        cuentaDeCobroId,
        versionEsperada,
        nombre: textoDe(datos, "nombre"),
        identificadorExterno: textoDe(datos, "identificadorExterno"),
        sucursalId: textoDe(datos, "sucursalId"),
      }),
    ),
    RUTAS_DE_CUENTAS.lista,
  );
}

export async function desactivarLaCuenta(cuentaDeCobroId: string): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      desactivarLaCuentaDeCobro(dependencias, contexto, { cuentaDeCobroId }),
    ),
    RUTAS_DE_CUENTAS.lista,
  );
}

export async function reactivarLaCuenta(cuentaDeCobroId: string): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      reactivarLaCuentaDeCobro(dependencias, contexto, { cuentaDeCobroId }),
    ),
    RUTAS_DE_CUENTAS.lista,
  );
}
