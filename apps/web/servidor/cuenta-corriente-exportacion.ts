import "server-only";
import { headers } from "next/headers";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  exportarLaCuentaCorriente,
  type ArchivoDeCuentaCorriente,
  type DependenciasDeLaExportacionDeCuentaCorriente,
} from "../../../src/composicion/cuenta-corriente-exportacion-web";
import { crearEscritorDePlanilla } from "../../../src/composicion/escritor-de-planilla";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";

/**
 * La descarga del archivo de la cuenta corriente (Excel) para la ruta `/caja/cuenta-corriente/exportar`: resuelve QUIÉN y DÓNDE (sesión, origen propio y empresa elegida, nunca lo que diga el
 * navegador) y llama a `src/composicion/cuenta-corriente-exportacion-web.ts`, donde se prueba todo lo demás. El caso exige `cuenta_corriente.ver` adentro. Se rechaza todo pedido que no salga de
 * esta misma aplicación (`Sec-Fetch-Site`): la descarga deja un registro de auditoría, y un sitio ajeno no puede dispararla.
 * Previene: registros de auditoría sembrados desde otro sitio. Chequeo: `test/web/cuenta-corriente-exportacion-descarga.test.ts`.
 */

const dependencias: DependenciasDeLaExportacionDeCuentaCorriente = {
  casos: () => web.exportacionDeCuentaCorriente(),
  escritor: crearEscritorDePlanilla(),
  respuesta: dependenciasDeSesion.respuesta,
};

/** Desde esta misma aplicación: un clic en un enlace del sitio (`same-origin`) o la dirección tipeada o marcada (`none`). Lo demás, incluida la ausencia del dato, se rechaza. */
const ORIGENES_PERMITIDOS: ReadonlySet<string> = new Set(["same-origin", "none"]);

export async function exportarElArchivoDeCuentaCorriente(): Promise<
  Respuesta<ArchivoDeCuentaCorriente>
> {
  const origen = (await headers()).get("sec-fetch-site");
  if (origen === null || !ORIGENES_PERMITIDOS.has(origen)) {
    return { ok: false, error: errorDeCodigo("SIN_PERMISO") };
  }
  return conLaEmpresa((contexto) => exportarLaCuentaCorriente(dependencias, contexto));
}
