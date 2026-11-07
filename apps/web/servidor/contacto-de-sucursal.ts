import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { aRespuestaDeExcepcion } from "../../../src/composicion/a-respuesta";
import {
  editarContactoDeSucursal,
  fichaDeContactoDeSucursal,
  type ContactoDeSucursalParaLaPantalla,
  type DependenciasDeSucursalWeb,
} from "../../../src/composicion/contacto-de-sucursal-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { conLaEmpresa } from "./facturacion";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * El «Contacto de la sucursal» de /cuenta (D-113, alcance A): la lectura de la ficha y el guardado. Finas a propósito (ADR-015, punto 2):
 * resuelven DÓNDE y QUIÉN actúa y llaman a `src/composicion/contacto-de-sucursal-web.ts`, donde se prueba el resto. El permiso
 * (`sucursales.ver` / `sucursales.editar`) y la validez de cada dato los decide el servidor, dentro de la transacción: la pantalla no
 * valida nada.
 *
 * La sucursal la fija el SERVIDOR: es la elegida en este dispositivo (cookie validada contra las que la persona puede elegir,
 * `sucursalDelPedido`), nunca la que diga el navegador. Del pedido solo se toman la versión y los tres datos de contacto: la empresa y el
 * nombre que mande el cliente se descartan; su `sucursalId` solo se compara (ver abajo). Previene: editar el contacto de una sucursal que la persona no eligió o de
 * otra empresa. Chequeo: `test/web/servidor-contacto-de-sucursal.test.ts`.
 */

const dependencias: DependenciasDeSucursalWeb = {
  casosDeUso: web.casosDeUsoDeEmpresas,
  consultas: web.consultasDeEmpresas,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Lo único que se toma del pedido del navegador (lista blanca). */
const CAMPOS_DEL_PEDIDO = ["versionEsperada", "telefono", "correo", "web"] as const;

function soloLoPermitido(entrada: unknown): Record<string, unknown> {
  const tomado: Record<string, unknown> = {};
  if (typeof entrada !== "object" || entrada === null) return tomado;
  for (const campo of CAMPOS_DEL_PEDIDO) {
    if (Object.hasOwn(entrada, campo)) tomado[campo] = (entrada as Record<string, unknown>)[campo];
  }
  return tomado;
}

function coincideConLaMostrada(entrada: unknown, efectiva: string): boolean {
  if (typeof entrada !== "object" || entrada === null) return false;
  const mostrada = (entrada as Record<string, unknown>)["sucursalId"];
  return typeof mostrada === "string" && efectiva !== "" && mostrada === efectiva;
}

/** La ficha de la sucursal elegida, con el contexto que ya resolvió la página. Con varias y sin elegir, `FISCAL_SUCURSAL_NO_ELEGIDA`. */
export async function cargarElContactoDeLaSucursal(
  contexto: ContextoOperativo,
): Promise<Respuesta<ContactoDeSucursalParaLaPantalla>> {
  try {
    const sucursal = await sucursalDelPedido(contexto);
    if (!sucursal.ok) return sucursal;
    return await fichaDeContactoDeSucursal(dependencias, contexto, {
      sucursalId: sucursal.dato.elegida,
    });
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, dependenciasDeSesion.respuesta);
  }
}

/** Guarda el contacto de la sucursal elegida en el dispositivo; devuelve la versión vigente. */
export function guardarElContactoDeLaSucursal(
  entrada: unknown,
): Promise<Respuesta<Readonly<{ version: number }>>> {
  return conLaEmpresa(async (contexto) => {
    const sucursal = await sucursalDelPedido(contexto);
    if (!sucursal.ok) return sucursal;
    // Control de la carrera entre pestañas: el `sucursalId` del cliente es la ficha que estaba mirando, NUNCA la fuente de verdad. Si no
    // es la sucursal con la que trabaja hoy el servidor (o no vino), no se edita nada y se dice como versión desactualizada: la pantalla
    // ya lo trata como conflicto y recarga la ficha. Previene: guardar sobre la sucursal nueva lo que se escribió para la vieja.
    if (!coincideConLaMostrada(entrada, sucursal.dato.efectiva)) {
      return { ok: false, error: errorDeCodigo("FISCAL_VERSION_DESACTUALIZADA") };
    }
    return editarContactoDeSucursal(dependencias, contexto, {
      ...soloLoPermitido(entrada),
      sucursalId: sucursal.dato.elegida,
    });
  });
}

export type { ContactoDeSucursalParaLaPantalla };
