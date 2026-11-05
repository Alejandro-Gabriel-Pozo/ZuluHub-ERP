import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { PROVINCIAS } from "../../../../../src/primitivas/domicilio/provincias";
import type { TonoDeEstado } from "../../componentes/Insignia";
import { formatearPuntoDeVenta } from "../facturacion/formato-fiscal";
import { rutaDeUnPuntoDeVenta } from "./lista-de-lo-que-falta";

/**
 * El modelo de vista de Puntos de venta (D-43, D-48, D-63): de lo que entrega `puntosDeVentaDelEmisor`, lo que se ve en la lista y en
 * la pantalla de cada punto de venta. Puro: sin React ni servidor. Los textos salen del catálogo.
 */

/** Un domicilio guardado, como lo entrega la consulta (el del punto de venta y el de Datos fiscales: una forma, un lugar). */
export type DomicilioGuardado = Readonly<{
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

/** Un punto de venta como lo entrega la consulta (la misma forma, sin importar la composición). */
export type PuntoParaConfigurar = Readonly<{
  id: string;
  numero: number;
  activo: boolean;
  ambiente: "HOMOLOGACION" | "PRODUCCION";
  sucursal: Readonly<{ id: string; nombre: string; activa: boolean }>;
  tieneDomicilio: boolean;
  domicilio: DomicilioGuardado | null;
  hayNumerosUsados: boolean;
  version: number;
}>;

/**
 * Lo que el servidor deja hacer HOY con una acción de Puntos de venta, para la pantalla: si el botón va activo o apagado y, apagado,
 * el motivo ya escrito (del catálogo `motivo.*`). Solo una ayuda: el guard del servidor vuelve a decidir al enviar. Lo arma
 * `servidor/modulos.ts` con `permisosDelActor`. Previene: que la persona abra una ventana, confirme y recién ahí reciba el rechazo
 * del módulo (no activo en la empresa o sin permiso). Chequeo: `test/web/configuracion-fiscal-acciones.test.ts`.
 */
export type OfertaDeAccion = Readonly<{ permitida: boolean; motivo: string | null }>;

export type AccionesDePuntosDeVenta = Readonly<{
  agregar: OfertaDeAccion;
  editar: OfertaDeAccion;
  activar: OfertaDeAccion;
  desactivar: OfertaDeAccion;
  pasarAProduccion: OfertaDeAccion;
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

/**
 * La sucursal de un punto de venta; una cerrada se dice como en el Listado: «{nombre} · Cerrada» (D-37, `listado_sucursal_cerrada`).
 * SUPUESTO del ingeniero: reutilizar ese texto acá. Fuente: cuestionario A (21:08Z), pregunta 4 (solo se crea en sucursales
 * abiertas); no se le preguntó al dueño cómo se dice una sucursal cerrada en Puntos de venta. Una regla, un lugar.
 */
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

/**
 * Las acciones del detalle de UN punto de venta: las del actor (`accionesDePuntosDeVenta`) más lo que depende de este punto. D-80
 * (`facturador-contratos-de-pantalla.md`, confirmada por el dueño el 2026-10-29): uno no activo cuya sucursal está cerrada no se
 * puede activar, y «Activar» sale apagado con «Sucursal cerrada.» (el texto que ya existe, `error.fiscal_sucursal_cerrada`: una
 * regla, un lugar). Desactivar nunca se bloquea por esto. Si el actor ya no puede activar, queda su motivo (permiso o módulo).
 * Solo una ayuda: el servidor vuelve a validarlo. Previene: tocar «Activar» y recién ahí recibir el rechazo. Chequeo:
 * `test/web/configuracion-fiscal-puntos-de-venta-modelo.test.ts`.
 */
export function accionesDelPuntoDeVenta(
  acciones: AccionesDePuntosDeVenta,
  p: PuntoParaConfigurar,
): AccionesDePuntosDeVenta {
  if (p.activo || p.sucursal.activa || !acciones.activar.permitida) return acciones;
  return {
    ...acciones,
    activar: { permitida: false, motivo: texto({}, "error.fiscal_sucursal_cerrada") },
  };
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

/** Los campos del formulario con un domicilio guardado; en blanco si no hay. */
export const valoresDelDomicilio = (d: DomicilioGuardado | null): ValoresDelDomicilio => ({
  calle: d?.calle ?? "",
  numeroDeCalle: d?.numero ?? "",
  piso: d?.piso ?? "",
  departamento: d?.departamento ?? "",
  localidad: d?.localidad ?? "",
  provincia: d?.provincia ?? "",
  codigoPostal: d?.codigoPostal ?? "",
});

/** Los valores con los que abre la edición: el número, la sucursal y el domicilio actual del punto de venta (en blanco si no tiene). */
export function valoresParaEditar(p: PuntoParaConfigurar): ValoresDelFormulario {
  return {
    ...VALORES_EN_BLANCO,
    numero: formatearPuntoDeVenta(p.numero),
    sucursalId: p.sucursal.id,
    ...valoresDelDomicilio(p.domicilio),
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

/** Solo los campos del domicilio: así lo reutiliza el formulario de Datos fiscales (una regla, un lugar). */
export type ValoresDelDomicilio = Pick<ValoresDelFormulario, (typeof CAMPOS_DEL_DOMICILIO)[number]>;

/** La persona cargó algo del domicilio. Ninguno: no se manda domicilio (se puede crear o editar un punto de venta sin él; no se activa). */
export const hayDomicilioCargado = (v: ValoresDelDomicilio): boolean =>
  CAMPOS_DEL_DOMICILIO.some((campo) => sinVacios(v[campo]) !== "");

const mismoDomicilio = (a: ValoresDelDomicilio, b: ValoresDelDomicilio): boolean =>
  CAMPOS_DEL_DOMICILIO.every((campo) => sinVacios(a[campo]) === sinVacios(b[campo]));

/**
 * El domicilio viaja como NUEVO solo si la persona lo cambió respecto del guardado; si no, se conserva el que tiene. Un domicilio no se
 * edita (la tabla es de solo inserción: el mismo id con otro contenido es `ID_EN_USO`): uno corregido es otro, con un id que no se usó.
 * También lo usa Datos fiscales (una regla, un lugar). Chequeo: `test/web/configuracion-fiscal-puntos-de-venta-modelo.test.ts`.
 */
export const cambioElDomicilio = (
  v: ValoresDelDomicilio,
  guardado: DomicilioGuardado | null,
): boolean =>
  guardado === null ? hayDomicilioCargado(v) : !mismoDomicilio(v, valoresDelDomicilio(guardado));

/** El domicilio nuevo que viaja en el pedido, con su clave de idempotencia (también el de Datos fiscales). */
export function domicilioNuevo(v: ValoresDelDomicilio, id: string) {
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
 * El número igual al de antes no se manda (uno que ya emitió no se puede cambiar: no hay por qué tocarlo). El domicilio, si
 * cambió (`cambioElDomicilio`), es uno NUEVO que reemplaza al anterior; si no, no se reenvía.
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
    ...(cambioElDomicilio(v, original.domicilio)
      ? { domicilio: domicilioNuevo(v, ids.domicilioId) }
      : {}),
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
