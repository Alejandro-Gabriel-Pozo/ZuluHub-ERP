import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base.ts";
import {
  leerEstadoDeMigraciones,
  type EstadoDeMigraciones,
} from "../src/adaptadores/postgres/estado-de-migraciones.ts";
import { conBloqueoDeCarga } from "../src/adaptadores/postgres/bloqueo-de-carga.ts";
import { aplicarMigraciones } from "../src/adaptadores/postgres/migraciones.ts";
import {
  ErrorDePreparacion,
  prepararRoles,
  type RolPreparado,
} from "../src/adaptadores/postgres/preparar-roles.ts";
import {
  cadenaDeRol,
  esVariableDeRespaldo,
  esVariableProvisoria,
  rolesPorPreparar,
  type RolPorPreparar,
} from "../src/adaptadores/postgres/roles-de-la-aplicacion.ts";
import {
  cargarEnVercel,
  type ResultadoDeCarga,
} from "../src/adaptadores/vercel/cargar-en-vercel.ts";
import {
  crearClienteVercel,
  type ClienteDeVariables,
} from "../src/adaptadores/vercel/cliente-vercel.ts";
import {
  EQUIPO_DE_VERCEL,
  NOMBRE_DE_LA_CADENA_DE_DUENO,
  VARIABLE_DEL_TOKEN,
  generarSecretos,
  leerDestino,
  planificar,
  type Destino,
  type ValorACargar,
} from "../src/adaptadores/vercel/plan-de-variables.ts";

/**
 * Lo que hace `scripts/migrar-base.ts`, separado de su arranque para poder probarlo con una carpeta
 * de migraciones propia y capturando lo que escribe.
 *
 * - `--ver`: solo lectura (transacción READ ONLY que termina en ROLLBACK). Lista aplicadas y pendientes.
 * - `--aplicar`: aplica las pendientes con `aplicarMigraciones` (transacción por archivo, bloqueo de
 *   sesión, checksum). Repetirlo no hace nada.
 * - `--preparar-roles`: aplica las pendientes y, a los roles de la aplicación que todavía no tienen
 *   LOGIN, se lo da con una contraseña al azar; imprime UNA vez las variables para pegar en Vercel.
 *   Solo para correr en la terminal del dueño: se niega a correr en GitHub Actions (el registro es
 *   público para quien tenga acceso al repositorio). Con `--con-autenticacion` suma los roles de
 *   autenticación y captación; con `--con-respaldo` suma el rol de respaldo (solo lectura, el único que
 *   salta el aislamiento: su cadena se imprime en un bloque aparte, con el host directo, para el secreto del
 *   Environment «respaldo» de GitHub; nunca por defecto y nunca con `--vercel`); con `--rotar` también cambia la contraseña de los que ya tienen LOGIN;
 *   con `--directa` arma las cadenas con el host directo en vez del del pooler; con `--diagnostico`
 *   una falla inesperada al dar LOGIN muestra además el mensaje del servidor (sin cadena ni verificadores).
 * - `--preparar-roles --vercel <preview|production>`: lo mismo, pero en vez de imprimir las contraseñas
 *   las ESCRIBE en las variables de Vercel del destino pedido (tipo sensible, nunca en el otro destino),
 *   borra de ese destino lo que la aplicación prohíbe y la cadena de dueño de la base, y termina con una
 *   lista corta de «hecho / no hecho». `production` exige además `--confirmo production`. Con `--secretos`
 *   genera y carga también `PEDERNAL_CLAVE_CONTEXTO` y `PEDERNAL_SECRETO_INVITACIONES` (reemplaza los
 *   anteriores: las sesiones y las invitaciones emitidas antes dejan de valer). El token de la API de
 *   Vercel sale de `PEDERNAL_VERCEL_TOKEN`. Si escribir en Vercel falla después de que los roles ya
 *   recibieron contraseña, el bloque con las contraseñas se imprime igual (nunca se pierde una).
 *
 * La cadena DIRECTA de la base se lee de `PEDERNAL_DB_MIGRACIONES`. Esta función no la escribe jamás,
 * ni entera ni en pedazos: todo lo que imprime pasa por `ocultarSecretos` (con la cadena, el token de
 * Vercel y cada contraseña o secreto generado) y las fallas se cuentan con `describirFallaDeBase`. La
 * ÚNICA salida que lleva credenciales es el bloque de `--preparar-roles` (solo sin `--vercel`, o con
 * `--vercel` cuando la escritura en Vercel falló), que va por `secreto` (nunca por `info` ni `error`). Devuelve el código de salida: 0 todo bien,
 * 1 falla o problema en la base, 2 uso incorrecto.
 */

