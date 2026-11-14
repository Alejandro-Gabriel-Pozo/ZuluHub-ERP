import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { formatearNumeroDeDocumento } from "../../patrones/formato-fiscal";
import {
  cambioElDomicilio,
  domicilioNuevo,
  valoresDelDomicilio,
  type DomicilioGuardado,
  type ValoresDelDomicilio,
} from "./modelo-de-puntos-de-venta";

/**
 * El modelo de vista de Datos fiscales (D-43, D-61 a D-65, D-68, D-88): de lo que entrega `datosFiscalesDelEmisor` (el CUIT, la versión vigente y el borrador), lo que se escribe. Puro: sin React ni servidor. Los textos salen del catálogo. Las reglas de negocio (qué es una razón social, una fecha,
 * una provincia válidas) las decide el servidor: acá solo se acomoda la forma del pedido.
 */

export type DomicilioDeDatosFiscales = DomicilioGuardado;

export type VigenteDeDatosFiscales = Readonly<{
  id: string;
  numero: number;
  /** Un instante ISO 8601 en UTC. */
  vigenteDesde: string;
  razonSocial: string;
  condicionIva: string;
  domicilio: DomicilioDeDatosFiscales;
  /** `AAAA-MM-DD`. */
  inicioActividades: string;
  /** Ingresos Brutos (D-116): el número de inscripción o `iibbCondicion`. Las condiciones anteriores llegan como `null`. */
  iibbNumero: string | null;
  iibbCondicion: CondicionDeIibb | null;
}>;

export type BorradorDeDatosFiscales = Readonly<{
  /** La clave de idempotencia con la que se sigue guardando. */
  id: string;
  /** La versión que la pantalla manda en el próximo guardado. */
  version: number;
  razonSocial: string | null;
  condicionIva: string | null;
  domicilio: DomicilioDeDatosFiscales | null;
  inicioActividades: string | null;
  iibbNumero: string | null;
  iibbCondicion: CondicionDeIibb | null;
}>;

/** La única condición de Ingresos Brutos que sale a la pantalla (D-116). */
export type CondicionDeIibb = "NO_CONTRIBUYENTE";

export type OpcionDeCondicionDeIva = Readonly<{ valor: string; etiqueta: string }>;

/** El CUIT de la empresa (D-65), en su forma de lectura («30-71234567-8»): solo para leer en el formulario. */
export const filaDelCuit = (cuit: string): Readonly<{ rotulo: string; valor: string }> => ({
  rotulo: texto({}, "fiscal.pantalla.config_df_cuit"),
  valor: formatearNumeroDeDocumento("CUIT", cuit),
});

// ---------------------------------------------------------------------------------------------------------------
// El formulario
// ---------------------------------------------------------------------------------------------------------------

/** Lo que la persona escribe, tal cual (todo texto: el servidor decide qué es válido). */
export type ValoresDeDatosFiscales = ValoresDelDomicilio &
  Readonly<{
    razonSocial: string;
    /** El valor de la condición (`RESPONSABLE_INSCRIPTO`), o vacío si no eligió. */
    condicionIva: string;
    /** Ingresos Brutos (D-116): `NUMERO`, `NO_CONTRIBUYENTE` o vacío si no eligió. */
    ingresosBrutos: string;
    /** El número de inscripción: solo cuenta con `ingresosBrutos` en `NUMERO`. */
    iibbNumero: string;
    /** `aaaa-mm-dd`: lo que entrega la entrada de fecha y lo que entiende el servidor. */
    inicioActividades: string;
  }>;

export type CampoDeDatosFiscales = keyof ValoresDeDatosFiscales;

const VALORES_EN_BLANCO: ValoresDeDatosFiscales = {
  razonSocial: "",
  condicionIva: "",
  ingresosBrutos: "",
  iibbNumero: "",
  inicioActividades: "",
  calle: "",
  numeroDeCalle: "",
  piso: "",
  departamento: "",
  localidad: "",
  provincia: "",
  codigoPostal: "",
};

export const MODO_NUMERO = "NUMERO";
export const MODO_NO_CONTRIBUYENTE: CondicionDeIibb = "NO_CONTRIBUYENTE";

/** Lo guardado (número o condición) en los dos campos del formulario: el modo y el número escrito. */
const iibbEnPantalla = (
  numero: string | null,
  condicion: CondicionDeIibb | null,
): Pick<ValoresDeDatosFiscales, "ingresosBrutos" | "iibbNumero"> =>
  condicion !== null
    ? { ingresosBrutos: condicion, iibbNumero: "" }
    : numero !== null
      ? { ingresosBrutos: MODO_NUMERO, iibbNumero: numero }
      : { ingresosBrutos: "", iibbNumero: "" };

