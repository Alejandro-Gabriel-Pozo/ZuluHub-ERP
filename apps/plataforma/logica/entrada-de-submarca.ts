/**
 * La forma de lo que el navegador manda al guardar el borrador y al confirmar una versión de submarca. El
 * navegador NO es de confianza: acá se comprueba solo la FORMA (tipos, largos y claves permitidas). Los colores
 * (`#rrggbb`), los valores del aspecto y las reglas de negocio los decide el caso de uso. Lo que no está en la
 * lista se descarta: una clave de más nunca llega al caso.
 */
import type { CambiosDelBorrador } from "./submarca";

export type EntradaDelBorrador = Readonly<{
  claveDeIdempotencia: string;
  marcaId: string;
  versionEsperada: number | null;
  cambios: CambiosDelBorrador;
}>;

export type EntradaDeLaConfirmacion = Readonly<{
  claveDeIdempotencia: string;
  marcaId: string;
  /** La `version` del borrador que la persona vio al abrir la ventana: un entero de 1 en adelante, nunca `null`. */
  versionEsperada: number;
  /** AAAA-MM-DD: la acción la convierte a instante con `instanteDeVigencia`. */
  vigenteDesde: string;
  motivo: string;
  reemplazaProgramada: boolean;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const LARGO_MAXIMO_DE_NOMBRE = 200;
const LARGO_MAXIMO_DE_COLOR = 20;
const LARGO_MAXIMO_DE_ASPECTO = 40;
const LARGO_MAXIMO_DEL_MOTIVO = 2000;

const TOKENS_DE_TEMA = ["primary", "on-primary", "secondary", "accent"] as const;
const TOKENS_DE_ASPECTO = ["estilo", "superficie", "esquinas", "titulos", "ingreso"] as const;

const esRegistro = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

function uuidDe(valor: unknown): string | null {
  return typeof valor === "string" && UUID.test(valor) ? valor : null;
}

function textoDe(valor: unknown, maximo: number): string | null {
  if (typeof valor !== "string") return null;
  return valor.length >= 1 && valor.length <= maximo ? valor : null;
}

/** Un objeto con EXACTAMENTE esas claves, cada una con un texto corto; nada más se copia. */
function textosDe<C extends string>(
  valor: unknown,
  claves: readonly C[],
  maximo: number,
  { completo }: { completo: boolean },
): Record<C, string> | null {
  if (!esRegistro(valor)) return null;
  const salida: Partial<Record<C, string>> = {};
  for (const clave of claves) {
    if (!Object.hasOwn(valor, clave)) {
      if (completo) return null;
      continue;
    }
    const texto = valor[clave];
    if (typeof texto !== "string" || texto.length > maximo) return null;
    salida[clave] = texto;
  }
  return salida as Record<C, string>;
}

function cambiosDe(valor: unknown): CambiosDelBorrador | null {
  if (!esRegistro(valor)) return null;
  const cambios: {
    nombreVisible?: string;
    tema?: Record<(typeof TOKENS_DE_TEMA)[number], string>;
    aspecto?: Record<(typeof TOKENS_DE_ASPECTO)[number], string>;
  } = {};
  if (Object.hasOwn(valor, "nombreVisible")) {
    const nombre = textoDe(valor["nombreVisible"], LARGO_MAXIMO_DE_NOMBRE);
    if (nombre === null) return null;
    cambios.nombreVisible = nombre;
  }
  if (Object.hasOwn(valor, "tema")) {
    const tema = textosDe(valor["tema"], TOKENS_DE_TEMA, LARGO_MAXIMO_DE_COLOR, {
      completo: false,
    });
    if (tema === null) return null;
    cambios.tema = tema;
  }
  if (Object.hasOwn(valor, "aspecto")) {
    // Parcial: lo que no se manda sigue heredando (o rige el defecto); el caso de uso valida cada valor.
    const aspecto = textosDe(valor["aspecto"], TOKENS_DE_ASPECTO, LARGO_MAXIMO_DE_ASPECTO, {
      completo: false,
    });
    if (aspecto === null) return null;
    cambios.aspecto = aspecto;
  }
  return cambios as CambiosDelBorrador;
}

export function entradaDelBorrador(
  entrada: unknown,
): { ok: true; valor: EntradaDelBorrador } | { ok: false } {
  if (!esRegistro(entrada)) return { ok: false };
  const claveDeIdempotencia = uuidDe(entrada["claveDeIdempotencia"]);
  const marcaId = uuidDe(entrada["marcaId"]);
  const version = entrada["versionEsperada"];
  const versionEsperada =
    version === null
      ? null
      : typeof version === "number" && Number.isInteger(version) && version >= 0
        ? version
        : undefined;
  const cambios = cambiosDe(entrada["cambios"]);
  if (
    claveDeIdempotencia === null ||
    marcaId === null ||
    versionEsperada === undefined ||
    cambios === null
  ) {
    return { ok: false };
  }
  return { ok: true, valor: { claveDeIdempotencia, marcaId, versionEsperada, cambios } };
}

export function entradaDeLaConfirmacion(
  entrada: unknown,
): { ok: true; valor: EntradaDeLaConfirmacion } | { ok: false } {
  if (!esRegistro(entrada)) return { ok: false };
  const claveDeIdempotencia = uuidDe(entrada["claveDeIdempotencia"]);
  const marcaId = uuidDe(entrada["marcaId"]);
  const version = entrada["versionEsperada"];
  const versionEsperada =
    typeof version === "number" && Number.isInteger(version) && version >= 1 ? version : null;
  const fecha = entrada["vigenteDesde"];
  const vigenteDesde = typeof fecha === "string" && FECHA.test(fecha) ? fecha : null;
  const crudo = entrada["motivo"];
  const motivo = typeof crudo === "string" ? crudo.trim() : "";
  const reemplaza = entrada["reemplazaProgramada"];
  if (
    claveDeIdempotencia === null ||
    marcaId === null ||
    versionEsperada === null ||
    vigenteDesde === null ||
    motivo.length < 1 ||
    motivo.length > LARGO_MAXIMO_DEL_MOTIVO ||
    typeof reemplaza !== "boolean"
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    valor: {
      claveDeIdempotencia,
      marcaId,
      versionEsperada,
      vigenteDesde,
      motivo,
      reemplazaProgramada: reemplaza,
    },
  };
}
