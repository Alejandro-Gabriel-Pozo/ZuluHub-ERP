import type { Importe, ImporteJson } from "../../../primitivas/dinero/importe";
import {
  terceroDesdeEntrada,
  type ErrorDeTercero,
  type TerceroIdentificado,
} from "../../../primitivas/identificacion/tercero-identificado";
import { tipoAdmitido } from "../../../primitivas/identificacion/exigencia-de-tercero";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { explicacionDesdeTexto } from "../../cierre/publico";
import { TIPOS_DE_MEDIO, type TipoDeMedio } from "../estados";
import { huellaDeCampos } from "./huella";
import { importeDeEntrada, type ErrorDeImporte } from "./importes";
import { motivoObligatorio } from "./texto";

/**
 * El acto «movimiento de dinero» de Caja (0091): ingresar o sacar plata de la caja sin ticket ni compra, en sus dos sentidos. Una tabla, una
 * regla. Las categorías son lista cerrada acá y en la base (`movimiento_de_dinero_categoria_ck`): una prueba de paridad falla si difieren.
 * Los largos y la lista de permitidos de los textos de la base son los de sus primitivas (`test/integracion/movimiento-de-dinero-migracion.test.ts`).
 */
export const SENTIDOS_DE_MOVIMIENTO_DE_DINERO = ["ENTRADA", "SALIDA"] as const;
export type SentidoDeMovimientoDeDinero = (typeof SENTIDOS_DE_MOVIMIENTO_DE_DINERO)[number];

export const CATEGORIAS_DE_SALIDA = [
  "RETIRO_DEL_DUENO",
  "GASTO_MENOR",
  "ADELANTO_DE_SUELDO",
  "PROPINA_ENTREGADA",
  "OTRO",
  "DEVOLUCION_DE_UN_COBRO",
] as const;
export type CategoriaDeSalida = (typeof CATEGORIAS_DE_SALIDA)[number];

/** Las que la persona puede elegir en «Salida de dinero»: la devolución no se elige, nace de devolver un ingreso. */
export const CATEGORIAS_ELEGIBLES_DE_SALIDA: readonly CategoriaDeSalida[] =
  CATEGORIAS_DE_SALIDA.filter((c) => c !== "DEVOLUCION_DE_UN_COBRO");

export type ReglaDeCategoria = Readonly<{
  /** El retiro del dueño no exige a nadie del otro lado. */
  eximeDeTercero: boolean;
  /** «Otro» lleva un motivo propio de quien lo carga. */
  motivoPropio: boolean;
  /** La devolución se ata al ingreso que devuelve. */
  exigeIngresoOriginal: boolean;
}>;

const REGLAS: Readonly<Record<CategoriaDeSalida, ReglaDeCategoria>> = {
  RETIRO_DEL_DUENO: { eximeDeTercero: true, motivoPropio: false, exigeIngresoOriginal: false },
  GASTO_MENOR: { eximeDeTercero: false, motivoPropio: false, exigeIngresoOriginal: false },
  ADELANTO_DE_SUELDO: { eximeDeTercero: false, motivoPropio: false, exigeIngresoOriginal: false },
  PROPINA_ENTREGADA: { eximeDeTercero: false, motivoPropio: false, exigeIngresoOriginal: false },
  OTRO: { eximeDeTercero: false, motivoPropio: true, exigeIngresoOriginal: false },
  DEVOLUCION_DE_UN_COBRO: {
    eximeDeTercero: false,
    motivoPropio: false,
    exigeIngresoOriginal: true,
  },
};

export function reglaDeLaCategoria(c: CategoriaDeSalida): ReglaDeCategoria {
  return REGLAS[c];
}

/** El origen de los cobros que nacen de una entrada de dinero (`cobro.origen_tipo`): la base lo compara por texto. */
export const ORIGEN_DEL_MOVIMIENTO_DE_DINERO = "caja.movimiento_de_dinero";

export const LARGO_MAXIMO_DEL_CONCEPTO = 200; // fuente-unica: ajeno — el largo del concepto de un movimiento de dinero («por qué se cobró») es otro dato que el nombre o razón social
export const LARGO_MAXIMO_DE_LA_REFERENCIA = 40; // fuente-unica: ajeno — el largo de la referencia de una salida de dinero es otro dato que el de las demás constantes de 40

function textoOpcionalHasta<E extends string>(
  texto: string | null | undefined,
  maximo: number,
  error: E,
): Resultado<string | null, E> {
  // Mismo conjunto permitido que el motivo de caja (`texto.ts`): una regla, un lugar; acá solo cambia el largo.
  const canonico = explicacionDesdeTexto(texto);
  if (!canonico.ok) return err(error);
  if (canonico.valor !== null && canonico.valor.length > maximo) return err(error);
  return ok(canonico.valor);
}

export function conceptoDesdeTexto(
  t: string | null | undefined,
): Resultado<string | null, "CONCEPTO_INVALIDO"> {
  return textoOpcionalHasta(t, LARGO_MAXIMO_DEL_CONCEPTO, "CONCEPTO_INVALIDO");
}

export function referenciaDesdeTexto(
  t: string | null | undefined,
): Resultado<string | null, "REFERENCIA_INVALIDA"> {
  return textoOpcionalHasta(t, LARGO_MAXIMO_DE_LA_REFERENCIA, "REFERENCIA_INVALIDA");
}

/** Lo que identifica un pedido de movimiento de dinero (idempotencia). `importe` va como texto decimal (ADR-006). */
export type CamposDeLaHuellaDelMovimientoDeDinero = Readonly<{
  sentido: SentidoDeMovimientoDeDinero;
  sesionId: string;
  importe: string;
  categoria: CategoriaDeSalida | null;
  concepto: string | null;
  motivo: string | null;
  terceroNombre: string | null;
  terceroPersonaId: string | null;
  referencia: string | null;
  devuelveA: string | null;
}>;

