/**
 * Estados y transiciones de la solicitud de alta (alta por solicitud §2.2). Dominio puro: sin reloj ni
 * azar, sin puertos, sin guard. La base impone la MISMA tabla con un disparador y con políticas por rol
 * (migración de captación); una prueba de integración compara ambas contra la base real.
 *
 * Por qué una sola tabla con los actores adentro: la lista de «qué estado pasa a cuál» y la de «quién
 * lo hace» se escriben juntas, así no pueden contradecirse (una transición sin quién, o un quién sin
 * transición, no se puede escribir).
 */

export const ESTADOS_DE_SOLICITUD = [
  "NUEVA",
  "VERIFICADA",
  "APROBADA",
  "ALTA_CREADA",
  "RECHAZADA",
  "SPAM",
] as const;

export type EstadoDeSolicitud = (typeof ESTADOS_DE_SOLICITUD)[number];

/**
 * Quién mueve la solicitud. `CAPTACION` es el interesado (sin cuenta, por el rol de la landing),
 * `ADMIN` un administrador de plataforma con rol ADMIN y `SISTEMA` el barrido. SOPORTE no decide
 * nunca: solo mira.
 */
export type ActorDeSolicitud = "CAPTACION" | "ADMIN" | "SISTEMA";

type Transicion = Readonly<{
  desde: EstadoDeSolicitud;
  hasta: EstadoDeSolicitud;
  actores: readonly ActorDeSolicitud[];
}>;

/** La tabla de §2.2. El reenvío (`NUEVA → NUEVA`) no cambia de estado y no figura. */
const TABLA: readonly Transicion[] = [
  { desde: "NUEVA", hasta: "VERIFICADA", actores: ["CAPTACION"] },
  { desde: "NUEVA", hasta: "RECHAZADA", actores: ["ADMIN", "SISTEMA"] },
  { desde: "NUEVA", hasta: "SPAM", actores: ["ADMIN"] },
  { desde: "VERIFICADA", hasta: "APROBADA", actores: ["ADMIN"] },
  { desde: "VERIFICADA", hasta: "RECHAZADA", actores: ["ADMIN"] },
  { desde: "VERIFICADA", hasta: "SPAM", actores: ["ADMIN"] },
  { desde: "APROBADA", hasta: "ALTA_CREADA", actores: ["ADMIN"] },
  { desde: "APROBADA", hasta: "RECHAZADA", actores: ["ADMIN"] },
];

const destinosDe = (estado: EstadoDeSolicitud): readonly EstadoDeSolicitud[] =>
  TABLA.filter((t) => t.desde === estado).map((t) => t.hasta);

/** A qué estados puede pasar cada uno (sin mirar quién). `ALTA_CREADA`, `RECHAZADA` y `SPAM` son terminales. */
export const TRANSICIONES_DE_SOLICITUD: Readonly<
  Record<EstadoDeSolicitud, readonly EstadoDeSolicitud[]>
> = {
  NUEVA: destinosDe("NUEVA"),
  VERIFICADA: destinosDe("VERIFICADA"),
  APROBADA: destinosDe("APROBADA"),
  // Las terminales no salen a ningún lado; que `TABLA` no las nombre como origen lo comprueba una prueba.
  ALTA_CREADA: [],
  RECHAZADA: [],
  SPAM: [],
};

/** ¿Puede `actor` llevar la solicitud de `desde` a `hasta`? Falso para cualquier par que no figure. */
export function transicionPermitida(
  desde: EstadoDeSolicitud,
  hasta: EstadoDeSolicitud,
  actor: ActorDeSolicitud,
): boolean {
  return TABLA.some((t) => t.desde === desde && t.hasta === hasta && t.actores.includes(actor));
}

/** Un estado terminal no sale nunca de ahí (solo se anonimiza, sin cambiar de estado). */
export function esTerminal(estado: EstadoDeSolicitud): boolean {
  return TRANSICIONES_DE_SOLICITUD[estado].length === 0;
}

/**
 * Abierta = todavía puede cambiar de estado (`NUEVA`, `VERIFICADA`, `APROBADA`). A lo sumo una abierta
 * por correo y marca: la impone el índice único parcial de la base (`solicitud_abierta_uk`).
 */
export function estaAbierta(estado: EstadoDeSolicitud): boolean {
  return !esTerminal(estado);
}
