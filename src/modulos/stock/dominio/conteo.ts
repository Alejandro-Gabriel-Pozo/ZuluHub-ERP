import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeCantidad,
  restarConSigno,
  sumarConSigno,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import { cantidadDesdeTexto, type Cantidad } from "../../../primitivas/cantidad/cantidad";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { huellaDeComando } from "./huella";

/**
 * El conteo físico con la hora a la que se contó (E5 conteo con hora, §2 y §3.1; decisión del dueño del 11 y 12/11/2026). Cada cantidad contada trae
 * su hora; el sistema compara contra lo que creía que había A ESA HORA (`E`: la suma del libro con `hecho_en <= hora`), no contra lo que creía al
 * cargarla. Lo movido DESPUÉS de la hora (una venta a las 10:05 de un conteo de las 10:00) ya está incluido en lo que hay hoy y no se toca: solo
 * queda la diferencia `Δ0 = contada − E`, y de esa diferencia solo lo que sigue sin explicarse pide motivo. Las horas son INSTANTES: la jornada de
 * negocio no interviene en la cuenta (CF-D7), solo en la ventana de la hora que se acepta. Puro: sin reloj ni azar (el instante entra como dato).
 */

/** Un registro del conteo (`conteo_registro`, solo inserción). De varios del mismo artículo vale el de mayor `orden` (recontar = registro nuevo). */
export type RegistroDeConteo = Readonly<{
  id: string;
  articuloId: string;
  orden: number;
  cantidadContada: Cantidad;
  /** La hora que declaró quien cargó; `null` si no declaró ninguna. */
  contadoEn: Date | null;
  /** Cuándo se cargó. */
  registradoEn: Date;
}>;

/** La hora del conteo de un registro: la declarada, o la de carga si no se declaró ninguna (los registros anteriores a 0042 y los cargados «en vivo»). */
export const horaDelConteo = (
  registro: Pick<RegistroDeConteo, "contadoEn" | "registradoEn">,
): Date => registro.contadoEn ?? registro.registradoEn;

/**
 * El registro que vale de cada artículo (el de mayor `orden`: recontar es cargar otra vez), ordenados por artículo. Vale el ÚLTIMO CARGADO, no el de
 * hora más tardía: quien corrige cargando de nuevo manda aunque ponga una hora anterior (CF16).
 */
export function registrosVigentes(
  registros: readonly RegistroDeConteo[],
): readonly RegistroDeConteo[] {
  const vigentes = new Map<string, RegistroDeConteo>();
  for (const registro of registros) {
    const actual = vigentes.get(registro.articuloId);
    if (actual === undefined || registro.orden > actual.orden) {
      vigentes.set(registro.articuloId, registro);
    }
  }
  return [...vigentes.keys()]
    .sort()
    .map((articuloId) => vigentes.get(articuloId) as RegistroDeConteo);
}

/** `Δ0 = contada − E`: negativa si contó de menos (faltante), positiva si contó de más (sobrante). */
export function diferenciaBruta(
  contada: Cantidad,
  existenciaALaHora: CantidadConSigno,
): Resultado<CantidadConSigno, "FUERA_DE_RANGO"> {
  const diferencia = restarConSigno(cantidadConSignoDesdeCantidad(contada), existenciaALaHora);
  return diferencia.ok ? ok(diferencia.valor) : err("FUERA_DE_RANGO");
}

/** Un renglón del libro posterior a la hora del conteo, como lo entiende el dominio: su cantidad con signo y cuándo ocurrió. */
export type RenglonMarcable = Readonly<{ cantidad: CantidadConSigno; hechoEn: Date }>;

export type ErrorDeMarcas =
  "MOVIMIENTO_NO_EXPLICA" | "EXPLICACION_SUPERA_LA_DIFERENCIA" | "FUERA_DE_RANGO";

/**
 * La diferencia que queda después de marcar movimientos como «ya habían ocurrido cuando contó» (CF-D3): `Δ = Δ0 − Σ marcados`. Marcar es OPCIONAL
 * (sin marcas, `Δ = Δ0`) y solo explica, no inventa: cada movimiento marcado ocurrió DESPUÉS de la hora y es del MISMO SENTIDO que la diferencia (un
 * faltante se explica con lo que restó, un sobrante con lo que sumó: `MOVIMIENTO_NO_EXPLICA`), y entre todos nunca pasan de la diferencia bruta
 * (`EXPLICACION_SUPERA_LA_DIFERENCIA`): lo marcado puede dejarla en cero, jamás invertirla. Los marcados no se repiten (lo controla quien llama).
 */
export function explicarConMarcas(
  diferenciaBruta: CantidadConSigno,
  hora: Date,
  marcados: readonly RenglonMarcable[],
): Resultado<
  Readonly<{ marcado: CantidadConSigno; diferenciaFinal: CantidadConSigno }>,
  ErrorDeMarcas
