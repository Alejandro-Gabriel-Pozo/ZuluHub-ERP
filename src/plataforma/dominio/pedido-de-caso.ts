import { validarCodigoDeMarca } from "../../modulos/marcas/publico";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { validarAlta, type EntradaDeAlta, type ErrorDeValidacionDeAlta } from "./alta";
import {
  validarLargoDelMotivo,
  validarNumeroEsperado,
  validarVersionEsperada,
  validarVigencia,
} from "./formas-de-entrada";
import { claveDeIdempotenciaValida, uuidDesdeTexto } from "./soporte/consulta";

/**
 * El pedido de un caso de plataforma que llega por la línea de comandos (`scripts/ejecutar-caso-de-plataforma.ts`,
 * web-armazon §6.2): la lista CERRADA de casos que se pueden ejecutar desde un archivo, la forma de la línea de
 * comandos y la forma del JSON de cada caso. Dominio puro: sin archivos, sin reloj, sin azar, sin base de datos.
 *
 * Previene dos fallas: (1) que la puerta de scripts pueda ejecutar un caso que nadie decidió abrir (una lista
 * cerrada, no «cualquier cosa que exporte el módulo»); (2) que un archivo mal escrito (un campo con el nombre
 * cambiado, una fecha sin zona, un número donde va un texto) abra una transacción y llegue a la base: la forma
 * se revisa ANTES, campo por campo, reutilizando las validaciones de forma que los casos ya tienen. La
 * validación del caso, dentro de su transacción, sigue ahí: esto es la primera barrera, no la única.
 */

// ---------------------------------------------------------------------------------------------
// La lista cerrada
// ---------------------------------------------------------------------------------------------

/**
 * Los casos que se pueden ejecutar desde un archivo, y la forma de su entrada. Cada campo dice su tipo (qué
 * valores admite) y si puede faltar. Un campo que no figura acá se rechaza (`NO_SE_ESPERABA`): un error de
 * tipeo en el nombre de un campo opcional no se pierde en silencio.
 */
const req = <T extends string>(tipo: T) => ({ tipo, opcional: false }) as const;
const opc = <T extends string>(tipo: T) => ({ tipo, opcional: true }) as const;

const FORMAS = {
  crearMarca: {
    claveDeIdempotencia: req("clave"),
    codigo: req("texto"),
    marcaPadreId: req("idONulo"),
  },
  guardarBorradorDeMarca: {
    claveDeIdempotencia: req("clave"),
    marcaId: req("id"),
    versionEsperada: req("versionONula"),
    nombreVisible: opc("textoONulo"),
    tema: opc("objeto"),
    aspecto: opc("objeto"),
    logo: opc("textoONulo"),
    vocabulario: opc("mapaDeTextos"),
    modulosIniciales: opc("listaDeTextosONula"),
    planPorDefectoId: opc("idONulo"),
  },
  confirmarVersionDeMarca: {
    claveDeIdempotencia: req("clave"),
    marcaId: req("id"),
    vigenteDesde: req("vigencia"),
    motivo: req("motivo"),
    reemplazaProgramada: req("booleano"),
  },
  agregarDominio: {
    claveDeIdempotencia: req("clave"),
    host: req("texto"),
    superficie: req("texto"),
    titular: req("texto"),
    esCanonico: req("booleano"),
    duenio: req("duenio"),
  },
  crearPlan: {
    claveDeIdempotencia: req("clave"),
    codigo: req("texto"),
  },
  guardarBorradorDePlan: {
    claveDeIdempotencia: req("clave"),
    planId: req("id"),
    versionEsperada: req("versionONula"),
    nombreComercial: req("texto"),
    modulos: req("listaDeTextos"),
    perillas: req("objeto"),
  },
  publicarVersionDePlan: {
    claveDeIdempotencia: req("clave"),
    planId: req("id"),
    motivo: req("motivo"),
  },
  asignarPlan: {
    claveDeIdempotencia: req("clave"),
    tenantId: req("id"),
    versionDePlanId: req("id"),
    vigenteDesde: req("vigencia"),
    motivo: req("motivo"),
    numeroEsperado: req("numeroONulo"),
    reemplazaProgramada: req("booleano"),
  },
  altaDeEmpresa: {
    claveDeIdempotencia: req("clave"),
    tenantId: opc("texto"),
    nombreDeTenant: opc("texto"),
    marcaId: opc("texto"),
    versionDePlanId: opc("texto"),
    cuit: req("texto"),
    razonSocial: req("texto"),
    zonaHoraria: req("texto"),
    moneda: req("texto"),
    emailGerente: req("texto"),
  },
  activarModuloDeEmpresa: {
    claveDeIdempotencia: req("clave"),
    empresaId: req("id"),
    modulo: req("texto"),
  },
  desactivarModuloDeEmpresa: {
    claveDeIdempotencia: req("clave"),
    empresaId: req("id"),
    modulo: req("texto"),
  },
} as const;

