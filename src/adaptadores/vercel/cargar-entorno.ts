// Con extensión `.ts` a propósito: lo carga `scripts/cargar-entorno.ts` directamente con Node.
import { cargarEnVercel, type ResultadoDeCarga } from "./cargar-en-vercel.ts";
import type { ClienteDeVariables } from "./cliente-vercel.ts";
import {
  EQUIPO_DE_VERCEL,
  VARIABLES_GENERABLES,
  VARIABLE_CLAVE_CERTIFICADOS,
  VARIABLE_CLAVE_CONTEXTO,
  generarValor,
  noDebeEstarEnVercel,
  type Destino,
  type Paso,
  type VariableRemota,
} from "./plan-de-variables.ts";

/**
 * `cargar-entorno`: genera al azar las variables de Vercel que no dependen de nadie y las carga como SENSIBLES en el
 * destino pedido (Production o Preview, nunca los dos), sin mostrar ni devolver ningún valor. Lo que NO se puede
 * generar (correo, Google, el host) lo da el dueño a mano y acá solo se lista por nombre.
 *
 * Reglas que no se negocian (cada una con su prueba en `cargar-entorno.test.ts`):
 * - NUNCA SOBRESCRIBE. Se decide por NOMBRE (el valor de una sensible no se puede leer): si la variable ya figura en
 *   el destino se saltea («ya existía») y, además, la escritura va sin `upsert` (`sinPisar`), así que una variable que
 *   apareciera entre la lectura y la escritura tampoco se pisa. `PEDERNAL_CLAVE_CERTIFICADOS` no se puede rotar
 *   (cambiarla deja ilegibles los certificados cargados).
 * - Ningún valor sale de acá: el informe lleva solo nombres y estados; cada valor se entrega a `tapar` apenas se
 *   genera, antes de cualquier otra cosa, para que el que llama lo tape en toda salida.
 * - La clave de contexto se INSTALA en la base ANTES de cargarse en Vercel, y si la instalación falla no se carga:
 *   una clave en Vercel que la base no tiene hace que la base rechace todo contexto firmado. Si la base YA tiene
 *   alguna clave y Vercel no tiene `PEDERNAL_CLAVE_CONTEXTO`, este flujo no la copia ni genera otra (generar otra
 *   la reemplazaría y la aplicación dejaría de poder firmar): la corrida PARA antes de cambiar nada y lo decide el dueño.
 * - Todo lo que se puede comprobar sin cambiar nada (leer Vercel, mirar la base, generar los valores) se hace ANTES
 *   de la primera escritura. Después se frena en la primera falla de Vercel; repetir el flujo es seguro (lo ya
 *   cargado figura como «ya existía»).
 * - Del chequeo de «lo que NO debe existir» solo se informan nombres; no se borra nada.
 */

/** Las que da el dueño a mano: no se generan. (`PEDERNAL_DB_*` las carga `migrar-base --preparar-roles --vercel`.) */
export const VARIABLES_A_MANO: readonly string[] = [
  "PEDERNAL_RESEND_API_KEY",
  "PEDERNAL_CORREO_REMITENTE",
  "PEDERNAL_NOMBRE_DE_MARCA",
  "PEDERNAL_URL_BASE",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];

export type ResultadoDeLaBase =
  Readonly<{ ok: true; hay: boolean }> | Readonly<{ ok: false; motivo: string }>;
export type InstalacionDeLaClave = Readonly<{ ok: true }> | Readonly<{ ok: false; motivo: string }>;

/** Lo que `cargar-entorno` hace en la base. Las fallas vuelven como `motivo` ya limpio (sin cadena ni clave). */
export type BaseDeLaClave = Readonly<{
  /** ¿La base ya tiene alguna clave de contexto instalada? */
  hayClavesInstaladas: () => Promise<ResultadoDeLaBase>;
  /** Instala `<kid>:<hex>` (lo que hace `npm run instalar-clave`). Idempotente. */
  instalar: (clave: string) => Promise<InstalacionDeLaClave>;
}>;

export type EntradaDeCargaDeEntorno = Readonly<{
  destino: Destino;
  cliente: ClienteDeVariables;
  /** `null`: el entorno no tiene la cadena de la base, y la clave de contexto queda para el dueño. */
  base: BaseDeLaClave | null;
  /** Cada valor generado (y la parte secreta de `<kid>:<hex>`) se entrega acá apenas nace, para taparlo. */
  tapar: (secreto: string) => void;
  bytesAlAzar?: (cuantos: number) => Uint8Array;
}>;

export type EstadoDeVariable =
  "creada" | "ya existía" | "falta que la cargues vos" | "no se pudo cargar" | "no se intentó";

export type FilaDelInforme = Readonly<{
  nombre: string;
  estado: EstadoDeVariable;
  nota: string | null;
}>;