export const VARIABLE_DE_LA_CADENA = NOMBRE_DE_LA_CADENA_DE_DUENO;

export type EntradaDeMigracion = Readonly<{
  argumentos: readonly string[];
  entorno: Readonly<Record<string, string | undefined>>;
  carpeta: string;
  info: (linea: string) => void;
  error: (linea: string) => void;
  /** Donde va el bloque con credenciales de `--preparar-roles`. */
  secreto: (linea: string) => void;
  /** Se inyectan en las pruebas (roles propios, contraseñas conocidas); por defecto, los reales. */
  roles?: (conAutenticacion: boolean, conRespaldo: boolean) => readonly RolPorPreparar[];
  generarClave?: () => string;
  /** Solo con `--vercel`. Por defecto, el `fetch` global; las pruebas inyectan uno falso (nunca hay red). */
  fetch?: typeof fetch;
  /** Tiempo límite de cada pedido a Vercel. */
  plazoDeVercelEnMs?: number;
  /** Espera entre reintentos de una lectura de Vercel. */
  esperarEntreLecturas?: (milisegundos: number) => Promise<void>;
  /** Bytes para los secretos de `--secretos`. */
  bytesAlAzar?: (cuantos: number) => Uint8Array;
}>;

const SIN_TOKEN =
  `falta la variable ${VARIABLE_DEL_TOKEN}: es el token con el que este comando escribe en Vercel. ` +
  `Para crearlo: entrá a vercel.com, abrí Settings de tu cuenta > Tokens, creá uno con alcance limitado ` +
  `al equipo «${EQUIPO_DE_VERCEL}» y vencimiento corto, y ponelo en esa variable de entorno de la terminal ` +
  "(no lo pegues en ningún archivo ni en un chat).";

const USO =
  "uso: migrar-base --ver | --aplicar | --preparar-roles [--con-autenticacion] [--con-respaldo] [--rotar] [--directa] [--diagnostico] " +
  "[--vercel <preview|production> [--confirmo production] [--secretos]]";

type Pedido = Readonly<{
  modo: "--ver" | "--aplicar" | "--preparar-roles";
  conAutenticacion: boolean;
  /** Suma el rol de respaldo (nunca por defecto, nunca con `--vercel`). */
  conRespaldo: boolean;
  rotar: boolean;
  directa: boolean;
  diagnostico: boolean;
  /** El destino de Vercel pedido, o `null` si no se pidió cargar en Vercel. */
  vercel: Destino | null;
  secretos: boolean;
}>;

const MODOS = ["--ver", "--aplicar", "--preparar-roles"] as const;
const EXTRAS = [
  "--con-autenticacion",
  "--con-respaldo",
  "--rotar",
  "--directa",
  "--diagnostico",
  "--secretos",
  "--vercel",
  "--confirmo",
] as const;
/** Banderas que llevan el valor en el argumento siguiente. */
const CON_VALOR = ["--vercel", "--confirmo"] as const;

const SIN_CONFIRMACION =
  "cargar en PRODUCTION se confirma escribiendo también --confirmo production (así un comando de " +
  "preview copiado con una sola palabra cambiada no llega a producción sin querer)";

/**
 * Un solo modo, y las banderas extra solo con `--preparar-roles`, cada una una vez. Devuelve el pedido o
 * el texto del problema (sin el prefijo `ERROR:`).
 */
