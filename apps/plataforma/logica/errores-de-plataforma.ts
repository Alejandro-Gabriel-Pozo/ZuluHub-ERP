/**
 * Traductor de errores de la consola de plataforma. `aRespuesta` de la web no conoce los códigos de plataforma,
 * así que la consola traduce acá. Puro: sin Next ni React. Nunca devuelve un código técnico ni datos de la base
 * como texto: lo que no se reconoce es INESPERADO y el servidor le pone una referencia.
 */

export type CampoDelAlta =
  "razonSocial" | "cuit" | "marcaId" | "versionDePlanId" | "emailGerente" | "zonaHoraria";

export type ErrorParaLaPantalla =
  | { tipo: "CAMPO"; campo: CampoDelAlta; texto: string }
  | { tipo: "GENERAL"; texto: string }
  | { tipo: "SEGUNDO_FACTOR" }
  | { tipo: "PANTALLA_VIEJA"; texto: string }
  | { tipo: "OCULTAR_ACCION" }
  | { tipo: "INESPERADO" };

const TEXTO_PANTALLA_VIEJA = "La pantalla quedó vieja. Volvé a abrirla y probá de nuevo.";
const TEXTO_ALTA_GENERAL = "No se pudo dar de alta la empresa. Revisá los datos.";
const TEXTO_FILTROS = "Los filtros no son válidos. Probá quitarlos.";
const TEXTO_MARCA = "Esa submarca no está lista para dar de alta empresas. Elegí otra.";
const TEXTO_PLAN = "No se puede usar ese plan. Elegí otra versión de plan.";

const campo = (c: CampoDelAlta, texto: string): ErrorParaLaPantalla => ({
  tipo: "CAMPO",
  campo: c,
  texto,
});
const general = (texto: string): ErrorParaLaPantalla => ({ tipo: "GENERAL", texto });

