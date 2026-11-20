/**
 * Lógica pura de la pantalla «Política de cambio de plan» (H-14b): validar el formulario, armar el resumen «antes → después», dar forma a la entrada que manda el navegador y a lo que
 * recibe la pantalla. Sin Next ni React. La consola NO calcula fechas ni sentidos de un cambio de plan: acá solo se muestran los tres números que decidió el servidor.
 * Previene: mandar al servidor un formulario sin motivo, un número que no es entero de días o un pedido con forma rara (el servidor vuelve a validar y manda). Chequeo: `test/plataforma/politica-de-plan.test.ts`.
 */
import { esDiasDeLaPoliticaDePlan } from "../../../src/primitivas/tiempo/dias-de-la-politica-de-plan";
import { LARGO_MAXIMO_DEL_MOTIVO } from "./entrada-del-plan";
import { textoDePlanes } from "./textos-de-planes";
import { fechaArgentinaDeInstante, fechaLegible } from "./vigencia";

export type DiasDeLaPolitica = Readonly<{ suba: number; baja: number; arrepentimiento: number }>;

/** Una versión de la política tal como la muestra la pantalla: serializable (fecha en ISO). */
export type VersionDePolitica = DiasDeLaPolitica &
  Readonly<{ version: number; motivo: string; definidaPor: string; creadoEn: string }>;

export type FormularioDePolitica = Readonly<{
  suba: string;
  baja: string;
  arrepentimiento: string;
  motivo: string;
}>;
export type CampoDePolitica = keyof FormularioDePolitica;
type FaltasDePolitica = Readonly<Partial<Record<CampoDePolitica, string>>>;

/** Lo que la pantalla precarga: los tres números vigentes y el motivo vacío. */
export function formularioInicial(vigente: DiasDeLaPolitica): FormularioDePolitica {
  return {
    suba: String(vigente.suba),
    baja: String(vigente.baja),
    arrepentimiento: String(vigente.arrepentimiento),
    motivo: "",
  };
}

/** Solo dígitos, de uno a tres (el tope 365 lo comprueba la primitiva): lo que la lista no nombra, no pasa. */
const FORMA_DE_DIAS = /^[0-9]{1,3}$/;

function diasDe(texto: string): number | null {
  const limpio = texto.trim();
  if (!FORMA_DE_DIAS.test(limpio)) return null;
  const n = Number(limpio);
  return esDiasDeLaPoliticaDePlan(n) ? n : null;
}

export type FormularioValidado =
  | Readonly<{ ok: true; dias: DiasDeLaPolitica; motivo: string }>
  | Readonly<{ ok: false; faltas: FaltasDePolitica }>;

/** Valida el formulario con las faltas aprobadas. El servidor lo vuelve a validar y manda. */
export function validarFormularioDePolitica(f: FormularioDePolitica): FormularioValidado {
  const suba = diasDe(f.suba);
  const baja = diasDe(f.baja);
  const arrepentimiento = diasDe(f.arrepentimiento);
  const motivo = f.motivo.trim();
  const faltaDeMotivo =
    motivo === ""
      ? textoDePlanes("plataforma.politica.falta_motivo")
      : motivo.length > LARGO_MAXIMO_DEL_MOTIVO
        ? textoDePlanes("plataforma.politica.motivo_largo")
        : undefined;
  if (suba !== null && baja !== null && arrepentimiento !== null && faltaDeMotivo === undefined)
    return { ok: true, dias: { suba, baja, arrepentimiento }, motivo };
  const faltaDias = textoDePlanes("plataforma.politica.falta_dias");
  return {
    ok: false,
    faltas: {
      ...(suba === null ? { suba: faltaDias } : {}),
      ...(baja === null ? { baja: faltaDias } : {}),
      ...(arrepentimiento === null ? { arrepentimiento: faltaDias } : {}),
      ...(faltaDeMotivo === undefined ? {} : { motivo: faltaDeMotivo }),
    },
  };
}

/** «1 día» / «3 días». */
export function diasConUnidad(n: number): string {
  return `${String(n)} ${textoDePlanes(n === 1 ? "plataforma.politica.unidad_dia" : "plataforma.politica.unidad_dias")}`;
}