function leerPedido(argumentos: readonly string[]): Pedido | string {
  const banderas: string[] = [];
  const valores = new Map<string, string>();
  for (let i = 0; i < argumentos.length; i++) {
    const argumento = argumentos[i] as string;
    banderas.push(argumento);
    if ((CON_VALOR as readonly string[]).includes(argumento)) {
      const valor = argumentos[i + 1];
      if (valor === undefined || valor.startsWith("--")) return USO;
      valores.set(argumento, valor);
      i += 1;
    }
  }
  if (new Set(banderas).size !== banderas.length) return USO;
  const modos = banderas.filter((a) => (MODOS as readonly string[]).includes(a));
  const extras = banderas.filter((a) => (EXTRAS as readonly string[]).includes(a));
  if (modos.length !== 1 || modos.length + extras.length !== banderas.length) return USO;
  const modo = modos[0] as Pedido["modo"];
  if (modo !== "--preparar-roles" && extras.length > 0) return USO;

  const vercel = leerDestino(valores.get("--vercel"));
  const confirmo = valores.get("--confirmo");
  if (extras.includes("--vercel") && vercel === null) {
    return "--vercel acepta solo preview o production (en minúscula).";
  }
  if (vercel === null && (extras.includes("--secretos") || confirmo !== undefined)) {
    return "--secretos y --confirmo se usan solo junto con --vercel.";
  }
  if (vercel !== null && extras.includes("--con-respaldo")) {
    return (
      "--con-respaldo no se usa con --vercel: la credencial del rol de respaldo salta el aislamiento y nunca va " +
      "a Vercel (va al secreto del Environment «respaldo» de GitHub). Corré el comando sin --vercel."
    );
  }
  if (vercel === "production" && confirmo !== "production") return SIN_CONFIRMACION;
  if (vercel === "preview" && confirmo !== undefined) {
    return "--confirmo se usa solo con --vercel production.";
  }
  return {
    modo,
    conAutenticacion: extras.includes("--con-autenticacion"),
    conRespaldo: extras.includes("--con-respaldo"),
    rotar: extras.includes("--rotar"),
    directa: extras.includes("--directa"),
    diagnostico: extras.includes("--diagnostico"),
    vercel,
    secretos: extras.includes("--secretos"),
  };
}

function lista(nombres: readonly string[]): string[] {
  return nombres.map((nombre) => `  - ${nombre}`);
}

/** Los problemas que harían fallar a `aplicarMigraciones`, en castellano. */
function problemasDe(estado: EstadoDeMigraciones): string[] {
  return [
    ...estado.editadas.map(
      (n) => `${n} ya se aplicó y el archivo se editó después (el historial no se reescribe)`,
    ),
    ...estado.sinArchivo.map((n) => `${n} figura como aplicada pero su archivo ya no existe`),
  ];
}

function describirEstado(estado: EstadoDeMigraciones): string[] {
  return [
    estado.tablaDeControl
      ? "Tabla de control: existe."
      : "Tabla de control: todavía no existe (la base no tiene ninguna migración aplicada).",
    `Aplicadas (${estado.aplicadas.length}):`,
    ...lista(estado.aplicadas),
    `Pendientes (${estado.pendientes.length}):`,
    ...lista(estado.pendientes),
  ];
}

