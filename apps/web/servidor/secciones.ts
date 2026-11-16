import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  cambiarElEstadoDeLaSeccion,
  crearLaSeccion,
  moverUnaSeccion,
  renombrarLaSeccion,
  verLaSeccion,
  verLasSecciones,
  verUnaSeccion,
  type DependenciasDeSeccionesWeb,
  type SeccionesParaLaPantalla,
  type SeccionParaLaPantalla,
  type UnaSeccionParaLaPantalla,
} from "../../../src/composicion/secciones-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import {
  CAMPO_DE_BAJAR,
  CAMPO_DE_SUBIR,
  RUTA_DE_SECCIONES,
  rutaDeLaSeccion,
  type VistaDeSeccion,
} from "../ui/plantillas/catalogo/modelo-de-secciones";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";

/**
 * Las secciones de la carta (A8, parte 1): las lecturas y las acciones de crear, renombrar, mover, desactivar y reactivar. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa
 * (`conLaEmpresa`: sesión, origen propio y empresa elegida, nunca los que diga el navegador) y llaman a `src/composicion/secciones-web.ts`, donde se prueba el resto. El permiso (`productos.ver` /
 * `productos.editar`) y la validez de cada dato los decide el servidor, dentro de la transacción: la pantalla no valida nada. Del formulario solo se toman los campos que la acción declara; la
 * clave de creación, la sección, su versión y lo que la persona vio de la lista no viajan en el formulario: los fija la página al armar la acción (`bind`).
 *
 * Cómo se repite sin duplicar: crear lleva la clave de creación (el `id` de la sección), así el doble toque y el reintento son una sola alta; renombrar y mover lo ya aplicado no escriben;
 * desactivar y reactivar lo ya hecho devuelven «ya estaba». Con una versión vieja el servidor rechaza. Tras CUALQUIER resultado de una acción que se queda en la pantalla (mover, desactivar,
 * reactivar) se vuelve a pedir la página (`revalidatePath`): lo que sigue lleva las versiones vigentes y, si hubo un conflicto, se ve lo que cambió.
 */

const dependencias: DependenciasDeSeccionesWeb = {
  casosDeUso: web.casosDeUsoDeCatalogo,
  consultas: web.consultasDeCatalogo,
  respuesta: dependenciasDeSesion.respuesta,
};

/**
 * La clave de creación de UN intento de alta de una sección: la fija la página al abrirse. Recargar la página es otro intento (otra clave); reenviar el mismo formulario es el mismo. Previene:
 * que un doble toque o un reintento por red cortada creen dos secciones. Chequeo: `test/web/secciones-pagina.test.ts` (la acción llega ligada a una clave nueva por apertura).
 */
export const nuevaClaveDeSeccion = (): string => crypto.randomUUID();

/** Todas las secciones de la empresa, con el contexto que ya resolvió la página. */
export function cargarLasSecciones(
  contexto: ContextoOperativo,
): Promise<Respuesta<SeccionesParaLaPantalla>> {
  return verLasSecciones(dependencias, contexto);
}

/** Una sección de la empresa con una página de sus productos activos (`despues` es la clave de la dirección; `""` es la primera). */
export function cargarUnaSeccion(
  contexto: ContextoOperativo,
  seccionId: string,
  despues: string,
): Promise<Respuesta<UnaSeccionParaLaPantalla>> {
  return verUnaSeccion(dependencias, contexto, { seccionId, despues });
}

/** Una sección de la empresa sola (para renombrarla), con el contexto que ya resolvió la página. */
export function cargarLaSeccion(
  contexto: ContextoOperativo,
  seccionId: string,
): Promise<Respuesta<SeccionParaLaPantalla>> {
  return verLaSeccion(dependencias, contexto, seccionId);
}

/** Crea la sección; si sale bien, vuelve a la lista; si no, devuelve el error ya traducido. */
export async function darDeAltaLaSeccion(
  claveDeCreacion: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    crearLaSeccion(dependencias, contexto, { claveDeCreacion, nombre: textoDe(datos, "nombre") }),
  );
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(RUTA_DE_SECCIONES);
}

/** Renombra la sección con la versión que se vio; si sale bien, vuelve a la lista; si no, devuelve el error ya traducido. */
export async function guardarElNombreDeLaSeccion(
  seccionId: string,
  versionEsperada: number,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    renombrarLaSeccion(dependencias, contexto, {
      seccionId,
      versionEsperada,
      nombre: textoDe(datos, "nombre"),
    }),
  );
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(RUTA_DE_SECCIONES);
}

/** Lo que una acción que se queda en la pantalla devuelve: siempre vuelve a pedir la página, con éxito o sin él. */
function seQuedaEnLaPantalla<D>(respuesta: Respuesta<D>, ruta: string): ResultadoDeAccion {
  revalidatePath(ruta);
  return respuesta.ok ? { error: null } : { error: respuesta.error };
}

/** El toque de una flecha: la sección tocada (el valor de `subir` o `bajar`) sobre las activas que la persona vio. Un formulario sin ninguna de las dos no mueve nada. */
export async function moverLaSeccion(
  vistas: readonly VistaDeSeccion[],
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const sube = textoDe(datos, CAMPO_DE_SUBIR);
  const seccionId = sube === "" ? textoDe(datos, CAMPO_DE_BAJAR) : sube;
  const respuesta = await conLaEmpresa((contexto) =>
    moverUnaSeccion(dependencias, contexto, {
      vistas,
      seccionId,
      sentido: sube === "" ? "ABAJO" : "ARRIBA",
    }),
  );
  return seQuedaEnLaPantalla(respuesta, RUTA_DE_SECCIONES);
}

/** Desactiva (`activa: false`) o reactiva (`activa: true`) la sección. No toca los productos. */
export async function cambiarElEstadoDeLaSeccionDeCarta(
  seccionId: string,
  activa: boolean,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    cambiarElEstadoDeLaSeccion(dependencias, contexto, { seccionId }, activa),
  );
  return seQuedaEnLaPantalla(respuesta, rutaDeLaSeccion(seccionId));
}
