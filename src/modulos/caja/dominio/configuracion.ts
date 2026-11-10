import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { explicacionDesdeTexto } from "../../cierre/publico";
import {
  DATOS_DEL_COBRO,
  TIPOS_DE_CUENTA,
  TIPOS_DE_MEDIO,
  type DatoDelCobro,
  type TipoDeCuenta,
  type TipoDeMedio,
} from "../estados";
import { validarDatosQuePide, type DatosQuePideElMedio } from "./medios";

/**
 * Configuración de caja (e3 §3.2): cajas, medios de pago y cuentas de cobro. Puro: sin reloj ni azar. Nada se borra: se desactiva, y
 * una desactivada conserva su nombre (no se puede crear otra igual: se la reactiva). Los topes de largo y la forma repiten los CHECK de
 * `0027_caja.sql` (`caja_nombre_ck`, `medio_de_pago_nombre_ck`, `cuenta_de_cobro_nombre_ck`, `cuenta_de_cobro_identificador_ck`):
 * `test/integracion/caja-configuracion-esquema.test.ts` los compara contra la base. Previene que el código y la base acepten nombres
 * distintos (un nombre que el TypeScript deja pasar y la base rechaza sale como un error genérico de persistencia).
 */

export type Caja = Readonly<{
  id: string;
  sucursalId: SucursalId;
  nombre: string;
  activa: boolean;
  version: number;
}>;

export type MedioDePago = Readonly<{
  id: string;
  tipo: TipoDeMedio;
  /** `null`: la pantalla usa el vocabulario del tipo. */
  nombre: string | null;
  activo: boolean;
  /** Qué datos opcionales pide al cobrar (decisión 129); un medio nuevo nace sin ninguno. */
  pide: DatosQuePideElMedio;
  version: number;
}>;

export type CuentaDeCobro = Readonly<{
  id: string;
  tipo: TipoDeCuenta;
  nombre: string;
  identificadorExterno: string | null;
  sucursalId: SucursalId;
  activa: boolean;
  version: number;
}>;

/** Largos máximos en caracteres (cada uno repite su CHECK de la base: ver arriba). */
export const LARGO_MAXIMO_DEL_NOMBRE_DE_CAJA = 100;
export const LARGO_MAXIMO_DEL_NOMBRE_DE_MEDIO = 60;
export const LARGO_MAXIMO_DEL_NOMBRE_DE_CUENTA = 60;
// fuente-unica: ajeno — el 40 es el de `cuenta_de_cobro_identificador_ck`, no el del teléfono (`LARGO_MAXIMO_DEL_TELEFONO`): otro dato
export const LARGO_MAXIMO_DEL_IDENTIFICADOR_EXTERNO = 40;

/**
 * El nombre de la caja que nace sola con la sucursal (decisión 165; e3 §3.2.1): una sola constante para el gancho de `crearSucursal` y
 * para el disparador `asegurarCajaPorDefecto`. Previene que los dos caminos la nombren distinto y la sucursal termine con dos cajas.
 * Chequeo: `configuracion.test.ts` (es un nombre válido) y `caja-por-defecto.test.ts` (los dos caminos dejan «Caja 1»).
 */
export const NOMBRE_DE_LA_CAJA_POR_DEFECTO = "Caja 1";

export type ErrorDeNombreDeCaja = "NOMBRE_DE_CAJA_INVALIDO";
export type ErrorDeNombreDeMedio = "NOMBRE_DE_MEDIO_INVALIDO";
export type ErrorDeNombreDeCuenta = "NOMBRE_DE_CUENTA_INVALIDO";
export type ErrorDeIdentificadorExterno = "IDENTIFICADOR_EXTERNO_INVALIDO";

/**
 * Un nombre obligatorio de hasta `maximo` caracteres: la lista de permitidos de la explicación del cierre (una regla, un lugar; C7 de
 * 0027), que recorta los extremos, compone en NFC y junta los espacios repetidos. Vacío o solo blancos no es un nombre.
 */
function nombreObligatorio<C extends string>(
  texto: string,
  maximo: number,
  codigo: C,
): Resultado<string, C> {
  const explicacion = explicacionDesdeTexto(texto);
  if (!explicacion.ok || explicacion.valor === null || explicacion.valor.length > maximo) {
    return err(codigo);
  }
  return ok(explicacion.valor);
}

export function nombreDeCajaValido(texto: string): Resultado<string, ErrorDeNombreDeCaja> {
  return nombreObligatorio(texto, LARGO_MAXIMO_DEL_NOMBRE_DE_CAJA, "NOMBRE_DE_CAJA_INVALIDO");
}

export function nombreDeCuentaValido(texto: string): Resultado<string, ErrorDeNombreDeCuenta> {
  return nombreObligatorio(texto, LARGO_MAXIMO_DEL_NOMBRE_DE_CUENTA, "NOMBRE_DE_CUENTA_INVALIDO");
}