export type Informe = Readonly<{
  destino: Destino;
  /** Si la corrida paró antes de cambiar nada: por qué. */
  detenido: string | null;
  generables: readonly FilaDelInforme[];
  aMano: readonly Readonly<{ nombre: string; cargada: boolean }>[];
  /** Nombres de lo que no debe existir y está en el destino. */
  noDebenExistir: readonly string[];
  /** Todo lo generable quedó cargado (o ya lo estaba), nada paró la corrida y no sobra nada prohibido. */
  ok: boolean;
}>;

const SIN_BASE =
  "falta la cadena de la base (el secreto PEDERNAL_DB_DUENO_DIRECTA del Environment): sin ella no se instala la clave";
const NOTA_PARO = "la corrida se detuvo antes de cambiar nada";
const NOTA_ANTES_FALLO = "antes falló otra carga en Vercel";
const NOTA_GUARDADA_DISTINTA =
  "Vercel la guardó distinta de lo pedido (tiene que ser sensible y solo de este entorno): revisala en Vercel";
const NOTA_SIN_VERIFICAR = "sin verificar: no se pudo volver a leer Vercel";

function mensajeDeClaveSinRecuperar(destino: Destino): string {
  const lugar = destino.toUpperCase();
  return (
    `la base de ${lugar} ya tiene una clave de contexto instalada y Vercel (${lugar}) no tiene ${VARIABLE_CLAVE_CONTEXTO}. ` +
    "Este flujo no la copia a Vercel ni genera otra (reemplazarla dejaría a la aplicación sin poder firmar). No se cargó nada. " +
    "Lo decide el dueño: cargar a mano la clave que tenga guardada, o rotarla con otro kid (PRIMER-DESPLIEGUE.md, B.4)."
  );
}

const fila = (
  nombre: string,
  estado: EstadoDeVariable,
  nota: string | null = null,
): FilaDelInforme => ({ nombre, estado, nota });

/** La parte secreta de un valor `<kid>:<hex>`; de uno sin `kid`, el valor entero. */
const parteSecreta = (valor: string): string => valor.slice(valor.indexOf(":") + 1);

/** Lo raro de una variable que ya existía, por si el dueño la quiere revisar. Solo lo que se ve en la lista. */
function avisoDeLoExistente(variables: readonly VariableRemota[]): string | null {
  const avisos: string[] = [];
  if (variables.some((v) => v.type !== "sensitive")) avisos.push("no es sensible");
  if (variables.some((v) => v.target.length > 1)) avisos.push("vale también para otro destino");
  if (variables.some((v) => v.gitBranch !== null)) avisos.push("está atada a una rama");
  if (variables.some((v) => v.customEnvironmentIds.length > 0)) {
    avisos.push("vale también para un entorno personalizado");
  }
  return avisos.length === 0 ? null : avisos.join(", ");
}

/** Una fila por variable generable, en orden: las que ya existían tal cual y las demás «no se intentó». */
function filasIniciales(
  yaExistian: ReadonlyMap<string, FilaDelInforme>,
  nota: string,
): Map<string, FilaDelInforme> {
  return new Map(
    VARIABLES_GENERABLES.map((nombre) => [
      nombre,
      yaExistian.get(nombre) ?? fila(nombre, "no se intentó", nota),
    ]),
  );
}

function motivoDeLaFalla(falla: NonNullable<ResultadoDeCarga["falla"]>): string {
  return falla.incierta
    ? `${falla.motivo} (no se sabe si Vercel llegó a aplicarlo: repetir el flujo es seguro)`
    : falla.motivo;
}

const notaDeVerificacion = (carga: ResultadoDeCarga): string | null =>
  carga.sinVerificar ? NOTA_SIN_VERIFICAR : null;

/** Una fila por paso de una carga que frena en la primera falla: creada, mal guardada, la que falló, o sin intentar. */
function filasDeLaCarga(pasos: readonly Paso[], carga: ResultadoDeCarga): FilaDelInforme[] {
  // La primera variable sin escribir es la que falló: `cargarEnVercel` se frena ahí.
  let motivoPendiente = carga.falla === null ? null : motivoDeLaFalla(carga.falla);
  return pasos.map(({ key }) => {
    if (carga.escritas.includes(key)) {
      return carga.noEscritas.includes(key)
        ? fila(key, "no se pudo cargar", NOTA_GUARDADA_DISTINTA)
        : fila(key, "creada", notaDeVerificacion(carga));
    }
    if (motivoPendiente === null) return fila(key, "no se intentó", NOTA_ANTES_FALLO);
    const quePaso = fila(key, "no se pudo cargar", motivoPendiente);
    motivoPendiente = null;
    return quePaso;
  });
}

type Vista = Readonly<{
  aMano: Informe["aMano"];
  noDebenExistir: readonly string[];
}>;

