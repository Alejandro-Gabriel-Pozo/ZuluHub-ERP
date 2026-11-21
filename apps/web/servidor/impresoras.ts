import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import type { ImpresoraParaLaPantalla } from "../../../src/composicion/impresion-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { RUTA_DE_IMPRESORAS } from "../ui/plantillas/salon/modelo-de-impresoras";
import type { ResultadoDeAccion } from "./acciones";
import {
  cargarLasImpresoras,
  darDeAltaLaImpresora,
  desactivarLaImpresoraDelSalon,
  guardarLaImpresora,
} from "./comandas";
import { textoDe } from "./formularios-de-caja";

/**
 * Las impresoras del salón para la pantalla «Impresoras» (S-2; maqueta `imprimir.html`): una lectura y las acciones de agregar, editar y quitar (desactivar) de un formulario. Finas a propósito (ADR-015, punto 2): del
 * formulario solo toman los campos que la acción declara y llaman a `servidor/comandas.ts`, que resuelve QUIÉN y DÓNDE actúa (la sucursal la fija el servidor, nunca el navegador; sin sucursal no se asume «todas») y a
 * `src/composicion/impresion-web.ts`, donde se prueba el resto. El permiso (`impresoras.*`) y la validez de cada dato los decide el servidor dentro de la transacción: la pantalla no valida nada. Todo rechazo sale con el genérico.
 * Cómo se repite sin duplicar: el alta lleva el id de la impresora, que la página fija UNA vez al abrirse y liga a la acción (`bind`): el doble toque, el reintento y las dos pestañas con el mismo formulario son una sola
 * impresora; recargar la página es otro intento. «Quitar» desactiva, nunca borra, y repetirlo es éxito sin escribir.
 * Chequeo: `test/web/servidor-impresoras.test.ts`.
 */

/** Una impresora de la sucursal de trabajo (para editarla); una que no está ahí (ajena, inexistente, mal escrita) es el genérico, sin decir cuál de los casos es. */
export async function cargarLaImpresora(
  contexto: ContextoOperativo,
  impresoraId: string,
): Promise<Respuesta<ImpresoraParaLaPantalla>> {
  const respuesta = await cargarLasImpresoras(contexto);
  if (!respuesta.ok) return respuesta;
  const hallada = respuesta.dato.impresoras.find((i) => i.id === impresoraId && i.activa);
  return hallada === undefined
    ? { ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") }
    : { ok: true, dato: hallada };
}

const DATOS_DE_LA_IMPRESORA = ["nombre", "uso", "papelMm"] as const;
const delFormulario = (datos: FormData) =>
  Object.fromEntries(DATOS_DE_LA_IMPRESORA.map((campo) => [campo, textoDe(datos, campo)]));

/** Agrega la impresora; si sale bien, vuelve a la lista; si no, devuelve el error ya traducido. */
export async function agregarLaImpresora(
  impresoraId: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await darDeAltaLaImpresora({ impresoraId, ...delFormulario(datos) });
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(RUTA_DE_IMPRESORAS);
}

/** Guarda la impresora con la versión que se vio; si sale bien, vuelve a la lista; si no, devuelve el error ya traducido. */
export async function cambiarLaImpresora(
  impresoraId: string,
  versionEsperada: number,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await guardarLaImpresora({
    impresoraId,
    versionEsperada,
    ...delFormulario(datos),
  });
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(RUTA_DE_IMPRESORAS);
}

/** «Quitar»: desactiva la impresora (nunca se borra). Con éxito o sin él vuelve a pedir la lista: lo que sigue lleva lo vigente. */
export async function quitarLaImpresora(impresoraId: string): Promise<ResultadoDeAccion> {
  const respuesta = await desactivarLaImpresoraDelSalon({ impresoraId });
  revalidatePath(RUTA_DE_IMPRESORAS);
  return respuesta.ok ? { error: null } : { error: respuesta.error };
}
