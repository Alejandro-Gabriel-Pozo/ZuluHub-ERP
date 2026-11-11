import { cantidadDesdeTexto, type Cantidad } from "../../../primitivas/cantidad/cantidad";
import { formatearDecimalFijo } from "../../../primitivas/cantidad/decimal-fijo";
import { dividirRedondeando } from "../../../primitivas/cantidad/redondeo-entero";
import {
  precioUnitarioDesdeTexto,
  type PrecioUnitario,
} from "../../../primitivas/dinero/precio-unitario";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import { cantidadDeUnidades } from "./movimiento";

/**
 * El costo promedio móvil ponderado POR DEPÓSITO Y ARTÍCULO (E5 §3.6, D24; tramo TCO). Función pura con `bigint`: sin `number`, sin reloj
 * ni azar. El costo unitario tiene 6 decimales y se redondea UNA vez por cálculo con la política vigente; nunca al centavo (el importe
 * valorizado se redondea una vez, al mostrarlo). El caso de uso lo escribe en la misma transacción, DESPUÉS de bloquear el saldo.
 *
 * - Entrada con costo: `nuevo = (q_prev × c_prev + q_in × c_in) ÷ (q_prev + q_in)`; suma a `cantidadValorizada`.
 * - Entrada SIN costo: nunca es cero ni diluye lo conocido: la existencia sube y este estado no cambia.
 * - Salida (venta, merma, consumo, resta de un ajuste): congela el promedio vigente en el renglón; baja `cantidadValorizada` (piso 0).
 * - Transferencia: lleva el costo de origen y el destino lo incorpora a su promedio.
 * - Anulación: el MISMO costo congelado del original, no el vigente.
 */
export type EstadoDeCosto = Readonly<{
  /** `null` mientras nunca entró nada con costo (no hay fila de `costo_de_articulo`). */
  promedio: PrecioUnitario | null;
  /** Las unidades que tienen costo: la existencia sin costo no cuenta. Nunca negativa (piso 0). */
  cantidadValorizada: Cantidad;
}>;

export const ESTADO_DE_COSTO_INICIAL: EstadoDeCosto = {
  promedio: null,
  cantidadValorizada: cantidadDesdeTexto("0"),
};

/** El costo congelado en un renglón (`costo_de_renglon`): `SIN_COSTO` no es cero, es «no se sabe». */
export type CostoDeRenglon =
  | Readonly<{ estado: "SIN_COSTO" }>
  | Readonly<{ estado: "DEFINITIVO"; costoUnitario: PrecioUnitario }>;

export const SIN_COSTO: CostoDeRenglon = { estado: "SIN_COSTO" };

export const costoDefinitivo = (costoUnitario: PrecioUnitario): CostoDeRenglon => ({
  estado: "DEFINITIVO",
  costoUnitario,
});

/** La escala del costo (`numeric(18,6)`) sale de la primitiva, no se repite acá. */
const DECIMALES_DE_COSTO = precioUnitarioDesdeTexto("1").unidades.toString().length - 1;
const costoDeUnidades = (unidades: bigint): PrecioUnitario =>
  precioUnitarioDesdeTexto(formatearDecimalFijo(unidades, DECIMALES_DE_COSTO));

function exigirCantidadPositiva(cantidad: Cantidad): void {
  if (cantidad.unidades <= 0n)
    throw new RangeError("costo: la cantidad tiene que ser mayor que cero");
}

/** El costo que lleva hoy una unidad de este depósito y artículo: el promedio, o `SIN_COSTO` si nunca entró nada con costo. */
export const costoVigente = (estado: EstadoDeCosto): CostoDeRenglon =>
  estado.promedio === null ? SIN_COSTO : costoDefinitivo(estado.promedio);

/**
 * Una entrada de `cantidad` con el costo dado (el declarado, el congelado de un movimiento que se espeja o el vigente de un ajuste que
 * suma). Con `SIN_COSTO` el estado queda igual. Lanza `RangeError` con cantidad cero (el libro no admite renglones en cero) y
 * `ErrorDeValor` si la cantidad valorizada se saldría de `numeric(18,4)` (la base también lo rechazaría): defectos, no errores de negocio.
 */
export function entrar(
  estado: EstadoDeCosto,
  cantidad: Cantidad,
  costo: CostoDeRenglon,
): EstadoDeCosto {
  exigirCantidadPositiva(cantidad);
  if (costo.estado === "SIN_COSTO") return estado;
  const total = estado.cantidadValorizada.unidades + cantidad.unidades;
  const promedio =
    estado.promedio === null
      ? costo.costoUnitario
      : costoDeUnidades(
          dividirRedondeando(
            estado.cantidadValorizada.unidades * estado.promedio.unidades +
              cantidad.unidades * costo.costoUnitario.unidades,
            total,
            POLITICA_VIGENTE,
          ),
        );
  return { promedio, cantidadValorizada: cantidadDeUnidades(total) };
}

/**
 * Una salida de `cantidad`. Sin `costoCongelado` congela el promedio vigente (una venta, una merma); con él usa ESE (la anulación de una
 * entrada devuelve lo que realmente entró). Con costo definitivo baja `cantidadValorizada` (piso 0) y no toca el promedio; con
 * `SIN_COSTO` el estado queda igual. Devuelve el estado nuevo y el costo que queda congelado en el renglón.
 */
export function salir(
  estado: EstadoDeCosto,
  cantidad: Cantidad,
  costoCongelado?: CostoDeRenglon,
): Readonly<{ estado: EstadoDeCosto; costo: CostoDeRenglon }> {
  exigirCantidadPositiva(cantidad);
  const costo = costoCongelado ?? costoVigente(estado);
  if (costo.estado === "SIN_COSTO") return { estado, costo };
  const restante = estado.cantidadValorizada.unidades - cantidad.unidades;
  return {
    estado: {
      promedio: estado.promedio,
      // Stryker disable next-line EqualityOperator: con resto cero los dos lados dan 0
      cantidadValorizada: cantidadDeUnidades(restante > 0n ? restante : 0n),
    },
    costo,
  };
}

/** Una transferencia: sale del origen al promedio de origen y entra al destino con ESE costo. Devuelve los dos estados y el costo del renglón. */
export function transferir(
  origen: EstadoDeCosto,
  destino: EstadoDeCosto,
  cantidad: Cantidad,
): Readonly<{ origen: EstadoDeCosto; destino: EstadoDeCosto; costo: CostoDeRenglon }> {
  const salida = salir(origen, cantidad);
  return {
    origen: salida.estado,
    destino: entrar(destino, cantidad, salida.costo),
    costo: salida.costo,
  };
}
