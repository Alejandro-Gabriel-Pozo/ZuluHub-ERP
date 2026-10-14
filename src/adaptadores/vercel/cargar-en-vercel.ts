// Con extensión `.ts` a propósito: lo carga `scripts/migrar-base.ts` directamente con Node.
import type { ClienteDeVariables, FallaDeVercel } from "./cliente-vercel.ts";
import {
  sobraEnVercel,
  type Destino,
  type Paso,
  type VariableRemota,
} from "./plan-de-variables.ts";

/**
 * Ejecuta los pasos de `planificar` contra Vercel y cuenta, con NOMBRES de variable (jamás valores),
 * qué quedó hecho y qué no.
 *
 * - Se frena en la PRIMERA falla: lo que sigue no se intenta (si Vercel o el token fallan, insistir con
 *   cada variable solo suma esperas). Todo paso es idempotente (escribir es `upsert`, borrar algo que ya
 *   no está es éxito), así que repetir el comando completa lo que faltó sin duplicar nada.
 * - Una escritura que no se pudo confirmar se da por NO hecha, aunque Vercel pueda haberla aplicado:
 *   el comando imprime entonces la contraseña (nunca se pierde una ya cambiada) y recomienda `--rotar`.
 * - Al final, y solo si nada falló, vuelve a LEER el proyecto y comprueba lo que quedó: cada variable
 *   escrita figura en el destino, es sensible y vale solo para ese destino, y no sobra nada. Si esa
 *   lectura no se puede hacer, se dice («sin verificar») y no se inventa un resultado.
 */

export type ProblemaVerificado = Readonly<{ nombre: string; texto: string }>;

export type ResultadoDeCarga = Readonly<{
  /** Nombres de las variables escritas (confirmadas por Vercel). */
  escritas: readonly string[];
  /** Nombres de las variables que había que escribir y no están confirmadas (falló, no se intentó o no pasó la verificación). */
  noEscritas: readonly string[];
  /** Nombres de las variables que sobraban y se borraron enteras. */
  borradas: readonly string[];
  /** Nombres de las variables compartidas a las que se les quitó el destino. */
  recortadas: readonly string[];
  /** La primera falla, ya limpia, y el paso en el que ocurrió. */
  falla: Readonly<{ paso: string; motivo: string; incierta: boolean }> | null;
  /** Problemas que dejó ver la verificación final: la variable y qué tiene mal (sin valores). */
  problemas: readonly ProblemaVerificado[];
  /** La verificación final no pudo leer el proyecto. */
  sinVerificar: boolean;
}>;

function descripcionDelPaso(paso: Paso): string {
  const accion =
    paso.tipo === "escribir"
      ? "escribir"
      : paso.tipo === "borrar"
        ? "borrar"
        : "quitar el destino de";
  return `${accion} ${paso.key}`;
}

async function ejecutar(
  cliente: ClienteDeVariables,
  paso: Paso,
  destino: Destino,
): Promise<{ ok: true } | { ok: false; falla: FallaDeVercel }> {
  const respuesta =
    paso.tipo === "escribir"
      ? await cliente.escribir(paso.key, paso.value, destino)
      : paso.tipo === "borrar"
        ? await cliente.borrar(paso.id)
        : await cliente.quitarDestinos(paso.id, paso.target);
  return respuesta.ok ? { ok: true } : { ok: false, falla: respuesta.error };
}

/** Lo que la verificación final encuentra mal en el estado del destino. */
function problemasDe(
  variables: readonly VariableRemota[],
  escritas: readonly string[],
  destino: Destino,
): ProblemaVerificado[] {
  const problemas: ProblemaVerificado[] = [];
  for (const nombre of escritas) {
    const delDestino = variables.filter((v) => v.key === nombre && v.target.includes(destino));
    if (delDestino.length === 0) {
      problemas.push({ nombre, texto: `no figura en ${destino}` });
    } else if (delDestino.some((v) => v.type !== "sensitive" || v.target.length !== 1)) {
      problemas.push({ nombre, texto: `no quedó como sensible y solo para ${destino}` });
    }
  }
  for (const variable of variables) {
    if (sobraEnVercel(variable.key) && variable.target.includes(destino)) {
      problemas.push({ nombre: variable.key, texto: `sigue en ${destino}` });
    }
  }
  return problemas;
}

export async function cargarEnVercel(
  cliente: ClienteDeVariables,
  destino: Destino,
  pasos: readonly Paso[],
): Promise<ResultadoDeCarga> {
  const escritas: string[] = [];
  const borradas: string[] = [];
  const recortadas: string[] = [];
  const porEscribir = pasos.filter((p) => p.tipo === "escribir").map((p) => p.key);
  let falla: ResultadoDeCarga["falla"] = null;

  for (const paso of pasos) {
    if (falla !== null) break;
    const resultado = await ejecutar(cliente, paso, destino);
    if (!resultado.ok) {
      falla = { paso: descripcionDelPaso(paso), ...resultado.falla };
    } else if (paso.tipo === "escribir") {
      escritas.push(paso.key);
    } else if (paso.tipo === "borrar") {
      borradas.push(paso.key);
    } else {
      recortadas.push(paso.key);
    }
  }

  let problemas: ProblemaVerificado[] = [];
  let sinVerificar = false;
  if (falla === null && pasos.length > 0) {
    const lectura = await cliente.listar();
    if (lectura.ok) problemas = problemasDe(lectura.valor, escritas, destino);
    else sinVerificar = true;
  }

  const sinConfirmar = (nombre: string) =>
    !escritas.includes(nombre) || problemas.some((p) => p.nombre === nombre);
  return {
    escritas,
    noEscritas: porEscribir.filter(sinConfirmar),
    borradas,
    recortadas,
    falla,
    problemas,
    sinVerificar,
  };
}
