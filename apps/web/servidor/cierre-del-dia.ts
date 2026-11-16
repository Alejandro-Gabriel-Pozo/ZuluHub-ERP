import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  cancelarElCierre,
  cerrarElDia,
  corregirElMedio,
  darElConforme,
  declararElTotal,
  empezarElCierre,
  type DependenciasDeCierreWeb,
} from "../../../src/composicion/cierre-del-dia-web";
import {
  cargarElCierre,
  type CierreParaLaPantalla,
} from "../../../src/composicion/lectura-del-cierre";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * «Cierre del día»: la lectura de la jornada y las acciones de empezar el cierre, cancelarlo, corregir el medio de un cobro, declarar un total, dar el conforme general y cerrar el día.
 * Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa y llaman a `src/composicion/cierre-del-dia-web.ts`. La sucursal la fija el SERVIDOR: es la elegida en este dispositivo
 * (cookie validada contra las que la persona puede elegir, `sucursalDelPedido`), nunca la que diga el navegador; sin ninguna, el genérico (nunca se asume «todas»). Los casos de uso la vuelven a
 * validar. El permiso, el estado de la jornada y los controles los decide el servidor dentro de cada transacción: la pantalla no replica ninguna regla.
 */

const dependencias: DependenciasDeCierreWeb = {
  casosDeCierre: web.casosDeUsoDeCierre,
  consultasDeCierre: web.consultasDeCierre,
  casosDeCaja: web.casosDeUsoDeCaja,
  consultasDeCaja: web.consultasDeCaja,
  consultasDeVentas: web.consultasDeVentas,
  consultasDeIdentidad: web.consultasDeIdentidad,
  respuesta: dependenciasDeSesion.respuesta,
};

const SIN_SUCURSAL = {
  ok: false,
  error: errorDeCodigo("CIERRE_ACCION_NO_PERMITIDA"),
} as const;

/** La sucursal con la que trabaja la persona, o el genérico si no hay ninguna. */
async function laSucursal(contexto: ContextoOperativo): Promise<Respuesta<string>> {
  const sucursal = await sucursalDelPedido(contexto);
  if (!sucursal.ok) return sucursal;
  return sucursal.dato.efectiva === "" ? SIN_SUCURSAL : { ok: true, dato: sucursal.dato.efectiva };
}

/** La jornada que se opera en la sucursal elegida y todo lo que la pantalla muestra. */
export async function cargarElCierreDeLaSucursal(
  contexto: ContextoOperativo,
): Promise<Respuesta<CierreParaLaPantalla>> {
  const sucursal = await laSucursal(contexto);
  if (!sucursal.ok) return sucursal;
  return cargarElCierre(dependencias, contexto, sucursal.dato);
}

/** Corre una acción del cierre con la empresa de la sesión y la sucursal elegida. */
function enLaSucursal<D>(
  hacer: (contexto: ContextoOperativo, sucursalId: string) => Promise<Respuesta<D>>,
): Promise<Respuesta<D>> {
  return conLaEmpresa(async (contexto) => {
    const sucursal = await laSucursal(contexto);
    if (!sucursal.ok) return sucursal;
    return hacer(contexto, sucursal.dato);
  });
}

export const empezarElCierreDeLaSucursal = (entrada: unknown) =>
  enLaSucursal((contexto, sucursalId) =>
    empezarElCierre(dependencias, contexto, sucursalId, entrada),
  );

export const cancelarElCierreDeLaSucursal = (entrada: unknown) =>
  enLaSucursal((contexto, sucursalId) =>
    cancelarElCierre(dependencias, contexto, sucursalId, entrada),
  );

export const cerrarElDiaDeLaSucursal = (entrada: unknown) =>
  enLaSucursal((contexto, sucursalId) => cerrarElDia(dependencias, contexto, sucursalId, entrada));

/** La sucursal de una corrección sale del cobro, que el caso de uso valida contra el alcance de la persona: no se lee la elegida. */
export const corregirElMedioDelCobro = (entrada: unknown) =>
  conLaEmpresa((contexto) => corregirElMedio(dependencias, contexto, entrada));

export const declararElTotalDeLaSucursal = (entrada: unknown) =>
  enLaSucursal((contexto, sucursalId) =>
    declararElTotal(dependencias, contexto, sucursalId, entrada),
  );

export const darElConformeDeLaSucursal = (entrada: unknown) =>
  enLaSucursal((contexto, sucursalId) =>
    darElConforme(dependencias, contexto, sucursalId, entrada),
  );