> {
  let acumulado = cantidadConSignoDesdeCantidad(cantidadDesdeTexto("0"));
  for (const renglon of marcados) {
    const mismoSentido =
      (diferenciaBruta.unidades < 0n && renglon.cantidad.unidades < 0n) ||
      (diferenciaBruta.unidades > 0n && renglon.cantidad.unidades > 0n);
    if (!mismoSentido || !(renglon.hechoEn.getTime() > hora.getTime())) {
      return err("MOVIMIENTO_NO_EXPLICA");
    }
    const suma = sumarConSigno(acumulado, renglon.cantidad);
    if (!suma.ok) return err("FUERA_DE_RANGO");
    acumulado = suma.valor;
  }
  const final = restarConSigno(diferenciaBruta, acumulado);
  // Stryker disable next-line all: `acumulado` es del signo de la diferencia: la resta cabe siempre en el rango (su valor absoluto no supera al mayor de los dos); la guarda solo satisface al tipo.
  if (!final.ok) return err("FUERA_DE_RANGO");
  // Lo marcado explica hasta dejarla en cero, nunca la invierte: una final de signo contrario a la bruta es que se marcó de más.
  if (final.valor.unidades * diferenciaBruta.unidades < 0n) {
    return err("EXPLICACION_SUPERA_LA_DIFERENCIA");
  }
  return ok({ marcado: acumulado, diferenciaFinal: final.valor });
}

export type ErrorDeHora =
  "FECHA_FUTURA_NO_ADMITIDA" | "HORA_FUERA_DE_VENTANA" | "HORA_ANTERIOR_AL_ULTIMO_CONTEO";

const MS_POR_DIA = 86_400_000;

/**
 * ¿Se admite esta hora de conteo? (CF-D2). No es futura; cae en la jornada de negocio vigente o en la anterior de la sucursal (así un conteo de
 * cierre a las 23:30 puede cargarse a la mañana siguiente, pero no uno de hace una semana); y no es anterior al momento en que se aplicó el último
 * conteo del depósito (ese conteo ya corrigió lo que había). Las jornadas llegan como fecha civil `AAAA-MM-DD` (las calcula quien llama con la zona
 * y el corte de la sucursal); una fecha ilegible cierra (`HORA_FUERA_DE_VENTANA`).
 */
export function validarHoraDeConteo(
  datos: Readonly<{
    hora: Date;
    ahora: Date;
    jornadaDeLaHora: string;
    jornadaDeHoy: string;
    ultimoAplicadoEn: Date | null;
  }>,
): Resultado<null, ErrorDeHora> {
  if (!(datos.hora.getTime() <= datos.ahora.getTime())) return err("FECHA_FUTURA_NO_ADMITIDA");
  const dias =
    (Date.parse(`${datos.jornadaDeHoy}T00:00:00Z`) -
      Date.parse(`${datos.jornadaDeLaHora}T00:00:00Z`)) /
    MS_POR_DIA;
  if (!(dias >= 0 && dias <= 1)) return err("HORA_FUERA_DE_VENTANA");
  if (datos.ultimoAplicadoEn !== null && datos.hora.getTime() < datos.ultimoAplicadoEn.getTime()) {
    return err("HORA_ANTERIOR_AL_ULTIMO_CONTEO");
  }
  return ok(null);
}

/** Lo que la persona vio de un artículo al revisar el conteo y sobre lo que decide. */
export type ItemDeRevision = Readonly<{
  articuloId: string;
  /** El registro vigente que se evaluó. */
  registroId: string;
  hora: Date;
  existenciaALaHora: CantidadConSigno;
  diferenciaBruta: CantidadConSigno;
}>;

/**
 * La huella de lo mostrado (CF-D10): sha256 del contenido canónico de la revisión (por artículo: registro vigente, hora, `E` y `Δ0`). La revisión la
 * entrega y `aplicarConteo` la recibe, la recalcula dentro de su transacción y, si difiere, frena (`REVISION_DESACTUALIZADA`) sin escribir: nunca se
 * aplica un ajuste calculado con datos que la persona no vio (una recarga, un movimiento con hora anterior a la del conteo que entró mientras
 * miraba). Es control optimista de versión sobre lo que se decidió mirando. No entran los movimientos posteriores a la hora: no cambian `E` ni
 * `Δ0`, y lo que se marque se verifica uno por uno al aplicar. Los artículos se ordenan antes de hashear (mismo contenido en otro orden, misma huella).
 */
export function huellaDeRevision(conteoId: string, items: readonly ItemDeRevision[]): string {
  return huellaDeComando(
    "revision_de_conteo",
    [conteoId],
    items.map((i) => [
      i.articuloId,
      i.registroId,
      i.hora.toISOString(),
      cantidadConSignoATexto(i.existenciaALaHora),
      cantidadConSignoATexto(i.diferenciaBruta),
    ]),
  );
}
