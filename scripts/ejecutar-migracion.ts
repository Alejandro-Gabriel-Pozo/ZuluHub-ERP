import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base.ts";
import {
  leerEstadoDeMigraciones,
  type EstadoDeMigraciones,
} from "../src/adaptadores/postgres/estado-de-migraciones.ts";
import { aplicarMigraciones } from "../src/adaptadores/postgres/migraciones.ts";
import { prepararRoles } from "../src/adaptadores/postgres/preparar-roles.ts";
import {
  cadenaDeRol,
  esVariableProvisoria,
  rolesPorPreparar,
  type RolPorPreparar,
} from "../src/adaptadores/postgres/roles-de-la-aplicacion.ts";

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
 *   autenticación y captación; con `--rotar` también cambia la contraseña de los que ya tienen LOGIN;
 *   con `--directa` arma las cadenas con el host directo en vez del del pooler.
 *
 * La cadena DIRECTA de la base se lee de `ZULUHUB_DB_MIGRACIONES`. Esta función no la escribe jamás,
 * ni entera ni en pedazos: todo lo que imprime pasa por `ocultarSecretos` y las fallas se cuentan con
 * `describirFallaDeBase`. La ÚNICA salida que lleva credenciales es el bloque de `--preparar-roles`,
 * que va por `secreto` (nunca por `info` ni `error`). Devuelve el código de salida: 0 todo bien,
 * 1 falla o problema en la base, 2 uso incorrecto.
 */

export const VARIABLE_DE_LA_CADENA = "ZULUHUB_DB_MIGRACIONES";

export type EntradaDeMigracion = Readonly<{
  argumentos: readonly string[];
  entorno: Readonly<Record<string, string | undefined>>;
  carpeta: string;
  info: (linea: string) => void;
  error: (linea: string) => void;
  /** Donde va el bloque con credenciales de `--preparar-roles`. */
  secreto: (linea: string) => void;
  /** Se inyectan en las pruebas (roles propios, contraseñas conocidas); por defecto, los reales. */
  roles?: (conAutenticacion: boolean) => readonly RolPorPreparar[];
  generarClave?: () => string;
}>;

const USO =
  "uso: migrar-base --ver | --aplicar | --preparar-roles [--con-autenticacion] [--rotar] [--directa]";

type Pedido = Readonly<{
  modo: "--ver" | "--aplicar" | "--preparar-roles";
  conAutenticacion: boolean;
  rotar: boolean;
  directa: boolean;
}>;

const MODOS = ["--ver", "--aplicar", "--preparar-roles"] as const;
const EXTRAS = ["--con-autenticacion", "--rotar", "--directa"] as const;

/** Un solo modo, y las banderas extra solo con `--preparar-roles`, cada una una vez. */
function leerPedido(argumentos: readonly string[]): Pedido | null {
  if (new Set(argumentos).size !== argumentos.length) return null;
  const modos = argumentos.filter((a) => (MODOS as readonly string[]).includes(a));
  const extras = argumentos.filter((a) => (EXTRAS as readonly string[]).includes(a));
  if (modos.length !== 1 || modos.length + extras.length !== argumentos.length) return null;
  const modo = modos[0] as Pedido["modo"];
  if (modo !== "--preparar-roles" && extras.length > 0) return null;
  return {
    modo,
    conAutenticacion: extras.includes("--con-autenticacion"),
    rotar: extras.includes("--rotar"),
    directa: extras.includes("--directa"),
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
  const info = (linea: string) => entrada.info(ocultarSecretos(linea, cadena));
  const error = (linea: string) => entrada.error(ocultarSecretos(linea, cadena));

  const pedido = leerPedido(argumentos);
  if (pedido === null) {
    error(`ERROR: ${USO}`);
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
  const roles = (entrada.roles ?? rolesPorPreparar)(pedido.conAutenticacion);
  const preparados = await prepararRoles(cadena, {
    roles,
    rotar: pedido.rotar,
    ...(entrada.generarClave === undefined ? {} : { generarClave: entrada.generarClave }),
  });
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
  const conClave = preparados.filter((p) => p.clave !== undefined);
  if (conClave.length === 0) {
    info("RESULTADO: OK, no hubo nada para cambiar; no se generó ninguna contraseña.");
    return;
  }

  const secreto = entrada.secreto;
  let sinPooler = false;
  secreto("");
  secreto("=============== PEGAR EN VERCEL (Settings > Environment Variables) ===============");
  secreto("Se muestra UNA sola vez y no se guarda en ningún lado. Copialo ahora.");
  secreto("");
  for (const p of conClave) {
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
  for (const p of conClave) {
    if (esVariableProvisoria(p.variable)) {
      info(
        `Aviso: ${p.variable} es un nombre provisorio: la aplicación todavía no declara una variable para ${p.rol}.`,
      );
    }
  }
  info(`RESULTADO: OK, ${conClave.length} roles con contraseña nueva.`);
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
