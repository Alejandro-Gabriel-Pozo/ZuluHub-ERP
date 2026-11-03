import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { aRespuestaDeExcepcion } from "../../../src/composicion/a-respuesta";
import {
  cargarCertificado,
  estadoDeCertificados,
  generarPedidoDeCertificado,
  type CertificadoParaLaPantalla,
} from "../../../src/composicion/certificado-de-arca-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { cargarElEstadoDeLaConfiguracion } from "./configuracion-fiscal";
import { conLaEmpresa } from "./facturacion";
import { dependenciasDeSesion } from "./sesion";

/**
 * Las acciones de servidor del certificado de ARCA: generar el pedido, cargar el certificado que devolvió ARCA y la lectura que arma la
 * pantalla. Finas a propósito (ADR-015, punto 2): resuelven DÓNDE y QUIÉN actúa con `conLaEmpresa` y llaman a
 * `src/composicion/certificado-de-arca-web.ts`, donde se prueba todo lo demás. Ninguna decide permisos (cada caso de uso y la consulta
 * exigen `certificados.gestionar` dentro de su transacción) ni toca la base. Del navegador solo viene la forma del pedido; la empresa y
 * la persona salen de la sesión. Nada de lo que devuelven lleva la clave privada: del pedido sale su CSR (público), de la carga solo
 * cuándo vence.
 */

const dependencias = {
  casosDeUso: web.casosDeUsoDeCertificados,
  consultas: web.consultasDeFacturacion,
  respuesta: dependenciasDeSesion.respuesta,
};

export function generarElPedidoDeCertificado(entrada: unknown) {
  return conLaEmpresa((contexto) => generarPedidoDeCertificado(dependencias, contexto, entrada));
}

export function cargarElCertificado(entrada: unknown) {
  return conLaEmpresa((contexto) => cargarCertificado(dependencias, contexto, entrada));
}

export type CertificadosParaLaPantalla = Readonly<{
  emisorId: string;
  certificados: readonly CertificadoParaLaPantalla[];
}>;

/**
 * El estado de los certificados del emisor principal, por ambiente. El emisor sale del estado de la configuración (D-47), no del
 * navegador; si ese estado falla (sin permiso, por ejemplo), responde ese error.
 */
export async function cargarLosCertificados(
  contexto: ContextoOperativo,
): Promise<Respuesta<CertificadosParaLaPantalla>> {
  try {
    const estado = await cargarElEstadoDeLaConfiguracion(contexto);
    if (!estado.ok) return estado;
    const emisorId = estado.dato.emisorId;
    const certificados = await estadoDeCertificados(dependencias, contexto, { emisorId });
    return certificados.ok
      ? { ok: true, dato: { emisorId, certificados: certificados.dato } }
      : certificados;
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, dependenciasDeSesion.respuesta);
  }
}
