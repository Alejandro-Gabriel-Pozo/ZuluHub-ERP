import { porcentajeDesdeTexto } from "../cantidad/porcentaje";
import { ErrorDeValor } from "../cantidad/errores";
import { MAXIMO_DE_PARTES_POR_PORCENTAJE } from "./limites-de-division";
import { repartirEnPartesIguales, repartirPorPorcentaje } from "./reparto";

/**
 * LA HOJA «POR PORCENTAJE» DEL COBRO (SAL-E3; ficha `dividir-la-cuenta.md`, CYN 89 y la decisión del dueño del 14/11/2026): dividir por porcentaje NO divide datos, es UN ticket cobrado con varios cobros. Acá vive lo que la pantalla
 * propone: las partes (la 1 es siempre el resto hasta 100 %, las demás se agregan con su porcentaje), cuánto cobra cada una y si se puede usar. El reparto del centavo es el de `reparto.ts` (una regla, un lugar); el servidor no confía en
 * esto: solo comprueba que los cobros sumen el total al centavo. Todo en texto decimal y `bigint`, jamás `number` para el dinero. Sin React.
 * Previene: dos pantallas que repartan distinto el mismo total, una parte a $ 0 que el servidor rechaza al cobrar, y un porcentaje con más decimales de los que se muestran.
 * Chequeo: `reparto-por-porcentaje.test.ts` (suma exacta, centavo suelto, partes vacías, máximo de partes).
 */

/** Los porcentajes se escriben con 2 decimales (decisión del dueño, 14/11/2026); la primitiva `Porcentaje` admite hasta 4. */
export const DECIMALES_DEL_PORCENTAJE_DE_LA_PARTE = 2;
/** De 0 a 100: hasta tres dígitos enteros. */
export const ENTEROS_DEL_PORCENTAJE_DE_LA_PARTE = 3;

/** Una centésima de punto como unidad: 100 % son `CIEN` unidades. */
const ESCALA = 10n ** BigInt(DECIMALES_DEL_PORCENTAJE_DE_LA_PARTE);
const CIEN = 100n * ESCALA;
const UNA_CENTESIMA = 1n;

const FORMA_DEL_PORCENTAJE = new RegExp(
  `^(?:0|[1-9][0-9]{0,${ENTEROS_DEL_PORCENTAJE_DE_LA_PARTE - 1}})(?:\\.[0-9]{1,${DECIMALES_DEL_PORCENTAJE_DE_LA_PARTE}})?$`,
);

export type RepartoEnEdicion = Readonly<{
  /** `true` mientras nadie escribió un porcentaje: las partes son iguales (el centavo que sobra, de a uno desde la parte 1). */
  iguales: boolean;
  /** Los porcentajes de las partes 2 en adelante, en texto decimal canónico (`"33.33"`); `""` mientras se escribe. La parte 1 no se guarda: es el resto. */
  porcentajes: readonly string[];
}>;

/** Empieza con una sola parte (el 100 %): hace falta agregar al menos una para poder usarlo. */
export const repartoInicial: RepartoEnEdicion = { iguales: true, porcentajes: [] };

export type ParteDeLaHoja = Readonly<{
  /** Número de la parte, desde 1. */
  parte: number;
  /** El porcentaje en texto canónico con sus decimales; el de la parte 1 es el resto y `null` si el reparto no cierra. */
  porcentaje: string | null;
  /** Cuánto cobra esta parte, o `null` si el reparto no es válido todavía. */
  importe: string | null;
}>;

export type VistaDelReparto = Readonly<{
  partes: readonly ParteDeLaHoja[];
  /** Hay al menos dos partes, cada una con un porcentaje válido, la parte 1 con resto positivo y ninguna parte a $ 0. */
  utilizable: boolean;
  /** Se puede agregar otra parte: hay lugar y a la parte 1 le sobra al menos una centésima. */
  puedeAgregar: boolean;
}>;

