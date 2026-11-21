import { randomBytes } from "node:crypto";
import { leerClaveDeContexto } from "../src/adaptadores/postgres/contexto-firmado";
import {
  aplicarCambioDeLaConsola,
  kidDeLaClaveNueva,
  leerEstadoDeLaConsola,
  ROL_DE_AUTENTICACION_DE_CONSOLA,
  ROL_DE_PLATAFORMA,
  VIGENCIA_DEL_LOGIN_EN_DIAS,
  type CambioDeLaConsola,
  type LoginNuevo,
} from "../src/adaptadores/postgres/consola-de-plataforma";
import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base";
import { cadenaDeRol, claveAlAzar } from "../src/adaptadores/postgres/roles-de-la-aplicacion";
import {
  crearClienteVercel,
  type ClienteDeVariables,
} from "../src/adaptadores/vercel/cliente-vercel";
import {
  PROYECTO_DE_VERCEL,
  PROYECTO_DE_VERCEL_DE_LA_CONSOLA,
  VARIABLE_CLAVE_CONTEXTO,
  VARIABLE_SECRETO_INVITACIONES,
  type VariableRemota,
} from "../src/adaptadores/vercel/plan-de-variables";
import {
  GOOGLE_CLIENT_ID_PLATAFORMA,
  GOOGLE_CLIENT_SECRET_PLATAFORMA,
  PEDERNAL_AUTH_SECRETO_PLATAFORMA,
  PEDERNAL_HOST_DE_LA_CONSOLA,
} from "../src/adaptadores/autenticacion/configuracion";
import {
  PEDERNAL_DB_AUTENTICACION,
  PEDERNAL_DB_PLATAFORMA,
} from "../src/composicion/entorno-de-plataforma";
import { leerCadenaDeDueno } from "./ejecutar-instalar-clave";

/**
 * Lo que hace `scripts/cargar-entorno-consola.ts` (workflow `cargar-entorno-consola.yml`): deja la consola de plataforma de `preview`
 * con sus variables SIN que el dueño vea ni pegue ningún secreto. Decisiones del dueño (2026-11-19, pregunta directa): rol de
 * autenticación PROPIO de la consola (0088), login permanente de `pedernal_plataforma` SOLO en `preview` (90 días, renovable por este
 * flujo), el mismo secreto de invitaciones en la web y la consola, y token de Vercel propio con alcance a los dos proyectos.
 *
 * Qué carga (todo en Vercel `preview`, sensible, valor al azar de esta corrida que nadie ve):
 *  - `PEDERNAL_CLAVE_CONTEXTO` de la consola: kid nuevo (el siguiente al más alto de la base, mínimo 3), instalada en `contexto_clave`.
 *  - `PEDERNAL_SECRETO_INVITACIONES`: UN valor nuevo escrito IGUAL en la web y en la consola (primero la web).
 *  - `PEDERNAL_DB_AUTENTICACION` y `PEDERNAL_DB_PLATAFORMA` de la consola: contraseña nueva de `pedernal_autenticacion_plataforma` y de
 *    `pedernal_plataforma`, con login y `VALID UNTIL` a 90 días.
 * Qué NO carga: `PEDERNAL_HOST_DE_LA_CONSOLA`, `PEDERNAL_AUTH_SECRETO_PLATAFORMA` y el cliente de Google (los carga el dueño; acá solo
 * se informa por nombre si están o faltan). NUNCA toca `production`: sin `DESTINO=preview` no hace nada.
 *
 * Sin `rotar` es idempotente: lo que ya está no se toca (solo se renueva la vigencia del login de los roles que ya entran). Con `rotar`
 * reemplaza las cuatro. Atomicidad (de la base): un cambio en UNA transacción que queda abierta mientras se escribe en Vercel; si
 * Vercel falla se deshace y la base no cambia. Lo que no puede evitarse (Vercel no tiene transacciones): si falla a mitad, algunas
 * variables ya quedaron escritas; el informe las nombra y repetir con `rotar` lo deja consistente.
 *
 * Nada de lo secreto se imprime: cada valor se enmascara (`::add-mask::`) antes de usarse y todo lo que sale pasa por `ocultarSecretos`.
 * Código de salida: 0 bien, 1 falla o problema de configuración.
 */

