/**
 * Traductor de errores de la consola de plataforma. `aRespuesta` de la web no conoce los códigos de plataforma,
 * así que la consola traduce acá. Puro: sin Next ni React. Nunca devuelve un código técnico ni datos de la base
 * como texto: lo que no se reconoce es INESPERADO y el servidor le pone una referencia.
 */

export type CampoDelAlta =
  "razonSocial" | "cuit" | "marcaId" | "versionDePlanId" | "emailGerente" | "zonaHoraria";

export type CampoDeSubmarca =
  | "nombreVisible"
  | "primary"
  | "onPrimary"
  | "secondary"
  | "accent"
  | "estilo"
  | "superficie"
  | "esquinas"
  | "titulos"
  | "ingreso"
  | "vigenteDesde"
  | "motivo";

export type ErrorParaLaPantalla =
  | { tipo: "CAMPO"; campo: CampoDelAlta | CampoDeSubmarca; texto: string }
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

const campo = (c: CampoDelAlta | CampoDeSubmarca, texto: string): ErrorParaLaPantalla => ({
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

  // Submarca (guardar borrador y confirmar versión). Textos fijos: nada del cliente se interpola.
  NOMBRE_DE_MARCA_INVALIDO: campo(
    "nombreVisible",
    "El nombre tiene que tener entre 1 y 60 letras, sin símbolos raros.",
  ),
  MOTIVO_OBLIGATORIO: campo("motivo", "Escribí el motivo del cambio."),
  MOTIVO_DEMASIADO_LARGO: campo("motivo", "El motivo es demasiado largo."),
  VIGENCIA_INVALIDA: campo("vigenteDesde", "Elegí una fecha válida."),
  VIGENCIA_RETROACTIVA: campo("vigenteDesde", "La fecha tiene que ser posterior a hoy."),
  CAMBIO_PROGRAMADO_PENDIENTE: general(
    "Ya hay un cambio programado. Tildá «Reemplazar el cambio programado» para confirmar este.",
  ),
  SIN_BORRADOR: general("No hay un borrador para confirmar. Guardá primero los cambios."),
  MODULO_INICIAL_FUERA_DEL_PLAN: general(
    "Hay un módulo inicial que el plan por defecto no incluye.",
  ),
  MODULO_DESCONOCIDO: general("Hay un módulo inicial que el plan por defecto no incluye."),
  LOGO_INVALIDO: general("El logo no es válido."),
  CLAVE_DE_TEXTO_DESCONOCIDA: general("Hay un texto de la marca que no se reconoce."),
  TEXTO_INVALIDO: general("Hay un texto de la marca que no es válido."),
  MARCADORES_DISTINTOS: general("Un texto de la marca no conserva sus marcadores."),
  PLAN_NO_ENCONTRADO: general("No se encontró el plan por defecto de la submarca."),
  PLAN_POR_DEFECTO_RETIRADO: general("El plan por defecto de la submarca está retirado."),
  VERSION_ESPERADA_INVALIDA: general(
    "La versión que se esperaba no es válida. Recargá la pantalla.",
  ),
  ConcurrenciaAgotada: general("Se estaba guardando otro cambio a la vez. Probá de nuevo."),

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

const TEXTO_SUBMARCA_VIEJA = "La pantalla quedó vieja. Volvé a abrirla.";

/** En la pantalla de submarca estos códigos significan otra cosa que en el alta o en los filtros. */
const POR_CODIGO_DE_SUBMARCA: Readonly<Record<string, ErrorParaLaPantalla>> = {
  MARCA_NO_ENCONTRADA: { tipo: "PANTALLA_VIEJA", texto: TEXTO_SUBMARCA_VIEJA },
  MARCA_RETIRADA: { tipo: "PANTALLA_VIEJA", texto: TEXTO_SUBMARCA_VIEJA },
  ID_INVALIDO: { tipo: "PANTALLA_VIEJA", texto: TEXTO_SUBMARCA_VIEJA },
  VERSION_DESACTUALIZADA: {
    tipo: "PANTALLA_VIEJA",
    texto:
      "Alguien más cambió el borrador. Recargá la pantalla para ver sus cambios antes de guardar los tuyos.",
  },
};

const CAMPO_DE_TEMA: Readonly<Record<string, CampoDeSubmarca>> = {
  primary: "primary",
  "on-primary": "onPrimary",
  secondary: "secondary",
  accent: "accent",
};
const CAMPO_DE_ASPECTO: Readonly<Record<string, CampoDeSubmarca>> = {
  estilo: "estilo",
  superficie: "superficie",
  esquinas: "esquinas",
  titulos: "titulos",
  ingreso: "ingreso",
};
const CAMPO_DE_PAR: Readonly<Record<string, CampoDeSubmarca>> = {
  "on-primary/primary": "onPrimary",
  "accent/fondo": "accent",
  "accent/superficie": "accent",
};
const RUBRO_FALTANTE: Readonly<Record<string, string>> = {
  nombre_visible: "el nombre visible",
  "tema.primary": "el color principal",
  "tema.on-primary": "el texto sobre el principal",
  "tema.secondary": "el color secundario",
  "tema.accent": "el acento",
  logo: "el logo (todavía no se puede cargar desde la consola)",
  modulos_iniciales: "los módulos iniciales",
  plan_por_defecto: "el plan por defecto",
};

/** Busca el valor en una tabla cerrada; lo que no es texto o no está en la tabla da `undefined`. */
function buscar<T>(tabla: Readonly<Record<string, T>>, clave: unknown): T | undefined {
  return typeof clave === "string" && Object.hasOwn(tabla, clave) ? tabla[clave] : undefined;
}

function textoDeDefinicionIncompleta(faltan: unknown): string {
  const sinLista = "Todavía falta completar la definición de la submarca.";
  if (!Array.isArray(faltan)) return sinLista;
  const rubros: string[] = [];
  for (const f of faltan as unknown[]) {
    const rubro = buscar(RUBRO_FALTANTE, f);
    if (rubro !== undefined) rubros.push(rubro);
  }
  return rubros.length === 0 ? sinLista : `Todavía falta completar: ${rubros.join(", ")}.`;
}

/** Los códigos de submarca que traen datos del cliente; el dato solo elige el campo, nunca entra al texto. */
function errorDeSubmarcaConDatos(
  codigo: string,
  datos: Record<string, unknown>,
): ErrorParaLaPantalla | null {
  switch (codigo) {
    case "TEMA_INVALIDO": {
      const texto = "Ese color no es válido. Usá el formato #rrggbb.";
      const c = buscar(CAMPO_DE_TEMA, datos["token"]);
      return c === undefined ? general(texto) : campo(c, texto);
    }
    case "ASPECTO_INVALIDO": {
      const texto = "Esa opción no es válida.";
      const c = buscar(CAMPO_DE_ASPECTO, datos["token"]);
      return c === undefined ? general(texto) : campo(c, texto);
    }
    case "CONTRASTE_INSUFICIENTE": {
      const texto = "No se lee: elegí un color con más contraste sobre esa superficie.";
      const c = buscar(CAMPO_DE_PAR, datos["par"]);
      return c === undefined ? general(texto) : campo(c, texto);
    }
    case "DEFINICION_INCOMPLETA":
      return general(textoDeDefinicionIncompleta(datos["faltan"]));
    default:
      return null;
  }
}

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
export function errorParaLaPantalla(
  error: unknown,
  contexto: "GENERAL" | "SUBMARCA" = "GENERAL",
): ErrorParaLaPantalla {
  let codigo: string;
  let datos: Record<string, unknown> = {};
  if (typeof error === "string") {
    codigo = error;
  } else if (esRegistro(error) && typeof error["codigo"] === "string") {
    codigo = error["codigo"];
    datos = error;
  } else if (esRegistro(error) && error["tipo"] === "ConcurrenciaAgotada") {
    codigo = "ConcurrenciaAgotada";
  } else {
    return INESPERADO;
  }
  const deSubmarca = errorDeSubmarcaConDatos(codigo, datos);
  if (deSubmarca !== null) return deSubmarca;
  if (contexto === "SUBMARCA" && Object.hasOwn(POR_CODIGO_DE_SUBMARCA, codigo)) {
    return POR_CODIGO_DE_SUBMARCA[codigo] ?? INESPERADO;
  }
  if (codigo === "LIMITE_DEL_PLAN") return general(textoDeLimiteDelPlan(datos));
  if (!Object.hasOwn(POR_CODIGO, codigo)) return INESPERADO;
  return POR_CODIGO[codigo] ?? INESPERADO;
}
