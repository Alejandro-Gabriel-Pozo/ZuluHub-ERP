import "server-only";
import { revalidatePath } from "next/cache";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  ocultarOMostrarUnProducto,
  verLaVisibilidadDelProducto,
  verLosProductosOcultos,
  volverAMostrarProductos,
  type DependenciasDeOcultarWeb,
  type ProductoOcultoParaLaPantalla,
  type VisibilidadParaLaPantalla,
} from "../../../src/composicion/ocultar-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { rutaDeLaFicha } from "../ui/plantillas/catalogo/modelo-de-ficha-de-producto";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * Ocultar un producto (A15): la lectura de dónde está oculto y las acciones de ocultar o volver a mostrar, en el local y en toda la empresa. Finas a propósito (ADR-015, punto 2): resuelven
 * QUIÉN y DÓNDE actúa (`conLaEmpresa`) y llaman a `src/composicion/ocultar-web.ts`, donde se prueba el resto. El local lo fija el SERVIDOR: es la sucursal con la que la sesión trabaja
 * (`sucursalDelPedido`), nunca la que diga el navegador; sin ninguna, «Ocultar en este local» cierra (nunca se asume «todas»). El permiso y las condiciones (existencia, conteo abierto) las
 * decide el servidor dentro de la transacción: la pantalla no replica ninguna regla. El producto y el estado que se quiere los fija la página al armar la acción (`bind`); repetirla no duplica
 * ni deshace (fija un estado, no alterna).
 */

const dependencias: DependenciasDeOcultarWeb = {
  casosDeUso: web.casosDeUsoDeCatalogo,
  consultas: web.consultasDeCatalogo,
  respuesta: dependenciasDeSesion.respuesta,
};

/** El local con el que trabaja la persona, o `null` si no hay ninguno (nunca se asume «todas»). */
async function elLocal(contexto: ContextoOperativo): Promise<string | null> {
  const sucursal = await sucursalDelPedido(contexto);
  if (!sucursal.ok || sucursal.dato.efectiva === "") return null;
  return sucursal.dato.efectiva;
}

/** Dónde está oculto el producto, para la tarjeta de la ficha. Si no se puede leer (módulo sin activar, sin permiso), la tarjeta no se ofrece. */
export async function cargarLaVisibilidad(
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<VisibilidadParaLaPantalla>> {
  return verLaVisibilidadDelProducto(dependencias, contexto, productoId, await elLocal(contexto));
}

/** Oculta (`oculto`) o vuelve a mostrar el producto en `alcance`; si sale bien, se vuelve a pedir la ficha; si no, devuelve el error ya traducido. */
export async function ocultarOMostrar(
  productoId: string,
  alcance: "LOCAL" | "EMPRESA",
  oculto: boolean,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa(async (contexto) => {
    // El local solo lo usa el alcance LOCAL: la composición lo ignora para toda la empresa.
    const local = await elLocal(contexto);
    return ocultarOMostrarUnProducto(dependencias, contexto, local, {
      productoId,
      alcance,
      oculto,
    });
  });
  if (!respuesta.ok) return { error: respuesta.error };
  revalidatePath(rutaDeLaFicha(respuesta.dato.productoId));
  return { error: null };
}

/**
 * Los productos ocultos en el local con el que se trabaja y en toda la empresa (C2: la lista de ocultos y la marca de la lista de productos). Si no se puede leer (módulo `vidriera` sin
 * activar, sin `vidrieras.ver`, falla), no se ofrece nada (fail closed): la lista de productos sigue sin marcas.
 */
export async function cargarLosOcultos(
  contexto: ContextoOperativo,
): Promise<Respuesta<readonly ProductoOcultoParaLaPantalla[]>> {
  return verLosProductosOcultos(dependencias, contexto, await elLocal(contexto));
}

/**
 * Vuelve a mostrar uno o varios productos (C2). El servidor lee dónde está oculto cada uno y actúa en el local con el que trabaja la sesión y en toda la empresa, con el permiso de cada
 * alcance; repetirlo no duplica nada. Si sale bien (o a medias), se vuelve a pedir la lista de productos.
 */
export async function volverAMostrar(productoIds: readonly string[]): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa(async (contexto) =>
    volverAMostrarProductos(dependencias, contexto, await elLocal(contexto), { productoIds }),
  );
  revalidatePath("/catalogo/productos");
  for (const id of productoIds) revalidatePath(rutaDeLaFicha(id));
  return respuesta.ok ? { error: null } : { error: respuesta.error };
}
