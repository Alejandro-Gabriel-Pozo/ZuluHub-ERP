import { describirFallaDeBase } from "../src/adaptadores/postgres/describir-falla-de-base";
import { MENSAJES_DE_ERROR_DE_DOMINIOS } from "../src/plataforma/casos-de-uso/mensajes-de-dominios";
import type { ErrorDeLinea, ProblemaDeForma } from "../src/plataforma/dominio/pedido-de-caso";

/**
 * Los textos de `ejecutar-caso-de-plataforma`, en castellano rioplatense. Dicen QUÉ pasó y QUÉ hacer; nunca
 * repiten un valor del archivo (un CUIT, un email) ni nada del entorno. Un código que no tiene texto propio se
 * muestra tal cual: es un nombre estable y documentado, y se entiende mejor que un mensaje inventado.
 */

export const USO =
  "Uso: npm run plataforma:caso -- <caso> <archivo.json> --admin-email <email del administrador>";

export const MENSAJES_DE_LINEA: Readonly<Record<ErrorDeLinea, string>> = {
  FALTA_EL_CASO: "Falta el nombre del caso.",
  FALTA_EL_ARCHIVO: "Falta el archivo .json con los datos del caso.",
  FALTA_EL_EMAIL_DEL_ADMIN:
    "Falta --admin-email: el email del administrador de plataforma que hace el cambio.",
  SOBRAN_ARGUMENTOS: "Sobran argumentos: son solo el caso, el archivo y --admin-email.",
  OPCION_DESCONOCIDA: "Hay una opción que no existe: la única es --admin-email.",
  OPCION_REPETIDA: "--admin-email está repetida.",
};

const DESCRIPCION_DE_TIPO: Readonly<Record<NonNullable<ProblemaDeForma["esperado"]>, string>> = {
  clave: "un texto de 16 a 128 caracteres (letras, números, guion y guion bajo)",
  texto: "un texto",
  textoONulo: "un texto o null",
  id: "un identificador (uuid) escrito entre comillas",
  idONulo: "un identificador (uuid) entre comillas, o null",
  versionONula: "un número entero, o null si no había borrador",
  numeroONulo: "un número entero, o null si no había ninguna",
  booleano: "true o false",
  vigencia: 'una fecha y hora con zona, por ejemplo "2026-10-20T12:00:00-03:00"',
  motivo: "un texto",
  objeto: "un objeto { ... }",
  mapaDeTextos: "un objeto cuyos valores son todos textos",
  listaDeTextos: "una lista de textos",
  listaDeTextosONula: "una lista de textos, o null",
  duenio: '{ "tipo": "MARCA", "marcaId": "..." } o { "tipo": "EMPRESA", "empresaId": "..." }',
};

