import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  LARGO_MAXIMO_DEL_NOMBRE_O_RAZON_SOCIAL,
  nombreODenominacionDesdeTexto,
} from "../../../primitivas/texto/nombre-o-razon-social";
import { esCondicionDeIva, type CondicionIva } from "./emisor";
import type { DomicilioId, EmisorId, VersionId } from "./identificadores";
import { confirmarVersion, type ErrorDeConfirmacion } from "./vigencia";

/**
 * Datos fiscales de un emisor, versionados con vigencia (spec H7 §B.3). Los edita y confirma el
 * GERENTE (decisión del dueño); el CUIT no está acá: es del emisor y solo lo toca la plataforma.
 *
 * Un BORRADOR es editable (hay uno por emisor) y puede estar incompleto. Al confirmarlo pasa a una
 * versión CONFIRMADA e inmutable, con número, vigencia y quién la confirmó. Los textos que llegan
 * se normalizan (se recortan los blancos) y los vacíos opcionales quedan en `null`.
 *
 * Valores configurables, todos SUPUESTOS (no son requisitos verificados de ARCA):
 * - `LIMITES_DE_DATOS_FISCALES`: largo máximo de la razón social y del número de IIBB. La razón social NO se define acá: es el dato
 *   «nombre o razón social» y su tope y sus caracteres permitidos viven en su primitiva (P2, dueño, 2026-11-05: una sola fuente);
 * - `CONDICIONES_DE_IIBB`: lo que la base puede tener guardado. Desde D-115/D-116 (dueño, 2026-11-05) lo único que se
 *   pide y se imprime es el número de inscripción O «No contribuyente» (RG 1415 Anexo II A.I.a punto 4: el comprobante lleva
 *   el número de inscripción en Ingresos Brutos o la condición de no contribuyente). Las tres condiciones anteriores (local,
 *   convenio multilateral, exento: supuesto del diseño, sin fuente) quedan solo para LEER filas viejas: no se aceptan al
 *   editar, no se copian a una versión nueva y el modelo de impresión nuevo no las imprime.
 */
export const LIMITES_DE_DATOS_FISCALES = {
  razonSocial: LARGO_MAXIMO_DEL_NOMBRE_O_RAZON_SOCIAL,
  iibbNumero: 30,
} as const;

export const CONDICION_NO_CONTRIBUYENTE = "NO_CONTRIBUYENTE" as const;

export const CONDICIONES_DE_IIBB = [
  "LOCAL",
  "CONVENIO_MULTILATERAL",
  "EXENTO",
  CONDICION_NO_CONTRIBUYENTE,
] as const;

export type CondicionIibb = (typeof CONDICIONES_DE_IIBB)[number];

export function esCondicionDeIibb(texto: string): texto is CondicionIibb {
  return (CONDICIONES_DE_IIBB as readonly string[]).includes(texto);
}

/**
 * De una condición guardada, la única que sigue vigente: «No contribuyente». Las tres anteriores se descartan al armar un
 * borrador o confirmar, para que ninguna versión nueva las arrastre. Previene: que una versión confirmada de hoy lleve una
 * condición que ya no se pide ni se imprime.
 */
export function condicionVigente(condicion: CondicionIibb | null): CondicionIibb | null {
  return condicion === CONDICION_NO_CONTRIBUYENTE ? condicion : null;
}

type Identidad = Readonly<{ id: VersionId; empresaId: EmpresaId; emisorId: EmisorId }>;

export type DatosFiscalesBorrador = Identidad &
  Readonly<{
    razonSocial: string | null;
    condicionIva: CondicionIva | null;
    domicilioFiscalId: DomicilioId | null;
    /** Fecha civil `YYYY-MM-DD` (texto en la frontera). */
    inicioActividades: string | null;
    iibbNumero: string | null;
    iibbCondicion: CondicionIibb | null;
    creadoPor: PersonaId;
    version: number;
  }>;

export type DatosFiscalesConfirmados = Identidad &
  Readonly<{
    numero: number;
    razonSocial: string;
    condicionIva: CondicionIva;
    domicilioFiscalId: DomicilioId;
    inicioActividades: string;
    iibbNumero: string | null;
    iibbCondicion: CondicionIibb | null;
    vigenteDesde: Date;
    confirmadaEn: Date;
    confirmadaPor: PersonaId;
    motivo: string;
    version: number;
  }>;

/** Los campos que hay que tener para confirmar, en el orden en que se informan los faltantes. */
export type CampoObligatorio =
  "razonSocial" | "condicionIva" | "domicilioFiscalId" | "inicioActividades" | "ingresosBrutos";