/** Lo que el formulario declara de Ingresos Brutos: el número solo con «Número de inscripción» y con texto; la condición solo con «No contribuyente». */
const iibbDeLosValores = (
  v: Pick<ValoresDeDatosFiscales, "ingresosBrutos" | "iibbNumero">,
): Readonly<{ numero: string | null; condicion: CondicionDeIibb | null }> => ({
  numero:
    v.ingresosBrutos === MODO_NUMERO && v.iibbNumero.trim() !== "" ? v.iibbNumero.trim() : null,
  condicion: v.ingresosBrutos === MODO_NO_CONTRIBUYENTE ? MODO_NO_CONTRIBUYENTE : null,
});

/** Lo vigente en los campos del formulario (D-88: sin borrador se abre con lo que rige; no se guarda nada hasta Guardar borrador o Confirmar). */
function valoresDeLoVigente(v: VigenteDeDatosFiscales): ValoresDeDatosFiscales {
  return {
    razonSocial: v.razonSocial,
    condicionIva: v.condicionIva,
    ...iibbEnPantalla(v.iibbNumero, v.iibbCondicion),
    inicioActividades: v.inicioActividades,
    ...valoresDelDomicilio(v.domicilio),
  };
}

/** Los valores con los que abre el formulario: los del borrador si existe (D-88), si no los de lo vigente, y en blanco si nunca hubo nada. */
export function valoresDelBorrador(
  b: BorradorDeDatosFiscales | null,
  vigente: VigenteDeDatosFiscales | null = null,
): ValoresDeDatosFiscales {
  if (b === null) return vigente === null ? VALORES_EN_BLANCO : valoresDeLoVigente(vigente);
  return {
    razonSocial: b.razonSocial ?? "",
    condicionIva: b.condicionIva ?? "",
    ...iibbEnPantalla(b.iibbNumero, b.iibbCondicion),
    inicioActividades: b.inicioActividades ?? "",
    ...valoresDelDomicilio(b.domicilio),
  };
}

/** Las claves de idempotencia del formulario: se generan UNA vez al abrirlo y viajan con el pedido. */
export type IdsDeDatosFiscales = Readonly<{ borradorId: string; domicilioId: string }>;

/**
 * El pedido de «Guardar borrador» (`guardarBorradorDeDatosFiscales`): el `borradorId` es el del borrador (o el que generó el
 * formulario si todavía no hay), y la versión es la última que vio la pantalla. Un dato en blanco no se manda salvo que antes tuviera
 * valor (así un borrador a medio llenar se guarda, y borrar un dato ya cargado lo rechaza el servidor marcándolo). El domicilio va
 * como NUEVO solo si cambió: si no, el borrador conserva el que tiene. Un domicilio no se edita (la tabla es de solo inserción: el
 * mismo id con otro contenido es `ID_EN_USO`, `dejarListoElDomicilio`): cada domicilio nuevo lleva un id que no se usó antes.
 */
export function armarElPedidoDeGuardado(
  v: ValoresDeDatosFiscales,
  ids: IdsDeDatosFiscales,
  emisorId: string,
  version: number | null,
  original: BorradorDeDatosFiscales | null,
) {
  const base = valoresDelBorrador(original);
  const dato = (clave: "razonSocial" | "condicionIva", valor: string) =>
    valor.trim() !== "" || base[clave] !== "" ? { [clave]: valor.trim() } : {};
  const inicio = v.inicioActividades.trim();
  // Ingresos Brutos: igual que el resto, solo se manda lo que tiene valor o lo que antes lo tenía (entonces va `null` y el servidor lo
  // borra). Elegir uno limpia el otro en el servidor; el pedido nunca lleva los dos con valor (sería error de `iibbCondicion`).
  const iibb = iibbDeLosValores(v);
  const antes = iibbDeLosValores(base);
  return {
    emisorId,
    borradorId: ids.borradorId,
    ...(version === null ? {} : { versionEsperada: version }),
    ...dato("razonSocial", v.razonSocial),
    ...dato("condicionIva", v.condicionIva),
    ...(iibb.numero !== null || antes.numero !== null ? { iibbNumero: iibb.numero } : {}),
    ...(iibb.condicion !== null || antes.condicion !== null
      ? { iibbCondicion: iibb.condicion }
      : {}),
    ...(inicio !== "" || base.inicioActividades !== "" ? { inicioActividades: inicio } : {}),
    ...(cambioElDomicilio(v, original?.domicilio ?? null)
      ? { domicilio: domicilioNuevo(v, ids.domicilioId) }
      : {}),
  };
}