/** Los casos que se pueden ejecutar desde un archivo (la lista cerrada). */
export const CASOS_DE_PLATAFORMA = Object.keys(FORMAS) as readonly NombreDeCaso[];

export type NombreDeCaso = keyof typeof FORMAS;

/** ¿Es un caso de la lista? (`constructor`, `toString` y compañía no lo son.) */
export function esCasoDeLaLista(nombre: string): nombre is NombreDeCaso {
  return Object.hasOwn(FORMAS, nombre);
}

// ---------------------------------------------------------------------------------------------
// Los tipos de campo
// ---------------------------------------------------------------------------------------------

/** Un valor mal formado o mal tipado. `FORMA_INVALIDA` es «no es del tipo»; los demás, el motivo del validador. */
type MotivoDeValor =
  | "FORMA_INVALIDA"
  | "CLAVE_DE_IDEMPOTENCIA_INVALIDA"
  | "ID_INVALIDO"
  | "VERSION_ESPERADA_INVALIDA"
  | "NUMERO_ESPERADO_INVALIDO"
  | "VIGENCIA_INVALIDA"
  | "MOTIVO_DEMASIADO_LARGO";

type Leido<T> = Resultado<T, MotivoDeValor>;
type Objeto = Readonly<Record<string, unknown>>;

const FORMA_INVALIDA = err("FORMA_INVALIDA" as const);

const esTexto = (valor: unknown): valor is string => typeof valor === "string";
const esObjeto = (valor: unknown): valor is Objeto =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

/**
 * Fecha con zona explícita (`Z` o `+hh:mm`): una hora sin zona se leería en la zona de quien corre el
 * comando, y la misma instrucción valdría distinto en dos computadoras.
 */
// Stryker disable Regex: los anclajes `^` y `$` son la primera barrera; la conversión a fecha es la segunda y rechaza por su cuenta todo texto con algo antes o después de la fecha (verificado con comentarios, espacios, saltos de línea y fechas en otros formatos), así que sacarlos no cambia ningún resultado.
const FORMA_DE_VIGENCIA =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
// Stryker restore Regex

function id(valor: unknown): Leido<string> {
  return esTexto(valor) ? uuidDesdeTexto(valor) : FORMA_INVALIDA;
}

const lista = (valor: unknown): Leido<readonly string[]> =>
  Array.isArray(valor) && valor.every(esTexto) ? ok(valor) : FORMA_INVALIDA;

