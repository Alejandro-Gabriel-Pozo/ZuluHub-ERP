import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
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
 * - `LIMITES_DE_DATOS_FISCALES`: largo máximo de la razón social y del número de IIBB;
 * - `CONDICIONES_DE_IIBB`: NO VERIFICADO, supuesto del diseño (local, convenio multilateral, exento).
 */
export const LIMITES_DE_DATOS_FISCALES = { razonSocial: 200, iibbNumero: 30 } as const;

export const CONDICIONES_DE_IIBB = ["LOCAL", "CONVENIO_MULTILATERAL", "EXENTO"] as const;

export type CondicionIibb = (typeof CONDICIONES_DE_IIBB)[number];

export function esCondicionDeIibb(texto: string): texto is CondicionIibb {
  return (CONDICIONES_DE_IIBB as readonly string[]).includes(texto);
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
  "razonSocial" | "condicionIva" | "domicilioFiscalId" | "inicioActividades";

const CAMPOS_OBLIGATORIOS: readonly CampoObligatorio[] = [
  "razonSocial",
  "condicionIva",
  "domicilioFiscalId",
  "inicioActividades",
];

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
 * Cambios a un borrador. Un campo ausente no se toca; en los opcionales (`iibb*`) `null` o el texto
 * en blanco lo borran. Los obligatorios no se pueden borrar: se reemplazan.
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
    iibbCondicion: confirmada.iibbCondicion,
    creadoPor: datos.creadoPor,
    version: 1,
  };
}

const CARACTERES_DE_CONTROL = /\p{Cc}/u;
const FECHA_CIVIL = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/** Texto recortado, no vacío, sin caracteres de control y de hasta `maximo`; `null` si no sirve. */
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
    razonSocial = textoLimpio(cambios.razonSocial, LIMITES_DE_DATOS_FISCALES.razonSocial);
    if (razonSocial === null) return err("RAZON_SOCIAL_INVALIDA");
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
  if (cambios.iibbNumero !== undefined) {
    if (cambios.iibbNumero === null || cambios.iibbNumero.trim() === "") {
      iibbNumero = null;
    } else {
      iibbNumero = textoLimpio(cambios.iibbNumero, LIMITES_DE_DATOS_FISCALES.iibbNumero);
      if (iibbNumero === null) return err("IIBB_NUMERO_INVALIDO");
    }
  }

  let iibbCondicion = borrador.iibbCondicion;
  if (cambios.iibbCondicion !== undefined) {
    if (cambios.iibbCondicion === null || cambios.iibbCondicion.trim() === "") {
      iibbCondicion = null;
    } else {
      if (!esCondicionDeIibb(cambios.iibbCondicion)) return err("IIBB_CONDICION_INVALIDA");
      iibbCondicion = cambios.iibbCondicion;
    }
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
  if (
    razonSocial === null ||
    condicionIva === null ||
    domicilioFiscalId === null ||
    inicioActividades === null
  ) {
    const faltantes = CAMPOS_OBLIGATORIOS.filter((campo) => borrador[campo] === null);
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
    iibbCondicion: borrador.iibbCondicion,
    vigenteDesde: confirmacion.valor.vigenteDesde,
    confirmadaEn: confirmacion.valor.confirmadaEn,
    confirmadaPor: datos.confirmadaPor,
    motivo: confirmacion.valor.motivo,
    version: borrador.version,
  });
}
