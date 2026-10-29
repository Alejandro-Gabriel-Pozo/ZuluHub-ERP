import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { PROVINCIAS } from "../../../../../src/primitivas/domicilio/provincias";
import type { TonoDeEstado } from "../../componentes/Insignia";
import { formatearPuntoDeVenta } from "../facturacion/formato-fiscal";
import { rutaDeUnPuntoDeVenta } from "./lista-de-lo-que-falta";

/**
 * El modelo de vista de Puntos de venta (D-43, D-48, D-63): de lo que entrega `puntosDeVentaDelEmisor`, lo que se ve en la lista y en
 * la pantalla de cada punto de venta. Puro: sin React ni servidor. Los textos salen del catálogo.
 */

/** Un punto de venta como lo entrega la consulta (la misma forma, sin importar la composición). */
export type PuntoParaConfigurar = Readonly<{
  id: string;
  numero: number;
  activo: boolean;
  ambiente: "HOMOLOGACION" | "PRODUCCION";
  sucursal: Readonly<{ id: string; nombre: string; activa: boolean }>;
  tieneDomicilio: boolean;
  hayNumerosUsados: boolean;
  version: number;
}>;

/** Una marca del punto de venta: su rótulo visible («Estado», «Ambiente»), su valor y el tono. */
type Marca = Readonly<{ rotulo: string; texto: string; tono: TonoDeEstado | "neutro" }>;

const marcaDeActivo = (activo: boolean): Marca => {
  // El rótulo «Estado» ya existe en el Listado: una regla, un lugar.
  const rotulo = texto({}, "fiscal.pantalla.listado_rotulo_estado");
  return activo
    ? { rotulo, texto: texto({}, "fiscal.pantalla.config_pv_activo"), tono: "exito" }
    : { rotulo, texto: texto({}, "fiscal.pantalla.config_pv_no_activo"), tono: "neutro" };
};

/**
 * El aviso de pruebas, solo para un punto de venta en homologación: sin él, una factura de pruebas se confunde con una real.
 * Chequeo: `test/web/configuracion-fiscal-puntos-de-venta-modelo.test.ts` (aparece solo en pruebas).
 */
const avisoDePruebas = (ambiente: PuntoParaConfigurar["ambiente"]): string | null =>
  ambiente === "HOMOLOGACION" ? texto({}, "fiscal.pantalla.config_pv_aviso_pruebas") : null;

const marcaDeAmbiente = (ambiente: PuntoParaConfigurar["ambiente"]): Marca => ({
  rotulo: texto({}, "fiscal.pantalla.config_pv_rotulo_ambiente"),
  texto: texto(
    {},
    ambiente === "PRODUCCION"
      ? "fiscal.pantalla.config_pv_produccion"
      : "fiscal.pantalla.config_pv_pruebas",
  ),
  tono: "neutro",
});

/** La sucursal de un punto de venta; una cerrada se dice como en el Listado (D-37). */
const sucursalParaMostrar = (s: PuntoParaConfigurar["sucursal"]): string =>
  s.activa ? s.nombre : texto({}, "fiscal.pantalla.listado_sucursal_cerrada", { nombre: s.nombre });

export type FilaDePuntoDeVenta = Readonly<{
  id: string;
  href: string;
  /** El número en cinco dígitos («00001»). */
  numero: string;
  sucursal: string;
  activo: Marca;
  ambiente: Marca;
  /** «Las facturas de pruebas no tienen valor fiscal.», solo en ambiente de pruebas; `null` en producción. */
  avisoDePruebas: string | null;
}>;

