import type { Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  DATOS_DEL_COBRO,
  type EstadoDeSesion,
  type TipoDeCuenta,
  type TipoDeMedio,
} from "../estados";
import { filaVigente } from "./correccion";
import {
  datosEnFormaCompleta,
  type DatosDelCobro,
  type DatosDelCobroValidos,
} from "./datos-del-cobro";
import {
  claveDelCobro,
  huellaDelCobro,
  validarOrigen,
  type ReferenciaOpaca,
} from "./identidad-del-cobro";
import { importeConRegla, type ErrorDeImporte } from "./importes";
import {
  CUENTAS_ADMITIDAS,
  DATOS_ADMITIDOS_POR_MEDIO,
  cuentaDeCobroRequerida,
  type DatosQuePideElMedio,
} from "./medios";
import { exigirCajaAbiertaParaCobrar } from "./sesion";

/**
 * El puerto «cobrar» de caja (e3 §3.5), la parte pura: armar el cobro (clave, huella y entrada válida), decidir si la caja admite el
 * cobro, qué ofrecer en la pantalla de cobro y cuál es el medio vigente de un cobro. Sin reloj ni azar: la clave y la huella salen solo
 * del contenido, así que un reintento (doble clic, corte de red) da exactamente lo mismo.
 */

export type EntradaParaArmarCobro = Readonly<{
  origen: ReferenciaOpaca;
  origenOrden: number;
  cajaId: string;
  sucursalId: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  importe: Importe;
  datos: DatosDelCobro;
}>;

export type CobroArmado = Readonly<{
  /** `cobro_<origen.id>_<orden>`: la arma caja, no la manda quien llama. */
  clave: string;
  /** sha256 de la entrada canónica sin la clave. */
  huella: string;
  datos: DatosDelCobroValidos;
}>;

export type ErrorDeEntradaDeCobro =
  | ErrorDeImporte
  | "ORIGEN_INVALIDO"
  | "CAJA_NO_ENCONTRADA"
  | "MEDIO_NO_ENCONTRADO"
  | "CUENTA_DE_COBRO_NO_ENCONTRADA";

/**
 * Lo primero que hace el puerto (e3 §3.5, paso 1), sin tocar la base: el origen (`modulo.cosa`, id UUID, orden 1 a 50), el importe (ARS,
 * mayor que cero y dentro del tope: cero y negativo se rechazan SIEMPRE; la auditoría vio que `-100` habilitaba «Cobrar y emitir») y que
 * los identificadores tengan forma de UUID (si no, no pueden existir). Después arma la clave y la huella con los datos en su forma completa,
 * sin juzgarlos todavía: qué datos habilita el medio se sabe recién al leerlo, y la búsqueda por clave va ANTES.
 */
export function armarCobro(
  entrada: EntradaParaArmarCobro,
): Resultado<CobroArmado, ErrorDeEntradaDeCobro> {
  const origen = validarOrigen(entrada.origen, entrada.origenOrden);
  if (!origen.ok) return origen;
  // Los identificadores van en minúsculas, como los guarda la base: la clave `cobro_<id>_<orden>` es la identidad del efecto y el mismo
  // origen escrito con mayúsculas armaría otra clave para el mismo `(origen, orden)`.
  if (!esUuidCanonico(entrada.origen.id)) return err("ORIGEN_INVALIDO");
  if (entrada.importe.moneda !== ARS) return err("MONEDA_NO_SOPORTADA");
  const importe = importeConRegla(entrada.importe, "POSITIVO");
  if (!importe.ok) return importe;
  if (!esUuidCanonico(entrada.cajaId)) return err("CAJA_NO_ENCONTRADA");
  if (!esUuidCanonico(entrada.medioDePagoId)) return err("MEDIO_NO_ENCONTRADO");
  if (entrada.cuentaDeCobroId !== null && !esUuidCanonico(entrada.cuentaDeCobroId)) {
    return err("CUENTA_DE_COBRO_NO_ENCONTRADA");
  }
  const datos = datosEnFormaCompleta(entrada.datos);
  return ok({
    clave: claveDelCobro(entrada.origen, entrada.origenOrden),
    huella: huellaDelCobro({
      origen: entrada.origen,
      origenOrden: entrada.origenOrden,
      cajaId: entrada.cajaId,
      sucursalId: entrada.sucursalId,
      medioDePagoId: entrada.medioDePagoId,
      cuentaDeCobroId: entrada.cuentaDeCobroId,
      importe: entrada.importe,
      datos,
    }),
    datos,
  });
}

export type CajaParaCobrar = Readonly<{ sucursalId: string; activa: boolean }>;
export type SesionParaCobrar = Readonly<{ id: string; estado: EstadoDeSesion }>;

/**
 * La caja admite el cobro (e3 §3.5, paso 3, primera parte): existe, está activa y es de la sucursal pedida. Va antes de leer la sesión:
 * una caja que no sirve no toma ningún bloqueo.
 */