export async function ejecutarMigracion(entrada: EntradaDeMigracion): Promise<number> {
  const { argumentos, entorno, carpeta } = entrada;
  const cadena = entorno[VARIABLE_DE_LA_CADENA]?.trim();
  // Además de la cadena, se tapan el token de Vercel y cada contraseña o secreto generado.
  const tapados: string[] = [];
  const tapar = (linea: string) =>
    tapados.reduce(
      (texto, secreto) => ocultarSecretos(texto, secreto),
      ocultarSecretos(linea, cadena),
    );
  const info = (linea: string) => entrada.info(tapar(linea));
  const error = (linea: string) => entrada.error(tapar(linea));

  const pedido = leerPedido(argumentos);
  if (typeof pedido === "string") {
    error(`ERROR: ${pedido}`);
    return 2;
  }
  if (pedido.modo === "--preparar-roles" && entorno["GITHUB_ACTIONS"] === "true") {
    error(
      "ERROR: --preparar-roles imprime contraseñas y no se corre en GitHub Actions (el registro queda " +
        "guardado). Correlo en tu terminal.",
    );
    return 2;
  }
  if (cadena === undefined || cadena === "") {
    error(
      `ERROR: falta la variable ${VARIABLE_DE_LA_CADENA}: es la cadena de conexión DIRECTA de la base.`,
    );
    return 1;
  }
  let protocolo: string;
  try {
    protocolo = new URL(cadena).protocol;
  } catch {
    protocolo = "";
  }
  if (protocolo !== "postgres:" && protocolo !== "postgresql:") {
    error(
      `ERROR: ${VARIABLE_DE_LA_CADENA} no tiene forma de cadena de conexión (postgresql://usuario:clave@host/base).`,
    );
    return 1;
  }

  // Con `--vercel`, antes de tocar nada se comprueba que el token sirve y se puede leer el proyecto: si
  // no, se corta acá y no se cambia ninguna contraseña.
  let vercel: Readonly<{ cliente: ClienteDeVariables; destino: Destino }> | null = null;
  if (pedido.vercel !== null) {
    const token = entorno[VARIABLE_DEL_TOKEN]?.trim();
    if (token === undefined || token === "") {
      error(`ERROR: ${SIN_TOKEN}`);
      return 1;
    }
    if (!/^[\x21-\x7e]+$/.test(token)) {
      error(
        `ERROR: ${VARIABLE_DEL_TOKEN} tiene espacios, saltos de línea o letras raras: copialo de nuevo.`,
      );
      return 1;
    }
    tapados.push(token);
    const cliente = crearClienteVercel({
      token,
      fetch: entrada.fetch ?? fetch,
      ...(entrada.plazoDeVercelEnMs === undefined ? {} : { plazoEnMs: entrada.plazoDeVercelEnMs }),
      ...(entrada.esperarEntreLecturas === undefined
        ? {}
        : { esperar: entrada.esperarEntreLecturas }),
    });
    info(
      `Se cargará en Vercel: ${pedido.vercel.toUpperCase()} (proyecto pedernal-erp, equipo ${EQUIPO_DE_VERCEL}).`,
    );
    const lectura = await cliente.listar();
    if (!lectura.ok) {
      error(`ERROR: no se pudo leer el proyecto de Vercel: ${lectura.error.motivo}.`);
      error("RESULTADO: FALLA (no se cambió nada).");
      return 1;
    }
    vercel = { cliente, destino: pedido.vercel };
  }

  const verSolo = pedido.modo === "--ver";
  info(
    verSolo
      ? "Modo: VER (solo lectura, no escribe nada)."
      : pedido.modo === "--aplicar"
        ? "Modo: APLICAR migraciones."
        : "Modo: PREPARAR ROLES (aplica migraciones y da LOGIN a los roles de la aplicación).",
  );
  let fase: "migraciones" | "roles" = "migraciones";
  try {
    const antes = await leerEstadoDeMigraciones(cadena, carpeta);
    for (const linea of describirEstado(antes)) info(linea);
    const problemas = problemasDe(antes);
    if (problemas.length > 0) {
      error("Problemas que hacen fallar a «aplicar» (hay que resolverlos en el código):");
      for (const problema of problemas) error(`  - ${problema}`);
      error("RESULTADO: FALLA.");
      return 1;
    }
    if (verSolo) {
      info(
        antes.pendientes.length === 0
          ? "RESULTADO: la base está al día, no hay nada para aplicar."
          : `RESULTADO: faltan aplicar ${antes.pendientes.length} migraciones (no se aplicó nada).`,
      );
      return 0;
    }

    const resultado = await aplicarMigraciones(cadena, carpeta);
    info(`Aplicadas ahora (${resultado.aplicadas.length}):`);
    for (const linea of lista(resultado.aplicadas)) info(linea);
    info(`Ya estaban aplicadas: ${resultado.yaAplicadas.length}.`);
    if (pedido.modo === "--aplicar") {
      info(
        resultado.aplicadas.length === 0
          ? "RESULTADO: OK, la base ya estaba al día; no se cambió nada."
          : `RESULTADO: OK, se aplicaron ${resultado.aplicadas.length} migraciones.`,
      );
      return 0;
    }

    fase = "roles";
    if (vercel !== null) {
      return await prepararYCargar(cadena, pedido, entrada, {
        info,
        error,
        tapar: (secreto) => tapados.push(secreto),
        ...vercel,
        migracionesAplicadas: resultado.aplicadas.length,
      });
    }
    await prepararYMostrar(cadena, pedido, entrada, info);
    return 0;
  } catch (falla) {
    error(`ERROR: ${describirFallaDeBase(falla, cadena)}`);
    if (fase === "migraciones" && !verSolo) await contarQueQuedoPendiente(cadena, carpeta, error);
    error("RESULTADO: FALLA.");
    return 1;
  }
}

