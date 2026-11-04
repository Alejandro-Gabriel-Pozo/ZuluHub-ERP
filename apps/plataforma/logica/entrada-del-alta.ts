/**
 * La forma de lo que el navegador manda al alta de una empresa. El navegador NO es de confianza: acá se comprueba
 * solo la FORMA (tipos y largos). El CUIT, el email y el resto de las reglas del alta los decide el caso de uso.
 * Lo que no está en la lista se descarta: un campo de más nunca llega al caso.
 */

export type EntradaDelAlta = Readonly<{
  claveDeIdempotencia: string;
  razonSocial: string;
  cuit: string;
  marcaId: string;
  versionDePlanId: string | null;
  emailGerente: string;
  zonaHoraria: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function textoDe(valor: unknown, maximo: number): string | null {
  if (typeof valor !== "string") return null;
  return valor.length >= 1 && valor.length <= maximo ? valor : null;
}

function uuidDe(valor: unknown): string | null {
  return typeof valor === "string" && UUID.test(valor) ? valor : null;
}

export function entradaDelAlta(
  entrada: unknown,
): { ok: true; valor: EntradaDelAlta } | { ok: false } {
  if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) {
    return { ok: false };
  }
  const campos = entrada as Record<string, unknown>;
  const claveDeIdempotencia = uuidDe(campos["claveDeIdempotencia"]);
  const razonSocial = textoDe(campos["razonSocial"], 200);
  const cuit = textoDe(campos["cuit"], 20);
  const marcaId = uuidDe(campos["marcaId"]);
  const emailGerente = textoDe(campos["emailGerente"], 254);
  const zonaHoraria = textoDe(campos["zonaHoraria"], 64);
  const plan = campos["versionDePlanId"];
  const versionDePlanId = plan === null ? null : uuidDe(plan);
  if (
    claveDeIdempotencia === null ||
    razonSocial === null ||
    cuit === null ||
    marcaId === null ||
    emailGerente === null ||
    zonaHoraria === null ||
    (plan !== null && versionDePlanId === null)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    valor: {
      claveDeIdempotencia,
      razonSocial,
      cuit,
      marcaId,
      versionDePlanId,
      emailGerente,
      zonaHoraria,
    },
  };
}