export function decidirCajaParaCobrar(
  entrada: Readonly<{ caja: CajaParaCobrar | null; sucursalPedida: string }>,
): Resultado<null, "CAJA_NO_ENCONTRADA" | "CAJA_INACTIVA" | "CAJA_DE_OTRA_SUCURSAL"> {
  const { caja } = entrada;
  if (caja === null) return err("CAJA_NO_ENCONTRADA");
  if (!caja.activa) return err("CAJA_INACTIVA");
  if (caja.sucursalId !== entrada.sucursalPedida) return err("CAJA_DE_OTRA_SUCURSAL");
  return ok(null);
}

export type ErrorDeSesionParaCobrar =
  | Readonly<{ codigo: "SIN_SESION_ABIERTA"; cajaId: string }>
  | Readonly<{ codigo: "CAJA_EN_CIERRE"; cajaId: string; sesionId: string }>;

/**
 * La sesión en la que entra el cobro (segunda parte): la sesión no cerrada de la caja tiene que estar `ABIERTA`. Sin sesión:
 * `SIN_SESION_ABIERTA` (la pantalla ofrece abrir la caja); con la sesión contando: `CAJA_EN_CIERRE` («abrí la caja» sería falso: está
 * abierta, contándose).
 */
export function decidirSesionParaCobrar(
  entrada: Readonly<{ cajaId: string; sesionVigente: SesionParaCobrar | null }>,
): Resultado<Readonly<{ sesionId: string }>, ErrorDeSesionParaCobrar> {
  const { cajaId, sesionVigente } = entrada;
  const abierta = exigirCajaAbiertaParaCobrar(sesionVigente?.estado ?? null);
  if (abierta.ok) return ok({ sesionId: (sesionVigente as SesionParaCobrar).id });
  return err(
    abierta.error === "CAJA_EN_CIERRE"
      ? { codigo: "CAJA_EN_CIERRE", cajaId, sesionId: (sesionVigente as SesionParaCobrar).id }
      : { codigo: "SIN_SESION_ABIERTA", cajaId },
  );
}

export type MedioParaOfrecer = Readonly<{
  id: string;
  tipo: TipoDeMedio;
  nombre: string | null;
  pide: DatosQuePideElMedio;
}>;
export type CuentaParaOfrecer = Readonly<{ id: string; tipo: TipoDeCuenta; nombre: string }>;

export type OpcionDeMedioParaCobrar = Readonly<{
  id: string;
  tipo: TipoDeMedio;
  nombre: string | null;
  cuentaObligatoria: boolean;
  /** Las cuentas que el medio admite (puede estar vacía: la cuenta es opcional, decisión 151; el efectivo no lleva). */
  cuentas: readonly CuentaParaOfrecer[];
  datosQuePide: DatosQuePideElMedio;
}>;

/**
 * Lo que ofrece la pantalla de cobro por un medio activo (e3 §3.5, §3.3 y §3.6): solo las cuentas de un tipo que el medio admite (el
 * efectivo, ninguna) y solo los datos que el tipo admite Y el medio pide (lo que la base no admitiría nunca se ofrece, aunque una fila
 * dijera otra cosa). `cuentaObligatoria` sale de `cuentaDeCobroRequerida`, hoy siempre `false`. Las cuentas llegan ya filtradas: activas
 * y de la sucursal de la caja.
 */
export function opcionDeMedioParaCobrar(
  medio: MedioParaOfrecer,
  cuentasDeLaSucursal: readonly CuentaParaOfrecer[],
): OpcionDeMedioParaCobrar {
  const admitidas = CUENTAS_ADMITIDAS[medio.tipo];
  const datosAdmitidos = DATOS_ADMITIDOS_POR_MEDIO[medio.tipo];
  return {
    id: medio.id,
    tipo: medio.tipo,
    nombre: medio.nombre,
    cuentaObligatoria: cuentaDeCobroRequerida(medio.tipo),
    cuentas: cuentasDeLaSucursal
      .filter((c) => admitidas.includes(c.tipo))
      .map((c) => ({ id: c.id, tipo: c.tipo, nombre: c.nombre })),
    datosQuePide: Object.fromEntries(
      DATOS_DEL_COBRO.map((dato) => [dato, medio.pide[dato] && datosAdmitidos.includes(dato)]),
    ) as DatosQuePideElMedio,
  };
}

export type CorreccionDeMedioVista = Readonly<{ secuencia: number; medioDespuesTipo: TipoDeMedio }>;

/**
 * El tipo del medio VIGENTE de un cobro (e3 §3.5 y §3.11): el destino de su última corrección de medio o, si no hubo, el original. Una
 * corrección mueve el cobro de medio en la conciliación del día; nunca cambia lo cobrado.
 */
export function medioVigenteTipo(
  medioTipo: TipoDeMedio,
  correcciones: readonly CorreccionDeMedioVista[],
): TipoDeMedio {
  return filaVigente(correcciones)?.medioDespuesTipo ?? medioTipo;
}
