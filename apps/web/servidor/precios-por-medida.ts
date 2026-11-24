import "server-only";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { leerLosPreciosDelFormulario } from "../../../src/composicion/entradas-de-precios-por-medida";
import {
  cambiarLosPreciosPorMedida,
  verLosPreciosPorMedida,
  type DependenciasDePreciosPorMedidaWeb,
  type PreciosPorMedidaParaLaPantalla,
} from "../../../src/composicion/precios-por-medida-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { rutaDeLosPreciosPorMedida } from "../ui/plantillas/catalogo/modelo-de-precios-por-medida";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";

/**
 * Los precios por medida de un producto (A13, tramo Medidas): la lectura y la acción de cambiarlos. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa (`conLaEmpresa`) y
 * llaman a `src/composicion/precios-por-medida-web.ts`, donde se prueba el resto. Del formulario solo se toman los precios (`precio_<i>`); el producto, la clave del cambio y, por medida, la
 * medida y la fila vista los liga la página (`bind`, cifrados): el navegador no puede mandar otra medida. Si algo sale mal se vuelve a pedir la pantalla (`revalidatePath`).
 */

const dependencias: DependenciasDePreciosPorMedidaWeb = {
  casosDeUso: web.casosDeUsoDeCatalogo,
  consultas: web.consultasDeCatalogo,
  respuesta: dependenciasDeSesion.respuesta,
  nuevoId: randomUUID,
};

/** Los precios por medida de un producto de la empresa, con el contexto que ya resolvió la página. */
export function cargarLosPreciosPorMedida(
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<PreciosPorMedidaParaLaPantalla>> {
  return verLosPreciosPorMedida(dependencias, contexto, productoId);
}

/** Lo que la página liga a la acción: el producto, la clave del cambio y, por medida, su id y la fila que se vio como vigente. */
export type LigadoDePreciosPorMedida = Readonly<{
  productoId: string;
  claveDelCambio: string;
  medidas: readonly Readonly<{ opcionId: string; precioIdEsperado: string | null }>[];
}>;

/** Cambia los precios; si sale bien, vuelve a los precios (con lo nuevo); si no, devuelve el error ya traducido y pide la pantalla de nuevo. */
export async function cambiarLosPreciosDeLasMedidas(
  ligado: LigadoDePreciosPorMedida,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const precios = leerLosPreciosDelFormulario(datos.entries(), ligado.medidas.length);
  const respuesta = await conLaEmpresa((contexto) =>
    cambiarLosPreciosPorMedida(dependencias, contexto, {
      productoId: ligado.productoId,
      claveDelCambio: ligado.claveDelCambio,
      filas: ligado.medidas.map((m, i) => ({
        opcionId: m.opcionId,
        precioIdEsperado: m.precioIdEsperado,
        precio: precios[i] ?? "",
      })),
    }),
  );
  const ruta = rutaDeLosPreciosPorMedida(ligado.productoId);
  revalidatePath(ruta);
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(ruta);
}
