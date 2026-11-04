import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { aRespuestaDeExcepcion, respuestaDeFalla } from "../../../src/composicion/a-respuesta";
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

/**
 * `CLAVE_REUTILIZADA` (el mismo `id` con otros datos) llega como `FISCAL_PEDIDO_REPETIDO`, cuyo texto compartido habla de «comprobante».
 * En estas dos acciones sale el mensaje genérico con su referencia (dueño: mensajes genéricos) y el catálogo no se toca, porque ese
 * texto sigue sirviendo a las otras pantallas. Previene: decirle «comprobante» a quien está cargando un certificado.
 * Chequeo: `test/web/servidor-certificado-de-arca.test.ts`.
 */
async function conMensajeGenericoSiSeRepite<T>(
  respuesta: Promise<Respuesta<T>>,
): Promise<Respuesta<T>> {
  const r = await respuesta;
  if (r.ok || r.error.codigo !== "FISCAL_PEDIDO_REPETIDO") return r;
  return {
    ok: false,
    error: respuestaDeFalla(
      "FISCAL_PEDIDO_REPETIDO en una acción del certificado de ARCA (el mismo id con otros datos)",
      dependenciasDeSesion.respuesta,
    ),
  };
}

export function generarElPedidoDeCertificado(entrada: unknown) {
  return conMensajeGenericoSiSeRepite(
    conLaEmpresa((contexto) => generarPedidoDeCertificado(dependencias, contexto, entrada)),
  );
}

export function cargarElCertificado(entrada: unknown) {
  return conMensajeGenericoSiSeRepite(
    conLaEmpresa((contexto) => cargarCertificado(dependencias, contexto, entrada)),
  );
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