async function prepararYMostrar(
  cadena: string,
  pedido: Pedido,
  entrada: EntradaDeMigracion,
  info: (linea: string) => void,
): Promise<void> {
  const roles = (entrada.roles ?? rolesPorPreparar)(pedido.conAutenticacion, pedido.conRespaldo);
  let preparados: RolPreparado[];
  try {
    preparados = await prepararRoles(cadena, {
      roles,
      rotar: pedido.rotar,
      diagnostico: pedido.diagnostico,
      ...(entrada.generarClave === undefined ? {} : { generarClave: entrada.generarClave }),
    });
  } catch (falla) {
    // Los roles que ya quedaron activos antes de la falla tienen una contraseña que nadie vio: se muestra.
    if (
      falla instanceof ErrorDePreparacion &&
      falla.preparados.some((p) => p.clave !== undefined)
    ) {
      mostrarBloqueDeVercel(cadena, pedido, entrada, info, falla.preparados);
    }
    throw falla;
  }
  for (const p of preparados) {
    info(
      p.estado === "nuevo"
        ? `${p.rol}: LOGIN activado con una contraseña nueva (va en el bloque de abajo).`
        : p.estado === "rotado"
          ? `${p.rol}: contraseña ROTADA; la anterior ya no sirve (va en el bloque de abajo).`
          : `${p.rol}: ya tenía LOGIN, no se tocó (su contraseña no se puede volver a mostrar; ` +
            "para generar otra, --rotar).",
    );
  }
  if (!preparados.some((p) => p.clave !== undefined)) {
    info("RESULTADO: OK, no hubo nada para cambiar; no se generó ninguna contraseña.");
    return;
  }
  const conClave = mostrarBloqueDeVercel(cadena, pedido, entrada, info, preparados);
  info(`RESULTADO: OK, ${conClave.length} roles con contraseña nueva.`);
}

type ContextoDeVercel = Readonly<{
  info: (linea: string) => void;
  error: (linea: string) => void;
  /** Suma un secreto a lo que se tapa en toda salida posterior. */
  tapar: (secreto: string) => void;
  cliente: ClienteDeVariables;
  destino: Destino;
  migracionesAplicadas: number;
}>;

/**
 * `--preparar-roles --vercel`: prepara los roles y escribe sus contraseñas en Vercel, sin imprimirlas.
 * Todo corre dentro de un bloqueo de sesión propio (ver `bloqueo-de-carga.ts`), y la lista de variables
 * de Vercel se lee de nuevo ya con el bloqueo tomado, antes de tocar ninguna contraseña. Si cargar en
 * Vercel falla o se corta con una excepción, las contraseñas que no llegaron se imprimen igual.
 */