/** El nombre de un medio es opcional: `null` = sin nombre propio. Un texto en blanco NO es «sin nombre»: es inválido. */
export function nombreDeMedioValido(
  texto: string | null,
): Resultado<string | null, ErrorDeNombreDeMedio> {
  if (texto === null) return ok(null);
  return nombreObligatorio(texto, LARGO_MAXIMO_DEL_NOMBRE_DE_MEDIO, "NOMBRE_DE_MEDIO_INVALIDO");
}

const FORMA_DEL_IDENTIFICADOR = new RegExp(
  `^[A-Za-z0-9 ._/-]{1,${LARGO_MAXIMO_DEL_IDENTIFICADOR_EXTERNO}}$`,
);

/** El número de terminal o el alias de la cuenta (opcional; nunca una credencial). Se recortan los extremos; en blanco es inválido. */
export function identificadorExternoValido(
  texto: string | null,
): Resultado<string | null, ErrorDeIdentificadorExterno> {
  if (texto === null) return ok(null);
  const recortado = texto.trim();
  return FORMA_DEL_IDENTIFICADOR.test(recortado)
    ? ok(recortado)
    : err("IDENTIFICADOR_EXTERNO_INVALIDO");
}

export function tipoDeMedioValido(texto: string): Resultado<TipoDeMedio, "TIPO_DE_MEDIO_INVALIDO"> {
  const tipo = TIPOS_DE_MEDIO.find((candidato) => candidato === texto);
  return tipo === undefined ? err("TIPO_DE_MEDIO_INVALIDO") : ok(tipo);
}

export function tipoDeCuentaValido(
  texto: string,
): Resultado<TipoDeCuenta, "TIPO_DE_CUENTA_INVALIDO"> {
  const tipo = TIPOS_DE_CUENTA.find((candidato) => candidato === texto);
  return tipo === undefined ? err("TIPO_DE_CUENTA_INVALIDO") : ok(tipo);
}

export type DecisionDeAlta = "CREAR" | "YA_EXISTIA";

/**
 * Crear una caja cuyo nombre (sin distinguir mayúsculas, en esa sucursal) puede ya existir: activa, el alta ya estaba hecha (doble clic o
 * reintento); desactivada, hay que reactivarla, no crear otra con su nombre.
 */
export function decidirAltaDeCaja(
  existente: Pick<Caja, "activa"> | null,
): Resultado<DecisionDeAlta, "CAJA_INACTIVA_CON_ESE_NOMBRE"> {
  if (existente === null) return ok("CREAR");
  return existente.activa ? ok("YA_EXISTIA") : err("CAJA_INACTIVA_CON_ESE_NOMBRE");
}

export type ErrorDeAltaDeMedio =
  "MEDIO_DUPLICADO" | "MEDIO_INACTIVO_CON_ESE_NOMBRE" | "EFECTIVO_YA_EXISTE";

/**
 * Crear un medio. `conEseNombre` es el que ya usa ese nombre (sin distinguir mayúsculas) o, si el pedido no trae nombre, el que no tiene
 * nombre de ese tipo; `efectivo` es el efectivo de la empresa si ya existe. Hay un solo efectivo por empresa (`EFECTIVO_YA_EXISTE`),
 * salvo que el pedido sea el mismo que ya está hecho (mismo nombre: doble clic o reintento). Un nombre que usa un medio de OTRO tipo es
 * `MEDIO_DUPLICADO`; el de uno desactivado, `MEDIO_INACTIVO_CON_ESE_NOMBRE` (se lo reactiva).
 */
export function decidirAltaDeMedio(
  pedido: Readonly<{ tipo: TipoDeMedio; nombre: string | null }>,
  existentes: Readonly<{ conEseNombre: MedioDePago | null; efectivo: MedioDePago | null }>,
): Resultado<DecisionDeAlta, ErrorDeAltaDeMedio> {
  const { conEseNombre, efectivo } = existentes;
  if (pedido.tipo === "EFECTIVO" && efectivo !== null) {
    return efectivo.nombre === pedido.nombre ? ok("YA_EXISTIA") : err("EFECTIVO_YA_EXISTE");
  }
  if (conEseNombre === null) return ok("CREAR");
  if (conEseNombre.tipo !== pedido.tipo) return err("MEDIO_DUPLICADO");
  return conEseNombre.activo ? ok("YA_EXISTIA") : err("MEDIO_INACTIVO_CON_ESE_NOMBRE");
}

export type PedidoDeCuenta = Readonly<{
  tipo: TipoDeCuenta;
  identificadorExterno: string | null;
  sucursalId: SucursalId;
}>;

/**
 * Crear una cuenta de cobro cuyo nombre (sin distinguir mayúsculas, en toda la empresa) puede ya existir: si es la misma cuenta y está
 * activa, el alta ya estaba hecha; cualquier otra cosa con ese nombre (otra cuenta, o la misma desactivada) es `CUENTA_DUPLICADA`.
 */