export type DatosFiscalesIncompletos = Readonly<{
  codigo: "DATOS_FISCALES_INCOMPLETOS";
  faltantes: readonly CampoObligatorio[];
}>;

export type ErrorDeDatosFiscales =
  | "RAZON_SOCIAL_INVALIDA"
  | "CONDICION_IVA_INVALIDA"
  | "INICIO_DE_ACTIVIDADES_INVALIDO"
  | "IIBB_NUMERO_INVALIDO"
  | "IIBB_CONDICION_INVALIDA"
  | ErrorDeConfirmacion
  | DatosFiscalesIncompletos;

/**
 * Cambios a un borrador. Un campo ausente no se toca; `null` o el texto en blanco borran `iibbNumero` e `iibbCondicion`. Los
 * obligatorios no se pueden borrar: se reemplazan. Ingresos Brutos se elige entre el número o `NO_CONTRIBUYENTE` (D-115/D-116):
 * elegir uno borra el otro, y mandar los dos a la vez es un error. Que haya uno de los dos se exige al confirmar, no acá.
 */
export type CambiosDeBorrador = Readonly<{
  razonSocial?: string;
  condicionIva?: string;
  domicilioFiscalId?: DomicilioId;
  inicioActividades?: string;
  iibbNumero?: string | null;
  iibbCondicion?: string | null;
}>;

export type DatosDeBorradorNuevo = Identidad & Readonly<{ creadoPor: PersonaId }>;

/** Un borrador vacío, para empezar de cero. */
export function nuevoBorrador(datos: DatosDeBorradorNuevo): DatosFiscalesBorrador {
  return {
    id: datos.id,
    empresaId: datos.empresaId,
    emisorId: datos.emisorId,
    razonSocial: null,
    condicionIva: null,
    domicilioFiscalId: null,
    inicioActividades: null,
    iibbNumero: null,
    iibbCondicion: null,
    creadoPor: datos.creadoPor,
    version: 1,
  };
}

/** Un borrador que parte de los valores de una versión confirmada (para corregirla sin retipear todo). */
export function borradorDesdeConfirmada(
  confirmada: DatosFiscalesConfirmados,
  datos: Pick<DatosDeBorradorNuevo, "id" | "creadoPor">,
): DatosFiscalesBorrador {
  return {
    id: datos.id,
    empresaId: confirmada.empresaId,
    emisorId: confirmada.emisorId,
    razonSocial: confirmada.razonSocial,
    condicionIva: confirmada.condicionIva,
    domicilioFiscalId: confirmada.domicilioFiscalId,
    inicioActividades: confirmada.inicioActividades,
    iibbNumero: confirmada.iibbNumero,
    iibbCondicion: condicionVigente(confirmada.iibbCondicion),
    creadoPor: datos.creadoPor,
    version: 1,
  };
}

const CARACTERES_DE_CONTROL = /\p{Cc}/u;
const FECHA_CIVIL = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/**
 * Texto recortado, no vacío, sin caracteres de control y de hasta `maximo`; `null` si no sirve. Hoy solo lo usa el número de IIBB (sin
 * primitiva: Q6, texto corto de 30 sin formato); sigue siendo lista de prohibidos (deuda, ver «Hallazgos aparte»).
 */
function textoLimpio(valor: string, maximo: number): string | null {
  const limpio = valor.trim();
  if (limpio === "" || limpio.length > maximo || CARACTERES_DE_CONTROL.test(limpio)) return null;
  return limpio;
}

function esBisiesto(anio: number): boolean {
  return anio % 4 === 0 && (anio % 100 !== 0 || anio % 400 === 0);
}

/** Una fecha civil real `YYYY-MM-DD` (calendario gregoriano, año 0001 en adelante). Sin reloj ni zona. */
export function fechaCivilValida(texto: string): boolean {
  const partes = FECHA_CIVIL.exec(texto);
  if (partes === null) return false;
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])] as const;
  if (anio < 1 || dia < 1) return false;
  const diasDelMes = [31, esBisiesto(anio) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Un mes fuera de 1 a 12 no tiene entrada en la tabla: 0 días, así que ningún día entra.
  return dia <= (diasDelMes[mes - 1] ?? 0);
}

const NUMERO_INVALIDO = Symbol("numero de IIBB invalido");

/** `undefined`: no viene; `null`: se borra; el texto limpio; o `NUMERO_INVALIDO`. */
function limpiarNumeroDeIibb(
  valor: string | null | undefined,
): string | null | undefined | typeof NUMERO_INVALIDO {
  if (valor === undefined) return undefined;
  if (valor === null || valor.trim() === "") return null;
  return textoLimpio(valor, LIMITES_DE_DATOS_FISCALES.iibbNumero) ?? NUMERO_INVALIDO;
}

