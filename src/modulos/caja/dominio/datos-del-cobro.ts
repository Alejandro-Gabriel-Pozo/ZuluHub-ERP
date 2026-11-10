import { cuotasDesdeTexto } from "../../../primitivas/cantidad/cuotas";
import { FORMATO_DE_DNI } from "../../../primitivas/identificacion-fiscal/documento";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { cuponDePagoDesdeTexto } from "../../../primitivas/texto/cupon-de-pago";
import { ultimosCuatroDigitosDesdeTexto } from "../../../primitivas/texto/ultimos-cuatro-digitos";
import type { DatoDelCobro } from "../estados";
import { esUuid } from "./identificadores";
import type { DatosQuePideElMedio } from "./medios";

/**
 * Los datos opcionales de un cobro (e3 §3.6; decisión 129). Nunca bloquean: ausente es válido; mal escrito es error con el nombre del
 * dato y no deja cobrar hasta corregir o vaciar; un dato que el medio no habilitó se rechaza (la pantalla no lo ofrece y el servidor
 * no lo confía). Nunca se guarda el número de la tarjeta: el cupón con 13 o más dígitos, aun separados, se rechaza; los últimos 4 no
 * se truncan. Las reglas de cada dato las repite la base (`cobro_cupon_ck`, `cobro_ultimos4_ck`, `cobro_cuotas_ck`, `cobro_dni_ck`).
 */
export type DatosDelCobro = Readonly<{
  cupon?: string;
  ultimos4?: string;
  marcaDeTarjetaId?: string;
  cuotas?: number;
  dni?: string;
}>;

/** Los datos ya validados y completos: lo que no vino es `null`. Es lo que se guarda y lo que entra a la huella. */
export type DatosDelCobroValidos = Readonly<{
  cupon: string | null;
  ultimos4: string | null;
  marcaDeTarjetaId: string | null;
  cuotas: number | null;
  dni: string | null;
}>;

/**
 * `NUMERO_DE_TARJETA`: el cupón parece el número de una tarjeta. `FORMA`: cualquier otra forma que no es la del dato. `NO_DISPONIBLE`: la
 * marca de tarjeta no existe o ya está desactivada (los cobros viejos la conservan, un cobro nuevo no la elige).
 */
export type MotivoDeDatoInvalido = "FORMA" | "NUMERO_DE_TARJETA" | "NO_DISPONIBLE";

export type ErrorDeDatoDelCobro =
  | Readonly<{ codigo: "DATO_DE_COBRO_NO_HABILITADO"; dato: DatoDelCobro }>
  | Readonly<{
      codigo: "DATO_DE_COBRO_INVALIDO";
      dato: DatoDelCobro;
      motivo: MotivoDeDatoInvalido;
    }>;

const SEPARADORES_DEL_CUPON = /[._/-]/g;
const TRECE_DIGITOS_SEGUIDOS = /[0-9]{13}/;
const TIENE_LETRA_O_DIGITO = /[A-Za-z0-9]/;

/**
 * El cupón de la decisión 129: la primitiva `cuponDePagoDesdeTexto` (largo, letras sin tilde, dígitos y `. _ / -`, y que no sea un número
 * de tarjeta por Luhn) MÁS tres reglas de la base (`cobro_cupon_ck`) que la primitiva no tiene: sin espacios, no solo separadores, y
 * ningún tramo de 13 dígitos una vez quitados los separadores (`4509-9535-6623-3704`). SUPUESTO: alinear la primitiva con la base es
 * trabajo aparte (ver informe); acá se componen para que el dominio rechace lo mismo que la base.
 */
function motivoDelCupon(valor: unknown): MotivoDeDatoInvalido | null {
  if (typeof valor !== "string") return "FORMA";
  if (valor.includes(" ") || !TIENE_LETRA_O_DIGITO.test(valor)) return "FORMA";
  if (TRECE_DIGITOS_SEGUIDOS.test(valor.replace(SEPARADORES_DEL_CUPON, ""))) {
    return "NUMERO_DE_TARJETA";
  }
  return cuponDePagoDesdeTexto(valor).ok ? null : "FORMA";
}

const VALIDADORES: Readonly<Record<DatoDelCobro, (valor: unknown) => MotivoDeDatoInvalido | null>> =
  {
    cupon: motivoDelCupon,
    ultimos4: (valor) =>
      typeof valor === "string" && ultimosCuatroDigitosDesdeTexto(valor).ok ? null : "FORMA",
    marca: (valor) => (esUuid(valor) ? null : "FORMA"),
    // Cuotas es un conteo entero: el texto canónico de cada entero del rango es la lista de permitidos (sin `Number` ni parseo).
    cuotas: (valor) =>
      typeof valor === "number" && cuotasDesdeTexto(String(valor)).ok ? null : "FORMA",
    dni: (valor) => (typeof valor === "string" && FORMATO_DE_DNI.test(valor) ? null : "FORMA"),
  };

/** Dato → campo de `DatosDelCobro`, en el orden en que se revisan. */
const CAMPOS: readonly (readonly [DatoDelCobro, keyof DatosDelCobro])[] = [
  ["cupon", "cupon"],
  ["ultimos4", "ultimos4"],
  ["marca", "marcaDeTarjetaId"],
  ["cuotas", "cuotas"],
  ["dni", "dni"],
];

/** Los datos que el cobro trae (la lista que va a la auditoría: nunca los valores, e3 §3.6). */
export function datosCompletados(datos: DatosDelCobro): readonly DatoDelCobro[] {
  return CAMPOS.filter(([, campo]) => datos[campo] !== undefined).map(([dato]) => dato);
}

/**
 * Valida los datos del cobro contra lo que el medio habilitó. Revisa en el orden cupón, últimos 4, marca, cuotas y DNI y devuelve el
 * primer error: primero si el dato no está habilitado, después si está mal escrito. Solo `undefined` es «no vino»: un texto vacío o un
 * `null` es un dato mal escrito (la frontera convierte el campo vacío en ausente).
 */
export function validarDatosDelCobro(
  datos: DatosDelCobro,
  habilitados: DatosQuePideElMedio,
): Resultado<DatosDelCobroValidos, ErrorDeDatoDelCobro> {
  for (const [dato, campo] of CAMPOS) {
    const valor = datos[campo];
    if (valor === undefined) continue;
    if (!habilitados[dato]) return err({ codigo: "DATO_DE_COBRO_NO_HABILITADO", dato });
    const motivo = VALIDADORES[dato](valor);
    if (motivo !== null) return err({ codigo: "DATO_DE_COBRO_INVALIDO", dato, motivo });
  }
  return ok(datosEnFormaCompleta(datos));
}

/**
 * Los datos en su forma completa (lo que no vino es `null`), SIN juzgarlos: la huella de un cobro se arma antes de leer qué habilita el
 * medio (la búsqueda por clave va primero), y una repetición tiene que dar la misma huella que el pedido original.
 */
export function datosEnFormaCompleta(datos: DatosDelCobro): DatosDelCobroValidos {
  return {
    cupon: datos.cupon ?? null,
    ultimos4: datos.ultimos4 ?? null,
    marcaDeTarjetaId: datos.marcaDeTarjetaId ?? null,
    cuotas: datos.cuotas ?? null,
    dni: datos.dni ?? null,
  };
}