async function prepararYCargar(
  cadena: string,
  pedido: Pedido,
  entrada: EntradaDeMigracion,
  contexto: ContextoDeVercel,
): Promise<number> {
  return conBloqueoDeCarga(cadena, async () => {
    const { cliente, error } = contexto;
    const lectura = await cliente.listar();
    if (!lectura.ok) {
      throw new ErrorDePreparacion(
        `no se pudo leer el proyecto de Vercel: ${lectura.error.motivo} (no se cambió ninguna contraseña)`,
      );
    }
    const roles = (entrada.roles ?? rolesPorPreparar)(pedido.conAutenticacion, pedido.conRespaldo);
    let preparados: RolPreparado[];
    let fallaDeRoles: ErrorDePreparacion | null = null;
    try {
      preparados = await prepararRoles(cadena, {
        roles,
        rotar: pedido.rotar,
        diagnostico: pedido.diagnostico,
        ...(entrada.generarClave === undefined ? {} : { generarClave: entrada.generarClave }),
      });
    } catch (falla) {
      // Los roles que ya quedaron activos antes de la falla tienen una contraseña que nadie vio: se cargan igual.
      if (
        !(falla instanceof ErrorDePreparacion) ||
        !falla.preparados.some((p) => p.clave !== undefined)
      ) {
        throw falla;
      }
      preparados = falla.preparados.filter((p) => p.clave !== undefined);
      fallaDeRoles = falla;
    }
    const conClave = preparados.filter((p) => p.clave !== undefined);
    for (const p of conClave) contexto.tapar(p.clave ?? "");
    let sinCargar: readonly RolPreparado[] = conClave;
    let sinPooler = false;
    try {
      const valores: ValorACargar[] = conClave.map((p) => {
        const { cadena: deRol, pooler } = cadenaDeRol(
          cadena,
          p.rol,
          p.clave ?? "",
          !pedido.directa,
        );
        if (!pedido.directa && !pooler) sinPooler = true;
        return { key: p.variable, value: deRol };
      });
      const secretos =
        pedido.secretos && fallaDeRoles === null ? generarSecretos(entrada.bytesAlAzar) : [];
      for (const secreto of secretos) contexto.tapar(secreto.value);
      const intactas =
        fallaDeRoles === null
          ? preparados.filter((p) => p.clave === undefined).map((p) => p.variable)
          : [];
      const plan = planificar({
        destino: contexto.destino,
        existentes: lectura.valor,
        paraEscribir: [...valores, ...secretos],
        intactas,
      });
      const carga = await cargarEnVercel(cliente, contexto.destino, plan.pasos);
      sinCargar = conClave.filter((p) => carga.noEscritas.includes(p.variable));
      const hechos = resumirCarga(contexto, {
        pedido,
        preparados,
        carga,
        yaCargadas: plan.yaCargadas,
        faltaRotar: plan.faltaRotar,
        secretos: secretos.map((s) => s.key),
        sinPooler,
      });
      if (sinCargar.length > 0) {
        error(
          `Las contraseñas de abajo YA están cambiadas en la base y NO quedaron cargadas en Vercel (${contexto.destino.toUpperCase()}). ` +
            "Pegalas a mano (Settings > Environment Variables, tipo Sensitive) o repetí este comando con --rotar " +
            "para que genere otras y las cargue.",
        );
        mostrarBloqueDeVercel(cadena, pedido, entrada, contexto.info, sinCargar);
      }
      if (fallaDeRoles !== null) throw fallaDeRoles;
      if (!hechos) {
        error("RESULTADO: FALLA, ver «No hecho» más arriba.");
        return 1;
      }
      contexto.info(
        `RESULTADO: OK, la base y Vercel (${contexto.destino.toUpperCase()}) quedaron listos.`,
      );
      return 0;
    } catch (falla) {
      // Una excepción inesperada no puede perder las contraseñas que ya se cambiaron (y no se mostraron).
      if (falla !== fallaDeRoles && sinCargar.length > 0) {
        error(
          "Se cortó la carga en Vercel antes de terminar: las contraseñas de abajo YA están cambiadas en la base. " +
            "Pegalas a mano en Vercel o repetí el comando con --rotar.",
        );
        mostrarBloqueDeVercel(cadena, pedido, entrada, contexto.info, sinCargar);
      }
      throw falla;
    }
  });
}