/** Solo «No contribuyente» se acepta al editar (las otras tres ya no se piden). Mismas salidas que el número. */
function limpiarCondicionDeIibb(
  valor: string | null | undefined,
): CondicionIibb | null | undefined | "INVALIDA" {
  if (valor === undefined) return undefined;
  if (valor === null || valor.trim() === "") return null;
  return valor === CONDICION_NO_CONTRIBUYENTE ? valor : "INVALIDA";
}

/**
 * Si de Ingresos Brutos hay UNA elección: el número de inscripción o «No contribuyente», no las dos ni ninguna (D-115/D-116, RG 1415
 * Anexo II A.I.a punto 4). Una sola regla para confirmar y para emitir. Previene: una factura emitida sin el dato que ARCA exige, o
 * con dos que se contradicen. Una condición anterior (local, convenio multilateral, exento) no cuenta como elección.
 */
export function ingresosBrutosDeclarados(
  datos: Readonly<{ iibbNumero: string | null; iibbCondicion: CondicionIibb | null }>,
): boolean {
  return (datos.iibbNumero !== null) !== (condicionVigente(datos.iibbCondicion) !== null);
}

/**
 * ¿El pedido deja `guardado` tal cual está? Compara lo pedido CONTRA LO GUARDADO, sin volver a validar con las reglas de hoy: una
 * versión confirmada es inmutable y se validó cuando se confirmó. Sirve para el reintento de un guardado cuya confirmación ya se
 * hizo (se cortó la red al volver la respuesta): si la razón social guardada se aceptó con reglas anteriores (doble espacio, un `@`),
 * el mismo pedido sigue siendo «ya estaba» y no `VERSION_CONFIRMADA_INMUTABLE`. Previene: que endurecer una regla convierta el
 * reintento idempotente de un dato ya confirmado en un error. Chequeo: las pruebas de este archivo y de `guardar-borrador`.
 * Los textos se comparan recortados (lo único que hacía la validación anterior); `null` o en blanco en Ingresos Brutos pide que no
 * haya valor, como en `editarBorrador`. Un campo ausente no se mira.
 */
export function pedidoNoCambiaLoGuardado(
  guardado: DatosFiscalesBorrador,
  cambios: CambiosDeBorrador,
): boolean {
  const iguales = (pedido: string | null | undefined, valor: string | null): boolean =>
    pedido === undefined ||
    (pedido === null || pedido.trim() === "" ? valor === null : pedido.trim() === valor);
  const textoPedido = (pedido: string | undefined, valor: string | null): boolean =>
    pedido === undefined || pedido.trim() === valor;
  return (
    textoPedido(cambios.razonSocial, guardado.razonSocial) &&
    (cambios.condicionIva === undefined || cambios.condicionIva === guardado.condicionIva) &&
    (cambios.domicilioFiscalId === undefined ||
      cambios.domicilioFiscalId === guardado.domicilioFiscalId) &&
    (cambios.inicioActividades === undefined ||
      cambios.inicioActividades === guardado.inicioActividades) &&
    iguales(cambios.iibbNumero, guardado.iibbNumero) &&
    iguales(cambios.iibbCondicion, guardado.iibbCondicion)
  );
}

/**
 * Aplica `cambios` a un borrador y valida cada valor que llega. Devuelve el PRIMER error, en el orden
 * razón social, condición de IVA, inicio de actividades, número de IIBB, condición de IIBB. No
 * exige que el borrador esté completo (eso se pide al confirmar).
 */
