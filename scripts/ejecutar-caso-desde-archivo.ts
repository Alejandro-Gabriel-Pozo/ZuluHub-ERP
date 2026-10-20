import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base";
import { ZULUHUB_CLAVE_CONTEXTO } from "../src/adaptadores/postgres/contexto-firmado";
import { ZULUHUB_SECRETO_INVITACIONES } from "../src/adaptadores/tokens/tokens-hmac";
import { contextoDePlataforma } from "../src/composicion/contextos";
import { ZULUHUB_DB_PLATAFORMA } from "../src/composicion/entorno-de-plataforma";
import type { Plataforma } from "../src/composicion/plataforma";
import type { ContextoDePlataforma } from "../src/contexto/contexto";
import {
  armarEntradaDelCaso,
  esCasoDeLaLista,
  leerJson,
  leerLineaDeComandos,
  CASOS_DE_PLATAFORMA,
  type EntradaDeCaso,
  type NombreDeCaso,
} from "../src/plataforma/dominio/pedido-de-caso";
import { emailDesdeTexto } from "../src/modulos/identidad/publico";
import type { AdminEncontrado } from "../src/puertos/admins-de-plataforma";
import type { Resultado } from "../src/primitivas/resultado/resultado";
import {
  MENSAJES_DE_LINEA,
  USO,
  lineasDeResultado,
  textoDeProblema,
  textoDeRechazo,
} from "./mensajes-de-plataforma";

/**
 * Lo que hace `scripts/ejecutar-caso-de-plataforma.ts`, separado de su arranque para poder probarlo con
 * dependencias inyectadas (web-armazon §6.2): ejecuta UN caso de la lista cerrada, leyendo sus datos de un
 * archivo .json y actuando como el administrador de plataforma que se identifica por su email.
 *
 * Orden, y qué toca cada paso: (1) línea de comandos, caso de la lista y email, (2) archivo y forma del
 * JSON, campo por campo, SIN abrir ninguna conexión, (3) buscar al administrador (tiene que existir, estar
 * activo y ser ADMIN: si no, no se ejecuta nada), (4) el caso, con su guard, su idempotencia y su auditoría
 * (los pone el caso). La clave de idempotencia va EN el archivo: repetir el comando con el mismo archivo no
 * duplica nada.
 *
 * Este script NO exige el segundo factor reciente (h5-p8 §2.4 bis): no hay sesión web ni segundo factor que pedirle; el
 * administrador se identifica por su email y quien lo corre es el dueño, con la credencial de plataforma. Eso es a
 * propósito. La exigencia es de la consola, que entra por `puerta-de-consola.ts`.
 *
 * Todo lo que sale pasa por `tapar`: la cadena, la clave de contexto y el secreto de invitaciones nunca se
 * imprimen, ni enteros ni en pedazos, y las fallas de la base se cuentan con `describirFallaDeBase`. El
 * email del administrador y los datos del archivo tampoco se repiten. Código de salida: 0 todo bien (también
 * «ya estaba»), 1 rechazo o falla, 2 uso incorrecto o archivo mal formado.
 */

/** Cada caso de la lista, ya armado, con la entrada que el archivo produce para él. */
export type CasosDeLaLista = {
  readonly [N in NombreDeCaso]: (
    contexto: ContextoDePlataforma,
    entrada: EntradaDeCaso<N>,
  ) => Promise<Resultado<unknown, unknown>>;
};

/**
 * La lista cerrada de casos, tomada de la puerta de plataforma. Es el ÚNICO lugar que dice qué función corre
 * cada nombre; el compilador exige que la entrada del archivo (`EntradaDeCaso`) entre en la del caso.
 * Cada caso se resuelve al ejecutarse: elegir uno no arma ni valida los demás.
 */
export function armarCasosDeLaLista(
  plataforma: Pick<
    Plataforma,
    "casosDeUsoDeMarcasYPlanes" | "casosDeUsoDeDominios" | "casosDeUsoDeAltas"
  >,
): CasosDeLaLista {
  return {
    crearMarca: (c, e) => plataforma.casosDeUsoDeMarcasYPlanes().crearMarca(c, e),
    guardarBorradorDeMarca: (c, e) =>
      plataforma.casosDeUsoDeMarcasYPlanes().guardarBorradorDeMarca(c, e),
    confirmarVersionDeMarca: (c, e) =>
      plataforma.casosDeUsoDeMarcasYPlanes().confirmarVersionDeMarca(c, e),
    agregarDominio: (c, e) => plataforma.casosDeUsoDeDominios().agregarDominio(c, e),
    crearPlan: (c, e) => plataforma.casosDeUsoDeMarcasYPlanes().crearPlan(c, e),
    guardarBorradorDePlan: (c, e) =>
      plataforma.casosDeUsoDeMarcasYPlanes().guardarBorradorDePlan(c, e),
    publicarVersionDePlan: (c, e) =>
      plataforma.casosDeUsoDeMarcasYPlanes().publicarVersionDePlan(c, e),
    asignarPlan: (c, e) => plataforma.casosDeUsoDeMarcasYPlanes().asignarPlan(c, e),
    altaDeEmpresa: (c, e) => plataforma.casosDeUsoDeAltas().altaDeEmpresa(c, e),
    activarModuloDeEmpresa: (c, e) =>
      plataforma.casosDeUsoDeMarcasYPlanes().activarModuloDeEmpresa(c, e),
    desactivarModuloDeEmpresa: (c, e) =>
      plataforma.casosDeUsoDeMarcasYPlanes().desactivarModuloDeEmpresa(c, e),
  };
}