export function huellaDelMovimientoDeDinero(c: CamposDeLaHuellaDelMovimientoDeDinero): string {
  return huellaDeCampos([
    "movimiento_de_dinero",
    c.sentido,
    c.sesionId,
    c.importe,
    c.categoria,
    c.concepto,
    c.motivo,
    c.terceroNombre,
    c.terceroPersonaId,
    c.referencia,
    c.devuelveA,
  ]);
}

/**
 * Con qué tipos de medio puede salir cada categoría (dueño, 26/11/2026, Q-D8 opción A: TODAS por cualquier medio). Una línea por categoría: pasar a «solo efectivo
 * para el retiro» u otra regla es cambiar esa línea, sin migración (la base no la repite: solo exige que un egreso que no es efectivo tenga su acto de salida).
 */
export const MEDIOS_ADMITIDOS_POR_CATEGORIA: Readonly<
  Record<CategoriaDeSalida, readonly TipoDeMedio[]>
> = {
  RETIRO_DEL_DUENO: TIPOS_DE_MEDIO,
  GASTO_MENOR: TIPOS_DE_MEDIO,
  ADELANTO_DE_SUELDO: TIPOS_DE_MEDIO,
  PROPINA_ENTREGADA: TIPOS_DE_MEDIO,
  OTRO: TIPOS_DE_MEDIO,
  DEVOLUCION_DE_UN_COBRO: TIPOS_DE_MEDIO,
};

export function categoriaAdmiteElMedio(categoria: CategoriaDeSalida, tipo: TipoDeMedio): boolean {
  return MEDIOS_ADMITIDOS_POR_CATEGORIA[categoria].includes(tipo);
}

export type ErrorDeSalidaDeDinero =
  | ErrorDeImporte
  | ErrorDeTercero
  | "CATEGORIA_INVALIDA"
  | "MOTIVO_INVALIDO"
  | "REFERENCIA_INVALIDA";

export type SalidaDeDineroArmada = Readonly<{
  categoria: CategoriaDeSalida;
  /** Positivo y en ARS: el egreso de caja lo guarda con signo negativo. */
  importe: Importe;
  motivo: string;
  referencia: string | null;
  tercero: TerceroIdentificado | null;
  /** La categoría no exige decir quién recibió (el retiro del dueño): no hay control que evaluar. */
  eximeDeTercero: boolean;
}>;

/**
 * Lo que valida una salida de dinero sin compra antes de tocar la base: la categoría tiene que ser una de las ELEGIBLES (la devolución de un cobro no entra por acá, nace de
 * devolver una entrada), el importe positivo y en ARS, el motivo obligatorio, la referencia y el tercero (nombre o empleado, nunca los dos). Puro. Que un `personaId` sea de
 * una persona de la empresa lo comprueba el caso de uso (necesita la base).
 */
export function decidirSalidaDeDinero(
  entrada: Readonly<{
    categoria: string;
    importe: ImporteJson;
    motivo: string | null | undefined;
    referencia?: string | null | undefined;
    tercero: Readonly<{ nombre?: string | undefined; personaId?: string | undefined }> | null;
  }>,
): Resultado<SalidaDeDineroArmada, ErrorDeSalidaDeDinero> {
  const categoria = CATEGORIAS_ELEGIBLES_DE_SALIDA.find((c) => c === entrada.categoria);
  if (categoria === undefined) return err("CATEGORIA_INVALIDA");
  const importe = importeDeEntrada(entrada.importe, "POSITIVO");
  if (!importe.ok) return importe;
  const motivo = motivoObligatorio(entrada.motivo);
  if (!motivo.ok) return motivo;
  const referencia = referenciaDesdeTexto(entrada.referencia);
  if (!referencia.ok) return referencia;
  const tercero = terceroDesdeEntrada(entrada.tercero);
  if (!tercero.ok) return tercero;
  if (tercero.valor !== null && !tipoAdmitido("SALIDA", tercero.valor)) {
    return err("TERCERO_INVALIDO");
  }
  return ok({
    categoria,
    importe: importe.valor,
    motivo: motivo.valor,
    referencia: referencia.valor,
    tercero: tercero.valor,
    eximeDeTercero: reglaDeLaCategoria(categoria).eximeDeTercero,
  });
}

/**
 * La huella de una salida de dinero: la del acto (categoría, importe, motivo, tercero, referencia) más la CAJA (la sesión todavía no se conoce al buscar por clave, y una
 * repetición tras el cierre y la reapertura sigue siendo la misma) y el MEDIO con su cuenta: la misma clave con otro medio es `CLAVE_REUTILIZADA`, no una repetición.
 */
export function huellaDeLaSalidaDeDinero(
  c: Readonly<{
    cajaId: string;
    medioDePagoId: string;
    cuentaDeCobroId: string | null;
    importe: string;
    categoria: CategoriaDeSalida;
    motivo: string;
    terceroNombre: string | null;
    terceroPersonaId: string | null;
    referencia: string | null;
  }>,
): string {
  return huellaDeCampos([
    huellaDelMovimientoDeDinero({
      sentido: "SALIDA",
      sesionId: c.cajaId,
      importe: c.importe,
      categoria: c.categoria,
      concepto: null,
      motivo: c.motivo,
      terceroNombre: c.terceroNombre,
      terceroPersonaId: c.terceroPersonaId,
      referencia: c.referencia,
      devuelveA: null,
    }),
    c.medioDePagoId,
    c.cuentaDeCobroId,
  ]);
}
