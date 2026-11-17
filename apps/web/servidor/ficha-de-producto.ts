import "server-only";
import { redirect } from "next/navigation";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  guardarLaFichaDeProducto,
  verLaFichaDeProducto,
  type DependenciasDeFichaDeProductoWeb,
  type FichaParaLaPantalla,
} from "../../../src/composicion/ficha-de-producto-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { rutaDeLaFicha } from "../ui/plantillas/catalogo/modelo-de-ficha-de-producto";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";

/**
 * La ficha de datos de un producto (A1, T2a): la lectura y la acción de guardar. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa (`conLaEmpresa`: sesión,
 * origen propio y empresa elegida, nunca los que diga el navegador) y llaman a `src/composicion/ficha-de-producto-web.ts`, donde se prueba el resto. El permiso (`productos.ver` /
 * `productos.editar`) y la validez de cada dato los decide el servidor, dentro de la transacción: la pantalla no valida nada. Del formulario solo se toman los campos que la
 * acción declara; el id y la versión no viajan en el formulario: los fija la página al armar la acción (`bind`). Cómo se repite sin duplicar: guardar lo ya guardado no escribe;
 * con una versión vieja el servidor rechaza.
 */

const dependencias: DependenciasDeFichaDeProductoWeb = {
  casosDeUso: web.casosDeUsoDeCatalogo,
  consultas: web.consultasDeCatalogo,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Los datos de un producto de la empresa, con el contexto que ya resolvió la página. */
export function cargarLaFicha(
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<FichaParaLaPantalla>> {
  return verLaFichaDeProducto(dependencias, contexto, productoId);
}

/** El valor de un campo del formulario si vino como texto; si no vino (o no es texto), `undefined`: el servidor conserva lo guardado. */
const textoSiVino = (datos: FormData, nombre: string): string | undefined =>
  typeof datos.get(nombre) === "string" ? textoDe(datos, nombre) : undefined;

/** Guarda los datos del producto; si sale bien, vuelve a su ficha (con la versión nueva); si no, devuelve el error ya traducido. */
export async function guardarLaFicha(
  productoId: string,
  versionEsperada: number,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    guardarLaFichaDeProducto(dependencias, contexto, {
      productoId,
      versionEsperada,
      nombre: textoDe(datos, "nombre"),
      nombreDeCocina: textoSiVino(datos, "nombreDeCocina"),
      codigo: textoSiVino(datos, "codigo"),
      codigoDeBarras: textoSiVino(datos, "codigoDeBarras"),
      alicuota: textoSiVino(datos, "alicuota"),
      seccionDeCartaId: textoSiVino(datos, "seccionDeCartaId"),
    }),
  );
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(rutaDeLaFicha(respuesta.dato.productoId));
}