const TIPOS = {
  clave: (valor: unknown): Leido<string> =>
    !esTexto(valor)
      ? FORMA_INVALIDA
      : claveDeIdempotenciaValida(valor)
        ? ok(valor)
        : err("CLAVE_DE_IDEMPOTENCIA_INVALIDA"),
  texto: (valor: unknown): Leido<string> => (esTexto(valor) ? ok(valor) : FORMA_INVALIDA),
  textoONulo: (valor: unknown): Leido<string | null> =>
    valor === null || esTexto(valor) ? ok(valor) : FORMA_INVALIDA,
  id,
  idONulo: (valor: unknown): Leido<string | null> => (valor === null ? ok(null) : id(valor)),
  versionONula: (valor: unknown): Leido<number | null> =>
    valor === null || typeof valor === "number" ? validarVersionEsperada(valor) : FORMA_INVALIDA,
  numeroONulo: (valor: unknown): Leido<number | null> =>
    valor === null || typeof valor === "number" ? validarNumeroEsperado(valor) : FORMA_INVALIDA,
  booleano: (valor: unknown): Leido<boolean> =>
    typeof valor === "boolean" ? ok(valor) : FORMA_INVALIDA,
  vigencia: (valor: unknown): Leido<Date> =>
    !esTexto(valor)
      ? FORMA_INVALIDA
      : FORMA_DE_VIGENCIA.test(valor)
        ? validarVigencia(new Date(valor))
        : err("VIGENCIA_INVALIDA"),
  motivo: (valor: unknown): Leido<string> =>
    esTexto(valor) ? validarLargoDelMotivo(valor) : FORMA_INVALIDA,
  objeto: (valor: unknown): Leido<Objeto> => (esObjeto(valor) ? ok(valor) : FORMA_INVALIDA),
  mapaDeTextos: (valor: unknown): Leido<Readonly<Record<string, string>>> =>
    esObjeto(valor) && Object.values(valor).every(esTexto)
      ? ok(valor as Readonly<Record<string, string>>)
      : FORMA_INVALIDA,
  listaDeTextos: lista,
  listaDeTextosONula: (valor: unknown): Leido<readonly string[] | null> =>
    valor === null ? ok(null) : lista(valor),
  /** El dueño de un host: una marca o una empresa, con el identificador de esa clase y nada más. */
  duenio: (valor: unknown): Leido<DuenioDeDominio> => {
    if (!esObjeto(valor)) return FORMA_INVALIDA;
    const claves = Object.keys(valor);
    const campo = valor["tipo"] === "MARCA" ? "marcaId" : "empresaId";
    if (
      (valor["tipo"] !== "MARCA" && valor["tipo"] !== "EMPRESA") ||
      claves.length !== 2 ||
      !Object.hasOwn(valor, campo)
    ) {
      return FORMA_INVALIDA;
    }
    const identificador = id(valor[campo]);
    if (!identificador.ok) return identificador;
    return ok(
      valor["tipo"] === "MARCA"
        ? { tipo: "MARCA", marcaId: identificador.valor }
        : { tipo: "EMPRESA", empresaId: identificador.valor },
    );
  },
} as const;

type DuenioDeDominio =
  Readonly<{ tipo: "MARCA"; marcaId: string }> | Readonly<{ tipo: "EMPRESA"; empresaId: string }>;

type Tipo = keyof typeof TIPOS;
type Salida<T extends Tipo> =
  ReturnType<(typeof TIPOS)[T]> extends Resultado<infer V, MotivoDeValor> ? V : never;

type Forma = Readonly<Record<string, Readonly<{ tipo: Tipo; opcional: boolean }>>>;
type EntradaDeForma<F extends Forma> = {
  -readonly [K in keyof F as F[K]["opcional"] extends true ? never : K]: Salida<F[K]["tipo"]>;
} & {
  -readonly [K in keyof F as F[K]["opcional"] extends true ? K : never]?: Salida<F[K]["tipo"]>;
};

/** La entrada del caso, ya con los tipos que él espera: se pasa tal cual al caso de uso. */
export type EntradaDeCaso<N extends NombreDeCaso> = EntradaDeForma<(typeof FORMAS)[N]>;

// ---------------------------------------------------------------------------------------------
// El archivo
// ---------------------------------------------------------------------------------------------

/**
 * Un problema de la forma del archivo. `campo` es el nombre del campo, o `null` si el problema es del
 * conjunto (el archivo no es un objeto, o la combinación de datos del alta no cierra).
 */
export type ProblemaDeForma = Readonly<{
  campo: string | null;
  motivo:
    | MotivoDeValor
    | "FALTA"
    | "NO_SE_ESPERABA"
    | "NO_ES_UN_OBJETO"
    | "JSON_INVALIDO"
    | ErrorDeValidacionDeAlta
    | "CODIGO_DE_MARCA_INVALIDO";
  /** Solo con `FORMA_INVALIDA` y `FALTA`: el tipo de dato que el campo espera. */
  esperado: Tipo | null;
}>;

/** El texto del archivo como JSON; `JSON_INVALIDO` si no lo es (el detalle de la sintaxis no se repite: podría citar datos). */
export function leerJson(texto: string): Resultado<unknown, "JSON_INVALIDO"> {
  try {
    return ok(JSON.parse(texto) as unknown);
  } catch {
    return err("JSON_INVALIDO");
  }
}

/**
 * Controles que el caso hace con una función pura propia sobre el conjunto de la entrada (no sobre un
 * campo suelto): se repiten acá para que el error llegue antes de abrir la transacción, y con el mismo
 * motivo que daría el caso. Corre con la forma ya validada campo por campo.
 */