const opcional = (t: string): string | null => (t.trim() === "" ? null : t.trim());

/**
 * El borrador que queda guardado cuando el guardado del pedido de arriba sale bien (sin su versión, que la devuelve el servidor):
 * el formulario sigue desde ahí y el próximo guardado se compara con esto, no con lo que había al abrir. Si el domicilio viajó, el
 * borrador pasa a tener ese (con su id, que ya no se reutiliza); si no, conserva el que tenía. Previene: reenviar el mismo id de
 * domicilio con otro contenido (`ID_EN_USO`) cuando la persona corrige tras una confirmación rechazada.
 */
export function borradorTrasGuardar(
  v: ValoresDeDatosFiscales,
  ids: IdsDeDatosFiscales,
  original: BorradorDeDatosFiscales | null,
): Omit<BorradorDeDatosFiscales, "version"> {
  return {
    id: ids.borradorId,
    razonSocial: opcional(v.razonSocial),
    condicionIva: opcional(v.condicionIva),
    iibbNumero: iibbDeLosValores(v).numero,
    iibbCondicion: iibbDeLosValores(v).condicion,
    inicioActividades: opcional(v.inicioActividades),
    domicilio: cambioElDomicilio(v, original?.domicilio ?? null)
      ? {
          id: ids.domicilioId,
          calle: v.calle.trim(),
          numero: v.numeroDeCalle.trim(),
          piso: opcional(v.piso),
          departamento: opcional(v.departamento),
          localidad: v.localidad.trim(),
          provincia: v.provincia.trim(),
          codigoPostal: opcional(v.codigoPostal),
        }
      : (original?.domicilio ?? null),
  };
}

/**
 * El motivo que pide el caso de uso al confirmar (`confirmarDatosFiscales`: obligatorio). La pantalla no tiene un campo de
 * motivo: viaja este texto fijo, que se guarda en la versión confirmada y nunca se muestra. Fuente: D-89 de
 * `facturador-contratos-de-pantalla.md`, confirmada por el dueño el 2026-11-03.
 */
export const MOTIVO_DE_LA_CONFIRMACION = "Confirmación de datos fiscales";

/** El pedido de «Confirmar»: sin `vigenteDesde` (D-61: rige desde ya). La versión se completa con la que devuelve el guardado. */
export const armarElPedidoDeConfirmacion = (emisorId: string, borradorId: string) => ({
  emisorId,
  borradorId,
  motivo: MOTIVO_DE_LA_CONFIRMACION,
});

/** Un envío del formulario: siempre guarda el borrador y, con «Confirmar», lo confirma con la versión que quedó guardada. */
export type PedidoDelFormulario = Readonly<{
  guardar: object;
  /** Lo que queda guardado si el guardado sale bien (`borradorTrasGuardar`). */
  tras: Omit<BorradorDeDatosFiscales, "version">;
  confirmar: object | null;
}>;

/** Dónde se marca un error: un campo del formulario o ninguno (va como aviso arriba). */
export type LugarDelError = CampoDeDatosFiscales | null;

const CAMPO_DEL_SERVIDOR: Readonly<Record<string, CampoDeDatosFiscales>> = {
  razonSocial: "razonSocial",
  condicionIva: "condicionIva",
  inicioActividades: "inicioActividades",
  // Ingresos Brutos (D-116): «falta elegir» y un valor de condición inválido marcan el desplegable; el número inválido, su campo.
  ingresosBrutos: "ingresosBrutos",
  iibbCondicion: "ingresosBrutos",
  iibbNumero: "iibbNumero",
  "domicilio.calle": "calle",
  "domicilio.numero": "numeroDeCalle",
  "domicilio.piso": "piso",
  "domicilio.departamento": "departamento",
  "domicilio.localidad": "localidad",
  "domicilio.provincia": "provincia",
  "domicilio.codigoPostal": "codigoPostal",
  // «Falta el domicilio» no apunta a un campo: se marca el primero del bloque, que es donde se empieza a cargar.
  domicilio: "calle",
};

/** El nombre de campo que usa el servidor (`campo` del error) → dónde lo marca el formulario. Uno que no conoce: `null`. */
export const lugarDelError = (campo: string | undefined): LugarDelError =>
  campo !== undefined && Object.hasOwn(CAMPO_DEL_SERVIDOR, campo)
    ? (CAMPO_DEL_SERVIDOR[campo] ?? null)
    : null;
