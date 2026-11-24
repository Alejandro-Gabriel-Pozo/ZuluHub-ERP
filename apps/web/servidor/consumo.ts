import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  guardarElConsumoDeUnGrupo,
  verElConsumoDeUnGrupo,
  type ConsumoParaLaPantalla,
  type DependenciasDeConsumoWeb,
} from "../../../src/composicion/consumo-web";
import { leerLasLineasDeConsumo } from "../../../src/composicion/entradas-de-consumo";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { rutaDeLasOpciones, rutaDelConsumo } from "../ui/plantillas/catalogo/modelo-de-opciones";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";

/**
 * Lo que consume cada opción de un grupo (A13, tramo Consumo): la lectura y la acción de guardar. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa (`conLaEmpresa`) y llaman a
 * `src/composicion/consumo-web.ts`, donde se prueba el resto. Del formulario solo se toman las líneas (`consumo_<opción>_<línea>_<campo>`); el producto, el grupo, la versión de las opciones y los ids
 * de las opciones que se vieron los liga la página (`bind`, cifrados): el navegador no puede nombrar otra opción. Si algo sale mal se vuelve a pedir la pantalla (`revalidatePath`).
 */

const dependencias: DependenciasDeConsumoWeb = {
  casosDeUso: web.casosDeUsoDeCatalogo,
  consultas: web.consultasDeCatalogo,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Lo que consume cada opción de un grupo, con el contexto que ya resolvió la página. */
export function cargarElConsumo(
  contexto: ContextoOperativo,
  productoId: string,
  grupoId: string,
): Promise<Respuesta<ConsumoParaLaPantalla>> {
  return verElConsumoDeUnGrupo(dependencias, contexto, productoId, grupoId);
}

/** Lo que la página liga a la acción de guardar el consumo. */
export type LigadoDelConsumo = Readonly<{
  productoId: string;
  versionDeOpciones: number;
  grupoId: string;
  /** Los ids de las opciones que se vieron, en el orden de sus tarjetas. */
  idsDeOpciones: readonly string[];
}>;

/** Guarda el consumo; si sale bien, vuelve a las opciones del producto; si no, devuelve el error ya traducido y pide la pantalla de nuevo. */
export async function guardarElConsumo(
  ligado: LigadoDelConsumo,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const lineas = leerLasLineasDeConsumo(datos.entries(), ligado.idsDeOpciones.length);
  const respuesta = await conLaEmpresa((contexto) =>
    guardarElConsumoDeUnGrupo(dependencias, contexto, {
      productoId: ligado.productoId,
      grupoId: ligado.grupoId,
      versionDeOpciones: ligado.versionDeOpciones,
      opciones: ligado.idsDeOpciones.map((opcionId, i) => ({ opcionId, lineas: lineas[i] ?? [] })),
    }),
  );
  revalidatePath(rutaDelConsumo(ligado.productoId, ligado.grupoId));
  if (!respuesta.ok) return { error: respuesta.error };
  revalidatePath(rutaDeLasOpciones(respuesta.dato.productoId));
  redirect(rutaDeLasOpciones(respuesta.dato.productoId));
}