function revisarElConjunto(caso: NombreDeCaso, entrada: Objeto): ProblemaDeForma["motivo"] | null {
  if (caso === "altaDeEmpresa") {
    const alta = validarAlta(entrada as EntradaDeAlta);
    return alta.ok ? null : alta.error;
  }
  if (caso === "crearMarca") {
    const codigo = validarCodigoDeMarca(entrada["codigo"] as string);
    return codigo.ok ? null : codigo.error;
  }
  return null;
}

/**
 * Arma la entrada de un caso a partir del JSON ya leído. Devuelve TODOS los problemas de forma juntos
 * (así quien corrige el archivo no los descubre de a uno): primero los campos del caso en su orden, después
 * los que sobran en el orden del archivo y, solo si la forma está bien, los controles del conjunto.
 */
export function armarEntradaDelCaso<N extends NombreDeCaso>(
  caso: N,
  json: unknown,
): Resultado<EntradaDeCaso<N>, readonly ProblemaDeForma[]> {
  if (!esObjeto(json)) {
    return err([{ campo: null, motivo: "NO_ES_UN_OBJETO", esperado: null }]);
  }
  const forma: Forma = FORMAS[caso];
  const problemas: ProblemaDeForma[] = [];
  const entrada: Record<string, unknown> = {};
  for (const [campo, { tipo, opcional }] of Object.entries(forma)) {
    if (!Object.hasOwn(json, campo)) {
      if (!opcional) problemas.push({ campo, motivo: "FALTA", esperado: tipo });
      continue;
    }
    const leido = TIPOS[tipo](json[campo]);
    if (leido.ok) entrada[campo] = leido.valor;
    else {
      problemas.push({
        campo,
        motivo: leido.error,
        esperado: leido.error === "FORMA_INVALIDA" ? tipo : null,
      });
    }
  }
  for (const campo of Object.keys(json)) {
    if (!Object.hasOwn(forma, campo)) {
      problemas.push({ campo, motivo: "NO_SE_ESPERABA", esperado: null });
    }
  }
  if (problemas.length > 0) return err(problemas);

  const motivo = revisarElConjunto(caso, entrada);
  if (motivo !== null) return err([{ campo: null, motivo, esperado: null }]);
  return ok(entrada as EntradaDeCaso<N>);
}

// ---------------------------------------------------------------------------------------------
// La línea de comandos
// ---------------------------------------------------------------------------------------------

export type PedidoDeLinea = Readonly<{ caso: string; archivo: string; emailDelAdmin: string }>;

export type ErrorDeLinea =
  | "FALTA_EL_CASO"
  | "FALTA_EL_ARCHIVO"
  | "FALTA_EL_EMAIL_DEL_ADMIN"
  | "SOBRAN_ARGUMENTOS"
  | "OPCION_DESCONOCIDA"
  | "OPCION_REPETIDA";

export const OPCION_DEL_EMAIL_DEL_ADMIN = "--admin-email";

/**
 * `<caso> <archivo.json> --admin-email <email>` (la opción puede ir en cualquier lugar, también como
 * `--admin-email=<email>`). Error por el primero que corresponda: opción desconocida o repetida, sobran
 * argumentos, falta el caso, el archivo o el email. No decide si el caso está en la lista (eso es
 * `esCasoDeLaLista`, para poder decirlo con su propio mensaje).
 */
export function leerLineaDeComandos(
  argumentos: readonly string[],
): Resultado<PedidoDeLinea, ErrorDeLinea> {
  const posicionales: string[] = [];
  let email: string | null = null;
  for (let i = 0; i < argumentos.length; i++) {
    const argumento = argumentos[i] as string;
    if (argumento.startsWith("--")) {
      const igual = argumento.indexOf("=");
      const nombre = igual === -1 ? argumento : argumento.slice(0, igual);
      if (nombre !== OPCION_DEL_EMAIL_DEL_ADMIN) return err("OPCION_DESCONOCIDA");
      if (email !== null) return err("OPCION_REPETIDA");
      email = igual === -1 ? (argumentos[++i] ?? "") : argumento.slice(igual + 1);
    } else {
      posicionales.push(argumento);
    }
  }
  if (posicionales.length > 2) return err("SOBRAN_ARGUMENTOS");
  const [caso, archivo] = posicionales;
  if (caso === undefined) return err("FALTA_EL_CASO");
  if (archivo === undefined) return err("FALTA_EL_ARCHIVO");
  if (email === null || email.trim() === "") return err("FALTA_EL_EMAIL_DEL_ADMIN");
  return ok({ caso, archivo, emailDelAdmin: email });
}
