import "server-only";
import { redirect } from "next/navigation";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  crearElProducto,
  verLasOpcionesDelAlta,
  type DependenciasDeAltaDeProductoWeb,
  type OpcionesDelAlta,
} from "../../../src/composicion/alta-de-producto-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { rutaDeLaFicha } from "../ui/plantillas/catalogo/modelo-de-ficha-de-producto";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";

/**
 * El alta de un producto (A1, T6): la lectura de lo que se ofrece, la clave de creación y la acción de crear. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa
 * (`conLaEmpresa`: sesión, origen propio y empresa elegida, nunca los que diga el navegador) y llaman a `src/composicion/alta-de-producto-web.ts`, donde se prueba el resto. El permiso
 * (`productos.crear`) y la validez de cada dato los decide el servidor, dentro de la transacción: la pantalla no valida nada. Del formulario solo se toman los campos que la acción
 * declara; la clave de creación no viaja en el formulario: la fija la página al armar la acción (`bind`). Cómo se repite sin duplicar: la clave de creación es el `id` del producto, así
 * que el doble toque y el reintento con la misma clave son una sola alta.
 */

const dependencias: DependenciasDeAltaDeProductoWeb = {
  casosDeUso: web.casosDeUsoDeCatalogo,
  consultas: web.consultasDeCatalogo,
  respuesta: dependenciasDeSesion.respuesta,
};

/**
 * La clave de creación de UN intento de alta: la fija la página al abrirse. Recargar la página es otro intento (otra clave); reenviar el mismo formulario es el mismo. Previene:
 * que un doble toque o un reintento por red cortada creen dos productos. Chequeo: `test/web/alta-de-producto-pagina.test.ts` (la acción llega ligada a una clave nueva por apertura).
 */
export const nuevaClaveDeAlta = (): string => crypto.randomUUID();

/** Lo que se ofrece al crear un producto, con el contexto que ya resolvió la página. */
export function cargarLasOpcionesDelAlta(
  contexto: ContextoOperativo,
): Promise<Respuesta<OpcionesDelAlta>> {
  return verLasOpcionesDelAlta(dependencias, contexto);
}

/** Crea el producto; si sale bien, va a su ficha; si no, devuelve el error ya traducido. */
export async function darDeAltaElProducto(
  claveDeCreacion: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    crearElProducto(dependencias, contexto, {
      claveDeCreacion,
      claseDeUso: textoDe(datos, "claseDeUso"),
      unidadBaseId: textoDe(datos, "unidadBaseId"),
      nombre: textoDe(datos, "nombre"),
      nombreDeCocina: textoDe(datos, "nombreDeCocina"),
      codigo: textoDe(datos, "codigo"),
      codigoDeBarras: textoDe(datos, "codigoDeBarras"),
      alicuota: textoDe(datos, "alicuota"),
      seccionDeCartaId: textoDe(datos, "seccionDeCartaId"),
    }),
  );
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(rutaDeLaFicha(respuesta.dato.productoId));
}