/** Los tres números con su rótulo, para el resumen. */
function descripcion(d: DiasDeLaPolitica): string {
  return [
    `${textoDePlanes("plataforma.politica.rotulo_suba")}: ${diasConUnidad(d.suba)}`,
    `${textoDePlanes("plataforma.politica.rotulo_baja")}: ${diasConUnidad(d.baja)}`,
    `${textoDePlanes("plataforma.politica.rotulo_arrepentimiento")}: ${diasConUnidad(d.arrepentimiento)}`,
  ].join(" · ");
}

/** El resumen «antes → después» de la confirmación (T-15). */
export function resumenDelCambio(antes: DiasDeLaPolitica, despues: DiasDeLaPolitica): string {
  return textoDePlanes("plataforma.politica.resumen", {
    antes: descripcion(antes),
    despues: descripcion(despues),
  });
}

/** El pie del bloque «vigente» (T-7): quién, cuándo (día argentino) y con qué motivo. */
export function pieDeLaVersion(v: VersionDePolitica): string {
  return textoDePlanes("plataforma.politica.pie_vigente", {
    persona: v.definidaPor,
    fecha: fechaLegible(fechaArgentinaDeInstante(v.creadoEn)),
    motivo: v.motivo,
  });
}

/** El día argentino de la versión, para el historial. */
export function fechaDeLaVersion(v: VersionDePolitica): string {
  return fechaLegible(fechaArgentinaDeInstante(v.creadoEn));
}

// --- La entrada que manda el navegador --------------------------------------------------------------------

export type EntradaDeDefinirPolitica = Readonly<{
  claveDeIdempotencia: string;
  versionEsperada: number;
  diasDeAnticipacionDeSuba: number;
  diasDeAnticipacionDeBaja: number;
  diasDeArrepentimiento: number;
  motivo: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esRegistro = (v: unknown): v is Record<string, unknown> =>
  // Stryker disable next-line ConditionalExpression,LogicalOperator: un valor que no es objeto (texto, número, lista) desestructura a campos ausentes y las comprobaciones de abajo lo rechazan igual; solo `null` rompería (se prueba).
  typeof v === "object" && v !== null && !Array.isArray(v);
// Stryker disable next-line ConditionalExpression: `Number.isInteger` ya rechaza todo lo que no es número.
const esEntero = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/**
 * La forma de lo que manda el navegador al definir la política: tipos y tamaños (las claves que sobran se descartan). Que los días estén entre 0 y
 * `MAXIMO_DE_DIAS_DE_LA_POLITICA_DE_PLAN`, que el motivo no esté vacío y que la versión sea la vigente lo decide el caso de uso.
 */
export function entradaDeDefinirPolitica(
  entrada: unknown,
): { ok: true; valor: EntradaDeDefinirPolitica } | { ok: false } {
  // Stryker disable next-line ConditionalExpression: ver `esRegistro`: sin este corte, lo que no es objeto igual se rechaza abajo (salvo `null`, que lanzaría y se prueba).
  if (!esRegistro(entrada)) return { ok: false };
  const {
    claveDeIdempotencia,
    versionEsperada,
    diasDeAnticipacionDeSuba,
    diasDeAnticipacionDeBaja,
    diasDeArrepentimiento,
    motivo,
  } = entrada;
  // Stryker disable next-line ConditionalExpression: `UUID.test` convierte lo que no es texto a texto y ese texto no tiene forma de UUID.
  if (typeof claveDeIdempotencia !== "string" || !UUID.test(claveDeIdempotencia))
    return { ok: false };
  if (!esEntero(versionEsperada) || versionEsperada < 1) return { ok: false };
  if (
    !esEntero(diasDeAnticipacionDeSuba) ||
    !esEntero(diasDeAnticipacionDeBaja) ||
    !esEntero(diasDeArrepentimiento)
  )
    return { ok: false };
  if (typeof motivo !== "string" || motivo.length > LARGO_MAXIMO_DEL_MOTIVO * 4)
    return { ok: false };
  return {
    ok: true,
    valor: {
      claveDeIdempotencia,
      versionEsperada,
      diasDeAnticipacionDeSuba,
      diasDeAnticipacionDeBaja,
      diasDeArrepentimiento,
      motivo,
    },
  };
}