export function editarBorrador(
  borrador: DatosFiscalesBorrador,
  cambios: CambiosDeBorrador,
): Resultado<DatosFiscalesBorrador, ErrorDeDatosFiscales> {
  let razonSocial = borrador.razonSocial;
  if (cambios.razonSocial !== undefined) {
    // Las MISMAS reglas que el nombre del receptor (lista de permitidos, al menos una letra): Q10, dueño, 2026-11-05 (respuesta 4 de la auditoría).
    const valida = nombreODenominacionDesdeTexto(cambios.razonSocial);
    if (!valida.ok) return err("RAZON_SOCIAL_INVALIDA");
    razonSocial = valida.valor;
  }

  let condicionIva = borrador.condicionIva;
  if (cambios.condicionIva !== undefined) {
    if (!esCondicionDeIva(cambios.condicionIva)) return err("CONDICION_IVA_INVALIDA");
    condicionIva = cambios.condicionIva;
  }

  let inicioActividades = borrador.inicioActividades;
  if (cambios.inicioActividades !== undefined) {
    if (!fechaCivilValida(cambios.inicioActividades)) return err("INICIO_DE_ACTIVIDADES_INVALIDO");
    inicioActividades = cambios.inicioActividades;
  }

  let iibbNumero = borrador.iibbNumero;
  let iibbCondicion = condicionVigente(borrador.iibbCondicion);
  const numeroNuevo = limpiarNumeroDeIibb(cambios.iibbNumero);
  if (numeroNuevo === NUMERO_INVALIDO) return err("IIBB_NUMERO_INVALIDO");
  const condicionNueva = limpiarCondicionDeIibb(cambios.iibbCondicion);
  if (condicionNueva === "INVALIDA") return err("IIBB_CONDICION_INVALIDA");
  if (
    numeroNuevo !== undefined &&
    numeroNuevo !== null &&
    condicionNueva === CONDICION_NO_CONTRIBUYENTE
  ) {
    return err("IIBB_CONDICION_INVALIDA");
  }
  if (numeroNuevo !== undefined) {
    iibbNumero = numeroNuevo;
    // Elegir el número descarta «No contribuyente»; borrarlo no toca la condición (se puede estar cambiando de una a otro).
    if (numeroNuevo !== null) iibbCondicion = null;
  }
  if (condicionNueva !== undefined) {
    iibbCondicion = condicionNueva;
    // Elegir «No contribuyente» descarta el número; borrar la condición no lo toca.
    if (condicionNueva !== null) iibbNumero = null;
  }

  return ok({
    ...borrador,
    razonSocial,
    condicionIva,
    domicilioFiscalId: cambios.domicilioFiscalId ?? borrador.domicilioFiscalId,
    inicioActividades,
    iibbNumero,
    iibbCondicion,
  });
}

export type DatosDeConfirmacionFiscal = Readonly<{
  ahora: Date;
  /** Desde cuándo rige: no antes de `ahora`, puede ser futura. */
  vigenteDesde: Date;
  motivo: string;
  confirmadaPor: PersonaId;
}>;

/**
 * Confirma un borrador y lo vuelve una versión inmutable. `existentes` son las versiones ya
 * confirmadas DEL MISMO emisor (mezclar emisores es un error de programación y lanza).
 * Orden de los errores: datos incompletos (`DATOS_FISCALES_INCOMPLETOS` con los campos que faltan),
 * motivo obligatorio y vigencia retroactiva. El número es el máximo + 1.
 */
export function confirmarDatosFiscales(
  borrador: DatosFiscalesBorrador,
  existentes: readonly DatosFiscalesConfirmados[],
  datos: DatosDeConfirmacionFiscal,
): Resultado<DatosFiscalesConfirmados, ErrorDeDatosFiscales> {
  if (existentes.some((v) => v.emisorId !== borrador.emisorId)) {
    throw new RangeError("las versiones confirmadas son de otro emisor");
  }
  const { razonSocial, condicionIva, domicilioFiscalId, inicioActividades } = borrador;
  const iibbCondicion = condicionVigente(borrador.iibbCondicion);
  // D-115/D-116: el comprobante lleva el número de inscripción O «No contribuyente», uno solo. Ninguno (o los dos) no se confirma.
  const eligioIngresosBrutos = ingresosBrutosDeclarados(borrador);
  if (
    razonSocial === null ||
    condicionIva === null ||
    domicilioFiscalId === null ||
    inicioActividades === null ||
    !eligioIngresosBrutos
  ) {
    const faltantes: CampoObligatorio[] = [];
    if (razonSocial === null) faltantes.push("razonSocial");
    if (condicionIva === null) faltantes.push("condicionIva");
    if (domicilioFiscalId === null) faltantes.push("domicilioFiscalId");
    if (inicioActividades === null) faltantes.push("inicioActividades");
    if (!eligioIngresosBrutos) faltantes.push("ingresosBrutos");
    return err({ codigo: "DATOS_FISCALES_INCOMPLETOS", faltantes });
  }
  const confirmacion = confirmarVersion(existentes, datos);
  if (!confirmacion.ok) return confirmacion;
  return ok({
    id: borrador.id,
    empresaId: borrador.empresaId,
    emisorId: borrador.emisorId,
    numero: confirmacion.valor.numero,
    razonSocial,
    condicionIva,
    domicilioFiscalId,
    inicioActividades,
    iibbNumero: borrador.iibbNumero,
    iibbCondicion,
    vigenteDesde: confirmacion.valor.vigenteDesde,
    confirmadaEn: confirmacion.valor.confirmadaEn,
    confirmadaPor: datos.confirmadaPor,
    motivo: confirmacion.valor.motivo,
    version: borrador.version,
  });
}
