import { createHash } from "node:crypto";
import type { ContextoOperativo } from "../../contexto/contexto";
import type { EmpresaId, SucursalId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../primitivas/tiempo/fecha-civil";

/**
 * EL PUNTO DE ENGANCHE DEL CIERRE DEL DÍA (E3b §3.4). `cierre` DECLARA este puerto; cada módulo que tiene algo que revisar al final del
 * día (caja, ventas, stock...) lo IMPLEMENTA y la composición lo REGISTRA. `cierre` no importa a ninguno de ellos (regla de arquitectura
 * `cierre-sin-negocio`): no sabe qué es un cobro, un ticket ni una reserva, solo cuántos hallazgos hay y cómo se llaman.
 * Previene: que el cierre dependa de los módulos que lo usan (ciclo) y que cada módulo invente su propia forma de «pendientes del día».
 * Puro: sin reloj ni azar. Chequeo: `aporte-al-cierre.test.ts` y la regla `cierre-sin-negocio` con su violación inyectada.
 */

export type Severidad = "BLOQUEA" | "RECONOCIBLE" | "INFORMA";

export const SEVERIDADES: readonly Severidad[] = ["BLOQUEA", "RECONOCIBLE", "INFORMA"];

/** Lo que un módulo entrega para que la pantalla navegue al detalle; `cierre` no la interpreta. Hasta `MAXIMO_DE_REFERENCIAS`. */
export type ReferenciaOpaca = string;

export const MAXIMO_DE_REFERENCIAS = 50;

/** La jornada a revisar. La empresa va explícita: los aportes filtran por ella y no se apoyan en lo que haya en el contexto. */
export type JornadaRef = Readonly<{
  empresaId: EmpresaId;
  sucursalId: SucursalId;
  fechaDeNegocio: FechaCivil;
}>;

export type ControlDelDia = Readonly<{
  modulo: string;
  /** `modulo.control` en minúsculas y guion bajo, p. ej. `caja.cobrado_contra_ticket`. */
  clave: string;
  severidad: Severidad;
  /** 0 = sin hallazgos. */
  cantidad: number;
  /** sha256 (hex) del detalle que el módulo mostraría: si el detalle cambia, la huella del día cambia. */
  huellaDelDetalle: string;
  referencias: readonly ReferenciaOpaca[];
}>;

/** Qué reconoce quien cierra (el texto es opcional, decisión 160): llega al aporte del módulo dueño del control. */
export type ReconocimientoDeControl = Readonly<{ clave: string; texto: string | null }>;

/** Un aporte que no se pudo leer, o que devolvió algo que rompe el contrato: el día no se cierra con un dato que no se pudo leer. */
export type ErrorDeAporte = "APORTE_NO_DISPONIBLE";

/**
 * Lo que implementa cada módulo. `TLectura` es la transacción que el aporte necesita para LEER (sus repositorios, sobre la misma conexión
 * que la del cierre) y `TEscritura` la que necesita para congelar. La composición pasa la misma transacción para ambas; los tipos
 * distinguen lo que cada método puede hacer.
 */
export interface AporteAlCierreDelDia<TLectura, TEscritura extends TLectura = TLectura> {
  readonly modulo: string;
  /** Los controles `BLOQUEA` que impiden EMPEZAR a contar el día (hoy, caja: sesiones sin cerrar). Solo lectura. */
  impedimentos(
    tx: TLectura,
    jornada: JornadaRef,
  ): Promise<Resultado<readonly ControlDelDia[], ErrorDeAporte>>;
  /** Todos los controles del módulo para la jornada. Solo lectura, determinista (sin reloj ni azar) y recalculable. */
  controles(
    tx: TLectura,
    jornada: JornadaRef,
  ): Promise<Resultado<readonly ControlDelDia[], ErrorDeAporte>>;
  /**
   * Congela lo suyo en la transacción del cierre. Si falla, no se cierra nada de nada. `reconocidos` son solo los controles de este módulo.
   */
  congelarEnTx(
    tx: TEscritura,
    contexto: ContextoOperativo,
    jornada: JornadaRef,
    reconocidos: readonly ReconocimientoDeControl[],
  ): Promise<Resultado<null, ErrorDeAporte>>;
}

export type RegistroDeAportes<
  TLectura,
  TEscritura extends TLectura = TLectura,
> = readonly AporteAlCierreDelDia<TLectura, TEscritura>[];

// Listas de permitidos: la forma de cada nombre y de la huella. Las repite la base (CHECK `control_modulo_ck`, `control_clave_ck`).
// fuente-unica: ajeno — coincide con el 40 del teléfono; es el largo máximo del nombre de un módulo del cierre, dato sin relación
const FORMA_DEL_MODULO = /^[a-z_]{1,40}$/;
const FORMA_DE_LA_CLAVE = /^[a-z_]+\.[a-z_]+$/;
const LARGO_MAXIMO_DE_LA_CLAVE = 81;
const FORMA_DE_LA_HUELLA = /^[0-9a-f]{64}$/;
/** `integer` de Postgres. */
const MAXIMO_DE_LA_CANTIDAD = 2_147_483_647;

export function formaDeModuloValida(modulo: string): boolean {
  return FORMA_DEL_MODULO.test(modulo);
}

export function formaDeClaveValida(clave: string): boolean {
  return clave.length <= LARGO_MAXIMO_DE_LA_CLAVE && FORMA_DE_LA_CLAVE.test(clave);
}

export function formaDeHuellaValida(huella: string): boolean {
  return FORMA_DE_LA_HUELLA.test(huella);
}

/** La clave de un control pertenece al módulo que la declara: `caja.x` es de `caja`. */
export function claveDelModulo(modulo: string, clave: string): boolean {
  return clave.startsWith(`${modulo}.`);
}

function controlValido(modulo: string, control: ControlDelDia): boolean {
  return (
    control.modulo === modulo &&
    formaDeModuloValida(control.modulo) &&
    formaDeClaveValida(control.clave) &&
    claveDelModulo(control.modulo, control.clave) &&
    SEVERIDADES.includes(control.severidad) &&
    Number.isSafeInteger(control.cantidad) &&
    control.cantidad >= 0 &&
    control.cantidad <= MAXIMO_DE_LA_CANTIDAD &&
    formaDeHuellaValida(control.huellaDelDetalle) &&
    control.referencias.length <= MAXIMO_DE_REFERENCIAS
  );
}

/**
 * Los controles que devolvió el aporte de `modulo`, comprobados contra el contrato: del módulo que los entrega, con la forma permitida,
 * sin claves repetidas. Cualquier otra cosa es `APORTE_NO_DISPONIBLE` (falla cerrado: el cierre nunca se apoya en un dato que no cumple
 * el contrato, ni lo guarda).
 */
export function controlesDelAporte(
  modulo: string,
  controles: readonly ControlDelDia[],
): Resultado<readonly ControlDelDia[], ErrorDeAporte> {
  const claves = new Set<string>();
  for (const control of controles) {
    if (!controlValido(modulo, control) || claves.has(control.clave)) {
      return err("APORTE_NO_DISPONIBLE");
    }
    claves.add(control.clave);
  }
  return ok(controles);
}

/** Orden total y estable de los controles: por módulo y por clave, comparando unidades de código (sin depender del idioma del servidor). */
export function ordenarControles<T extends Readonly<{ modulo: string; clave: string }>>(
  controles: readonly T[],
): T[] {
  const comparar = (a: string, b: string): number => (a < b ? -1 : Number(a !== b));
  return [...controles].sort((a, b) => comparar(a.modulo, b.modulo) || comparar(a.clave, b.clave));
}

/**
 * La huella del día: sha256 (hex) de la lista ORDENADA `(modulo, clave, severidad, cantidad, huellaDelDetalle)` (las referencias no
 * entran). Con los mismos datos da lo mismo; cualquier cambio de un control, de su cantidad o de su detalle da otra. Es lo que la
 * pantalla vio (`huellaVista`) y lo que `cerrarJornada` vuelve a calcular: nada se cierra con algo que nadie vio.
 */
export function huellaDeControles(controles: readonly ControlDelDia[]): string {
  const filas = ordenarControles(controles).map((c) => [
    c.modulo,
    c.clave,
    c.severidad,
    c.cantidad,
    c.huellaDelDetalle,
  ]);
  return createHash("sha256").update(JSON.stringify(filas)).digest("hex");
}

/** Lo que impide cerrar: `BLOQUEA` con hallazgos. */
export function impideCerrar(control: Pick<ControlDelDia, "severidad" | "cantidad">): boolean {
  return control.severidad === "BLOQUEA" && control.cantidad > 0;
}

/** Lo que hay que reconocer para cerrar: `RECONOCIBLE` con hallazgos. */
export function pideReconocimiento(
  control: Pick<ControlDelDia, "severidad" | "cantidad">,
): boolean {
  return control.severidad === "RECONOCIBLE" && control.cantidad > 0;
}