/** Los motivos que no dependen del caso: se usan en el archivo y en el resultado. */
export const MENSAJES_DE_MOTIVO: Readonly<Record<string, string>> = {
  ...MENSAJES_DE_ERROR_DE_DOMINIOS,
  SIN_PERMISO: "Ese administrador no tiene permiso para hacer esto.",
  CLAVE_DE_IDEMPOTENCIA_INVALIDA:
    "La clave de idempotencia no sirve: tiene que ser un texto de 16 a 128 caracteres (letras, números, guion y guion bajo).",
  CLAVE_REUTILIZADA:
    "Esa clave de idempotencia ya se usó con OTROS datos. Para repetir el mismo pedido, usá el mismo archivo; para otro pedido, una clave nueva.",
  ID_INVALIDO: "Hay un identificador que no tiene la forma de un uuid.",
  VERSION_DESACTUALIZADA:
    "Otra persona cambió esto mientras tanto. Volvé a mirar el estado actual y repetí con los datos al día.",
  VERSION_ESPERADA_INVALIDA: "La versión esperada tiene que ser un entero desde 1, o null.",
  NUMERO_ESPERADO_INVALIDO: "El número esperado tiene que ser un entero desde 1, o null.",
  VIGENCIA_INVALIDA: "La fecha de vigencia no es una fecha válida con zona.",
  VIGENCIA_RETROACTIVA: "La vigencia no puede ser anterior a ahora.",
  MOTIVO_DEMASIADO_LARGO: "El motivo es demasiado largo (hasta 500 caracteres).",
  MOTIVO_OBLIGATORIO: "Hay que escribir el motivo.",
  CAMBIO_PROGRAMADO_PENDIENTE:
    "Hay un cambio programado que este deja sin efecto: si es lo que querés, poné reemplazaProgramada en true.",
  CODIGO_DE_MARCA_INVALIDO:
    "El código de la marca no sirve: minúsculas, dígitos y guion, de 2 a 40 caracteres, y empieza con letra.",
  CODIGO_DE_MARCA_OCUPADO: "Ya existe una marca con ese código y otro padre.",
  CODIGO_DE_PLAN_INVALIDO:
    "El código del plan no sirve: minúsculas, dígitos y guion, de 2 a 40 caracteres, y empieza con letra.",
  PLAN_NO_ENCONTRADO: "No se encontró el plan indicado.",
  PLAN_RETIRADO: "El plan está retirado y no admite cambios.",
  NOMBRE_DE_PLAN_INVALIDO:
    "El nombre comercial del plan no sirve (está vacío o es demasiado largo).",
  SIN_BORRADOR: "No hay un borrador para publicar: guardalo primero.",
  VERSION_DE_PLAN_NO_ENCONTRADA: "No se encontró esa versión de plan.",
  VERSION_DE_PLAN_NO_PUBLICADA: "Esa versión de plan todavía no está publicada.",
  TENANT_NO_ENCONTRADO: "No se encontró el cliente (tenant) indicado.",
  TENANT_NO_ACTIVO: "El cliente (tenant) no está activo: no admite altas.",
  NOMBRE_INVALIDO: "El nombre del cliente (tenant) no sirve.",
  RAZON_SOCIAL_INVALIDA: "La razón social no sirve.",
  CUIT_FORMATO_INVALIDO: "El CUIT no tiene 11 dígitos.",
  CUIT_DIGITO_VERIFICADOR_INVALIDO: "El CUIT tiene mal el dígito verificador.",
  CUIT_INVALIDO: "El CUIT no es válido.",
  CUIT_DUPLICADO: "Ya hay una empresa vigente con ese CUIT.",
  ZONA_HORARIA_INVALIDA:
    "La zona horaria no es una zona válida (por ejemplo America/Argentina/Buenos_Aires).",
  MONEDA_NO_SOPORTADA: "La moneda no está soportada.",
  EMAIL_INVALIDO: "El email del gerente no tiene forma de email.",
  EMAIL_DE_ADMIN_PLATAFORMA:
    "Ese email es el de un administrador de plataforma, que no puede ser gerente de una empresa.",
  TENANT_AMBIGUO: "Hay que dar tenantId (cliente existente) o nombreDeTenant (nuevo), no los dos.",
  TENANT_INDEFINIDO: "Falta tenantId (cliente existente) o nombreDeTenant (cliente nuevo).",
  TENANT_ID_INVALIDO: "El tenantId no tiene forma de uuid.",
  MARCA_ID_INVALIDA: "La marcaId no tiene forma de uuid.",
  MARCA_INDEFINIDA: "Un cliente nuevo necesita marcaId.",
  MARCA_SOLO_CON_TENANT_NUEVO:
    "La marcaId solo va con un cliente nuevo; uno existente ya tiene la suya.",
  PLAN_SOLO_CON_TENANT_NUEVO:
    "La versionDePlanId solo va con un cliente nuevo; a uno existente se le cambia el plan con asignarPlan.",
  VERSION_DE_PLAN_ID_INVALIDA: "La versionDePlanId no tiene forma de uuid.",
  MARCA_SIN_PLAN_POR_DEFECTO: "La marca no tiene un plan por defecto con una versión publicada.",
  MARCA_SIN_DEFINICION: "La marca no tiene una versión confirmada y vigente con nombre.",
  MARCA_SIN_DOMINIO: "La marca no tiene un host canónico activo de la aplicación.",
  INSTALACION_SINGLE_YA_TIENE_TENANT:
    "Esta instalación es de un solo cliente y ya tiene uno: no admite otro.",
  FUNCION_NO_INCLUIDA: "El plan del cliente no incluye esa función.",
  LIMITE_DEL_PLAN: "Se llegó al tope que fija el plan del cliente.",
  MODULO_DESCONOCIDO: "Ese módulo no existe en el catálogo.",
  MODULO_OBLIGATORIO: "Ese módulo es obligatorio: está siempre activo y no se cambia.",
  MODULO_FUERA_DEL_PLAN: "El plan de la empresa no incluye ese módulo.",
  REQUIERE_INACTIVO: "Ese módulo necesita otro que todavía no está activo.",
  ES_REQUERIDO_POR: "Otro módulo activo necesita a este: desactivá primero ese.",
  EMPRESA_NO_ENCONTRADA: "No se encontró la empresa indicada.",
  MARCA_NO_ENCONTRADA: "No se encontró la marca indicada.",
  MARCA_RETIRADA: "La marca está retirada y no admite cambios.",
  TEMA_INVALIDO: "Hay un color del tema que no sirve (se espera #rrggbb).",
  CONTRASTE_INSUFICIENTE: "Hay una combinación de colores con poco contraste para leer.",
};

