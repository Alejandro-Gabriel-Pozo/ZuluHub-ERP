import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  agregarLaCaja,
  desactivarLaCaja,
  editarLaCaja,
  listarLasCajas,
  reactivarLaCaja,
  type CajasParaLaPantalla,
  type DependenciasDeCajasWeb,
} from "../../../src/composicion/cajas-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { RUTAS_DE_CAJAS } from "../ui/plantillas/caja/modelo-de-cajas";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./facturacion";
import { aLaLista, textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * «Cajas» de la configuración de caja: la lectura de la lista y las acciones de agregar, editar el nombre, desactivar y reactivar. Finas a propósito (ADR-015, punto 2): resuelven
 * QUIÉN y DÓNDE actúa y llaman a `src/composicion/cajas-web.ts`. La sucursal la fija el SERVIDOR: es la elegida en este dispositivo (cookie validada contra las que la persona puede
 * elegir, `sucursalDelPedido`), nunca la que diga el navegador; sin ninguna, el genérico (nunca se asume «todas»). El caso de uso la vuelve a validar. El permiso, el límite del plan y la sesión
 * abierta los decide el servidor dentro de la transacción: la pantalla no replica ninguna regla.
 */

const dependencias: DependenciasDeCajasWeb = {
  casosDeUso: web.casosDeUsoDeCaja,
  consultas: web.consultasDeCaja,
  respuesta: dependenciasDeSesion.respuesta,
};

const SIN_SUCURSAL = {
  ok: false,
  error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA"),
} as const;

/** La sucursal con la que trabaja la persona, o el genérico si no hay ninguna. */
async function laSucursal(contexto: ContextoOperativo): Promise<Respuesta<string>> {
  const sucursal = await sucursalDelPedido(contexto);
  if (!sucursal.ok) return sucursal;
  return sucursal.dato.efectiva === "" ? SIN_SUCURSAL : { ok: true, dato: sucursal.dato.efectiva };
}

/** Las cajas de la sucursal elegida, también las desactivadas. */
export async function cargarLasCajas(
  contexto: ContextoOperativo,
): Promise<Respuesta<CajasParaLaPantalla>> {
  const sucursal = await laSucursal(contexto);
  if (!sucursal.ok) return sucursal;
  return listarLasCajas(dependencias, contexto, sucursal.dato);
}

export async function agregarLaCajaDeLaSucursal(datos: FormData): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa(async (contexto) => {
      const sucursal = await laSucursal(contexto);
      if (!sucursal.ok) return sucursal;
      return agregarLaCaja(dependencias, contexto, sucursal.dato, {
        nombre: textoDe(datos, "nombre"),
      });
    }),
    RUTAS_DE_CAJAS.lista,
  );
}

export async function editarLaCajaDeLaSucursal(
  cajaId: string,
  versionEsperada: number,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      editarLaCaja(dependencias, contexto, {
        cajaId,
        versionEsperada,
        nombre: textoDe(datos, "nombre"),
      }),
    ),
    RUTAS_DE_CAJAS.lista,
  );
}

export async function desactivarLaCajaDeLaSucursal(cajaId: string): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) => desactivarLaCaja(dependencias, contexto, { cajaId })),
    RUTAS_DE_CAJAS.lista,
  );
}

export async function reactivarLaCajaDeLaSucursal(cajaId: string): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) => reactivarLaCaja(dependencias, contexto, { cajaId })),
    RUTAS_DE_CAJAS.lista,
  );
}
