import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  anularUnItemEnviado,
  cambiarLaNota,
  cambiarLaSalida,
  enviarALaCocina,
  pedirQueSalga,
  quitarUnPlatoSinEnviar,
  type DependenciasDeComandasWeb,
} from "../../../src/composicion/comandas-web";
import {
  declararElResultadoDeImpresion,
  desactivarLaImpresora,
  editarLaImpresora,
  pedirLaImpresion,
  pedirUnaCopia,
  registrarLaImpresora,
  verElPapelDelDocumento,
  verLasImpresoras,
  verLosTrabajosDeImpresion,
  type DependenciasDeImpresionWeb,
} from "../../../src/composicion/impresion-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { sucursalDeTrabajo } from "./salon";
import { dependenciasDeSesion } from "./sesion";

/**
 * Las comandas y la impresión del salón (S-0r; E7 §3.5): enviar a cocina, pedir que salga, el orden de salida, anular un ítem enviado, las impresoras y los trabajos. Finas a propósito (ADR-015, punto 2):
 * resuelven QUIÉN y DÓNDE actúa (`conLaEmpresa`: sesión, origen propio y empresa elegida; la sucursal, la elegida en este dispositivo y validada contra las que la persona puede elegir) y llaman a
 * `src/composicion/comandas-web.ts`, donde se prueba el resto. La sucursal NUNCA viene del navegador y sin sucursal no se asume «todas»: vacía cierra con el genérico. El permiso y la validez de cada dato los
 * decide el servidor dentro de la transacción: la pantalla no valida nada.
 * Cómo se repite sin duplicar: cada intento lleva su id y su clave, que fija la página una vez con `nuevoIdDeIntento` (el doble toque y el reintento son un solo envío, un solo aviso, un solo trabajo);
 * recargar la página es otro intento.
 * Chequeo: `test/web/servidor-comandas.test.ts`.
 */

const dependencias: DependenciasDeComandasWeb = {
  casosDeUsoDeSalon: web.casosDeUsoDeSalon,
  casosDeUso: web.casosDeUsoDeComandas,
  consultasDeSalon: web.consultasDeSalon,
  respuesta: dependenciasDeSesion.respuesta,
};
const dependenciasDeImpresion: DependenciasDeImpresionWeb = {
  casosDeUso: web.casosDeUsoDeComandas,
  consultas: web.consultasDeComandas,
  respuesta: dependenciasDeSesion.respuesta,
};

/** El id (y la clave) de UN intento: de un envío, de un aviso de anulación, de un trabajo de impresión o de una impresora. Previene: que un doble toque o un reintento por red cortada dupliquen el papel o el aviso. */
export const nuevoIdDeIntento = (): string => crypto.randomUUID();

/** Corre una operación con la sucursal de trabajo que fija el servidor (nunca la del navegador; sin ninguna, el genérico). */
const enLaSucursal = <D>(
  hacer: (contexto: ContextoOperativo, sucursalId: string) => Promise<Respuesta<D>>,
): Promise<Respuesta<D>> =>
  conLaEmpresa(async (contexto) => {
    const sucursal = await sucursalDeTrabajo(contexto);
    return sucursal.ok ? hacer(contexto, sucursal.dato) : sucursal;
  });

/** «Enviar a cocina» (`{ envioId, cuentaId, claveIdempotencia }`). */
export const enviarLaCuentaALaCocina = (crudo: unknown) =>
  enLaSucursal((c, s) => enviarALaCocina(dependencias, c, s, crudo));

/** «Pedir que salga» (`{ envioId, cuentaId, lineaIds | "TODAS", claveIdempotencia }`). */
export const pedirQueSalgaLoQueEspera = (crudo: unknown) =>
  enLaSucursal((c, s) => pedirQueSalga(dependencias, c, s, crudo));

/** Anular un ítem ya enviado (`{ cuentaId, lineaId, cantidad, motivo, avisoId }`). */
export const anularElItemEnviado = (crudo: unknown) =>
  enLaSucursal((c, s) => anularUnItemEnviado(dependencias, c, s, crudo));

/** «Sale ahora» / «Sale después» de un plato no enviado (`{ cuentaId, lineaId, salida }`). */
export const cambiarElOrdenDeSalida = (crudo: unknown) =>
  enLaSucursal((c, s) => cambiarLaSalida(dependencias, c, s, crudo));

/** La nota libre de un plato no enviado (`{ cuentaId, lineaId, nota }`; vacía la quita). */
export const cambiarLaNotaDelPlato = (crudo: unknown) =>
  enLaSucursal((c, s) => cambiarLaNota(dependencias, c, s, crudo));

/** Quitar un plato que todavía no se envió (`{ cuentaId, lineaId }`): sin motivo y sin papel. */
export const quitarElPlatoSinEnviar = (crudo: unknown) =>
  enLaSucursal((c, s) => quitarUnPlatoSinEnviar(dependencias, c, s, crudo));

/** Las impresoras de la sucursal de trabajo. */
export const cargarLasImpresoras = (contexto: ContextoOperativo) =>
  sucursalDeTrabajo(contexto).then((sucursal) =>
    sucursal.ok ? verLasImpresoras(dependenciasDeImpresion, contexto, sucursal.dato) : sucursal,
  );

/** Alta de impresora (`{ impresoraId, nombre, uso, papelMm }`). */
export const darDeAltaLaImpresora = (crudo: unknown) =>
  enLaSucursal((c, s) => registrarLaImpresora(dependenciasDeImpresion, c, s, crudo));

/** Edición de impresora (`{ impresoraId, nombre?, uso?, papelMm?, versionEsperada }`). */
export const guardarLaImpresora = (crudo: unknown) =>
  enLaSucursal((c, s) => editarLaImpresora(dependenciasDeImpresion, c, s, crudo));

/** Desactivar una impresora (`{ impresoraId }`). */
export const desactivarLaImpresoraDelSalon = (crudo: unknown) =>
  enLaSucursal((c, s) => desactivarLaImpresora(dependenciasDeImpresion, c, s, crudo));

/** «Imprimir» o «Reintentar» (`{ trabajoId, documentoTipo, documentoId, impresoraId?, claveIdempotencia }`). */
export const imprimirElDocumento = (crudo: unknown) =>
  enLaSucursal((c, s) => pedirLaImpresion(dependenciasDeImpresion, c, s, crudo));

/** «Reimprimir»: una copia (mismo pedido que imprimir, con otro `trabajoId` y otra clave). */
export const reimprimirElDocumento = (crudo: unknown) =>
  enLaSucursal((c, s) => pedirUnaCopia(dependenciasDeImpresion, c, s, crudo));

/** El dispositivo declara el resultado de un intento (`{ trabajoId, numero, resultado }`). */
export const declararSiSeImprimio = (crudo: unknown) =>
  enLaSucursal((c, s) => declararElResultadoDeImpresion(dependenciasDeImpresion, c, s, crudo));

/** Los trabajos de impresión de un documento (`{ documentoId }`). */
export const cargarLosTrabajosDeImpresion = (crudo: unknown) =>
  enLaSucursal((c, s) => verLosTrabajosDeImpresion(dependenciasDeImpresion, c, s, crudo));

/** El papel de un documento, para que el navegador lo imprima (`{ documentoTipo, documentoId, copia?, impresoraId? }`). */
export const cargarElPapelDelDocumento = (crudo: unknown) =>
  enLaSucursal((c, s) => verElPapelDelDocumento(dependenciasDeImpresion, c, s, crudo));