/** La corrida paró ANTES de cambiar nada. */
function detenida(
  destino: Destino,
  motivo: string,
  filas: ReadonlyMap<string, FilaDelInforme>,
  vista: Vista,
): Informe {
  return { destino, detenido: motivo, generables: [...filas.values()], ...vista, ok: false };
}

export async function cargarEntorno(entrada: EntradaDeCargaDeEntorno): Promise<Informe> {
  const { destino, cliente, base } = entrada;
  const lectura = await cliente.listar();
  if (!lectura.ok) {
    return detenida(
      destino,
      `no se pudo leer el proyecto de Vercel (equipo ${EQUIPO_DE_VERCEL}): ${lectura.error.motivo}. No se cambió nada.`,
      filasIniciales(new Map(), NOTA_PARO),
      { aMano: [], noDebenExistir: [] },
    );
  }
  const delDestino = lectura.valor.filter((v) => v.target.includes(destino));
  const de = (nombre: string) => delDestino.filter((v) => v.key === nombre);
  const vista: Vista = {
    aMano: VARIABLES_A_MANO.map((nombre) => ({ nombre, cargada: de(nombre).length > 0 })),
    noDebenExistir: [
      ...new Set(delDestino.filter((v) => noDebeEstarEnVercel(v.key)).map((v) => v.key)),
    ].sort(),
  };
  const yaExistian = new Map(
    VARIABLES_GENERABLES.filter((nombre) => de(nombre).length > 0).map((nombre) => [
      nombre,
      fila(nombre, "ya existía", avisoDeLoExistente(de(nombre))),
    ]),
  );
  const pendientes = VARIABLES_GENERABLES.filter((nombre) => !yaExistian.has(nombre));
  const contextoPendiente = pendientes.includes(VARIABLE_CLAVE_CONTEXTO);
  /** La base solo cuenta si la clave de contexto falta: si ya está en Vercel, no se toca nada de ella. */
  const baseDeLaClave = contextoPendiente ? base : null;

  // 1. Todo lo que se puede comprobar sin cambiar nada: la base y los valores.
  if (baseDeLaClave !== null) {
    const estado = await baseDeLaClave.hayClavesInstaladas();
    const parada = (motivo: string) =>
      detenida(destino, motivo, filasIniciales(yaExistian, NOTA_PARO), vista);
    if (!estado.ok) {
      return parada(
        `no se pudo mirar si la base ya tiene una clave de contexto: ${estado.motivo}. No se cambió nada.`,
      );
    }
    if (estado.hay) return parada(mensajeDeClaveSinRecuperar(destino));
  }
  const filas = filasIniciales(yaExistian, NOTA_ANTES_FALLO);
  if (contextoPendiente && baseDeLaClave === null) {
    filas.set(
      VARIABLE_CLAVE_CONTEXTO,
      fila(VARIABLE_CLAVE_CONTEXTO, "falta que la cargues vos", SIN_BASE),
    );
  }

  const registrar = (valor: string): string => {
    entrada.tapar(valor);
    entrada.tapar(parteSecreta(valor));
    return valor;
  };
  const otras: { key: string; value: string }[] = [];
  let aInstalar: { base: BaseDeLaClave; clave: string } | null = null;
  try {
    for (const nombre of pendientes) {
      if (nombre === VARIABLE_CLAVE_CONTEXTO) {
        if (baseDeLaClave === null) continue;
        aInstalar = {
          base: baseDeLaClave,
          clave: registrar(generarValor(nombre, entrada.bytesAlAzar)),
        };
      } else {
        otras.push({ key: nombre, value: registrar(generarValor(nombre, entrada.bytesAlAzar)) });
      }
    }
  } catch (falla) {
    // El mensaje de `generarValor` nombra la variable y el motivo; nunca el valor.
    const motivo = falla instanceof RangeError ? falla.message : "falla al generar un valor";
    return detenida(
      destino,
      `${motivo}. No se cambió nada.`,
      filasIniciales(yaExistian, NOTA_PARO),
      vista,
    );
  }
  const deCertificados = otras.find((o) => o.key === VARIABLE_CLAVE_CERTIFICADOS)?.value;
  if (
    aInstalar !== null &&
    deCertificados !== undefined &&
    parteSecreta(aInstalar.clave) === parteSecreta(deCertificados)
  ) {
    return detenida(
      destino,
      `${VARIABLE_CLAVE_CERTIFICADOS} salió igual a ${VARIABLE_CLAVE_CONTEXTO}: no puede ser la misma. No se cambió nada.`,
      filasIniciales(yaExistian, NOTA_PARO),
      vista,
    );
  }

  // 2. Las que no dependen de la base, de a una y frenando en la primera falla de Vercel.
  const pasos: Paso[] = otras.map(({ key, value }) => ({
    tipo: "escribir",
    key,
    value,
    sinPisar: true,
  }));
  const carga = await cargarEnVercel(cliente, destino, pasos);
  for (const f of filasDeLaCarga(pasos, carga)) filas.set(f.nombre, f);

  // 3. La clave de contexto: primero en la base, y recién después en Vercel (si nada falló antes).
  if (aInstalar !== null && carga.noEscritas.length === 0) {
    filas.set(
      VARIABLE_CLAVE_CONTEXTO,
      await cargarLaClaveDeContexto(entrada, aInstalar.base, aInstalar.clave),
    );
  }

  const generables = [...filas.values()];
  return {
    destino,
    detenido: null,
    generables,
    ...vista,
    ok:
      generables.every((f) => f.estado === "creada" || f.estado === "ya existía") &&
      vista.noDebenExistir.length === 0,
  };
}