export function decidirAltaDeCuenta(
  pedido: PedidoDeCuenta,
  existente: CuentaDeCobro | null,
): Resultado<DecisionDeAlta, "CUENTA_DUPLICADA"> {
  if (existente === null) return ok("CREAR");
  const esLaMisma =
    existente.activa &&
    existente.tipo === pedido.tipo &&
    existente.identificadorExterno === pedido.identificadorExterno &&
    existente.sucursalId === pedido.sucursalId;
  return esLaMisma ? ok("YA_EXISTIA") : err("CUENTA_DUPLICADA");
}

export type DecisionDeEdicion = "SIN_CAMBIOS" | "EDITAR";

/**
 * Editar con control de versión. Si lo pedido ya es lo que hay no hay nada que hacer, aunque la versión sea otra: repetir una edición que
 * ya se aplicó (un corte de conexión) da el mismo resultado y no un conflicto. Si no, la versión esperada tiene que ser la vigente.
 */
function decidirConVersion(
  igual: boolean,
  versionVigente: number,
  versionEsperada: number,
): Resultado<DecisionDeEdicion, "VERSION_DESACTUALIZADA"> {
  if (igual) return ok("SIN_CAMBIOS");
  return versionVigente === versionEsperada ? ok("EDITAR") : err("VERSION_DESACTUALIZADA");
}

export function decidirEdicionDeCaja(
  caja: Caja | null,
  versionEsperada: number,
  nombre: string,
): Resultado<DecisionDeEdicion, "CAJA_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA"> {
  if (caja === null) return err("CAJA_NO_ENCONTRADA");
  return decidirConVersion(caja.nombre === nombre, caja.version, versionEsperada);
}

export type CambiosDeMedio = Readonly<{ nombre: string | null; pide: DatosQuePideElMedio }>;

export type ErrorDeEdicionDeMedio =
  | "MEDIO_NO_ENCONTRADO"
  | "VERSION_DESACTUALIZADA"
  | Readonly<{ codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO"; dato: DatoDelCobro }>;

/**
 * Editar el nombre y los datos que pide un medio. Habilitar un dato que el tipo no admite se rechaza aunque no haya otro cambio (el
 * CHECK `medio_de_pago_datos_ck` de la base es la defensa final).
 */
export function decidirEdicionDeMedio(
  medio: MedioDePago | null,
  versionEsperada: number,
  cambios: CambiosDeMedio,
): Resultado<DecisionDeEdicion, ErrorDeEdicionDeMedio> {
  if (medio === null) return err("MEDIO_NO_ENCONTRADO");
  const admitido = validarDatosQuePide(medio.tipo, cambios.pide);
  if (!admitido.ok) return admitido;
  const igual =
    medio.nombre === cambios.nombre &&
    DATOS_DEL_COBRO.every((d) => medio.pide[d] === cambios.pide[d]);
  return decidirConVersion(igual, medio.version, versionEsperada);
}

export type CambiosDeCuenta = Readonly<{
  nombre: string;
  identificadorExterno: string | null;
  sucursalId: SucursalId;
}>;

/** Editar una cuenta: el tipo no cambia nunca (lo impide la base), por eso no está entre los cambios. */
export function decidirEdicionDeCuenta(
  cuenta: CuentaDeCobro | null,
  versionEsperada: number,
  cambios: CambiosDeCuenta,
): Resultado<DecisionDeEdicion, "CUENTA_DE_COBRO_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA"> {
  if (cuenta === null) return err("CUENTA_DE_COBRO_NO_ENCONTRADA");
  const igual =
    cuenta.nombre === cambios.nombre &&
    cuenta.identificadorExterno === cambios.identificadorExterno &&
    cuenta.sucursalId === cambios.sucursalId;
  return decidirConVersion(igual, cuenta.version, versionEsperada);
}

export type DecisionDeCambioDeEstado = "YA_ESTABA" | "CAMBIAR";

/** Desactivar o reactivar es idempotente por estado: si ya está como se pide, no se escribe ni se audita. */
export function decidirCambioDeEstado(
  estaActivo: boolean,
  seQuiereActivo: boolean,
): DecisionDeCambioDeEstado {
  return estaActivo === seQuiereActivo ? "YA_ESTABA" : "CAMBIAR";
}

/** El efectivo no se desactiva nunca (decisión 124; `medio_de_pago_efectivo_activo_ck`): siempre se puede cobrar en efectivo. */
export function decidirDesactivacionDeMedio(
  medio: MedioDePago,
): Resultado<DecisionDeCambioDeEstado, "EFECTIVO_NO_SE_DESACTIVA"> {
  if (medio.tipo === "EFECTIVO") return err("EFECTIVO_NO_SE_DESACTIVA");
  return ok(decidirCambioDeEstado(medio.activo, false));
}
