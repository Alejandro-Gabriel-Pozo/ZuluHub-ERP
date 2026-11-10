import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  DATOS_DEL_COBRO,
  type DatoDelCobro,
  type TipoDeCuenta,
  type TipoDeMedio,
} from "../estados";

/**
 * Medios de pago y cuentas de cobro (e3 §3.3 y §3.6; decisiones 129 y 151). Puro: sin reloj ni azar.
 */

/** Un par (medio, cuenta de cobro): `cuentaDeCobroId = null` es «sin cuenta» (decisión 151). La unidad de arqueo y de conciliación. */
export type ParDeCobro = Readonly<{ medioDePagoId: string; cuentaDeCobroId: string | null }>;

/**
 * Qué tipos de cuenta admite cada tipo de medio. El efectivo no admite ninguna. La misma tabla que `cuenta_admitida_por_medio` de la
 * base (0027): una prueba de integración compara las dos. Previene que un cobro con una cuenta que el medio no admite pase en un lado
 * y no en el otro.
 */
export const CUENTAS_ADMITIDAS: Readonly<Record<TipoDeMedio, readonly TipoDeCuenta[]>> = {
  EFECTIVO: [],
  TARJETA_DEBITO: ["TERMINAL"],
  TARJETA_CREDITO: ["TERMINAL"],
  QR: ["QR", "TERMINAL"],
  TRANSFERENCIA: ["CUENTA_BANCARIA"],
  OTRO: ["TERMINAL", "QR", "CUENTA_BANCARIA"],
};

export function cuentaAdmitidaPorMedio(
  tipoDeMedio: TipoDeMedio,
  tipoDeCuenta: TipoDeCuenta,
): boolean {
  return CUENTAS_ADMITIDAS[tipoDeMedio].includes(tipoDeCuenta);
}

/** ¿Hay que elegir una cuenta de cobro para cada tipo de medio? Hoy ninguno (decisión 151). */
const CUENTA_DE_COBRO_REQUERIDA: Readonly<Record<TipoDeMedio, boolean>> = {
  EFECTIVO: false,
  TARJETA_DEBITO: false,
  TARJETA_CREDITO: false,
  TRANSFERENCIA: false,
  QR: false,
  OTRO: false,
};

/**
 * ¿Hay que elegir una cuenta de cobro para este tipo de medio? Hoy nunca (decisión 151: con un solo CUIT la cuenta es opcional y el
 * arqueo agrupa los cobros «sin cuenta»). Es LA función que cambia si más adelante hay varios CUIT: volver a exigirla es cambiar
 * la tabla de arriba y sus pruebas, sin migración (la base no la replica con un CHECK). `opcionesDeCobro` la devuelve como
 * `cuentaObligatoria`.
 */
export function cuentaDeCobroRequerida(tipoDeMedio: TipoDeMedio): boolean {
  return CUENTA_DE_COBRO_REQUERIDA[tipoDeMedio];
}

export type MedioVisto = Readonly<{ tipo: TipoDeMedio; activo: boolean }>;
export type CuentaVista = Readonly<{
  tipo: TipoDeCuenta;
  activa: boolean;
  sucursalId: string;
}>;

export type ErrorDeParDeCobro =
  | "MEDIO_NO_ENCONTRADO"
  | "MEDIO_INACTIVO"
  | "CUENTA_DE_COBRO_NO_ADMITIDA"
  | "CUENTA_DE_COBRO_NO_ENCONTRADA"
  | "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL"
  | "CUENTA_DE_COBRO_INACTIVA"
  | "CUENTA_DE_COBRO_INCOMPATIBLE";

/**
 * El par (medio, cuenta) de un cobro, una corrección o una declaración: el medio existe y está activo; si viene cuenta, el medio la
 * admite (el efectivo no), existe, es de la sucursal de la caja, está activa y es de un tipo compatible. Devuelve el tipo del medio.
 * Es el espejo EXACTO de `par_de_cobro_validar` de la base, con el mismo orden de chequeos. `medio` y `cuenta` son lo que el caso de
 * uso encontró (`null` = no existe en la empresa). Previene que la regla medio↔cuenta quede en dos lugares con matices distintos.
 */
export function validarParDeCobro(
  entrada: Readonly<{
    medio: MedioVisto | null;
    cuentaDeCobroId: string | null;
    cuenta: CuentaVista | null;
    sucursalDeLaCaja: string;
  }>,
): Resultado<TipoDeMedio, ErrorDeParDeCobro> {
  const { medio, cuentaDeCobroId, cuenta } = entrada;
  if (medio === null) return err("MEDIO_NO_ENCONTRADO");
  if (!medio.activo) return err("MEDIO_INACTIVO");
  if (cuentaDeCobroId === null) return ok(medio.tipo);
  if (medio.tipo === "EFECTIVO") return err("CUENTA_DE_COBRO_NO_ADMITIDA");
  if (cuenta === null) return err("CUENTA_DE_COBRO_NO_ENCONTRADA");
  if (cuenta.sucursalId !== entrada.sucursalDeLaCaja) {
    return err("CUENTA_DE_COBRO_DE_OTRA_SUCURSAL");
  }
  if (!cuenta.activa) return err("CUENTA_DE_COBRO_INACTIVA");
  if (!cuentaAdmitidaPorMedio(medio.tipo, cuenta.tipo)) return err("CUENTA_DE_COBRO_INCOMPATIBLE");
  return ok(medio.tipo);
}

/**
 * Qué datos opcionales puede pedir cada tipo de medio (decisión 129). El efectivo, el QR y «otro» ninguno; el débito cupón, últimos 4 y
 * marca; el crédito además cuotas; la transferencia solo el DNI. Es `medio_de_pago_datos_ck` de la base: una prueba las compara.
 */
export const DATOS_ADMITIDOS_POR_MEDIO: Readonly<Record<TipoDeMedio, readonly DatoDelCobro[]>> = {
  EFECTIVO: [],
  QR: [],
  OTRO: [],
  TARJETA_DEBITO: ["cupon", "ultimos4", "marca"],
  TARJETA_CREDITO: ["cupon", "ultimos4", "marca", "cuotas"],
  TRANSFERENCIA: ["dni"],
};

/** Qué datos pide un medio (`pide_*` de la tabla `medio_de_pago`). Un medio nuevo nace con todos en `false`. */
export type DatosQuePideElMedio = Readonly<Record<DatoDelCobro, boolean>>;

/** `editarMedioDePago` rechaza habilitar un dato que el tipo no admite (el CHECK de la base es la defensa final). */
export function validarDatosQuePide(
  tipoDeMedio: TipoDeMedio,
  pide: DatosQuePideElMedio,
): Resultado<null, Readonly<{ codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO"; dato: DatoDelCobro }>> {
  for (const dato of DATOS_DEL_COBRO) {
    if (pide[dato] && !DATOS_ADMITIDOS_POR_MEDIO[tipoDeMedio].includes(dato)) {
      return err({ codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato });
    }
  }
  return ok(null);
}