/** El token del flujo: DISTINTO de `PEDERNAL_VERCEL_TOKEN`, con alcance a los DOS proyectos y vencimiento corto. */
export const VARIABLE_DEL_TOKEN_DE_LA_CONSOLA = "PEDERNAL_VERCEL_TOKEN_CONSOLA";
export const DESTINO_UNICO = "preview";

const A_MANO_DEL_DUENO: readonly string[] = [
  PEDERNAL_HOST_DE_LA_CONSOLA,
  PEDERNAL_AUTH_SECRETO_PLATAFORMA,
  GOOGLE_CLIENT_ID_PLATAFORMA,
  GOOGLE_CLIENT_SECRET_PLATAFORMA,
];

export type EntradaDeCargaDeLaConsola = Readonly<{
  entorno: Readonly<Record<string, string | undefined>>;
  info: (linea: string) => void;
  error: (linea: string) => void;
  /** Una línea tal cual, sin tapar (`::add-mask::`). */
  comando: (linea: string) => void;
  /** Para las pruebas. */
  crearCliente?: (token: string, proyecto: string) => ClienteDeVariables;
  leerEstado?: typeof leerEstadoDeLaConsola;
  aplicar?: typeof aplicarCambioDeLaConsola;
  bytesAlAzar?: (cuantos: number) => Buffer;
}>;

type Estado = "ok" | "falta" | "rara";

/** ¿Está la variable en `preview`, una sola vez, sin rama ni entorno propio? `rara` = hay algo que no se puede reemplazar sin adivinar. */
function estadoDeVariable(lista: readonly VariableRemota[], key: string): Estado {
  const filas = lista.filter((v) => v.key === key && v.target.includes(DESTINO_UNICO));
  if (filas.length === 0) return "falta";
  const [una] = filas;
  if (
    filas.length === 1 &&
    una !== undefined &&
    una.target.length === 1 &&
    una.gitBranch === null &&
    una.customEnvironmentIds.length === 0
  ) {
    return "ok";
  }
  return "rara";
}

const TOKEN_VALIDO = /^[\x21-\x7e]+$/;