/** El texto de un motivo: el propio si lo tiene; si no, el código mismo. */
export function textoDeMotivo(codigo: string): string {
  return Object.hasOwn(MENSAJES_DE_MOTIVO, codigo)
    ? (MENSAJES_DE_MOTIVO[codigo] as string)
    : `No se hizo ningún cambio. Motivo: ${codigo}.`;
}

/** Un problema de la forma del archivo, en una línea. Nunca repite el valor que había en el campo. */
export function textoDeProblema(problema: ProblemaDeForma): string {
  const { campo, motivo, esperado } = problema;
  const donde = campo === null ? "En el archivo" : `En el campo «${campo}»`;
  switch (motivo) {
    case "FALTA":
      return `${donde}: falta${esperado === null ? "" : `; tiene que ser ${DESCRIPCION_DE_TIPO[esperado]}`}.`;
    case "NO_SE_ESPERABA":
      return `${donde}: este caso no tiene ese campo. Revisá cómo está escrito.`;
    case "NO_ES_UN_OBJETO":
      return "El archivo tiene que ser un objeto JSON { ... } con los campos del caso.";
    case "JSON_INVALIDO":
      return "El archivo no es un JSON válido (revisá comas, comillas y llaves).";
    case "FORMA_INVALIDA":
      return `${donde}: tiene que ser ${esperado === null ? "de otro tipo" : DESCRIPCION_DE_TIPO[esperado]}.`;
    default:
      return `${donde}: ${textoDeMotivo(motivo)}`;
  }
}

type ErrorConDatos = Readonly<{ codigo: string }> & Readonly<Record<string, unknown>>;

const esObjeto = (valor: unknown): valor is Readonly<Record<string, unknown>> =>
  typeof valor === "object" && valor !== null;

/**
 * El texto de lo que un caso rechazó: un código (`"MARCA_RETIRADA"`), un objeto con datos
 * (`{ codigo: "LIMITE_DEL_PLAN", limite, usoActual }`) o un error de la base (`{ tipo: ... }`). Las fallas
 * inesperadas de la base pasan por `describirFallaDeBase`, como en los demás scripts.
 */
export function textoDeRechazo(error: unknown, cadena: string | undefined): string {
  if (typeof error === "string") return textoDeMotivo(error);
  if (!esObjeto(error)) return "El caso devolvió un rechazo que no se pudo leer.";
  if (typeof error["codigo"] === "string") {
    const { codigo, ...datos } = error as ErrorConDatos;
    const detalle = Object.entries(datos)
      .map(
        ([clave, valor]) =>
          `${clave}: ${typeof valor === "string" ? valor : JSON.stringify(valor)}`,
      )
      .join(", ");
    return detalle === "" ? textoDeMotivo(codigo) : `${textoDeMotivo(codigo)} (${detalle})`;
  }
  switch (error["tipo"]) {
    case "Unicidad":
    case "Superposicion":
    case "Referencia":
    case "Check":
      return `La base no aceptó el cambio porque choca con una regla de datos${
        typeof error["restriccion"] === "string" ? ` (${error["restriccion"]})` : ""
      }. Si repetís el pedido y sigue pasando, avisá a soporte.`;
    case "AccesoDenegado":
      return "La base negó el permiso: el administrador no está habilitado para este cambio.";
    case "ConcurrenciaAgotada":
      return "Había demasiados cambios a la vez sobre lo mismo. Esperá un momento y repetí el comando: es seguro repetirlo.";
    case "Inesperado": {
      const falla = Object.assign(
        new Error(typeof error["mensaje"] === "string" ? error["mensaje"] : ""),
        {
          ...(typeof error["sqlstate"] === "string" ? { code: error["sqlstate"] } : {}),
        },
      );
      return `Falla inesperada de la base: ${describirFallaDeBase(falla, cadena)}`;
    }
    default:
      return "El caso devolvió un rechazo que no se pudo leer.";
  }
}

/** Los nombres que, en el resultado, dicen «no se escribió nada porque ya estaba hecho». */
export const CAMPOS_DE_YA_ESTABA = ["yaExistia", "yaEstabaActivo", "yaEstabaInactivo"] as const;

/** El resultado de un caso, una línea por dato. */
export function lineasDeResultado(salida: unknown): string[] {
  if (!esObjeto(salida)) return [`  resultado: ${JSON.stringify(salida)}`];
  const lineas: string[] = [];
  for (const [clave, valor] of Object.entries(salida)) {
    const texto =
      typeof valor === "boolean"
        ? valor
          ? "sí"
          : "no"
        : typeof valor === "string"
          ? valor
          : JSON.stringify(valor);
    lineas.push(`  ${clave}: ${texto}`);
  }
  const repetido = CAMPOS_DE_YA_ESTABA.some((campo) => salida[campo] === true);
  if (repetido) {
    lineas.push("Nada cambió: este pedido ya se había hecho (o ya estaba en ese estado).");
  }
  return lineas;
}
