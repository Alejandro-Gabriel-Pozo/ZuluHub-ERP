import {
  claveDelModulo,
  formaDeClaveValida,
  formaDeModuloValida,
  impideCerrar,
  pideReconocimiento,
  type ControlDelDia,
} from "../aporte-al-cierre";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { explicacionDesdeTexto } from "./explicacion";

/**
 * Cuándo se puede cerrar la jornada y qué queda guardado (E3b §3.3 y §3.4; decisiones 160 y 167). «Resuelto o reconocido» =
 * ningún control `BLOQUEA` con hallazgos y todo control `RECONOCIBLE` con hallazgos reconocido (el texto es opcional); un `INFORMA`
 * nunca frena. Reconocer = listar el control en `cerrarJornada` junto con la huella que se vio (SUPUESTO (DEC-0070) de la especificación: sin
 * acción aparte). Puro: sin reloj ni azar.
 */

/** Lo que llega al pedir el cierre: qué reconoce quien cierra. `texto` es la explicación opcional del control. */
export type ReconocimientoPedido = Readonly<{
  modulo: string;
  clave: string;
  texto: string | null;
}>;

/** Un reconocimiento ya validado y con el texto en su forma canónica. */
export type Reconocimiento = Readonly<{ modulo: string; clave: string; texto: string | null }>;

/** Un control con su constancia de reconocimiento (cuándo y quién los pone la persistencia, con el contexto). */
export type ControlResuelto = Readonly<
  ControlDelDia & { reconocido: boolean; texto: string | null }
>;

export type ErrorDeCierre =
  | Readonly<{ codigo: "CONTROLES_CAMBIARON"; controles: readonly ControlDelDia[] }>
  | Readonly<{ codigo: "CONTROLES_QUE_BLOQUEAN"; claves: readonly string[] }>
  | Readonly<{ codigo: "CONTROLES_SIN_RECONOCER"; claves: readonly string[] }>
  | "RECONOCIMIENTO_INVALIDO";

/** Tope de reconocimientos por pedido: sobra para los controles de todos los módulos, y acota lo que se procesa. */
export const MAXIMO_DE_RECONOCIMIENTOS = 100;

/**
 * Valida y canoniza lo que pide reconocer, sin mirar todavía los controles: forma de módulo y clave (lista de permitidos), la clave es
 * del módulo, sin repetidos, el texto cumple la explicación y no se pasa del tope. Cualquier cosa fuera de eso es
 * `RECONOCIMIENTO_INVALIDO`.
 */
export function reconocimientosValidos(
  pedidos: readonly ReconocimientoPedido[],
): Resultado<readonly Reconocimiento[], "RECONOCIMIENTO_INVALIDO"> {
  if (pedidos.length > MAXIMO_DE_RECONOCIMIENTOS) return err("RECONOCIMIENTO_INVALIDO");
  const vistos = new Set<string>();
  const validos: Reconocimiento[] = [];
  for (const pedido of pedidos) {
    if (
      typeof pedido.modulo !== "string" ||
      typeof pedido.clave !== "string" ||
      !formaDeModuloValida(pedido.modulo) ||
      !formaDeClaveValida(pedido.clave) ||
      !claveDelModulo(pedido.modulo, pedido.clave) ||
      vistos.has(pedido.clave)
    ) {
      return err("RECONOCIMIENTO_INVALIDO");
    }
    const texto = explicacionDesdeTexto(pedido.texto);
    if (!texto.ok) return err("RECONOCIMIENTO_INVALIDO");
    vistos.add(pedido.clave);
    validos.push({ modulo: pedido.modulo, clave: pedido.clave, texto: texto.valor });
  }
  return ok(validos);
}

/**
 * Decide el cierre con los controles RECALCULADOS dentro de la transacción. En este orden (el primero que falla manda):
 *  1. la huella que se vio no es la de ahora → `CONTROLES_CAMBIARON` (con los controles actuales: la pantalla vuelve a mostrar);
 *  2. se reconoce algo que no es un control `RECONOCIBLE` con hallazgos → `RECONOCIMIENTO_INVALIDO`;
 *  3. algún `BLOQUEA` con hallazgos → `CONTROLES_QUE_BLOQUEAN`;
 *  4. algún `RECONOCIBLE` con hallazgos sin reconocer → `CONTROLES_SIN_RECONOCER`.
 * Si pasa, devuelve TODOS los controles (incluso los de cantidad 0 y los que solo informan) con su constancia de reconocimiento.
 */
export function decidirCierre(
  entrada: Readonly<{
    controles: readonly ControlDelDia[];
    huellaActual: string;
    huellaVista: string;
    reconocimientos: readonly Reconocimiento[];
  }>,
): Resultado<readonly ControlResuelto[], ErrorDeCierre> {
  const { controles, reconocimientos } = entrada;
  if (entrada.huellaVista !== entrada.huellaActual) {
    return err({ codigo: "CONTROLES_CAMBIARON", controles });
  }
  const porClave = new Map(controles.map((control) => [control.clave, control]));
  for (const reconocimiento of reconocimientos) {
    const control = porClave.get(reconocimiento.clave);
    if (control === undefined || !pideReconocimiento(control)) {
      return err("RECONOCIMIENTO_INVALIDO");
    }
  }
  const bloquean = controles.filter(impideCerrar).map((control) => control.clave);
  if (bloquean.length > 0) return err({ codigo: "CONTROLES_QUE_BLOQUEAN", claves: bloquean });
  const reconocidas = new Map(reconocimientos.map((r) => [r.clave, r.texto]));
  const sinReconocer = controles
    .filter((control) => pideReconocimiento(control) && !reconocidas.has(control.clave))
    .map((control) => control.clave);
  if (sinReconocer.length > 0) {
    return err({ codigo: "CONTROLES_SIN_RECONOCER", claves: sinReconocer });
  }
  return ok(
    controles.map((control) => ({
      ...control,
      reconocido: reconocidas.has(control.clave),
      texto: reconocidas.get(control.clave) ?? null,
    })),
  );
}

/**
 * ¿El pedido de cierre repite el que ya cerró la jornada? Sí si trae la misma huella, la misma observación y exactamente los mismos
 * reconocimientos (control y texto) que quedaron guardados: entonces `cerrarJornada` responde `yaEstabaCerrada` sin escribir. Cualquier
 * otra diferencia es otro cierre y recibe `JORNADA_CERRADA`. Previene: un doble clic o un reintento de red que duplique el cierre, y
 * que alguien «cierre otra vez» con otras explicaciones sobre una jornada congelada.
 */
export function repiteElCierre(
  cerrado: Readonly<{
    huellaDeCierre: string | null;
    observacion: string | null;
    reconocidos: readonly Readonly<{ clave: string; texto: string | null }>[];
  }>,
  pedido: Readonly<{
    huellaVista: string;
    observacion: string | null;
    reconocimientos: readonly Reconocimiento[];
  }>,
): boolean {
  if (cerrado.huellaDeCierre !== pedido.huellaVista) return false;
  if (cerrado.observacion !== pedido.observacion) return false;
  if (cerrado.reconocidos.length !== pedido.reconocimientos.length) return false;
  const guardados = new Map(cerrado.reconocidos.map((r) => [r.clave, r.texto]));
  return pedido.reconocimientos.every(
    (r) => guardados.has(r.clave) && guardados.get(r.clave) === r.texto,
  );
}
