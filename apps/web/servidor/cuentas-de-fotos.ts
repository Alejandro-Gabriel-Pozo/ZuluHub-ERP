import "server-only";
import { revalidatePath } from "next/cache";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  declararLaCuentaDeFotos,
  retirarLaCuentaDeFotos,
  verLasCuentasDeFotos,
  type CuentaDeFotosParaLaPantalla,
  type DependenciasDeCuentasDeFotosWeb,
} from "../../../src/composicion/cuentas-de-fotos-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { RUTA_DE_LAS_CUENTAS_DE_FOTOS } from "../ui/plantillas/carta/modelo-de-cuentas-de-fotos";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";
import { textoDe } from "./formularios-de-caja";

/**
 * «Conectá tu cuenta de fotos»: la lectura y las acciones de declarar y retirar una cuenta de imagen. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN actúa (`conLaEmpresa`: sesión, origen propio y
 * empresa elegida) y llaman a `src/composicion/cuentas-de-fotos-web.ts`, donde se prueba el resto. El permiso (`vidrieras.administrar_cuentas_de_imagen`) y la validez de cada dato los decide el servidor,
 * dentro de la transacción: acá no se decide ni se valida nada. La empresa, la persona y el proveedor no viajan: los pone el servidor.
 *
 * Cómo se repite sin duplicar: declarar lleva la clave del gesto (la fija la página: la misma clave dos veces es una sola cuenta); retirar lleva la cuenta y la versión que se vio (retirar dos veces es lo
 * mismo que una; con una versión vieja el servidor rechaza sin escribir). Tras CUALQUIER resultado se vuelve a pedir la página (`revalidatePath`). Chequeo: `test/web/acciones-de-cuentas-de-fotos.test.ts`.
 */

const dependencias: DependenciasDeCuentasDeFotosWeb = {
  casosDeUso: web.casosDeUsoDeCatalogo,
  consultas: web.consultasDeCatalogo,
  respuesta: dependenciasDeSesion.respuesta,
};

/**
 * La clave de UN gesto de declarar: la fija la página al abrirse. Recargar es otro gesto (otra clave); reenviar el mismo formulario es el mismo. Previene: que un doble toque o un reintento por red
 * cortada declaren dos cuentas. Chequeo: `test/web/cuentas-de-fotos-pagina.test.ts`.
 */
export const nuevaClaveDeCuentaDeFotos = (): string => crypto.randomUUID();

/** Las cuentas activas de la empresa, con el contexto que ya resolvió la página. */
export function cargarLasCuentasDeFotos(
  contexto: ContextoOperativo,
): Promise<Respuesta<readonly CuentaDeFotosParaLaPantalla[]>> {
  return verLasCuentasDeFotos(dependencias, contexto);
}

/** Lo que una acción devuelve: siempre vuelve a pedir la página, con éxito o sin él. */
function seQuedaEnLaPantalla<D>(respuesta: Respuesta<D>): ResultadoDeAccion {
  revalidatePath(RUTA_DE_LAS_CUENTAS_DE_FOTOS);
  return respuesta.ok ? { error: null } : { error: respuesta.error };
}

/** Declara la cuenta que escribió la persona, con la clave del gesto que ligó la página. */
export async function declararLaCuenta(
  ligado: Readonly<{ claveDeIdempotencia: string }>,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    declararLaCuentaDeFotos(dependencias, contexto, {
      ...ligado,
      cuenta: textoDe(datos, "cuenta"),
    }),
  );
  return seQuedaEnLaPantalla(respuesta);
}

/** Retira la cuenta que la página ligó (su id y la versión que se vio) con el motivo que escribió la persona. */
export async function retirarLaCuenta(
  ligado: Readonly<{ id: string; versionEsperada: number }>,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    retirarLaCuentaDeFotos(dependencias, contexto, {
      ...ligado,
      motivo: textoDe(datos, "motivo"),
    }),
  );
  return seQuedaEnLaPantalla(respuesta);
}
