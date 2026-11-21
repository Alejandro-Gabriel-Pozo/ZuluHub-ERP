import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { explicacionDesdeTexto } from "../../cierre/publico";
import { huellaDeCampos } from "./huella";

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
