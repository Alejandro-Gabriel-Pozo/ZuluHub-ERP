import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  cambiarLasCondiciones,
  clientesParaHabilitar,
  habilitarLaCuenta,
  reactivarLaCuenta,
  suspenderLaCuenta,
  type ClienteParaHabilitar,
  type DependenciasDeCuentaCorrienteEscrituraWeb,
} from "../../../src/composicion/cuenta-corriente-escritura-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { PLAZO_MAXIMO_EN_DIAS } from "../../../src/modulos/cuenta_corriente/publico";
import { rutaDeLaFichaDeCuenta } from "../ui/plantillas/cuenta-corriente/rutas-de-cuenta-corriente";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { aLaLista, textoDe } from "./formularios-de-caja";
import { puedeLaAccion } from "./permisos-de-la-persona";
import { dependenciasDeSesion } from "./sesion";

/**
 * Las escrituras de la cuenta corriente de clientes (CC-5, A2): habilitar, cambiar plazo y límite, suspender y reactivar. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN actúa (la empresa y la persona
 * salen de la SESIÓN, nunca del formulario) y llaman a `src/composicion/cuenta-corriente-escritura-web.ts`, donde se prueba todo lo demás. El permiso (`cuenta_corriente.administrar`), el aislamiento por
 * empresa, la versión que se vio, la repetición segura y la constancia los decide el servidor dentro de su transacción: la pantalla no replica ninguna regla. Repetir: el `id` del alta lo genera la
 * página al abrir el formulario y viaja ligado a la acción (`bind`); la ficha y su versión también se ligan por la página, no van en un campo. Si sale bien vuelve a la ficha del cliente.
 */

const dependencias: DependenciasDeCuentaCorrienteEscrituraWeb = {
  casosDeUso: web.casosDeUsoDeCuentaCorriente,
  consultas: web.consultasDeCuentaCorriente,
  respuesta: dependenciasDeSesion.respuesta,
};

export type { ClienteParaHabilitar };

/** El plazo máximo en días: de donde el formulario saca cuántos dígitos deja escribir (una regla, un lugar: la del dominio). */
export const PLAZO_MAXIMO_PARA_LA_PANTALLA: number = PLAZO_MAXIMO_EN_DIAS;

/** Los clientes que se pueden habilitar (también sin CUIT: el formulario avisa). Sin `administrar`, el genérico. */
export function cargarLosClientesParaHabilitar(
  contexto: ContextoOperativo,
): Promise<Respuesta<Readonly<{ clientes: readonly ClienteParaHabilitar[] }>>> {
  return clientesParaHabilitar(dependencias, contexto);
}

/** ¿Se ofrecen hoy los botones que escriben? Solo ayuda que apaga el botón: cada acción vuelve a pasar por el guard. Sin permisos legibles, `false`. */
export const puedeAdministrarCuentas = (contexto: ContextoOperativo): Promise<boolean> =>
  puedeLaAccion(contexto, "cuenta_corriente.administrar");

/** Habilita al cliente elegido; si sale bien vuelve a SU ficha (el id del cliente lo validó el servidor), si no devuelve el error ya traducido. */
export async function habilitarLaCuentaDelCliente(
  id: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const parteId = textoDe(datos, "parteId");
  return aLaLista(
    await conLaEmpresa((contexto) =>
      habilitarLaCuenta(dependencias, contexto, {
        id,
        parteId,
        plazoDias: textoDe(datos, "plazoDias"),
        limite: textoDe(datos, "limite"),
      }),
    ),
    rutaDeLaFichaDeCuenta(parteId),
  );
}

export async function cambiarLasCondicionesDeLaCuentaDelCliente(
  parteId: string,
  cuentaId: string,
  versionEsperada: number,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      cambiarLasCondiciones(dependencias, contexto, {
        cuentaId,
        versionEsperada,
        plazoDias: textoDe(datos, "plazoDias"),
        limite: textoDe(datos, "limite"),
      }),
    ),
    rutaDeLaFichaDeCuenta(parteId),
  );
}

export async function suspenderLaCuentaDelCliente(
  parteId: string,
  cuentaId: string,
  versionEsperada: number,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      suspenderLaCuenta(dependencias, contexto, {
        cuentaId,
        versionEsperada,
        motivo: textoDe(datos, "motivo"),
      }),
    ),
    rutaDeLaFichaDeCuenta(parteId),
  );
}

export async function reactivarLaCuentaDelCliente(
  parteId: string,
  cuentaId: string,
  versionEsperada: number,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      reactivarLaCuenta(dependencias, contexto, {
        cuentaId,
        versionEsperada,
        motivo: textoDe(datos, "motivo"),
      }),
    ),
    rutaDeLaFichaDeCuenta(parteId),
  );
}