export type EntradaDeEjecucion = Readonly<{
  /** Lo que sigue al nombre del script: `<caso> <archivo.json> --admin-email <email>`. */
  argumentos: readonly string[];
  /** Solo para tapar los valores sensibles en lo que se imprime; nunca se imprime. */
  entorno: Readonly<Record<string, string | undefined>>;
  leerArchivo: (ruta: string) => Promise<string>;
  ahora: () => Date;
  /** Busca al administrador por email (con el actor del sistema, solo lectura). */
  buscarAdmin: (email: string, ahora: Date) => Promise<AdminEncontrado | null>;
  casos: CasosDeLaLista;
  info: (linea: string) => void;
  error: (linea: string) => void;
}>;

export async function ejecutarCasoDePlataforma(entrada: EntradaDeEjecucion): Promise<number> {
  const { entorno } = entrada;
  const cadena = entorno[ZULUHUB_DB_PLATAFORMA]?.trim();
  // La parte secreta de la clave de contexto es la que sigue al kid.
  const secretoDeLaClave = entorno[ZULUHUB_CLAVE_CONTEXTO]?.trim().split(":")[1];
  const secretos = [cadena, secretoDeLaClave, entorno[ZULUHUB_SECRETO_INVITACIONES]?.trim()];
  const tapar = (linea: string) =>
    secretos.reduce<string>((texto, secreto) => ocultarSecretos(texto, secreto), linea);
  const info = (linea: string) => entrada.info(tapar(linea));
  const error = (linea: string) => entrada.error(tapar(linea));
  const usoIncorrecto = (...lineas: string[]) => {
    for (const linea of lineas) error(linea);
    error(USO);
    return 2;
  };

  // (1) La línea de comandos.
  const linea = leerLineaDeComandos(entrada.argumentos);
  if (!linea.ok) return usoIncorrecto(`ERROR: ${MENSAJES_DE_LINEA[linea.error]}`);
  const { caso, archivo, emailDelAdmin } = linea.valor;
  if (!esCasoDeLaLista(caso)) {
    return usoIncorrecto(
      `ERROR: «${caso}» no es un caso que se pueda ejecutar desde un archivo.`,
      `Los casos son: ${CASOS_DE_PLATAFORMA.join(", ")}.`,
    );
  }
  const email = emailDesdeTexto(emailDelAdmin);
  if (!email.ok)
    return usoIncorrecto("ERROR: --admin-email no tiene forma de email (algo@dominio).");

  // (2) El archivo y su forma, antes de abrir ninguna conexión.
  let texto: string;
  try {
    texto = await entrada.leerArchivo(archivo);
  } catch {
    return usoIncorrecto(`ERROR: no se pudo leer el archivo «${archivo}» (¿existe esa ruta?).`);
  }
  const json = leerJson(texto);
  if (!json.ok)
    return usoIncorrecto(
      "ERROR: el archivo no es un JSON válido (revisá comas, comillas y llaves).",
    );
  const armada = armarEntradaDelCaso(caso, json.valor);
  if (!armada.ok) {
    return usoIncorrecto(
      `ERROR: el archivo no sirve para «${caso}»:`,
      ...armada.error.map((problema) => `  - ${textoDeProblema(problema)}`),
    );
  }

  try {
    // (3) Quién hace el cambio: un ADMIN activo. Si no, no se ejecuta nada.
    const ahora = entrada.ahora();
    const admin = await entrada.buscarAdmin(email.valor, ahora);
    if (admin === null) {
      error(
        "ERROR: no existe ningún administrador de plataforma con ese email. No se ejecutó nada.",
      );
      return 1;
    }
    if (!admin.activo) {
      error("ERROR: ese administrador de plataforma está dado de baja. No se ejecutó nada.");
      return 1;
    }
    if (admin.rol !== "ADMIN") {
      error(
        "ERROR: ese administrador no es ADMIN (es SOPORTE) y estos casos son solo de ADMIN. No se ejecutó nada.",
      );
      return 1;
    }

    // (4) El caso: guard, idempotencia, trabajo, auditoría y clave, en su transacción.
    const contexto = contextoDePlataforma({ actor: { tipo: "ADMIN", id: admin.id }, ahora });
    const ejecutar = entrada.casos[caso] as (
      contexto: ContextoDePlataforma,
      entrada: EntradaDeCaso<NombreDeCaso>,
    ) => Promise<Resultado<unknown, unknown>>;
    const resultado = await ejecutar(contexto, armada.valor);
    if (!resultado.ok) {
      error(`ERROR: ${textoDeRechazo(resultado.error, cadena)}`);
      error(`RESULTADO: RECHAZADO (no se cambió nada). Caso «${caso}».`);
      return 1;
    }
    info(`RESULTADO: OK. Se ejecutó «${caso}».`);
    for (const dato of lineasDeResultado(resultado.valor)) info(dato);
    return 0;
  } catch (falla) {
    error(`ERROR: ${describirFallaDeBase(falla, cadena)}`);
    error(
      `RESULTADO: FALLA (no se sabe si el caso llegó a aplicarse: repetí el mismo comando con el mismo archivo, es seguro repetirlo).`,
    );
    return 1;
  }
}