/** Escribe la lista corta de «hecho / no hecho». Devuelve `true` si no quedó nada sin hacer. */
function resumirCarga(
  contexto: ContextoDeVercel,
  datos: Readonly<{
    pedido: Pedido;
    preparados: readonly RolPreparado[];
    carga: ResultadoDeCarga;
    yaCargadas: readonly string[];
    faltaRotar: readonly string[];
    secretos: readonly string[];
    sinPooler: boolean;
  }>,
): boolean {
  const { info, error } = contexto;
  const { preparados, carga } = datos;
  const destino = contexto.destino.toUpperCase();
  const confirmadas = carga.escritas.filter((n) => !carga.noEscritas.includes(n));
  const deContrasenas = confirmadas.filter((n) => !datos.secretos.includes(n));
  const deSecretos = confirmadas.filter((n) => datos.secretos.includes(n));
  const nuevos = preparados.filter((p) => p.clave !== undefined).map((p) => p.rol);

  const hecho: string[] = [
    contexto.migracionesAplicadas === 0
      ? "La base ya estaba al día (sin migraciones nuevas)."
      : `Base: ${contexto.migracionesAplicadas} migraciones aplicadas.`,
  ];
  if (nuevos.length > 0) hecho.push(`Roles con contraseña nueva: ${nuevos.join(", ")}.`);
  if (deContrasenas.length > 0) {
    hecho.push(`Cargadas en Vercel (${destino}, tipo sensible): ${deContrasenas.join(", ")}.`);
    hecho.push(
      datos.pedido.directa
        ? "Las cadenas usan el host DIRECTO (pedido con --directa)."
        : datos.sinPooler
          ? "Las cadenas usan el host directo: el host no es de Neon y no se pudo deducir el del pooler."
          : "Las cadenas usan el host del POOLER de Neon (la aplicación solo usa transacciones).",
    );
  }
  if (datos.yaCargadas.length > 0) {
    hecho.push(`Ya estaban cargadas en Vercel (${destino}): ${datos.yaCargadas.join(", ")}.`);
  }
  if (deSecretos.length > 0) {
    hecho.push(
      `Secretos nuevos generados y cargados en Vercel (${destino}): ${deSecretos.join(", ")}. ` +
        "Reemplazan a los anteriores: las sesiones y las invitaciones emitidas antes dejan de valer.",
    );
  }
  if (carga.borradas.length > 0) {
    hecho.push(
      `Borradas de Vercel (${destino}) por estar prohibidas: ${carga.borradas.join(", ")}.`,
    );
  }
  if (carga.recortadas.length > 0) {
    hecho.push(
      `Prohibidas que valían también para otros destinos: se les quitó ${destino} y se conservan en los demás: ${carga.recortadas.join(", ")}.`,
    );
  }
  for (const nombre of confirmadas) {
    if (esVariableProvisoria(nombre)) {
      hecho.push(`Aviso: ${nombre} es un nombre provisorio: la aplicación todavía no lo declara.`);
    }
  }

  const noHecho: string[] = [];
  for (const nombre of datos.faltaRotar) {
    noHecho.push(
      `${nombre}: el rol ya tenía contraseña (no se puede volver a ver) y la variable no está en Vercel (${destino}). ` +
        "Repetí el comando con --rotar para generar otra y cargarla.",
    );
  }
  if (carga.falla !== null) {
    noHecho.push(
      `No se pudo ${carga.falla.paso} en Vercel: ${carga.falla.motivo}. Lo que seguía no se intentó.` +
        (carga.falla.incierta
          ? " No se sabe si Vercel llegó a aplicar ese paso: repetir es seguro."
          : ""),
    );
  }
  for (const problema of carga.problemas) noHecho.push(`${problema.nombre}: ${problema.texto}.`);
  if (carga.sinVerificar) {
    noHecho.push("No se pudo volver a leer el proyecto de Vercel para verificar lo cargado.");
  }
  if (carga.noEscritas.length > 0)
    noHecho.push(`Sin cargar en Vercel: ${carga.noEscritas.join(", ")}.`);

  info("");
  info(`Hecho (Vercel: ${destino}):`);
  for (const linea of hecho) info(`  - ${linea}`);
  if (noHecho.length > 0) {
    error("No hecho:");
    for (const linea of noHecho) error(`  - ${linea}`);
  }
  return noHecho.length === 0;
}