const aUnidades = (texto: string): bigint | null => {
  if (!FORMA_DEL_PORCENTAJE.test(texto)) return null;
  try {
    porcentajeDesdeTexto(texto); // el rango (0 a 100) lo valida la primitiva del porcentaje
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
  const [entera = "0", fraccion = ""] = texto.split(".");
  return BigInt(entera + fraccion.padEnd(DECIMALES_DEL_PORCENTAJE_DE_LA_PARTE, "0"));
};

const aTexto = (unidades: bigint): string => {
  const digitos = unidades.toString().padStart(DECIMALES_DEL_PORCENTAJE_DE_LA_PARTE + 1, "0");
  const corte = digitos.length - DECIMALES_DEL_PORCENTAJE_DE_LA_PARTE;
  return `${digitos.slice(0, corte)}.${digitos.slice(corte)}`;
};

/** Cada parte con el mismo porcentaje, redondeado hacia abajo a las centésimas: lo que sobra queda en el resto de la parte 1. */
const igualesPara = (cuantas: number): readonly string[] =>
  Array.from({ length: cuantas - 1 }, () => aTexto(CIEN / BigInt(cuantas)));

/** Agrega una parte: en partes iguales todas pasan a valer lo mismo; si no, la nueva toma lo que le toca de a partes iguales sin dejar la parte 1 en cero. */
export function agregarParte(reparto: RepartoEnEdicion): RepartoEnEdicion {
  if (!vistaDelReparto("0.00", reparto).puedeAgregar) return reparto;
  const cuantas = reparto.porcentajes.length + 2;
  if (reparto.iguales) return { iguales: true, porcentajes: igualesPara(cuantas) };
  const otros = reparto.porcentajes.reduce((suma, p) => suma + (aUnidades(p) ?? 0n), 0n);
  const igual = CIEN / BigInt(cuantas);
  const cabe = CIEN - otros - UNA_CENTESIMA;
  return {
    iguales: false,
    porcentajes: [...reparto.porcentajes, aTexto(igual < cabe ? igual : cabe)],
  };
}

/** Quita una de las partes 2 en adelante (`indice` desde 0); en partes iguales las que quedan vuelven a valer lo mismo. */
export function quitarParte(reparto: RepartoEnEdicion, indice: number): RepartoEnEdicion {
  if (!Number.isInteger(indice) || indice < 0 || indice >= reparto.porcentajes.length)
    return reparto;
  const quedan = reparto.porcentajes.filter((_, i) => i !== indice);
  return reparto.iguales
    ? { iguales: true, porcentajes: igualesPara(quedan.length + 1).slice(0, quedan.length) }
    : { iguales: false, porcentajes: quedan };
}

/** Escribe el porcentaje de una parte (2 en adelante); desde ese momento ya no son partes iguales. El texto se guarda tal cual: si no es un porcentaje válido, la hoja no se puede usar. */
export function escribirPorcentaje(
  reparto: RepartoEnEdicion,
  indice: number,
  texto: string,
): RepartoEnEdicion {
  if (!Number.isInteger(indice) || indice < 0 || indice >= reparto.porcentajes.length)
    return reparto;
  return {
    iguales: false,
    porcentajes: reparto.porcentajes.map((p, i) => (i === indice ? texto : p)),
  };
}

/** La hoja tal como se dibuja: el porcentaje y el importe de cada parte para ese total (texto decimal con 2 decimales, ARS). */
export function vistaDelReparto(total: string, reparto: RepartoEnEdicion): VistaDelReparto {
  const cuantas = reparto.porcentajes.length + 1;
  const unidades = reparto.porcentajes.map(aUnidades);
  const todasValidas = unidades.every((u) => u !== null && u > 0n);
  const suma = unidades.reduce<bigint>((s, u) => s + (u ?? 0n), 0n);
  const resto = CIEN - suma;
  const restoValido = todasValidas && resto >= UNA_CENTESIMA;
  const hayLugar = cuantas < MAXIMO_DE_PARTES_POR_PORCENTAJE;
  const puedeAgregar = hayLugar && (reparto.iguales || (todasValidas && resto > UNA_CENTESIMA));
  const importes =
    cuantas < 2 || !restoValido
      ? null
      : reparto.iguales
        ? repartirEnPartesIguales(total, cuantas)
        : repartirPorPorcentaje(total, reparto.porcentajes);
  const lista = importes !== null && importes.ok ? importes.valor.map((p) => p.importe) : null;
  const partes: ParteDeLaHoja[] = Array.from({ length: cuantas }, (_, i) => ({
    parte: i + 1,
    porcentaje: i === 0 ? (restoValido ? aTexto(resto) : null) : (reparto.porcentajes[i - 1] ?? ""),
    importe: lista?.[i] ?? null,
  }));
  const utilizable = lista !== null && cuantas >= 2 && lista.every((importe) => importe !== "0.00");
  return { partes, utilizable, puedeAgregar };
}

/** Los importes que pasan al cobro, uno por parte y en orden, o `null` si la hoja todavía no se puede usar. */
export function importesParaElCobro(
  total: string,
  reparto: RepartoEnEdicion,
): readonly string[] | null {
  const vista = vistaDelReparto(total, reparto);
  if (!vista.utilizable) return null;
  return vista.partes.map((p) => p.importe as string);
}
