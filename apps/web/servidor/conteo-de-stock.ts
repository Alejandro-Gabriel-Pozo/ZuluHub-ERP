import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  abrirElConteo,
  aplicarElConteo,
  cancelarElConteo,
  cargarLoContado,
  lecturaDelConteo,
  revisionDelConteo,
  type DependenciasDeConteoWeb,
  type LecturaDelConteo,
  type RevisionDelConteo,
} from "../../../src/composicion/conteo-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { MAXIMO_DE_RENGLONES } from "../../../src/modulos/stock/publico";
import { hrefDeRevisar, hrefDelConteo } from "../ui/plantillas/stock/conteo/modelo-de-conteo";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { aLaLista, textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";
import { laSucursalDeStock } from "./stock";

/**
 * El conteo físico de la web: dos lecturas y las acciones (abrir, guardar lo contado de un artículo, cancelar y aplicar). Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúan (`laSucursalDeStock`: la
 * elegida en el dispositivo, nunca la del navegador) y llaman a `src/composicion/conteo-web.ts`. El conteo, la clave de cada registro y la huella de lo que se vio viajan ligados a la acción (`bind`) o como argumento
 * tipado, no como campos del formulario que la persona edite. El permiso, la cantidad, la hora y las reglas los decide el servidor dentro de su transacción.
 */

const dependencias: DependenciasDeConteoWeb = {
  casosDeUso: web.casosDeUsoDeStock,
  consultas: web.consultasDeStock,
  respuesta: dependenciasDeSesion.respuesta,
};

export async function cargarLaLecturaDelConteo(
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<LecturaDelConteo>> {
  const sucursal = await laSucursalDeStock(contexto);
  if (!sucursal.ok) return sucursal;
  return lecturaDelConteo(dependencias, contexto, sucursal.dato, crudo);
}

export function cargarLaRevisionDelConteo(
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<RevisionDelConteo>> {
  return revisionDelConteo(dependencias, contexto, crudo);
}

/** Abre el conteo del depósito (el id del conteo y el depósito los fija la página); si sale bien vuelve a Conteo con la grilla de carga. */
export async function abrirElConteoDeLaSucursal(
  id: string,
  depositoId: string,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa(async (contexto) => {
      const sucursal = await laSucursalDeStock(contexto);
      if (!sucursal.ok) return sucursal;
      return abrirElConteo(dependencias, contexto, sucursal.dato, { id, depositoId });
    }),
    hrefDelConteo(depositoId),
  );
}

/** Guarda lo contado de UN artículo del conteo abierto (se llama al salir del campo): devuelve el error ya traducido o `{ error: null }`, sin redirigir. */
export async function guardarLoContadoDeLaSucursal(
  conteoId: string,
  entrada: Readonly<{ id: string; articuloId: string; cantidad: string; hora: string }>,
): Promise<ResultadoDeAccion> {
  const r = await conLaEmpresa((contexto) =>
    cargarLoContado(dependencias, contexto, { conteoId, ...entrada }),
  );
  return r.ok ? { error: null } : { error: r.error };
}

/** Cancela el conteo con su motivo y vuelve a Conteo del mismo depósito. */
export async function cancelarElConteoDeLaSucursal(
  conteoId: string,
  depositoId: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      cancelarElConteo(dependencias, contexto, { conteoId, motivo: textoDe(datos, "motivo") }),
    ),
    hrefDelConteo(depositoId),
  );
}

/** Los motivos y detalles del formulario por artículo (`motivo.<articuloId>`, `detalle.<articuloId>`), con tope de un artículo MÁS que el máximo de renglones para que la composición lo rechace. */
function respuestasDe(datos: FormData): readonly Record<string, string>[] {
  const porArticulo = new Map<string, { motivo: string; detalle: string }>();
  for (const clave of datos.keys()) {
    const partes = /^(motivo|detalle)\.(.+)$/.exec(clave);
    if (partes === null) continue;
    const campo = partes[1] === "motivo" ? "motivo" : "detalle";
    const articuloId = partes[2] ?? "";
    const previo = porArticulo.get(articuloId);
    if (previo === undefined && porArticulo.size > MAXIMO_DE_RENGLONES) break;
    porArticulo.set(articuloId, {
      motivo: "",
      detalle: "",
      ...previo,
      [campo]: textoDe(datos, clave),
    });
  }
  return [...porArticulo].map(([articuloId, r]) => ({ articuloId, ...r }));
}

/** Aplica el conteo con la huella de lo que se vio (la fija la página); si sale bien muestra el resultado («Aplicado»). */
export async function aplicarElConteoDeLaSucursal(
  conteoId: string,
  huella: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      aplicarElConteo(dependencias, contexto, {
        conteoId,
        huella,
        respuestas: respuestasDe(datos),
      }),
    ),
    hrefDeRevisar(conteoId),
  );
}
