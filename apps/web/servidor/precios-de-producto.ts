import "server-only";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  cambiarElPrecioDeUnProducto,
  verLosPreciosDeUnProducto,
  type DependenciasDePreciosDeProductoWeb,
  type PreciosParaLaPantalla,
} from "../../../src/composicion/precios-de-producto-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { rutaDeLosPrecios } from "../ui/plantillas/catalogo/modelo-de-precios-de-producto";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";

/**
 * Los precios de un producto (A1, T3): la lectura y la acción de cambiar el precio de la empresa. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa (`conLaEmpresa`:
 * sesión, origen propio y empresa elegida, nunca los que diga el navegador) y llaman a `src/composicion/precios-de-producto-web.ts`, donde se prueba el resto. El permiso
 * (`productos.ver` / `productos.cambiar_precio`) y la validez del precio los decide el servidor, dentro de la transacción: la pantalla no valida nada. Del formulario solo se toma
 * el precio; el producto, la clave del cambio (idempotencia) y la fila que se vio como vigente (control de versión) no viajan en el formulario: los fija la página al armar la
 * acción (`bind`). Si otra persona cambió el precio antes, se vuelve a pedir la página (`revalidatePath`) para que el reintento lleve lo vigente ahora.
 */

const dependencias: DependenciasDePreciosDeProductoWeb = {
  casosDeUso: web.casosDeUsoDeCatalogo,
  consultas: web.consultasDeCatalogo,
  respuesta: dependenciasDeSesion.respuesta,
  nuevoId: randomUUID,
};

/** Los precios de un producto de la empresa, con el contexto que ya resolvió la página. */
export function cargarLosPrecios(
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<PreciosParaLaPantalla>> {
  return verLosPreciosDeUnProducto(dependencias, contexto, productoId);
}

/** Cambia el precio; si sale bien, vuelve a la pantalla de precios (con lo nuevo); si no, devuelve el error ya traducido. */
export async function cambiarElPrecio(
  productoId: string,
  precioId: string,
  precioIdEsperado: string | null,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    cambiarElPrecioDeUnProducto(dependencias, contexto, {
      productoId,
      precioId,
      precioIdEsperado,
      precio: textoDe(datos, "precio"),
    }),
  );
  if (!respuesta.ok) {
    if (respuesta.error.codigo === "CATALOGO_PRECIO_DESACTUALIZADO") {
      revalidatePath(rutaDeLosPrecios(productoId));
    }
    return { error: respuesta.error };
  }
  redirect(rutaDeLosPrecios(respuesta.dato.productoId));
}