/** La lista: todos los del emisor, activos o no (D-60), en el orden en que llegan (de menor a mayor número). */
export function armarLaListaDePuntosDeVenta(
  items: readonly PuntoParaConfigurar[],
): readonly FilaDePuntoDeVenta[] {
  return items.map((p) => ({
    id: p.id,
    href: rutaDeUnPuntoDeVenta(p.id),
    numero: formatearPuntoDeVenta(p.numero),
    sucursal: sucursalParaMostrar(p.sucursal),
    activo: marcaDeActivo(p.activo),
    ambiente: marcaDeAmbiente(p.ambiente),
    avisoDePruebas: avisoDePruebas(p.ambiente),
  }));
}

export type PuntoDeVentaArmado = Readonly<{
  titulo: string;
  sucursal: string;
  activo: Marca;
  ambiente: Marca;
  avisoDePruebas: string | null;
  /** `true` si todavía está en pruebas: solo ahí se ofrece «Pasar a producción» (D-48: de producción no se vuelve). */
  puedePasarAProduccion: boolean;
}>;

export function armarElPuntoDeVenta(p: PuntoParaConfigurar): PuntoDeVentaArmado {
  return {
    titulo: tituloDelPuntoDeVenta(p.numero),
    sucursal: sucursalParaMostrar(p.sucursal),
    activo: marcaDeActivo(p.activo),
    ambiente: marcaDeAmbiente(p.ambiente),
    avisoDePruebas: avisoDePruebas(p.ambiente),
    puedePasarAProduccion: p.ambiente === "HOMOLOGACION",
  };
}

export const tituloDelPuntoDeVenta = (numero: number): string =>
  texto({}, "fiscal.pantalla.config_pv_titulo_con_numero", {
    numero: formatearPuntoDeVenta(numero),
  });

// ---------------------------------------------------------------------------------------------------------------
// El formulario de alta y de edición
// ---------------------------------------------------------------------------------------------------------------

/** Lo que la persona escribe, tal cual (todo texto: el servidor decide qué es válido). */
export type ValoresDelFormulario = Readonly<{
  numero: string;
  sucursalId: string;
  calle: string;
  numeroDeCalle: string;
  piso: string;
  departamento: string;
  localidad: string;
  /** El código ISO de la provincia (`AR-B`), o vacío si no eligió. */
  provincia: string;
  codigoPostal: string;
}>;

export type CampoDelFormulario = keyof ValoresDelFormulario;

export const VALORES_EN_BLANCO: ValoresDelFormulario = {
  numero: "",
  sucursalId: "",
  calle: "",
  numeroDeCalle: "",
  piso: "",
  departamento: "",
  localidad: "",
  provincia: "",
  codigoPostal: "",
};

/** Las provincias para elegir: se muestra el nombre y se manda el código (24 jurisdicciones, por nombre). */
export const OPCIONES_DE_PROVINCIA: readonly Readonly<{ valor: string; etiqueta: string }>[] =
  PROVINCIAS.map((p) => ({ valor: p.codigo, etiqueta: p.nombre }));

/**
 * Los valores con los que abre la edición. El domicilio queda en blanco: ninguna consulta entrega todavía el domicilio de un punto
 * de venta (solo si lo tiene), así que no se puede precargar. Ver «Huecos del servidor» en el informe.
 */
export function valoresParaEditar(p: PuntoParaConfigurar): ValoresDelFormulario {
  return {
    ...VALORES_EN_BLANCO,
    numero: formatearPuntoDeVenta(p.numero),
    sucursalId: p.sucursal.id,
  };
}

/** Las claves de idempotencia del formulario: se generan UNA vez al abrirlo y viajan con el pedido. */
export type IdsDelFormulario = Readonly<{ puntoDeVentaId: string; domicilioId: string }>;

const sinVacios = (t: string): string => t.trim();
const opcional = (t: string): string | null => (sinVacios(t) === "" ? null : sinVacios(t));
const sinCeros = (t: string): string => sinVacios(t).replace(/^0+(?=\d)/, "");

const CAMPOS_DEL_DOMICILIO = [
  "calle",
  "numeroDeCalle",
  "piso",
  "departamento",
  "localidad",
  "provincia",
  "codigoPostal",
] as const satisfies readonly CampoDelFormulario[];

