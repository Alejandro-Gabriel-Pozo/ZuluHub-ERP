import "server-only";

import { detalleDeFalla } from "../../../src/capacidades/experiencia/respuesta";
import { inicioDelDiaArgentino } from "../logica/fecha-de-verificacion";
import {
  entradaDeAgregarDominio,
  entradaDeCambiarDominio,
  entradaDeRetirarDominio,
} from "../logica/entrada-de-dominios";
import { errorParaLaPantalla } from "../logica/errores-de-plataforma";
import type { RespuestaDeCambioDeDominio } from "../logica/cambio-de-dominio";
import { exigirAcceso } from "./acceso";
import { esRedireccion, fallaInesperada, type Falla } from "./proteccion";

const DATOS_NO_VALIDOS = "Los datos no son válidos. Revisalos.";
const ETIQUETA = "dominios";

const datosNoValidos = (): RespuestaDeCambioDeDominio => ({
  ok: false,
  error: { tipo: "GENERAL", texto: DATOS_NO_VALIDOS },
});

/** El error de un caso de uso para el navegador; lo inesperado va al registro con su referencia y sin datos del pedido. */
function falla(error: unknown): Falla {
  const paraLaPantalla = errorParaLaPantalla(error, "DOMINIO");
  if (paraLaPantalla.tipo === "INESPERADO") {
    return fallaInesperada(ETIQUETA, detalleDeFalla(error));
  }
  return { ok: false, error: paraLaPantalla };
}

type Resultado =
  { ok: true; valor: { dominioId: string; yaEstaba: boolean } } | { ok: false; error: unknown };

type Acceso = Awaited<ReturnType<typeof exigirAcceso>>;

/**
 * Lista blanca (todo nace cerrado): estas acciones solo valen sobre el dominio de una EMPRESA. Llegan con un id que manda el navegador, y los casos de uso de dominios sirven
 * también a los dominios de una marca (landing, consola, host canónico); sin esta lectura previa, un ADMIN con segundo factor podría mandar a la página neutra uno de ellos por su
 * id. La lectura solo devuelve dominios de empresas y el dueño de un dominio no cambia nunca (`dominio_inmutable`), así que no hay carrera entre leer y actuar. Si no vuelve
 * una fila (no existe o es de una marca) la respuesta es la misma: `DOMINIO_NO_ENCONTRADO`.
 */
async function noEsDeUnaEmpresa(acceso: Acceso, dominioId: string): Promise<Resultado | null> {
  const lectura = await acceso.consultas.listarDominios({ dominioId, limite: 1 });
  if (!lectura.ok) return lectura;
  return lectura.valor.filas.length === 1 ? null : { ok: false, error: "DOMINIO_NO_ENCONTRADO" };
}

/**
 * Corre un caso de uso de dominios con el acceso de este pedido. Cada caso pide su acción y el segundo factor reciente a la puerta de la consola; un `redirect`
 * de Next se relanza; lo que lance cualquier otra cosa sale como inesperado, con referencia y sin el pedido.
 */
async function ejecutar(
  correr: (acceso: Acceso) => Promise<Resultado>,
): Promise<RespuestaDeCambioDeDominio> {
  try {
    const acceso = await exigirAcceso();
    const resultado = await correr(acceso);
    if (resultado.ok) {
      return {
        ok: true,
        dato: { dominioId: resultado.valor.dominioId, yaEstaba: resultado.valor.yaEstaba },
      };
    }
    return falla(resultado.error);
  } catch (excepcion) {
    if (esRedireccion(excepcion)) throw excepcion;
    return fallaInesperada(ETIQUETA, detalleDeFalla(excepcion));
  }
}

/** Da de alta el dominio de una empresa: nace pendiente de verificación y sirve la página neutra. Repetir el pedido (misma clave) no registra otro. */
export async function agregarDominioDeConsola(
  entrada: unknown,
): Promise<RespuestaDeCambioDeDominio> {
  const forma = entradaDeAgregarDominio(entrada);
  if (!forma.ok) return datosNoValidos();
  const { claveDeIdempotencia, empresaId, host, superficie, titular } = forma.valor;
  return ejecutar(async (acceso) => {
    const r = await acceso.casos.agregarDominio({
      claveDeIdempotencia,
      host,
      superficie,
      titular,
      esCanonico: false,
      duenio: { tipo: "EMPRESA", empresaId },
    });
    return r.ok
      ? { ok: true, valor: { dominioId: r.valor.dominioId, yaEstaba: r.valor.yaExistia } }
      : r;
  });
}

/**
 * Verifica el dominio. En esta etapa NO consulta el DNS: quien opera comprueba el registro por fuera y deja constancia; la fecha es el inicio del día de hoy en la
 * Argentina (ver `fecha-de-verificacion.ts`), igual para todo reintento del día.
 */
export async function verificarDominioDeConsola(
  entrada: unknown,
): Promise<RespuestaDeCambioDeDominio> {
  const forma = entradaDeCambiarDominio(entrada);
  if (!forma.ok) return datosNoValidos();
  return ejecutar(async (acceso) => {
    const previo = await noEsDeUnaEmpresa(acceso, forma.valor.dominioId);
    if (previo !== null) return previo;
    const r = await acceso.casos.verificarDominio({
      ...forma.valor,
      verificadoEn: inicioDelDiaArgentino(new Date()),
    });
    return r.ok ? { ok: true, valor: r.valor } : r;
  });
}

export async function activarDominioDeConsola(
  entrada: unknown,
): Promise<RespuestaDeCambioDeDominio> {
  const forma = entradaDeCambiarDominio(entrada);
  if (!forma.ok) return datosNoValidos();
  return ejecutar(async (acceso) => {
    const previo = await noEsDeUnaEmpresa(acceso, forma.valor.dominioId);
    if (previo !== null) return previo;
    const r = await acceso.casos.activarDominio(forma.valor);
    return r.ok ? { ok: true, valor: r.valor } : r;
  });
}

export async function desactivarDominioDeConsola(
  entrada: unknown,
): Promise<RespuestaDeCambioDeDominio> {
  const forma = entradaDeCambiarDominio(entrada);
  if (!forma.ok) return datosNoValidos();
  return ejecutar(async (acceso) => {
    const previo = await noEsDeUnaEmpresa(acceso, forma.valor.dominioId);
    if (previo !== null) return previo;
    const r = await acceso.casos.desactivarDominio(forma.valor);
    return r.ok ? { ok: true, valor: r.valor } : r;
  });
}

/** Retira el dominio (la página neutra aparece de inmediato; el motivo es obligatorio). Nada se borra. */
export async function retirarDominioDeConsola(
  entrada: unknown,
): Promise<RespuestaDeCambioDeDominio> {
  const forma = entradaDeRetirarDominio(entrada);
  if (!forma.ok) return datosNoValidos();
  return ejecutar(async (acceso) => {
    const previo = await noEsDeUnaEmpresa(acceso, forma.valor.dominioId);
    if (previo !== null) return previo;
    const r = await acceso.casos.retirarDominio(forma.valor);
    return r.ok ? { ok: true, valor: r.valor } : r;
  });
}
