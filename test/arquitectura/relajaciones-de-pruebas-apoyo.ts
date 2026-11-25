/**
 * Apoyo de `relajaciones-de-pruebas.test.ts`: las reglas del registro de relajaciones de pruebas, como funciones puras (reciben el contenido y la fecha de hoy; no leen el disco).
 */

const ESTADOS = ["VIGENTE", "RESTAURADA"] as const;
export const CAMPOS_OBLIGATORIOS = [
  "id",
  "estado",
  "que",
  "donde",
  "motivo",
  "decidio",
  "fecha",
  "restaurar_si",
  "revisar_antes_de",
] as const;
const CAMPOS_PERMITIDOS = [...CAMPOS_OBLIGATORIOS, "valor"] as const;
/** Una relajación se revisa con el dueño como máximo cada 90 días. */
const DIAS_MAXIMOS_DE_REVISION = 90;
const ID_DE_LA_ESTABILIDAD = "estabilidad-reducida-en-pr";

const FORMA_DE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FORMA_DE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FORMA_DE_DECISION = /^dueño, (\d{4}-\d{2}-\d{2})$/;
const LARGO_MAXIMO_DEL_TEXTO = 400;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  valor !== null && typeof valor === "object" && !Array.isArray(valor);

/** Una fecha `AAAA-MM-DD` que existe en el calendario, en milisegundos (UTC), o `null`. */
export function fechaEnMs(texto: unknown): number | null {
  if (typeof texto !== "string" || !FORMA_DE_FECHA.test(texto)) return null;
  const ms = Date.parse(`${texto}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().startsWith(texto) ? ms : null;
}

/** Los problemas de UNA relajación (lista vacía si está bien). `hoy` en `AAAA-MM-DD`. */
function problemasDeUna(entrada: unknown, posicion: number, hoy: string): string[] {
  const donde = `relajación ${posicion + 1}`;
  if (!esObjeto(entrada)) return [`${donde}: tiene que ser un objeto.`];
  const problemas: string[] = [];
  const nombre = typeof entrada["id"] === "string" ? `«${entrada["id"]}»` : donde;
  for (const campo of Object.keys(entrada)) {
    if (!(CAMPOS_PERMITIDOS as readonly string[]).includes(campo)) {
      problemas.push(`${nombre}: «${campo}» no es un campo permitido.`);
    }
  }
  for (const campo of CAMPOS_OBLIGATORIOS) {
    if (!(campo in entrada)) problemas.push(`${nombre}: falta «${campo}».`);
  }
  const id = entrada["id"];
  if ("id" in entrada && !(typeof id === "string" && FORMA_DE_ID.test(id) && id.length <= 80)) {
    problemas.push(`${nombre}: «id» tiene que ser minúsculas, números y guiones (hasta 80).`);
  }
  if ("estado" in entrada && !(ESTADOS as readonly unknown[]).includes(entrada["estado"])) {
    problemas.push(`${nombre}: «estado» tiene que ser ${ESTADOS.join(" o ")}.`);
  }
  for (const campo of ["que", "donde", "motivo", "restaurar_si"] as const) {
    const texto = entrada[campo];
    if (
      campo in entrada &&
      !(typeof texto === "string" && texto.trim() !== "" && texto.length <= LARGO_MAXIMO_DEL_TEXTO)
    ) {
      problemas.push(
        `${nombre}: «${campo}» tiene que ser un texto no vacío (hasta ${LARGO_MAXIMO_DEL_TEXTO}).`,
      );
    }
  }
  const decision =
    typeof entrada["decidio"] === "string" ? FORMA_DE_DECISION.exec(entrada["decidio"]) : null;
  if ("decidio" in entrada && decision === null) {
    problemas.push(
      `${nombre}: «decidio» tiene que ser «dueño, AAAA-MM-DD» (quién lo decidió y cuándo).`,
    );
  }
  const fecha = fechaEnMs(entrada["fecha"]);
  if ("fecha" in entrada && fecha === null)
    problemas.push(`${nombre}: «fecha» tiene que ser una fecha AAAA-MM-DD.`);
  if (fecha !== null && decision !== null && decision[1] !== entrada["fecha"]) {
    problemas.push(`${nombre}: la fecha de «decidio» tiene que ser la misma que «fecha».`);
  }
  const hoyMs = fechaEnMs(hoy);
  if (fecha !== null && hoyMs !== null && fecha > hoyMs) {
    problemas.push(`${nombre}: «fecha» no puede ser futura.`);
  }
  const revisar = fechaEnMs(entrada["revisar_antes_de"]);
  if ("revisar_antes_de" in entrada && revisar === null) {
    problemas.push(`${nombre}: «revisar_antes_de» tiene que ser una fecha AAAA-MM-DD.`);
  }
  if (fecha !== null && revisar !== null) {
    if (revisar <= fecha)
      problemas.push(`${nombre}: «revisar_antes_de» tiene que ser posterior a «fecha».`);
    else if ((revisar - fecha) / MS_POR_DIA > DIAS_MAXIMOS_DE_REVISION) {
      problemas.push(
        `${nombre}: «revisar_antes_de» pasa de ${DIAS_MAXIMOS_DE_REVISION} días desde «fecha».`,
      );
    }
  }
  if (entrada["estado"] === "VIGENTE" && revisar !== null && hoyMs !== null && revisar < hoyMs) {
    problemas.push(
      `${nombre}: la revisión venció el ${String(entrada["revisar_antes_de"])}: se renueva con el dueño o se restaura.`,
    );
  }
  if (
    "valor" in entrada &&
    !(Number.isInteger(entrada["valor"]) && (entrada["valor"] as number) >= 1)
  ) {
    problemas.push(`${nombre}: «valor» tiene que ser un entero mayor que cero.`);
  }
  return problemas;
}

/** Los problemas del registro entero: forma, ids únicos y vencimientos. */
export function problemasDelRegistro(registro: unknown, hoy: string): string[] {
  if (!esObjeto(registro) || Object.keys(registro).some((c) => c !== "relajaciones")) {
    return ["el registro tiene que ser un objeto con solo «relajaciones»."];
  }
  const lista = registro["relajaciones"];
  if (!Array.isArray(lista) || lista.length === 0)
    return ["«relajaciones» tiene que ser una lista con al menos una."];
  const problemas = lista.flatMap((entrada, i) => problemasDeUna(entrada, i, hoy));
  const vistos = new Set<string>();
  for (const entrada of lista) {
    const id = esObjeto(entrada) ? entrada["id"] : undefined;
    if (typeof id !== "string") continue;
    if (vistos.has(id)) problemas.push(`«${id}»: el id está repetido.`);
    vistos.add(id);
  }
  return problemas;
}

/** `[1, 2, 3]` → 3; `null` si no es una lista de enteros consecutivos desde 1. */
function contarCopias(lista: string): number | null {
  const numeros = lista
    .slice(1, -1)
    .split(",")
    .map((n) => Number(n.trim()));
  return numeros.length > 0 && numeros.every((n, i) => n === i + 1) ? numeros.length : null;
}

/** Las copias de Estabilidad que declara el workflow: en un pull request y en los demás eventos. `null` si no se puede leer (falla cerrado). */
export function copiasDeEstabilidad(ci: string): { enPr: number; enElResto: number } | null {
  const coincide =
    /fromJSON\(github\.event_name == 'pull_request' && '(\[[0-9, ]+\])' \|\| '(\[[0-9, ]+\])'\)/.exec(
      ci,
    );
  if (coincide === null) return null;
  const enPr = contarCopias(coincide[1] ?? "");
  const enElResto = contarCopias(coincide[2] ?? "");
  return enPr === null || enElResto === null ? null : { enPr, enElResto };
}

/** Lo que el workflow recorta tiene que figurar en el registro, y lo que el registro dice tiene que ser lo que el workflow hace. */
export function problemasDelWorkflow(ci: string, registro: unknown): string[] {
  const copias = copiasDeEstabilidad(ci);
  if (copias === null) {
    return [
      "no se pudo leer cuántas copias de Estabilidad corren en un pull request y en el resto (el workflow cambió de forma).",
    ];
  }
  const lista =
    esObjeto(registro) && Array.isArray(registro["relajaciones"]) ? registro["relajaciones"] : [];
  const entrada = lista.find(
    (e): e is Record<string, unknown> => esObjeto(e) && e["id"] === ID_DE_LA_ESTABILIDAD,
  );
  if (copias.enPr < copias.enElResto) {
    if (entrada === undefined) {
      return [
        `el workflow corre ${copias.enPr} copias de Estabilidad en un pull request (y ${copias.enElResto} de noche) y no figura «${ID_DE_LA_ESTABILIDAD}» en el registro.`,
      ];
    }
    if (entrada["estado"] !== "VIGENTE") {
      return [
        `el workflow corre ${copias.enPr} copias de Estabilidad en un pull request y «${ID_DE_LA_ESTABILIDAD}» no está VIGENTE.`,
      ];
    }
    if (entrada["valor"] !== copias.enPr) {
      return [
        `el workflow corre ${copias.enPr} copias de Estabilidad en un pull request y el registro dice ${String(entrada["valor"])}: actualizá «valor» (y la decisión del dueño que lo respalda).`,
      ];
    }
    return [];
  }
  if (entrada !== undefined && entrada["estado"] !== "RESTAURADA") {
    return [
      `el workflow corre las mismas copias de Estabilidad en un pull request y de noche (${copias.enElResto}) y «${ID_DE_LA_ESTABILIDAD}» no está marcada RESTAURADA.`,
    ];
  }
  return [];
}

/** Los grupos de mutación que mutan rutas sensibles y no traen `critico: true`: `{ id, archivo }` del primero que lo muestra. */
export function gruposSensiblesSinMarca(
  grupos: readonly { id: string; critico?: true; expandidos: readonly string[] }[],
  rutas: readonly string[],
): { id: string; archivo: string }[] {
  const patrones = rutas.map((r) => new RegExp(r));
  const faltan: { id: string; archivo: string }[] = [];
  for (const grupo of grupos) {
    if (grupo.critico === true) continue;
    const archivo = grupo.expandidos
      .map((e) => e.replace(/:\d+-\d+$/, ""))
      .find((e) => patrones.some((p) => p.test(e)));
    if (archivo !== undefined) faltan.push({ id: grupo.id, archivo });
  }
  return faltan;
}

/** Las reglas de rutas sensibles bien formadas (lista no vacía de patrones que compilan y empiezan en `^`). */
export function problemasDeLasRutas(valor: unknown): string[] {
  if (!esObjeto(valor) || Object.keys(valor).some((c) => c !== "rutas")) {
    return ["las rutas sensibles tienen que ser un objeto con solo «rutas»."];
  }
  const rutas = valor["rutas"];
  if (!Array.isArray(rutas) || rutas.length === 0)
    return ["«rutas» tiene que ser una lista con al menos una regla."];
  const problemas: string[] = [];
  for (const ruta of rutas) {
    if (typeof ruta !== "string" || !ruta.startsWith("^")) {
      problemas.push(`la regla ${JSON.stringify(ruta)} tiene que ser un texto que empiece en «^».`);
      continue;
    }
    try {
      new RegExp(ruta);
    } catch {
      problemas.push(`la regla «${ruta}» no es una expresión válida.`);
    }
  }
  return problemas;
}