/** La persona cargó algo del domicilio. Ninguno: no se manda domicilio (se puede crear o editar un punto de venta sin él; no se activa). */
export const hayDomicilioCargado = (v: ValoresDelFormulario): boolean =>
  CAMPOS_DEL_DOMICILIO.some((campo) => sinVacios(v[campo]) !== "");

function domicilioNuevo(v: ValoresDelFormulario, id: string) {
  return {
    tipo: "NUEVO",
    id,
    calle: sinVacios(v.calle),
    numero: sinVacios(v.numeroDeCalle),
    piso: opcional(v.piso),
    departamento: opcional(v.departamento),
    localidad: sinVacios(v.localidad),
    // El código ISO de la lista; un texto vacío lo rechaza el servidor con su campo.
    provincia: sinVacios(v.provincia),
    codigoPostal: opcional(v.codigoPostal),
  } as const;
}

/**
 * El pedido de alta (`crearPuntoDeVenta`): el `id` del punto de venta y el del domicilio son los del formulario (la clave de
 * idempotencia: reenviar lo mismo no crea otro). El número va como texto de dígitos, tal cual se escribió: si no es un número,
 * lo rechaza el servidor marcando el campo `numero`. El emisor viaja en el pedido y el servidor lo valida contra la empresa.
 */
export function armarElPedidoDeAlta(
  v: ValoresDelFormulario,
  ids: IdsDelFormulario,
  emisorId: string,
) {
  return {
    id: ids.puntoDeVentaId,
    emisorId,
    sucursalId: v.sucursalId,
    numero: sinVacios(v.numero),
    ...(hayDomicilioCargado(v) ? { domicilio: domicilioNuevo(v, ids.domicilioId) } : {}),
  };
}

/**
 * El pedido de edición (`editarPuntoDeVenta`): solo lo que cambió, con la versión que vio la pantalla (control de versión optimista).
 * El número igual al de antes no se manda (uno que ya emitió no se puede cambiar: no hay por qué tocarlo). El domicilio, si se
 * escribió algo, es uno NUEVO que reemplaza al anterior.
 */
export function armarElPedidoDeEdicion(
  v: ValoresDelFormulario,
  ids: IdsDelFormulario,
  original: PuntoParaConfigurar,
) {
  return {
    puntoDeVentaId: original.id,
    versionEsperada: original.version,
    ...(sinCeros(v.numero) === String(original.numero) ? {} : { numero: sinVacios(v.numero) }),
    ...(v.sucursalId === original.sucursal.id ? {} : { sucursalId: v.sucursalId }),
    ...(hayDomicilioCargado(v) ? { domicilio: domicilioNuevo(v, ids.domicilioId) } : {}),
  };
}

/** Dónde se marca un error: un campo del formulario, el bloque del domicilio entero, o ninguno (va como aviso). */
export type LugarDelError = CampoDelFormulario | "domicilio" | null;

const CAMPO_DEL_SERVIDOR: Readonly<Record<string, LugarDelError>> = {
  numero: "numero",
  sucursalId: "sucursalId",
  "domicilio.calle": "calle",
  "domicilio.numero": "numeroDeCalle",
  "domicilio.piso": "piso",
  "domicilio.departamento": "departamento",
  "domicilio.localidad": "localidad",
  "domicilio.provincia": "provincia",
  "domicilio.codigoPostal": "codigoPostal",
  domicilio: "domicilio",
};

/** El nombre de campo que usa el servidor (`campo` del error) → dónde lo marca el formulario. Uno que no conoce: `null`. */
export const lugarDelError = (campo: string | undefined): LugarDelError =>
  campo !== undefined && Object.hasOwn(CAMPO_DEL_SERVIDOR, campo)
    ? (CAMPO_DEL_SERVIDOR[campo] ?? null)
    : null;
