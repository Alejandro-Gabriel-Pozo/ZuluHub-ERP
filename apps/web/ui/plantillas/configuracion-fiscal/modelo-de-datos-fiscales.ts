import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { PROVINCIAS } from "../../../../../src/primitivas/domicilio/provincias";
import { formatearFecha, formatearNumeroDeDocumento } from "../facturacion/formato-fiscal";
import {
  domicilioNuevo,
  hayDomicilioCargado,
  type ValoresDelDomicilio,
} from "./modelo-de-puntos-de-venta";

/**
 * El modelo de vista de Datos fiscales (D-43, D-61 a D-65, D-68): de lo que entrega `datosFiscalesDelEmisor` (el CUIT, la versión vigente y el borrador), lo que se lee y lo que
 * se escribe. Puro: sin React ni servidor. Los textos salen del catálogo. Las reglas de negocio (qué es una razón social, una fecha,
 * una provincia válidas) las decide el servidor: acá solo se acomoda la forma del pedido.
 */

export type DomicilioDeDatosFiscales = Readonly<{
  id: string;
  calle: string;
  numero: string;
  piso: string | null;
  departamento: string | null;
  localidad: string;
  /** El código de la provincia (`AR-B`). */
  provincia: string;
  codigoPostal: string | null;
}>;

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
}>;

export type OpcionDeCondicionDeIva = Readonly<{ valor: string; etiqueta: string }>;

const provinciaParaMostrar = (codigo: string): string =>
  PROVINCIAS.find((p) => p.codigo === codigo)?.nombre ?? codigo;

/**
 * El domicilio en una línea, con los rótulos ya aprobados de los campos para lo opcional («Piso 3», «Departamento B», «Código postal
 * 1000»). SUPUESTO del ingeniero: el prototipo muestra «Av. Rivadavia 1234, CABA» y no dice cómo se escriben piso, departamento y
 * código postal; se usan sus rótulos de Puntos de venta. Revertirlo es cambiar esta función.
 */
export function domicilioEnUnaLinea(d: DomicilioDeDatosFiscales): string {
  return [
    `${d.calle} ${d.numero}`,
    d.piso === null ? null : `${texto({}, "fiscal.pantalla.config_pv_piso")} ${d.piso}`,
    d.departamento === null
      ? null
      : `${texto({}, "fiscal.pantalla.config_pv_departamento")} ${d.departamento}`,
    d.localidad,
    provinciaParaMostrar(d.provincia),
    d.codigoPostal === null
      ? null
      : `${texto({}, "fiscal.pantalla.config_pv_codigo_postal")} ${d.codigoPostal}`,
  ]
    .filter((parte) => parte !== null)
    .join(", ");
}

/** El CUIT de la empresa (D-65), en su forma de lectura («30-71234567-8»): solo para leer, en la lectura y en el formulario. */
export const filaDelCuit = (cuit: string): Readonly<{ rotulo: string; valor: string }> => ({
  rotulo: texto({}, "fiscal.pantalla.config_df_cuit"),
  valor: formatearNumeroDeDocumento("CUIT", cuit),
});

export type LecturaDeDatosFiscales = Readonly<{
  filas: readonly Readonly<{ rotulo: string; valor: string }>[];
  /** «Rige desde el 12/10/2026.» */
  rigeDesde: string;
}>;

/**
 * Lo vigente, para leer (estado 1 y 3 de la opción A). `rigeDesdeEnArgentina`: el día civil argentino (`AAAA-MM-DD`) del instante
 * desde el que rige; lo calcula la página con la utilidad que ya existe (`hoyEnArgentina`).
 */