/** El bloque con las variables para Vercel de los roles que recibieron contraseña. Devuelve esos roles. */
function mostrarBloqueDeVercel(
  cadena: string,
  pedido: Pedido,
  entrada: EntradaDeMigracion,
  info: (linea: string) => void,
  preparados: readonly RolPreparado[],
): RolPreparado[] {
  const conClave = preparados.filter((p) => p.clave !== undefined);
  const secreto = entrada.secreto;
  const deRespaldo = conClave.filter((p) => esVariableDeRespaldo(p.variable));
  const paraVercel = conClave.filter((p) => !esVariableDeRespaldo(p.variable));
  let sinPooler = false;
  if (deRespaldo.length > 0) {
    // El rol de respaldo salta el aislamiento: su cadena va aparte, con el host directo, y NUNCA a Vercel.
    secreto("");
    secreto(
      "=========== PEGAR EN GITHUB: Environment «respaldo» > Secrets (NUNCA EN VERCEL) ===========",
    );
    secreto("Se muestra UNA sola vez y no se guarda en ningún lado. Copialo ahora.");
    secreto("");
    for (const p of deRespaldo) {
      secreto(`${p.variable}=${cadenaDeRol(cadena, p.rol, p.clave ?? "", false).cadena}`);
    }
    secreto("");
    secreto("=============== FIN ===============");
  }
  if (paraVercel.length === 0) return conClave;
  secreto("");
  secreto("=============== PEGAR EN VERCEL (Settings > Environment Variables) ===============");
  secreto("Se muestra UNA sola vez y no se guarda en ningún lado. Copialo ahora.");
  secreto("");
  for (const p of paraVercel) {
    const { cadena: deRol, pooler } = cadenaDeRol(cadena, p.rol, p.clave ?? "", !pedido.directa);
    if (!pedido.directa && !pooler) sinPooler = true;
    secreto(`${p.variable}=${deRol}`);
  }
  secreto("");
  secreto("=============== FIN ===============");
  secreto("");
  info(
    pedido.directa
      ? "Las cadenas usan el host DIRECTO (pedido con --directa)."
      : sinPooler
        ? "Las cadenas usan el host directo: el host no es de Neon y no se pudo deducir el del pooler."
        : "Las cadenas usan el host del POOLER de Neon (la aplicación solo usa transacciones y no depende de la sesión).",
  );
  for (const p of paraVercel) {
    if (esVariableProvisoria(p.variable)) {
      info(
        `Aviso: ${p.variable} es un nombre provisorio: la aplicación todavía no declara una variable para ${p.rol}.`,
      );
    }
  }
  return conClave;
}

/**
 * Cada migración corre en su transacción: lo anterior a la que falló quedó aplicado y ella no. Lo
 * decimos con una lectura nueva (si también falla, se omite: el error de arriba ya es el útil).
 */
async function contarQueQuedoPendiente(
  cadena: string,
  carpeta: string,
  error: (linea: string) => void,
): Promise<void> {
  try {
    const estado = await leerEstadoDeMigraciones(cadena, carpeta);
    const primera = estado.pendientes[0] ?? "ninguna";
    error(
      `Estado después de la falla: ${estado.aplicadas.length} aplicadas, ${estado.pendientes.length} pendientes. ` +
        `Si falló una migración, es la primera pendiente (${primera}); cada una corre en su propia transacción, así que ninguna quedó a medias.`,
    );
  } catch {
    // Sin esta lectura el informe sigue siendo correcto.
  }
}
