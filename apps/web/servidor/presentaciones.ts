import "server-only";
import { redirect } from "next/navigation";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  cambiarElEstadoDeLaPresentacion,
  crearLaPresentacion,
  renombrarLaPresentacion,
  verLaPresentacion,
  verLasPresentaciones,
  type DependenciasDePresentacionesWeb,
  type PresentacionesParaLaPantalla,
} from "../../../src/composicion/presentaciones-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { rutaDeLaCompraDelProducto } from "../ui/plantillas/catalogo/modelo-de-presentaciones";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";

/**
 * La solapa «Cómo se compra» de un producto (T0): las lecturas y las acciones de agregar, renombrar, desactivar y reactivar una presentación. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y
 * DÓNDE actúa (`conLaEmpresa`: sesión, origen propio y empresa elegida, nunca los que diga el navegador) y llaman a `src/composicion/presentaciones-web.ts`, donde se prueba el resto. El permiso
 * (`productos.ver` / `productos.editar`) y la validez de cada dato los decide el servidor, dentro de la transacción: la pantalla no valida nada. Del formulario solo se toman los campos que la
 * acción declara; el producto, la presentación y su versión no viajan en el formulario: los fija la página al armar la acción (`bind`).
 *
 * Cómo se repite sin duplicar: agregar lo mismo otra vez devuelve la presentación ya creada (el doble toque y el reintento son una sola alta); renombrar, desactivar y reactivar lo ya hecho no
 * escriben. Con una versión vieja el servidor rechaza. Si sale bien vuelve a la lista; si no, devuelve el error ya traducido.
 */
const dependencias: DependenciasDePresentacionesWeb = {
  casosDeUso: web.casosDeUsoDeCatalogo,
  consultas: web.consultasDeCatalogo,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Las presentaciones de un producto de la empresa, con el contexto que ya resolvió la página. */
export function cargarLasPresentaciones(
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<PresentacionesParaLaPantalla>> {
  return verLasPresentaciones(dependencias, contexto, productoId);
}

/** Una presentación de un producto de la empresa (para editarla), con el contexto que ya resolvió la página. */
export function cargarLaPresentacion(
  contexto: ContextoOperativo,
  productoId: string,
  presentacionId: string,
) {
  return verLaPresentacion(dependencias, contexto, productoId, presentacionId);
}

/** Agrega la presentación; si sale bien, vuelve a la lista; si no, devuelve el error ya traducido. */
export async function agregarLaPresentacion(
  productoId: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    crearLaPresentacion(dependencias, contexto, {
      productoId,
      nombre: textoDe(datos, "nombre"),
      cantidad: textoDe(datos, "cantidad"),
      pesoVariable: datos.get("pesoVariable") === "on",
    }),
  );
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(rutaDeLaCompraDelProducto(productoId));
}

/** Renombra la presentación con la versión que se vio; si sale bien, vuelve a la lista; si no, devuelve el error ya traducido. */
export async function guardarElNombreDeLaPresentacion(
  productoId: string,
  presentacionId: string,
  versionEsperada: number,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    renombrarLaPresentacion(dependencias, contexto, {
      productoId,
      presentacionId,
      versionEsperada,
      nombre: textoDe(datos, "nombre"),
    }),
  );
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(rutaDeLaCompraDelProducto(productoId));
}

/** Desactiva (`activa: false`) o reactiva (`activa: true`) la presentación con la versión que se vio; si sale bien, vuelve a la lista; si no, devuelve el error ya traducido. */
export async function cambiarElEstadoDeLaPresentacionDelProducto(
  productoId: string,
  presentacionId: string,
  versionEsperada: number,
  activa: boolean,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    cambiarElEstadoDeLaPresentacion(
      dependencias,
      contexto,
      { productoId, presentacionId, versionEsperada },
      activa,
    ),
  );
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(rutaDeLaCompraDelProducto(productoId));
}
