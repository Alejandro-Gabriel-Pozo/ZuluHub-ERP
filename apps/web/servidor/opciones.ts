import "server-only";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  copiarLasOpcionesDeOtroProducto,
  guardarUnGrupoDeOpciones,
  verLasOpcionesDeUnProducto,
  verLasOpcionesParaCopiar,
  verUnGrupoDeOpciones,
  type DependenciasDeOpcionesWeb,
  type GrupoParaEditar,
  type OpcionesParaCopiar,
  type OpcionesParaLaPantalla,
} from "../../../src/composicion/opciones-web";
import { leerLasFilasDeOpciones } from "../../../src/composicion/entradas-de-opciones";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { rutaDeLasOpciones } from "../ui/plantillas/catalogo/modelo-de-opciones";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";

/**
 * Las opciones de un producto (A13, tramo Opciones): las lecturas y las acciones de guardar un grupo y de copiar las de otro producto. Finas a propósito (ADR-015, punto 2): resuelven
 * QUIÉN y DÓNDE actúa (`conLaEmpresa`: sesión, origen propio y empresa elegida, nunca los que diga el navegador) y llaman a `src/composicion/opciones-web.ts`, donde se prueba el
 * resto. El permiso (`productos.ver` / `opciones.editar`) y la validez de cada dato los decide el servidor, dentro de la transacción: la pantalla no valida nada. Del formulario solo
 * se toman los campos que la acción declara; el producto, la versión de las opciones, el grupo, la clave del cambio (idempotencia) y los ids de las opciones que se vieron no viajan en
 * el formulario: los fija la página al armar la acción (`bind`). Si algo sale mal se vuelve a pedir la pantalla (`revalidatePath`): con la versión vieja, la persona ve lo que cambió.
 */

const dependencias: DependenciasDeOpcionesWeb = {
  casosDeUso: web.casosDeUsoDeCatalogo,
  consultas: web.consultasDeCatalogo,
  respuesta: dependenciasDeSesion.respuesta,
  nuevoId: randomUUID,
};

/** Las opciones de un producto de la empresa, con el contexto que ya resolvió la página. */
export function cargarLasOpciones(
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<OpcionesParaLaPantalla>> {
  return verLasOpcionesDeUnProducto(dependencias, contexto, productoId);
}

/** Un grupo para editarlo (o la hoja de uno nuevo si `grupoId` es nulo). */
export function cargarUnGrupo(
  contexto: ContextoOperativo,
  productoId: string,
  grupoId: string | null,
): Promise<Respuesta<GrupoParaEditar>> {
  return verUnGrupoDeOpciones(dependencias, contexto, productoId, grupoId);
}

/** De dónde se pueden copiar las opciones al producto. */
export function cargarLaCopia(
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<OpcionesParaCopiar>> {
  return verLasOpcionesParaCopiar(dependencias, contexto, productoId);
}

/** Lo que la página liga a la acción de guardar un grupo (cifrado por Next: no viaja en un campo). */
export type LigadoDeUnGrupo = Readonly<{
  productoId: string;
  versionDeOpciones: number;
  grupoId: string | null;
  claveDelCambio: string;
  /** Los ids de las opciones que se vieron, en el orden de las filas `e0`, `e1`… */
  idsDeOpciones: readonly string[];
}>;

/** Una casilla marcada manda `"on"`; desmarcada no manda nada. */
const marcada = (datos: FormData, nombre: string): boolean => datos.get(nombre) === "on";

/** Guarda un grupo; si sale bien, vuelve a la lista de opciones (con lo nuevo); si no, devuelve el error ya traducido y pide la pantalla de nuevo. */
export async function guardarElGrupo(
  ligado: LigadoDeUnGrupo,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    guardarUnGrupoDeOpciones(dependencias, contexto, {
      productoId: ligado.productoId,
      versionDeOpciones: ligado.versionDeOpciones,
      claveDelCambio: ligado.claveDelCambio,
      grupoId: ligado.grupoId,
      nombre: textoDe(datos, "nombre"),
      esAdicional: marcada(datos, "esAdicional"),
      esObligatorio: marcada(datos, "esObligatorio"),
      admiteVarias: marcada(datos, "admiteVarias"),
      seMuestraEnCarta: !marcada(datos, "fueraDeLaCarta"),
      opciones: leerLasFilasDeOpciones(datos.entries(), ligado.idsDeOpciones),
    }),
  );
  if (!respuesta.ok) {
    revalidatePath(rutaDeLasOpciones(ligado.productoId));
    return { error: respuesta.error };
  }
  // También al salir bien: sin esto la pantalla de destino puede salir de la memoria del navegador (la que se visitó antes de guardar) con lo viejo.
  revalidatePath(rutaDeLasOpciones(respuesta.dato.productoId));
  redirect(rutaDeLasOpciones(respuesta.dato.productoId));
}

/** Copia las opciones de otro producto; si sale bien, vuelve a la lista de opciones; si no, devuelve el error ya traducido y pide la pantalla de nuevo. */
export async function copiarLasOpciones(
  productoDestinoId: string,
  versionDeOpciones: number,
  claveDeLaCopia: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    copiarLasOpcionesDeOtroProducto(dependencias, contexto, {
      productoDestinoId,
      productoOrigenId: textoDe(datos, "productoOrigenId"),
      versionDeOpciones,
      claveDelCambio: claveDeLaCopia,
    }),
  );
  if (!respuesta.ok) {
    revalidatePath(rutaDeLasOpciones(productoDestinoId));
    return { error: respuesta.error };
  }
  revalidatePath(rutaDeLasOpciones(respuesta.dato.productoId));
  redirect(rutaDeLasOpciones(respuesta.dato.productoId));
}