export async function ejecutarCargaDeLaConsola(
  entrada: EntradaDeCargaDeLaConsola,
): Promise<number> {
  const { entorno } = entrada;
  const cadenaCruda = entorno["PEDERNAL_DB_MIGRACIONES"]?.trim();
  const token = entorno[VARIABLE_DEL_TOKEN_DE_LA_CONSOLA]?.trim();
  const tapados: Array<string | undefined> = [cadenaCruda, token];
  const tapar = (linea: string) =>
    tapados.reduce<string>((texto, secreto) => ocultarSecretos(texto, secreto), linea);
  const info = (linea: string) => entrada.info(tapar(linea));
  const error = (linea: string) => entrada.error(tapar(linea));
  const secreto = (valor: string) => {
    tapados.push(valor);
    entrada.comando(`::add-mask::${valor}`);
    return valor;
  };

  // Fail closed: solo `preview`, y `rotar` tiene que ser un sí o un no explícito.
  if (entorno["DESTINO"] !== DESTINO_UNICO) {
    error(`ERROR: esta carga es solo para ${DESTINO_UNICO}; producción no se toca desde acá.`);
    return 1;
  }
  const rotarTexto = entorno["ROTAR"];
  if (rotarTexto !== "true" && rotarTexto !== "false") {
    error("ERROR: la opción «rotar» tiene que ser true o false.");
    return 1;
  }
  const rotar = rotarTexto === "true";
  const revisada = leerCadenaDeDueno(cadenaCruda);
  if ("problema" in revisada) {
    error(`ERROR: ${revisada.problema}`);
    return 1;
  }
  const { cadena } = revisada;
  if (token === undefined || token === "" || !TOKEN_VALIDO.test(token)) {
    error(
      `ERROR: falta ${VARIABLE_DEL_TOKEN_DE_LA_CONSOLA} en el Environment preview (o tiene espacios o saltos de línea): es el token de Vercel con alcance a los dos proyectos.`,
    );
    return 1;
  }

  const crear =
    entrada.crearCliente ??
    ((t: string, proyecto: string) => crearClienteVercel({ token: t, fetch, proyecto }));
  const web = crear(token, PROYECTO_DE_VERCEL);
  const consola = crear(token, PROYECTO_DE_VERCEL_DE_LA_CONSOLA);
  const bytes = entrada.bytesAlAzar ?? ((n: number) => randomBytes(n));

  try {
    // 1. Solo lectura: lo que hay en los dos proyectos y en la base. Nada se escribe si algo de esto falla.
    const deLaWeb = await web.listar();
    if (!deLaWeb.ok) {
      error(`ERROR: no se pudo leer la web en Vercel: ${deLaWeb.error.motivo}`);
      return 1;
    }
    const deLaConsola = await consola.listar();
    if (!deLaConsola.ok) {
      error(`ERROR: no se pudo leer la consola en Vercel: ${deLaConsola.error.motivo}`);
      return 1;
    }
    const estado = await (entrada.leerEstado ?? leerEstadoDeLaConsola)(cadena);
    for (const rol of [ROL_DE_PLATAFORMA, ROL_DE_AUTENTICACION_DE_CONSOLA]) {
      if (estado.roles[rol]?.existe !== true) {
        error(
          `ERROR: en la base no existe el rol ${rol}: corré antes «Migrar (preview y producción)» (aplicar) en preview.`,
        );
        return 1;
      }
    }
    const enWeb = (key: string) => estadoDeVariable(deLaWeb.valor, key);
    const enConsola = (key: string) => estadoDeVariable(deLaConsola.valor, key);

    // 2. Qué hay que cambiar.
    const invitaciones =
      rotar ||
      enConsola(VARIABLE_SECRETO_INVITACIONES) !== "ok" ||
      enWeb(VARIABLE_SECRETO_INVITACIONES) !== "ok";
    const claveDeContexto = rotar || enConsola(VARIABLE_CLAVE_CONTEXTO) !== "ok";
    const logins: Array<{ rol: string; variable: string }> = [
      { rol: ROL_DE_AUTENTICACION_DE_CONSOLA, variable: PEDERNAL_DB_AUTENTICACION },
      { rol: ROL_DE_PLATAFORMA, variable: PEDERNAL_DB_PLATAFORMA },
    ];
    const nuevos = logins.filter(
      ({ rol, variable }) =>
        rotar || enConsola(variable) !== "ok" || estado.roles[rol]?.puedeEntrar !== true,
    );
    const aEscribir = [
      ...(invitaciones ? [`${VARIABLE_SECRETO_INVITACIONES} (web y consola)`] : []),
      ...(claveDeContexto ? [VARIABLE_CLAVE_CONTEXTO] : []),
      ...nuevos.map((l) => l.variable),
    ];
    // Una variable que ya existe pero no es solo de preview no se reemplaza a ciegas.
    const raras = [
      ...(invitaciones
        ? [VARIABLE_SECRETO_INVITACIONES]
            .filter((k) => enWeb(k) === "rara" || enConsola(k) === "rara")
            .map((k) => `${k} (web o consola)`)
        : []),
      ...(claveDeContexto && enConsola(VARIABLE_CLAVE_CONTEXTO) === "rara"
        ? [VARIABLE_CLAVE_CONTEXTO]
        : []),
      ...nuevos.filter((l) => enConsola(l.variable) === "rara").map((l) => l.variable),
    ];
    if (raras.length > 0) {
      error(
        `ERROR: estas variables ya existen con más de un destino, con rama o con entorno propio y no se reemplazan a ciegas: ${raras.join(", ")}. Dejalas solo para preview en Vercel (o borralas) y repetí.`,
      );
      return 1;
    }

    // 3. Los valores (cada uno enmascarado antes de usarse).
    const valores = new Map<string, string>();
    let claveNueva: CambioDeLaConsola["claveDeContexto"] = null;
    if (invitaciones) {
      valores.set(VARIABLE_SECRETO_INVITACIONES, secreto(bytes(32).toString("hex")));
    }
    if (claveDeContexto) {
      const kid = kidDeLaClaveNueva(estado.kidMaximo);
      const completa = secreto(`${kid}:${secreto(bytes(32).toString("hex"))}`);
      claveNueva = leerClaveDeContexto(completa);
      valores.set(VARIABLE_CLAVE_CONTEXTO, completa);
    }
    const loginsNuevos: LoginNuevo[] = [];
    for (const { rol, variable } of nuevos) {
      const clave = secreto(claveAlAzar());
      loginsNuevos.push({ rol, clave });
      const { cadena: cadenaDelRol } = cadenaDeRol(cadena, rol, clave, true);
      valores.set(variable, secreto(cadenaDelRol));
    }
    const renovar = logins
      .filter((l) => !nuevos.includes(l) && estado.roles[l.rol]?.puedeEntrar === true)
      .map((l) => l.rol);

    // 4. La base primero (en una transacción abierta) y Vercel mientras tanto; si Vercel falla, la base se deshace.
    const escritas: string[] = [];
    const problema: { texto: string | null } = { texto: null };
    const escribir = async (cliente: ClienteDeVariables, etiqueta: string, key: string) => {
      const valor = valores.get(key);
      if (valor === undefined) return true;
      const r = await cliente.escribir(key, valor, DESTINO_UNICO);
      if (!r.ok) {
        problema.texto = `${etiqueta} ${key}: ${r.error.motivo}${r.error.incierta ? " (no se sabe si llegó a aplicarse)" : ""}`;
        return false;
      }
      escritas.push(`${etiqueta} ${key}`);
      return true;
    };
    const entreTanto = async (): Promise<boolean> => {
      if (invitaciones) {
        if (!(await escribir(web, "web", VARIABLE_SECRETO_INVITACIONES))) return false;
        if (!(await escribir(consola, "consola", VARIABLE_SECRETO_INVITACIONES))) return false;
      }
      if (claveDeContexto && !(await escribir(consola, "consola", VARIABLE_CLAVE_CONTEXTO)))
        return false;
      for (const { variable } of nuevos) {
        if (!(await escribir(consola, "consola", variable))) return false;
      }
      return true;
    };
    const cambio: CambioDeLaConsola = { claveDeContexto: claveNueva, loginsNuevos, renovar };
    const confirmado = await (entrada.aplicar ?? aplicarCambioDeLaConsola)(
      cadena,
      cambio,
      entreTanto,
    );
    if (!confirmado) {
      error(
        `ERROR: Vercel no aceptó el cambio (${problema.texto ?? "sin detalle"}). La base NO se cambió.`,
      );
      if (escritas.length > 0) {
        error(
          `Ya quedaron escritas en Vercel: ${escritas.join(", ")}. Repetí el flujo con «rotar» en true para dejar todo consistente.`,
        );
      }
      return 1;
    }

    // 5. Informe: solo nombres.
    info(
      `CONSOLA DE ${DESTINO_UNICO.toUpperCase()}: carga terminada (los valores no se muestran).`,
    );
    for (const nombre of aEscribir) info(`  cargada: ${nombre}`);
    for (const rol of renovar)
      info(`  vigencia renovada a ${VIGENCIA_DEL_LOGIN_EN_DIAS} días (misma clave): ${rol}`);
    if (aEscribir.length === 0) info("  nada para cargar: ya estaba todo.");
    for (const nombre of A_MANO_DEL_DUENO) {
      const e = enConsola(nombre);
      info(`  ${e === "falta" ? "FALTA (la carga el dueño a mano)" : "está"}: ${nombre}`);
    }
    if (invitaciones) {
      info(
        "Aviso: el secreto de invitaciones de la web cambió. La web toma el valor nuevo en su próximo despliegue de preview, y las invitaciones de preview que estaban pendientes hay que reenviarlas.",
      );
    }
    if (claveDeContexto || nuevos.length > 0) {
      info(
        "Aviso: la consola toma los valores nuevos en su próximo despliegue de preview (redesplegar el último).",
      );
    }
    return 0;
  } catch (fallaInesperada) {
    error(`ERROR: ${describirFallaDeBase(fallaInesperada, cadena)}`);
    return 1;
  }
}