export function armarLaLectura(
  cuit: string,
  v: VigenteDeDatosFiscales,
  condiciones: readonly OpcionDeCondicionDeIva[],
  rigeDesdeEnArgentina: string,
): LecturaDeDatosFiscales {
  return {
    filas: [
      filaDelCuit(cuit),
      { rotulo: texto({}, "fiscal.pantalla.config_df_razon_social"), valor: v.razonSocial },
      {
        rotulo: texto({}, "fiscal.pantalla.config_df_condicion_iva"),
        // Una condición que la lista no conoce se muestra como llegó: nunca se inventa un texto.
        valor: condiciones.find((c) => c.valor === v.condicionIva)?.etiqueta ?? v.condicionIva,
      },
      {
        rotulo: texto({}, "fiscal.pantalla.config_df_domicilio_fiscal"),
        valor: domicilioEnUnaLinea(v.domicilio),
      },
      {
        rotulo: texto({}, "fiscal.pantalla.config_df_inicio_actividades"),
        valor: formatearFecha(v.inicioActividades),
      },
    ],
    rigeDesde: texto({}, "fiscal.pantalla.config_df_rige_desde", {
      fecha: formatearFecha(rigeDesdeEnArgentina),
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// El formulario
// ---------------------------------------------------------------------------------------------------------------

/** Lo que la persona escribe, tal cual (todo texto: el servidor decide qué es válido). */
export type ValoresDeDatosFiscales = ValoresDelDomicilio &
  Readonly<{
    razonSocial: string;
    /** El valor de la condición (`RESPONSABLE_INSCRIPTO`), o vacío si no eligió. */
    condicionIva: string;
    /** `dd/mm/aaaa`, como se lee en pantalla. */
    inicioActividades: string;
  }>;

export type CampoDeDatosFiscales = keyof ValoresDeDatosFiscales;

const VALORES_EN_BLANCO: ValoresDeDatosFiscales = {
  razonSocial: "",
  condicionIva: "",
  inicioActividades: "",
  calle: "",
  numeroDeCalle: "",
  piso: "",
  departamento: "",
  localidad: "",
  provincia: "",
  codigoPostal: "",
};

const valoresDelDomicilio = (d: DomicilioDeDatosFiscales | null): ValoresDelDomicilio => ({
  calle: d?.calle ?? "",
  numeroDeCalle: d?.numero ?? "",
  piso: d?.piso ?? "",
  departamento: d?.departamento ?? "",
  localidad: d?.localidad ?? "",
  provincia: d?.provincia ?? "",
  codigoPostal: d?.codigoPostal ?? "",
});

/** Los valores con los que abre el formulario: los del borrador (D-62: ya precargado con lo vigente), o en blanco si no hay. */
export function valoresDelBorrador(b: BorradorDeDatosFiscales | null): ValoresDeDatosFiscales {
  if (b === null) return VALORES_EN_BLANCO;
  return {
    razonSocial: b.razonSocial ?? "",
    condicionIva: b.condicionIva ?? "",
    inicioActividades: b.inicioActividades === null ? "" : formatearFecha(b.inicioActividades),
    ...valoresDelDomicilio(b.domicilio),
  };
}

/** Las claves de idempotencia del formulario: se generan UNA vez al abrirlo y viajan con el pedido. */
export type IdsDeDatosFiscales = Readonly<{ borradorId: string; domicilioId: string }>;

const FECHA_EN_PANTALLA = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/**
 * `dd/mm/aaaa` pasa a `aaaa-mm-dd`, solo con texto (sin `Date` ni zonas). Lo que no tiene esa forma viaja como está (recortado) y el
 * servidor lo rechaza marcando el campo; si el día existe en el calendario también lo decide el servidor (`fechaCivilValida`):
 * una regla, un lugar.
 */
export function aFechaCivil(escrita: string): string {
  const limpia = escrita.trim();
  const partes = FECHA_EN_PANTALLA.exec(limpia);
  return partes === null ? limpia : `${partes[3]}-${partes[2]}-${partes[1]}`;
}

const CAMPOS_DEL_DOMICILIO = [
  "calle",
  "numeroDeCalle",
  "piso",
  "departamento",
  "localidad",
  "provincia",
  "codigoPostal",
] as const satisfies readonly (keyof ValoresDelDomicilio)[];

const mismoDomicilio = (a: ValoresDelDomicilio, b: ValoresDelDomicilio): boolean =>
  CAMPOS_DEL_DOMICILIO.every((campo) => a[campo].trim() === b[campo].trim());

/**
 * El pedido de «Guardar borrador» (`guardarBorradorDeDatosFiscales`): el `borradorId` es el del borrador (o el que generó el
 * formulario si todavía no hay), y la versión es la última que vio la pantalla. Un dato en blanco no se manda salvo que antes tuviera
 * valor (así un borrador a medio llenar se guarda, y borrar un dato ya cargado lo rechaza el servidor marcándolo). El domicilio va
 * como NUEVO solo si cambió: si no, el borrador conserva el que tiene.
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
  const inicio = aFechaCivil(v.inicioActividades);
  const cambioElDomicilio =
    original === null || original.domicilio === null
      ? hayDomicilioCargado(v)
      : !mismoDomicilio(v, base);
  return {
    emisorId,
    borradorId: ids.borradorId,
    ...(version === null ? {} : { versionEsperada: version }),
    ...dato("razonSocial", v.razonSocial),
    ...dato("condicionIva", v.condicionIva),
    ...(inicio !== "" || base.inicioActividades !== "" ? { inicioActividades: inicio } : {}),
    ...(cambioElDomicilio ? { domicilio: domicilioNuevo(v, ids.domicilioId) } : {}),
  };
}

/**
 * El motivo que pide el caso de uso al confirmar (`confirmarDatosFiscales`: obligatorio). La pantalla aprobada no tiene un campo de
 * motivo, así que viaja este texto fijo. SUPUESTO del ingeniero, sin aprobar y sin fuente: se guarda en la versión confirmada, no se
 * muestra. Revertirlo es cambiar esta constante o agregar el campo a la pantalla (pregunta pendiente al dueño).
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
  confirmar: object | null;
}>;

/** Dónde se marca un error: un campo del formulario o ninguno (va como aviso arriba). */
export type LugarDelError = CampoDeDatosFiscales | null;

const CAMPO_DEL_SERVIDOR: Readonly<Record<string, CampoDeDatosFiscales>> = {
  razonSocial: "razonSocial",
  condicionIva: "condicionIva",
  inicioActividades: "inicioActividades",
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