/** Códigos que se traducen sin datos adicionales. */
const POR_CODIGO: Readonly<Record<string, ErrorParaLaPantalla>> = {
  segundo_factor_reciente_requerido: { tipo: "SEGUNDO_FACTOR" },
  SIN_PERMISO: { tipo: "OCULTAR_ACCION" },
  CLAVE_REUTILIZADA: { tipo: "PANTALLA_VIEJA", texto: TEXTO_PANTALLA_VIEJA },
  CLAVE_DE_IDEMPOTENCIA_INVALIDA: { tipo: "PANTALLA_VIEJA", texto: TEXTO_PANTALLA_VIEJA },
  VERSION_DESACTUALIZADA: { tipo: "PANTALLA_VIEJA", texto: TEXTO_PANTALLA_VIEJA },
  INSTALACION_SINGLE_YA_TIENE_TENANT: { tipo: "INESPERADO" },

  CUIT_FORMATO_INVALIDO: campo(
    "cuit",
    "El CUIT no tiene un formato válido. Escribilo con 11 números.",
  ),
  CUIT_DIGITO_VERIFICADOR_INVALIDO: campo("cuit", "El CUIT no es válido. Revisá los números."),
  CUIT_INVALIDO: campo("cuit", "El CUIT no es válido. Revisá los números."),
  CUIT_DUPLICADO: campo("cuit", "Ya hay una empresa con ese CUIT."),
  RAZON_SOCIAL_INVALIDA: campo("razonSocial", "Escribí la razón social de la empresa."),
  NOMBRE_INVALIDO: campo("razonSocial", "Escribí un nombre válido."),
  EMAIL_INVALIDO: campo("emailGerente", "El correo no es válido. Revisalo."),
  EMAIL_DE_ADMIN_PLATAFORMA: campo(
    "emailGerente",
    "Ese correo no se puede usar para el primer gerente.",
  ),

  MARCA_INDEFINIDA: campo("marcaId", "Elegí una submarca."),
  MARCA_ID_INVALIDA: campo("marcaId", "Elegí una submarca de la lista."),
  MARCA_NO_ENCONTRADA: campo("marcaId", TEXTO_MARCA),
  MARCA_RETIRADA: campo("marcaId", "Esa submarca está retirada y no admite empresas nuevas."),
  MARCA_SIN_DEFINICION: campo("marcaId", TEXTO_MARCA),
  MARCA_SIN_DOMINIO: campo("marcaId", TEXTO_MARCA),

  MARCA_SIN_PLAN_POR_DEFECTO: campo(
    "versionDePlanId",
    "Esa submarca no tiene un plan por defecto. Elegí una versión de plan.",
  ),
  VERSION_DE_PLAN_ID_INVALIDA: campo("versionDePlanId", "Elegí una versión de plan de la lista."),
  VERSION_DE_PLAN_NO_ENCONTRADA: campo("versionDePlanId", TEXTO_PLAN),
  VERSION_DE_PLAN_NO_PUBLICADA: campo(
    "versionDePlanId",
    "Esa versión de plan todavía no está publicada. Elegí otra.",
  ),
  PLAN_RETIRADO: campo("versionDePlanId", "Ese plan está retirado. Elegí otro."),

  ZONA_HORARIA_INVALIDA: campo(
    "zonaHoraria",
    "La zona horaria no es válida. Elegí una de la lista.",
  ),

  MONEDA_NO_SOPORTADA: general("La moneda elegida no está disponible."),
  TENANT_AMBIGUO: general(TEXTO_ALTA_GENERAL),
  TENANT_ID_INVALIDO: general(TEXTO_ALTA_GENERAL),
  TENANT_INDEFINIDO: general(TEXTO_ALTA_GENERAL),
  TENANT_NO_ENCONTRADO: general(TEXTO_ALTA_GENERAL),
  TENANT_NO_ACTIVO: general(TEXTO_ALTA_GENERAL),
  PLAN_SOLO_CON_TENANT_NUEVO: general(TEXTO_ALTA_GENERAL),
  MARCA_SOLO_CON_TENANT_NUEVO: general(TEXTO_ALTA_GENERAL),

  LIMITE_INVALIDO: general(TEXTO_FILTROS),
  CURSOR_INVALIDO: general(TEXTO_FILTROS),
  ID_INVALIDO: general(TEXTO_FILTROS),
  FILTRO_INVALIDO: general(TEXTO_FILTROS),
  ESTADO_INVALIDO: general(TEXTO_FILTROS),
  ESTADO_EFECTIVO_INVALIDO: general(TEXTO_FILTROS),
};

const INESPERADO: ErrorParaLaPantalla = { tipo: "INESPERADO" };

const esRegistro = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

const esNumeroFinito = (valor: unknown): valor is number =>
  typeof valor === "number" && Number.isFinite(valor);

function textoDeLimiteDelPlan(datos: Record<string, unknown>): string {
  if (datos["perilla"] !== "empresas_por_tenant") return TEXTO_ALTA_GENERAL;
  const { limite, usoActual } = datos;
  if (!esNumeroFinito(limite) || !esNumeroFinito(usoActual)) {
    return "El plan no permite dar de alta más empresas.";
  }
  return `El plan permite ${String(limite)} empresas y ya tiene ${String(usoActual)}.`;
}

/**
 * Traduce lo que devuelve un caso de uso o una consulta de plataforma. Texto = código; objeto con `codigo` =
 * código con datos; cualquier otra cosa (incluido un error de persistencia) es INESPERADO y no se muestra.
 */
export function errorParaLaPantalla(error: unknown): ErrorParaLaPantalla {
  let codigo: string;
  let datos: Record<string, unknown> = {};
  if (typeof error === "string") {
    codigo = error;
  } else if (esRegistro(error) && typeof error["codigo"] === "string") {
    codigo = error["codigo"];
    datos = error;
  } else {
    return INESPERADO;
  }
  if (codigo === "LIMITE_DEL_PLAN") return general(textoDeLimiteDelPlan(datos));
  if (!Object.hasOwn(POR_CODIGO, codigo)) return INESPERADO;
  return POR_CODIGO[codigo] ?? INESPERADO;
}
