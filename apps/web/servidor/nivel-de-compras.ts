import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  guardarElNivelDeCompras,
  leerElNivelDeCompras,
  type DependenciasDeNivelDeComprasWeb,
  type NivelDeComprasParaLaPantalla,
} from "../../../src/composicion/nivel-de-compras-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import type { ResultadoDeGuardarElNivel } from "../ui/plantillas/compras/nivel/resultado-de-nivel";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";

/**
 * «Nivel de compras» (Compras PR 11): la lectura para la página y el guardado para la acción. Finas a propósito (ADR-015, punto 2): la empresa y quién actúa salen de la SESIÓN, nunca del
 * formulario ni de la dirección, y todo lo demás (el permiso `compras.configurar`, la versión, el plan) lo decide el servidor dentro de su transacción en `src/composicion/nivel-de-compras-web.ts`.
 * Leer NO escribe. Guardar no redirige (un `redirect` dentro de una acción pierde el host): devuelve el resultado y la pantalla lo muestra.
 */

const dependencias: DependenciasDeNivelDeComprasWeb = {
  casosDeUso: web.casosDeUsoDeCompras,
  consultas: web.consultasDeCompras,
  respuesta: dependenciasDeSesion.respuesta,
};

/** El nivel vigente y su versión; solo el gerente (`compras.configurar`): para los demás, el genérico. */
export function cargarElNivelDeCompras(
  contexto: ContextoOperativo,
): Promise<Respuesta<NivelDeComprasParaLaPantalla>> {
  return leerElNivelDeCompras(dependencias, contexto);
}

const textoDe = (datos: FormData, nombre: string): string => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : "";
};

/**
 * Guarda el nivel elegido con la versión que la persona vio (la liga la página con `.bind`: no viaja en un campo). Si el servidor rechaza, vuelve a leer lo vigente (si puede) para que la pantalla
 * muestre el nivel que quedó; esa segunda lectura no escribe.
 */
export async function guardarElNivelDeLaPantalla(
  versionEsperada: number,
  datos: FormData,
): Promise<ResultadoDeGuardarElNivel> {
  const guardado = await conLaEmpresa((contexto) =>
    guardarElNivelDeCompras(dependencias, contexto, {
      nivel: textoDe(datos, "nivel"),
      versionEsperada,
    }),
  );
  if (guardado.ok) {
    return { estado: "HECHO", nivel: guardado.dato.nivel, version: guardado.dato.version };
  }
  const vigente = await conLaEmpresa((contexto) => leerElNivelDeCompras(dependencias, contexto));
  return {
    estado: "ERROR",
    error: guardado.error,
    vigente: vigente.ok ? { nivel: vigente.dato.nivel, version: vigente.dato.version } : null,
  };
}
