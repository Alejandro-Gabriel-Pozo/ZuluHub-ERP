import type { ImporteJson } from "../../../primitivas/dinero/importe";
import type { EstadoDeMesa } from "../dominio/estado-de-mesa";

/** Lo que devuelve la consulta de la ficha de una mesa (SAL-B; SAL-E2 suma el paso de cada línea y las hijas ya cobradas). Los tipos viven acá para que `consultas.ts` no pase del tope de líneas. */
export type LineaDeLaFicha = Readonly<{
  lineaId: string;
  posicion: number;
  descripcion: string;
  varianteNombre: string | null;
  cantidad: string;
  precioUnitario: string;
  /** El paso de la cantidad congelado en la línea (para repartir por unidades al dividir). */
  pasoDeCantidad: string;
  importe: string;
  /** La nota libre para la cocina del plato («sin cebolla»); `null` si no tiene. */
  nota: string | null;
  /** El importe de una línea compartida entre cuentas («Compartido»). */
  compartida: boolean;
  /** Estado de comanda: lo que falta enviar, lo que espera y lo enviado con su número de envío. */
  comanda: "PARA_ENVIAR" | "ESPERA" | "ENVIADA";
  numeroDeEnvio: number | null;
  /** El envío en que salió el ítem (para reimprimir su papel); `null` si todavía no se envió. */
  envioId: string | null;
  /** «De la mesa N»: el número de la mesa de la que vino el ítem por una unión. */
  deLaMesa: number | null;
}>;

export type CuentaDeLaFicha = Readonly<{
  cuentaId: string;
  /** Número de la parte («Cuenta 2») si es una cuenta hija de una división. */
  parte: number | null;
  /** Una cuenta hija ya cobrada (cerrada): se muestra «Cobrada» y no se vuelve a cobrar; una cuenta de mesa o una hija abierta es `false`. */
  cobrada: boolean;
  total: ImporteJson;
  lineas: readonly LineaDeLaFicha[];
}>;

export type FichaDeMesa = Readonly<{
  mesaId: string;
  numero: number;
  estado: EstadoDeMesa;
  unidaAMesa: number | null;
  cuentas: readonly CuentaDeLaFicha[];
}>;
