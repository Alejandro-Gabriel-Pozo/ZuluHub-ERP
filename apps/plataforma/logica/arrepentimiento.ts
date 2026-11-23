/**
 * Lo puro del «deshacer por arrepentimiento» de un cambio de plan (H-14b): qué se muestra junto al último cambio, los textos de la confirmación y la forma de lo que manda el navegador. Sin Next ni React.
 * La consola NO decide si se puede deshacer ni calcula días, fechas o el sentido del cambio: lo recibe decidido del servidor (`condicionesDeCambioDePlan`) y solo lo muestra.
 * Previene: un botón que el servidor después rechaza porque la pantalla replicó una regla (plazo, último cambio, sentido). Chequeo: `test/plataforma/arrepentimiento.test.ts`.
 */
import { LARGO_MAXIMO_DEL_MOTIVO } from "./entrada-del-plan";
import { textoDePlanes } from "./textos-de-planes";
import { fechaLegible } from "./vigencia";

export type SentidoDelCambio = "SUBA" | "BAJA";

/** El último cambio de plan de un cliente tal como lo manda el servidor (fechas `AAAA-MM-DD`). */
export type UltimoCambioVista = Readonly<{
  numero: number;
  sentido: SentidoDelCambio | null;
  arrepentimientoHasta: string | null;
  yaArrepentido: boolean;
  puedeDeshacerHoy: boolean;
  vuelveA: Readonly<{ nombreComercial: string; versionNumero: number }> | null;
  /** Si este cambio nació de un arrepentimiento: el día (`AAAA-MM-DD`) del cambio que se deshizo. */
  deshizoElCambioDel: string | null;
}>;

export type QueSeMuestra =
  | Readonly<{ tipo: "NADA" }>
  | Readonly<{ tipo: "DESHECHO"; texto: string; etiqueta: string }>
  | Readonly<{
      tipo: "DESHACER";
      sentido: string | null;
      puedeHasta: string;
      ofreceElBoton: boolean;
    }>;

/** Qué se ve junto al último cambio. Sin permiso se ve la información pero no el botón (el servidor lo vuelve a exigir). */
export function queMostrarDelUltimoCambio(
  cambio: UltimoCambioVista | null,
  puedeArrepentir: boolean,
): QueSeMuestra {
  if (cambio === null) return { tipo: "NADA" };
  if (cambio.deshizoElCambioDel !== null) {
    return {
      tipo: "DESHECHO",
      etiqueta: textoDePlanes("plataforma.arrepentir.deshecho"),
      texto: textoDePlanes("plataforma.arrepentir.del_cambio", {
        fecha: fechaLegible(cambio.deshizoElCambioDel),
      }),
    };
  }
  if (cambio.yaArrepentido) {
    return {
      tipo: "DESHECHO",
      etiqueta: textoDePlanes("plataforma.arrepentir.deshecho"),
      texto: textoDePlanes("plataforma.arrepentir.ya_arrepentido"),
    };
  }
  if (!cambio.puedeDeshacerHoy || cambio.arrepentimientoHasta === null) return { tipo: "NADA" };
  return {
    tipo: "DESHACER",
    sentido:
      cambio.sentido === null
        ? null
        : textoDePlanes(
            cambio.sentido === "SUBA"
              ? "plataforma.arrepentir.etiqueta_suba"
              : "plataforma.arrepentir.etiqueta_baja",
          ),
    puedeHasta: textoDePlanes("plataforma.arrepentir.puede_hasta", {
      fecha: fechaLegible(cambio.arrepentimientoHasta),
    }),
    ofreceElBoton: puedeArrepentir,
  };
}

/** Los textos de la confirmación: a qué plan vuelve y desde cuándo, la consecuencia según el sentido y que no se repite. */
export function textosDeLaConfirmacion(
  cambio: UltimoCambioVista,
  hoy: string,
): Readonly<{ vuelve: string | null; consecuencia: string | null; noSeRepite: string }> {
  return {
    vuelve:
      cambio.vuelveA === null
        ? null
        : textoDePlanes("plataforma.arrepentir.vuelve", {
            plan: cambio.vuelveA.nombreComercial,
            fecha: fechaLegible(hoy),
          }),
    consecuencia:
      cambio.sentido === null
        ? null
        : textoDePlanes(
            cambio.sentido === "SUBA"
              ? "plataforma.arrepentir.consecuencia_suba"
              : "plataforma.arrepentir.consecuencia_baja",
          ),
    noSeRepite: textoDePlanes("plataforma.arrepentir.no_se_repite"),
  };
}

/** La explicación de la fecha mínima de la opción elegida (T-31 suba, T-32 baja), con los días que dijo el servidor. */
export function explicacionDeLaFechaMinima(sentido: SentidoDelCambio, dias: number): string {
  return textoDePlanes(
    sentido === "SUBA" ? "plataforma.arrepentir.minima_suba" : "plataforma.arrepentir.minima_baja",
    { n: dias },
  );
}

/** La falta de anticipación con la primera fecha posible (T-33). */
export function faltaDeAnticipacion(primeraFechaValida: string): string {
  return textoDePlanes("plataforma.arrepentir.falta_anticipacion", {
    fecha: fechaLegible(primeraFechaValida),
  });
}

// --- La entrada que manda el navegador --------------------------------------------------------------------

export type EntradaDeArrepentir = Readonly<{
  claveDeIdempotencia: string;
  tenantId: string;
  numero: number;
  numeroEsperado: number;
  motivo: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esRegistro = (v: unknown): v is Record<string, unknown> =>
  // Stryker disable next-line ConditionalExpression: lo que no es objeto (texto, número) desestructura a campos ausentes y las comprobaciones de abajo lo rechazan igual; `null` y las listas se prueban.
  typeof v === "object" && v !== null && !Array.isArray(v);
// Stryker disable next-line ConditionalExpression: `UUID.test` convierte lo que no es texto a texto y ese texto no tiene forma de UUID.
const esUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const esNumeroDeCambio = (v: unknown): v is number =>
  // Stryker disable next-line ConditionalExpression: `Number.isInteger` ya rechaza todo lo que no es número.
  typeof v === "number" && Number.isInteger(v) && v >= 1;

/**
 * La forma de lo que manda el navegador al deshacer un cambio: tipos y tamaños (las claves que sobran se descartan). Que el cambio sea del cliente, el último y esté en plazo lo decide el caso de uso;
 * el largo del motivo (y que no esté vacío) también: la forma solo corta lo absurdo.
 */
export function entradaDeArrepentir(
  entrada: unknown,
): { ok: true; valor: EntradaDeArrepentir } | { ok: false } {
  if (!esRegistro(entrada)) return { ok: false };
  const { claveDeIdempotencia, tenantId, numero, numeroEsperado, motivo } = entrada;
  if (!esUuid(claveDeIdempotencia) || !esUuid(tenantId)) return { ok: false };
  if (!esNumeroDeCambio(numero) || !esNumeroDeCambio(numeroEsperado)) return { ok: false };
  if (typeof motivo !== "string" || motivo.length > LARGO_MAXIMO_DEL_MOTIVO * 4)
    return { ok: false };
  return { ok: true, valor: { claveDeIdempotencia, tenantId, numero, numeroEsperado, motivo } };
}
