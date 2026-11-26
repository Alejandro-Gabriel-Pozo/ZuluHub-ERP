import type { Respuesta } from "../capacidades/experiencia/respuesta";
import { CODIGOS_PUBLICOS } from "../capacidades/experiencia/respuesta";
import type { CodigoDeClientes } from "../capacidades/experiencia/respuesta-de-clientes";
import type { ContextoOperativo } from "../contexto/contexto";
import { armarHojaDeLaExportacion } from "../modulos/cuenta_corriente/publico";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { EscritorDePlanilla } from "../puertos/escritor-de-planilla";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import {
  nombreDelArchivoDeCuentaCorriente,
  rotulosDeLaExportacionDeCuentaCorriente,
} from "./cuenta-corriente-exportacion-textos";
import type { Web } from "./web";

/**
 * La exportación de la cuenta corriente a Excel para la ruta de descarga (CC-5 D). Junta el caso de uso (que lee todo en UNA transacción serializable, audita y devuelve las filas) con el
 * escritor de la planilla y los textos del catálogo. Los errores salen sin detalle: lo que no es un código público ya conocido (sin permiso, módulo no activo, empresa que no opera) es el
 * genérico «Esta acción no está permitida» (dueño, 30/10/2026); una excepción sale con referencia. Nunca devuelve un archivo a medias: o sale entero o sale el error.
 * Previene: que un error de la exportación llegue crudo al navegador y un archivo parcial que parece completo. Chequeo: `cuenta-corriente-exportacion-web.test.ts`.
 */

export type DependenciasDeLaExportacionDeCuentaCorriente = Readonly<{
  casos: () => Pick<ReturnType<Web["exportacionDeCuentaCorriente"]>, "exportarCuentaCorriente">;
  escritor: EscritorDePlanilla;
  respuesta: DependenciasDeRespuesta;
}>;

export type ArchivoDeCuentaCorriente = Readonly<{ nombre: string; contenido: Uint8Array }>;

const GENERICO = { codigo: "CLIENTES_ACCION_NO_PERMITIDA" satisfies CodigoDeClientes } as const;

/** El error del caso de uso tal como lo entiende `aRespuesta`: un código público ya conocido pasa; cualquier otro texto de negocio es el genérico; lo demás (la base) pasa tal cual. */
export function traducirErrorDeLaExportacionDeCuentaCorriente(error: unknown): unknown {
  if (typeof error === "string") return Object.hasOwn(CODIGOS_PUBLICOS, error) ? error : GENERICO;
  return error;
}

/** El archivo de la cuenta corriente de todos los clientes con ficha, al día de hoy (Argentina). La empresa, el actor y los permisos los decide el servidor con el contexto. */
export async function exportarLaCuentaCorriente(
  d: DependenciasDeLaExportacionDeCuentaCorriente,
  contexto: ContextoOperativo,
): Promise<Respuesta<ArchivoDeCuentaCorriente>> {
  try {
    const r = await d.casos().exportarCuentaCorriente(contexto);
    const armado: Resultado<Readonly<{ alDia: string; contenido: Uint8Array }>, unknown> = r.ok
      ? ok({
          alDia: r.valor.alDia,
          contenido: await d.escritor.escribir([
            armarHojaDeLaExportacion(r.valor.filas, rotulosDeLaExportacionDeCuentaCorriente()),
          ]),
        })
      : err(traducirErrorDeLaExportacionDeCuentaCorriente(r.error));
    return aRespuesta(armado, d.respuesta, ({ alDia, contenido }) => ({
      nombre: nombreDelArchivoDeCuentaCorriente(alDia),
      contenido,
    }));
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
