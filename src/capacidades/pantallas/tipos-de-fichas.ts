import type { IdDeCamino } from "../datos/caminos";
import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";
import type { IdDeDecision } from "../vocabulario/uso-y-fuente-de-texto";

/**
 * Ficha de pantalla: pasos, campos, botones, modales, estados y textos declarados (decisión del dueño, fila 174 de
 * `Pedernal-docs/11-especificaciones/decisiones-del-dueno-2026-11.md`). Diseño y motivo: `ficha-de-pantalla-diseno.md` §2.
 *
 * Solo la FORMA, sin chequeo que la exija todavía (`fichas.ts` está vacío). Lo no declarado en una ficha no existe en la pantalla
 * (cerrado por defecto). Pasos y campos NO se repiten: son los de los `caminos` que la ficha recorre (una regla, un lugar).
 */

/** Los estados de una pantalla que la ficha puede declarar (lista cerrada). */
export const ESTADOS_DE_PANTALLA = [
  "CARGANDO",
  "VACIO",
  "ERROR",
  "SIN_PERMISO",
  "SOLO_LECTURA",
  "SIN_CONEXION",
] as const;
export type EstadoDePantalla = (typeof ESTADOS_DE_PANTALLA)[number];

/** Lo que hace un botón: envía una acción de permiso, navega a una ruta o abre un modal de la misma ficha (por su `id`). */
export type HaceUnBoton =
  Readonly<{ envia: ClaveAccion }> | Readonly<{ navega: string }> | Readonly<{ abre: string }>;

export type BotonDeFicha = Readonly<{
  /** El literal que lleva la prop `boton="…"` en el JSX. */
  id: string;
  texto: ClaveDeTexto;
  hace: HaceUnBoton;
  /** Qué pasa sin permiso. Sin permisos leídos, cierra (denegar por defecto). */
  sinPermiso: "APAGADO" | "OCULTO";
}>;

export type ModalDeFicha = Readonly<{
  id: string;
  titulo: ClaveDeTexto;
  botones: readonly BotonDeFicha[];
}>;

export type EntradaDeMenuDeFicha = Readonly<{
  /** Área y grupo del menú (`apps/web/ui/navegacion/menu.ts`): texto porque `src/` no importa de `apps/`. */
  area: string;
  grupo: string;
  clave: string;
  departamento: string | null;
}>;

/** La ficha está en construcción o terminada (con la decisión que la aprobó y la huella de su contenido). */
export type EstadoDeLaFicha =
  "EN_CONSTRUCCION" | Readonly<{ terminada: Readonly<{ decision: IdDeDecision; huella: string }> }>;

export type FichaDePantalla = Readonly<{
  /** Identificador de la pantalla (`medios-de-pago`). */
  id: string;
  /** Archivos de la pantalla (desde la raíz): donde se leen botones, campos, modales y textos. El módulo sale de la tabla de frontera. */
  archivos: readonly [string, ...string[]];
  rutas: readonly string[];
  titulo: ClaveDeTexto;
  /** Acción de LECTURA que abre la pantalla (la del guard). */
  acceso: ClaveAccion;
  entradaDeMenu: EntradaDeMenuDeFicha | null;
  /** Los caminos declarados que recorre; sus pasos y campos no se repiten acá. */
  caminos: readonly IdDeCamino[];
  /** El texto de cada CAMPO de esos caminos, por el nombre del campo: `Campo` recibe la etiqueta ya resuelta. */
  rotulos: Readonly<Record<string, ClaveDeTexto>>;
  botones: readonly BotonDeFicha[];
  modales: readonly ModalDeFicha[];
  /** Estados declarados: la clave del texto, o `GENERICO` si usa el mensaje genérico. */
  estados: Readonly<Partial<Record<EstadoDePantalla, ClaveDeTexto | "GENERICO">>>;
  /** Textos propios que no son rótulo de botón, modal ni estado (subtítulos, vacíos…). */
  textos: readonly ClaveDeTexto[];
  estadoDeLaFicha: EstadoDeLaFicha;
}>;