/** Instala la clave en la base y, solo si quedó instalada, la carga en Vercel. */
async function cargarLaClaveDeContexto(
  entrada: EntradaDeCargaDeEntorno,
  base: BaseDeLaClave,
  clave: string,
): Promise<FilaDelInforme> {
  const { cliente, destino } = entrada;
  const nombre = VARIABLE_CLAVE_CONTEXTO;
  const instalada = await base.instalar(clave);
  if (!instalada.ok) {
    return fila(
      nombre,
      "no se pudo cargar",
      `no se pudo instalar en la base (${instalada.motivo}); no se cargó en Vercel`,
    );
  }
  const pasos: Paso[] = [{ tipo: "escribir", key: nombre, value: clave, sinPisar: true }];
  let carga = await cargarEnVercel(cliente, destino, pasos);
  if (carga.falla?.incierta === true) {
    // Ya está instalada en la base: perderla en Vercel la dejaría sin dueño. Solo si no se sabe si Vercel la aplicó
    // (red, tiempo, 429, 5xx) se relee —puede haberse aplicado aunque la respuesta se perdiera— y, si no figura, se
    // intenta una vez más. Una falla DEFINITIVA (por ejemplo, que ya existía otra con ese nombre) se informa tal cual:
    // una variable ajena con ese nombre no es la clave que quedó instalada.
    const relectura = await cliente.listar();
    if (
      relectura.ok &&
      relectura.valor.some((v) => v.key === nombre && v.target.includes(destino))
    ) {
      return fila(nombre, "creada", "confirmada al volver a leer Vercel");
    }
    carga = await cargarEnVercel(cliente, destino, pasos);
  }
  if (carga.noEscritas.length === 0) return fila(nombre, "creada", notaDeVerificacion(carga));
  const motivo = carga.falla === null ? NOTA_GUARDADA_DISTINTA : motivoDeLaFalla(carga.falla);
  return fila(
    nombre,
    "no se pudo cargar",
    `quedó instalada en la base pero NO en Vercel (${motivo}). Este flujo no la copia a Vercel: ` +
      "repetir el flujo se va a detener porque la base ya tiene una clave. Lo decide el dueño (PRIMER-DESPLIEGUE.md, B.4)",
  );
}

/** El informe en líneas: lo hecho (`info`) y lo que quedó sin hacer o mal (`error`). Solo nombres y estados. */
export function lineasDelInforme(informe: Informe): Readonly<{ info: string[]; error: string[] }> {
  const lugar = informe.destino.toUpperCase();
  const info: string[] = [`Cargar entorno en Vercel: ${lugar} (equipo ${EQUIPO_DE_VERCEL}).`];
  const error: string[] = [];
  if (informe.detenido !== null) error.push(`SE DETUVO: ${informe.detenido}`);
  info.push("Variables que se generan solas:");
  for (const f of informe.generables) {
    const linea = `  - ${f.nombre}: ${f.estado}${f.nota === null ? "" : ` (${f.nota})`}`;
    (f.estado === "creada" || f.estado === "ya existía" ? info : error).push(linea);
  }
  info.push("Las que tenés que cargar vos (no se generan):");
  for (const { nombre, cargada } of informe.aMano) {
    info.push(`  - ${nombre}: ${cargada ? "ya cargada" : "falta"}`);
  }
  if (informe.noDebenExistir.length === 0) {
    info.push(`Ninguna de las variables que no deben existir está en ${lugar}.`);
  } else {
    error.push(
      `Están en ${lugar} y NO deben existir (no se borró nada; la aplicación no arranca con ellas):`,
    );
    for (const nombre of informe.noDebenExistir) error.push(`  - ${nombre}`);
  }
  if (informe.ok) info.push(`RESULTADO: OK, lo generable en Vercel (${lugar}) quedó cargado.`);
  else error.push("RESULTADO: FALLA (ver arriba lo que quedó sin hacer).");
  return { info, error };
}
