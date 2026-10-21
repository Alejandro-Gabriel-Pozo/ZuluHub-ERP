/**
 * Vigilancia de la versión anterior (contratos-arquitectonicos.md §4, I8 e I9, y §5): lo que la rama
 * base exigía no puede dejar de exigirse en silencio.
 *
 * USO. Se ejecuta CON EL ARCHIVO DE LA BASE (`main`, extraída en una carpeta aparte) contra el árbol del
 * pull request:
 *
 *     node <base>/arquitectura/contratos/no-debilitar.cjs --arbol <árbol del PR>
 *
 * La base es la carpeta donde vive este script (sus `contratos.cjs`, `codigos.cjs`, `clasificacion.cjs`,
 * `ci.yml`, `package.json`…); el PR es lo que dice `--arbol`. Sale 0 si no hay debilitamientos, 1 si hay
 * (cada uno como `archivo:línea · contrato · motivo · corrección`, con la ubicación en el PR), 2 si el
 * uso es incorrecto. En la CI lo llama el job `guardian` (solo en pull requests); a mano también sirve
 * `node arquitectura/contratos/guardian.cjs --base <carpeta de la base>`.
 *
 * POR QUÉ MONOTONÍA Y NO IGUALDAD. Un guardián completo de la versión anterior fallaría ante un PR
 * legítimo que agrega un contrato, una clase o una regla (declaraciones a ids que el viejo no conoce).
 * Acá solo se comprueba que NADA DE LO QUE LA BASE EXIGÍA SE QUITÓ: se puede agregar, endurecer o subir
 * de versión; no se puede borrar, aflojar ni saltear sin una decisión registrada (`retiros.json`).
 *
 * LOS CHEQUEOS (cada uno es una función pura sobre estructuras ya leídas de la base y del PR):
 *  (a) un contrato del registro de la base ya no está en el del PR sin una entrada en `retiros.json`
 *      (`{ id, motivo, responsable, aprobadoPor, creada }`); y los retiros de la base siguen presentes
 *      (el registro es histórico: un retiro no se borra);
 *  (b) un contrato presente en ambos perdió detectores de un tipo o clases de ese tipo, o cambió su
 *      `fuenteDeVerdad` sin subir `version`; y un contrato que declara `sinDetectorDeDefinicion` (no tener
 *      detector de definición, ver `registro.cjs`) cuando la base no lo declaraba, sea nuevo o no;
 *  (c) un código de falla de la base ya no existe (se borró un chequeo);
 *  (d) las constantes de rigor empeoraron: subió el tope de días de las excepciones o bajó el aviso;
 *  (e) las clases esperadas con rutas se redujeron, las clases excluibles se ampliaron o crecieron las
 *      extensiones y rutas permitidas dentro de una clase excluida (`PERMITIDO_EN_CLASE_EXCLUIDA`);
 *  (f) en `ci.yml`: falta el job `guardian`, el job `gate` no lo espera en `needs`, `evaluar-gate.cjs` ya
 *      no lo trata como obligatorio, ya no ejecuta `guardian.cjs`, o tiene `continue-on-error`/`if` que
 *      la base no tenía;
 *  (g) `package.json`: el script `arquitectura` ya no encadena `npm run guardian` o el script
 *      `guardian` ya no apunta al guardián;
 *  (h) si la base trae `invariantes.cjs`: sus invariantes y mutaciones siguen en el PR (si la base no lo
 *      trae, se avisa y se saltea).
 * Además, un PR cuyo código no se puede leer (o ya no tiene un archivo vigilado) falla: nunca «pasa»
 * porque no se pudo mirar.
 *
 * SEGURIDAD. El código del PR (registro, códigos, clasificación, `evaluar-gate.cjs`) se carga en un
 * PROCESO HIJO (`--extraer`) que devuelve solo datos, así un módulo del PR no puede tocar el proceso del
 * verificador ni su código de salida. Las constantes y `ci.yml` se leen como texto: no se ejecutan.
 *
 * LÍMITES (qué NO ve): ver `limites` al final del archivo.
 *
 * Es puro salvo lecturas: `verificar` recibe las dos instantáneas y el reloj; el único efecto es leer
 * archivos (y lanzar el proceso hijo) en `capturar`. Solo usa Node y `ubicacion.cjs` (para `archivo:línea`).
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { crearUbicador, enArchivo, enContrato, enJson, enTexto } = require("./ubicacion.cjs");

const ARCHIVOS = Object.freeze({
  registro: "arquitectura/contratos/contratos.cjs",
  codigos: "arquitectura/contratos/codigos.cjs",
  clasificacion: "arquitectura/contratos/clasificacion.cjs",
  excepciones: "arquitectura/contratos/excepciones.cjs",
  retiros: "arquitectura/contratos/retiros.json",
  invariantes: "arquitectura/contratos/invariantes.cjs",
  evaluarGate: "arquitectura/evaluar-gate.cjs",
  ci: ".github/workflows/ci.yml",
  paquete: "package.json",
});

const CAMPOS_DE_RETIRO = Object.freeze(["id", "motivo", "responsable", "aprobadoPor", "creada"]);
const TIPOS_DE_DETECTOR = Object.freeze(["uso", "definicion"]);
const RESULTADOS_QUE_NO_SON_VERDE = Object.freeze(["failure", "skipped", "cancelled"]);
const JOB_DEL_GUARDIAN = "guardian";
const JOB_DEL_GATE = "gate";

/** Lista cerrada de códigos: código → qué comprueba. Una falla con otro código no existe. */
const DESCRIPCION_DE_CODIGOS = Object.freeze({
  "retiro-sin-registro":
    "(a) un contrato de la base ya no está en el registro y no hay un retiro registrado",
  "retiro-invalido": "(a) una entrada de retiros.json no trae todos sus campos, o está mal formada",
  "retiro-borrado": "(a) un retiro que registraba la base ya no está (el registro es histórico)",
  "detectores-perdidos": "(b) un contrato tiene menos detectores de un tipo que en la base",
  "clases-de-detector-perdidas": "(b) los detectores de un contrato cubren menos clases que antes",
  "fuente-cambiada-sin-version": "(b) un contrato cambió su fuente de verdad sin subir la versión",
  "sin-definicion-nueva":
    "(b) un contrato declara sinDetectorDeDefinicion y la base no lo declaraba (un contrato sin detector de definición es un debilitamiento)",
  "chequeo-borrado": "(c) un código de falla de la base ya no existe",
  "tope-de-excepciones-subio": "(d) el plazo máximo de las excepciones es mayor que el de la base",
  "aviso-de-excepciones-bajo":
    "(d) el aviso previo al vencimiento es menor (más tarde) que el de la base",
  "clases-esperadas-reducidas": "(e) una clase esperada con rutas dejó de esperarse",
  "clases-excluibles-ampliadas": "(e) se puede excluir del análisis una clase que antes no",
  "extensiones-permitidas-ampliadas":
    "(e) una clase excluida del análisis admite extensiones o rutas que la base no admitía",
  "ci-sin-job-guardian": "(f) ci.yml no tiene el job guardian",
  "ci-gate-no-espera-guardian": "(f) el job gate no espera al guardián en needs",
  "gate-no-exige-guardian": "(f) evaluar-gate.cjs no marca en rojo un guardián caído o saltado",
  "ci-guardian-sin-ejecutar": "(f) el job guardian ya no ejecuta guardian.cjs",
  "ci-guardian-con-salto":
    "(f) el job guardian tiene continue-on-error o un if que la base no tenía",
  "script-arquitectura-desviado": "(g) el script arquitectura ya no encadena npm run guardian",
  "script-guardian-desviado": "(g) el script guardian ya no ejecuta el guardián",
  "invariante-borrada": "(h) un invariante de la base ya no está en la matriz",
  "mutacion-borrada": "(h) una mutación de la base ya no está en la matriz",
  "arbol-ilegible": "el árbol del PR no se pudo leer o ya no tiene un archivo vigilado",
  "base-ilegible": "la base no se pudo leer: no hay con qué comparar",
});

/** Avisos (no bloquean). */
const CODIGOS_DE_AVISO = Object.freeze(["invariantes-sin-base"]);

const orden = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const esObjeto = (valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor);
const esTexto = (valor) => typeof valor === "string" && valor.trim() !== "";
const listaOVacia = (valor) => (Array.isArray(valor) ? valor : []);
const faltantes = (deBase, delPr) => deBase.filter((elemento) => !delPr.includes(elemento));
const tiene = (seccion) => seccion !== undefined && seccion.valor !== undefined;

const hallazgo = (codigo, archivo, motivo, correccion, extra = {}) => ({
  codigo,
  archivo,
  contrato: extra.contrato ?? null,
  motivo,
  correccion,
  ...(extra.donde === undefined ? {} : { donde: extra.donde }),
  ...(extra.linea === undefined ? {} : { linea: extra.linea }),
});

/** `a.b.c` es estrictamente mayor que `x.y.z` (numérico, por tramos). Una versión mal formada no es mayor. */
function versionMayor(nueva, vieja) {
  const partes = (version) =>
    /^\d+\.\d+\.\d+$/.test(String(version)) ? String(version).split(".").map(Number) : null;
  const n = partes(nueva);
  const v = partes(vieja);
  if (n === null || v === null) return false;
  for (let i = 0; i < 3; i += 1) {
    if (n[i] !== v[i]) return n[i] > v[i];
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Lectura de texto: ci.yml, retiros.json, package.json, constantes de rigor.
// ---------------------------------------------------------------------------------------------

const sinComentario = (valor) => valor.replace(/\s+#.*$/, "").trim();
const sinComillas = (valor) => (/^(["'])[^"']*\1$/.test(valor) ? valor.slice(1, -1) : valor);
const escalar = (valor) => sinComillas(sinComentario(valor));

const COMANDO_DEL_GUARDIAN = ["node", "arquitectura/contratos/guardian.cjs"];
/** Una opción suelta (`--base`, `-v`, `--base=x`): un solo cuantificador y sin repetición externa. */
const OPCION_DEL_GUARDIAN = /^--?[\w=./-]+$/;

/**
 * ¿Estos tokens son `node arquitectura/contratos/guardian.cjs` seguido solo de opciones? Análisis LINEAL:
 * compara el comando token por token y valida cada opción con una regex simple. No usa una regex con un
 * grupo repetido (`(?:\s+--?[\w=./-]+)*`) porque `-` está en la clase y el grupo queda ambiguo: con el texto
 * de `ci.yml` que escribe quien abre el PR, eso podía hacer backtracking exponencial (CodeQL js/redos).
 */
function esComandoDelGuardian(tokens) {
  if (tokens.length < COMANDO_DEL_GUARDIAN.length) return false;
  for (let i = 0; i < COMANDO_DEL_GUARDIAN.length; i += 1) {
    if (tokens[i] !== COMANDO_DEL_GUARDIAN[i]) return false;
  }
  for (let i = COMANDO_DEL_GUARDIAN.length; i < tokens.length; i += 1) {
    if (!OPCION_DEL_GUARDIAN.test(tokens[i])) return false;
  }
  return true;
}

/** La línea de un paso que corre el guardián tal cual: sin `|| true` ni otro operador (opciones sí). */
function ejecutaElGuardian(linea) {
  let resto = linea.trim();
  if (/^-\s/.test(resto)) resto = resto.slice(1).trimStart();
  if (resto.startsWith("run:")) resto = resto.slice("run:".length).trimStart();
  return esComandoDelGuardian(resto.split(/\s+/));
}

/**
 * Lee los jobs de un `ci.yml` con la línea de cada cosa que interesa. Es un análisis de TEXTO que entiende
 * el estilo que Prettier impone (jobs a 2 espacios, propiedades de job a 4, `needs` en lista de flujo o de
 * bloque); lo que no entiende lo rechaza con `{ error }`, no lo ignora.
 *
 * @returns {{ valor: Map<string, object>, lineaDeJobs: number } | { error: string }}
 */
function leerCi(texto) {
  const lineas = texto.replaceAll("\r", "").split("\n");
  const inicio = lineas.findIndex((linea) => /^jobs:\s*$/.test(linea));
  if (inicio < 0) return { error: "no hay una sección `jobs:`" };
  const bloques = new Map();
  let actual = null;
  for (let i = inicio + 1; i < lineas.length; i += 1) {
    const linea = lineas[i];
    if (linea.trimStart().startsWith("#")) continue;
    if (linea.trim() === "") {
      actual?.cuerpo.push({ n: i + 1, t: linea });
      continue;
    }
    if (/^\S/.test(linea)) break;
    const cabecera = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(linea);
    if (cabecera !== null) {
      if (bloques.has(cabecera[1])) return { error: `el job «${cabecera[1]}» está duplicado` };
      actual = { id: cabecera[1], linea: i + 1, cuerpo: [] };
      bloques.set(cabecera[1], actual);
    } else if (/^ {1,3}\S/.test(linea)) {
      return { error: `línea inesperada en el nivel de los jobs: «${linea.trim()}»` };
    } else if (actual === null) {
      return { error: `contenido antes del primer job: «${linea.trim()}»` };
    } else {
      actual.cuerpo.push({ n: i + 1, t: linea });
    }
  }
  if (bloques.size === 0) return { error: "la sección `jobs:` no tiene ningún job" };
  const jobs = new Map();
  for (const bloque of bloques.values()) {
    const job = leerJob(bloque);
    if (job.error !== undefined) return { error: job.error };
    jobs.set(bloque.id, job);
  }
  return { valor: jobs, lineaDeJobs: inicio + 1 };
}

function leerJob({ id, linea, cuerpo }) {
  const sinComentarios = cuerpo.filter((l) => !l.t.trimStart().startsWith("#"));
  const propiedad = (nombre) => {
    for (const l of sinComentarios) {
      const encontrada = new RegExp(`^ {4}${nombre}:[ \\t]*(.*)$`).exec(l.t);
      if (encontrada !== null) return { valor: escalar(encontrada[1]), linea: l.n };
    }
    return undefined;
  };
  const needs = leerNeeds(sinComentarios);
  if (needs.error !== undefined) return { error: `job «${id}»: ${needs.error}` };
  const si = propiedad("if");
  return {
    id,
    linea,
    needs: needs.lista,
    lineaNeeds: needs.linea,
    si: si?.valor,
    lineaSi: si?.linea,
    // Cualquier mención, en el job, en un paso o en la estrategia: todas dejan pasar un fallo.
    continuaConError: sinComentarios
      .filter((l) => l.t.includes("continue-on-error"))
      .map((l) => l.n),
    pasos: leerPasos(sinComentarios),
  };
}

/** Los pasos de `steps:` de un job: su rango de líneas, su `if` y si ejecutan el guardián. */
function leerPasos(cuerpo) {
  const pasos = [];
  let enSteps = false;
  let paso = null;
  for (const l of cuerpo) {
    if (l.t.trim() === "") continue;
    if (/^ {4}\S/.test(l.t)) {
      enSteps = /^ {4}steps:\s*$/.test(l.t);
      paso = null;
      continue;
    }
    if (!enSteps) continue;
    if (/^ {6}-(?:\s|$)/.test(l.t)) {
      paso = { desde: l.n, hasta: l.n, ejecutaGuardian: false, si: undefined };
      pasos.push(paso);
    }
    if (paso === null) continue;
    paso.hasta = l.n;
    if (ejecutaElGuardian(l.t)) paso.ejecutaGuardian = true;
    const si = /^ {6}-\s+if:\s*(.*)$|^ {8}if:\s*(.*)$/.exec(l.t);
    if (si !== null && paso.si === undefined) {
      paso.si = { valor: escalar(si[1] ?? si[2] ?? ""), linea: l.n };
    }
  }
  return pasos;
}

function leerNeeds(cuerpo) {
  const donde = cuerpo.findIndex((l) => /^ {4}needs:/.test(l.t));
  if (donde < 0) return { lista: [], linea: undefined };
  const linea = cuerpo[donde].n;
  let desde = donde;
  let valor = sinComentario(cuerpo[donde].t.replace(/^ {4}needs:/, ""));
  if (valor === "" && sinComentario(cuerpo[donde + 1]?.t ?? "").startsWith("[")) {
    desde = donde + 1;
    valor = sinComentario(cuerpo[desde].t);
  }
  if (valor.startsWith("[")) {
    let texto = valor;
    for (let i = desde + 1; !texto.includes("]") && i < cuerpo.length; i += 1) {
      texto += ` ${sinComentario(cuerpo[i].t)}`;
    }
    if (!texto.includes("]")) return { error: "la lista `needs` no cierra" };
    return {
      linea,
      lista: texto
        .slice(1, texto.indexOf("]"))
        .split(",")
        .map((n) => sinComillas(n.trim()))
        .filter((n) => n !== ""),
    };
  }
  if (valor !== "") return { lista: [sinComillas(valor)], linea };
  const lista = [];
  for (const l of cuerpo.slice(donde + 1)) {
    const item = /^ {5,}-\s+(.+)$/.exec(l.t)?.[1];
    if (item === undefined) break;
    lista.push(escalar(item));
  }
  return { lista, linea };
}

/** `retiros.json`: sin archivo es una lista vacía; JSON inválido o que no es una lista es un error. */
function leerRetiros(texto) {
  if (texto === null) return { valor: [] };
  try {
    const dato = JSON.parse(texto);
    return Array.isArray(dato) ? { valor: dato } : { error: "no es una lista" };
  } catch (error) {
    return { error: `no es JSON válido (${String(error?.message ?? error)})` };
  }
}

/** Lee `const NOMBRE = <entero>;` de un módulo como texto (no se ejecuta): valor y línea. */
function leerConstante(texto, nombre) {
  if (texto === null) return { ausente: true };
  const lineas = texto.split(/\r\n|\n/);
  const patron = new RegExp(`^const ${nombre} = (\\d+);\\s*(?://.*)?$`);
  for (let i = 0; i < lineas.length; i += 1) {
    const encontrada = patron.exec(lineas[i]);
    if (encontrada !== null) return { valor: Number(encontrada[1]), linea: i + 1 };
  }
  return { error: `no hay una línea «const ${nombre} = <entero>;»` };
}

/** `package.json`: solo los dos scripts que se vigilan. */
function leerPaquete(texto) {
  if (texto === null) return { ausente: true };
  try {
    const dato = JSON.parse(texto);
    const scripts = esObjeto(dato) && esObjeto(dato.scripts) ? dato.scripts : {};
    return { valor: { arquitectura: scripts.arquitectura, guardian: scripts.guardian } };
  } catch (error) {
    return { error: `no es JSON válido (${String(error?.message ?? error)})` };
  }
}

// ---------------------------------------------------------------------------------------------
// Carga del código del árbol en un proceso hijo (devuelve solo datos).
// ---------------------------------------------------------------------------------------------

/**
 * La lista de invariantes y mutaciones de la matriz (`invariantes.cjs`), tolerante a la forma de la
 * exportación: una lista, o un objeto con `INVARIANTES`/`invariantes`, o su primera propiedad que sea lista.
 * Una mutación se identifica por su `id`; si no lo trae, por `tipo` y su orden dentro del invariante.
 */
function extraerInvariantes(modulo) {
  const lista = Array.isArray(modulo)
    ? modulo
    : [modulo?.INVARIANTES, modulo?.invariantes, ...Object.values(modulo ?? {})].find(
        Array.isArray,
      );
  if (lista === undefined)
    throw new Error("no encuentro la lista de invariantes en la exportación");
  const ids = [];
  const mutaciones = [];
  for (const invariante of lista) {
    if (!esTexto(invariante?.id)) continue;
    ids.push(invariante.id);
    const vistos = new Map();
    for (const mutacion of listaOVacia(invariante.mutaciones)) {
      const tipo = String(mutacion?.tipo ?? "?");
      const orden = vistos.get(tipo) ?? 0;
      vistos.set(tipo, orden + 1);
      const id = esTexto(mutacion?.id) ? mutacion.id : `${tipo}#${orden + 1}`;
      mutaciones.push({ invariante: invariante.id, id });
    }
  }
  return { ids, mutaciones };
}

/**
 * Lo permitido en cada clase excluida como una lista plana de textos por clase (`extension:.md`,
 * `ruta:package-lock.json`). `null` si el módulo no define la constante (una base anterior a este
 * chequeo); una constante mal formada lanza, y la sección queda ilegible.
 */
function permitidasEnClasesExcluidas(valor) {
  if (valor === undefined) return null;
  if (!esObjeto(valor)) throw new Error("«PERMITIDO_EN_CLASE_EXCLUIDA» no es un objeto");
  return Object.fromEntries(
    Object.entries(valor).map(([clase, permitido]) => {
      if (!esObjeto(permitido)) throw new Error(`lo permitido en «${clase}» no es un objeto`);
      return [
        clase,
        [
          ...listaOVacia(permitido.extensiones).map((e) => `extension:${String(e)}`),
          ...listaOVacia(permitido.rutas).map((r) => `ruta:${String(r)}`),
        ],
      ];
    }),
  );
}

const resumirDetector = (detector) => ({
  tipo: esObjeto(detector) ? detector.tipo : undefined,
  clases: esObjeto(detector) ? listaOVacia(detector.clases).map(String) : [],
});

const resumirContrato = (contrato) => {
  const c = esObjeto(contrato) ? contrato : {};
  const fuente = esObjeto(c.fuenteDeVerdad) ? c.fuenteDeVerdad : {};
  return {
    id: esTexto(c.id) ? c.id : null,
    version: typeof c.version === "string" ? c.version : null,
    fuente: { archivo: fuente.archivo, exportacion: fuente.exportacion, variable: fuente.variable },
    detectores: listaOVacia(c.deteccion).map(resumirDetector),
    // El motivo de «no puede haber un detector de definición» (texto) o `null` si no lo declara.
    sinDefinicion:
      c.sinDetectorDeDefinicion === undefined ? null : String(c.sinDetectorDeDefinicion),
  };
};

/**
 * Se ejecuta en el proceso hijo: carga el código de `raiz` y devuelve, por sección, `{ valor }`,
 * `{ ausente: true }` o `{ error }`. `idsDeJobs` son los jobs de su `ci.yml`: sirven para armar el `needs`
 * con que se prueba `evaluarGate` (todo en verde salvo el guardián caído).
 */
function extraer(raiz, idsDeJobs) {
  const cargar = (archivo, leer) => {
    const ruta = path.join(raiz, archivo);
    if (!fs.existsSync(ruta)) return { ausente: true };
    try {
      return { valor: leer(require(ruta)) };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
  };
  const lista = (valor, nombre) => {
    if (!Array.isArray(valor)) throw new Error(`«${nombre}» no es una lista`);
    return valor.map(String);
  };
  return {
    registro: cargar(ARCHIVOS.registro, (modulo) => {
      if (!Array.isArray(modulo)) throw new Error("el registro no es una lista de contratos");
      return modulo.map(resumirContrato);
    }),
    codigos: cargar(ARCHIVOS.codigos, (m) => lista(m.CODIGOS_DE_FALLA, "CODIGOS_DE_FALLA")),
    clases: cargar(ARCHIVOS.clasificacion, (m) => ({
      esperadas: lista(m.CLASES_ESPERADAS, "CLASES_ESPERADAS"),
      excluibles: lista(m.CLASES_EXCLUIBLES, "CLASES_EXCLUIBLES"),
      permitidas: permitidasEnClasesExcluidas(m.PERMITIDO_EN_CLASE_EXCLUIDA),
    })),
    invariantes: cargar(ARCHIVOS.invariantes, extraerInvariantes),
    gate: cargar(ARCHIVOS.evaluarGate, (m) => {
      if (typeof m.evaluarGate !== "function") throw new Error("no exporta «evaluarGate»");
      const verde = Object.fromEntries(
        idsDeJobs
          .filter((id) => id !== JOB_DEL_GATE)
          .map((id) => [
            id,
            { result: "success", outputs: id === "mutacion-plan" ? { hay: "true" } : {} },
          ]),
      );
      const llamar = (needs) => lista(m.evaluarGate(needs), "el resultado de evaluarGate");
      return {
        conGuardianCaido: Object.fromEntries(
          RESULTADOS_QUE_NO_SON_VERDE.map((resultado) => [
            resultado,
            llamar({ ...verde, [JOB_DEL_GUARDIAN]: { result: resultado } }),
          ]),
        ),
      };
    }),
  };
}

const MARCA_DEL_RESULTADO = "@@NO-DEBILITAR@@";
const SECCIONES_DEL_HIJO = Object.freeze(["registro", "codigos", "clases", "invariantes", "gate"]);

/** Lanza `--extraer` (este mismo script) como proceso hijo sobre `raiz` y devuelve sus secciones. */
function extraerEnProceso(raiz, idsDeJobs) {
  try {
    const salida = execFileSync(
      process.execPath,
      [path.join(__dirname, "no-debilitar.cjs"), "--extraer", raiz, JSON.stringify(idsDeJobs)],
      {
        cwd: raiz,
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    // El código del PR puede imprimir lo que quiera al cargarse: solo vale la línea marcada.
    const linea = salida.split("\n").findLast((l) => l.startsWith(MARCA_DEL_RESULTADO));
    if (linea === undefined) throw new Error("el proceso no devolvió resultado");
    const datos = JSON.parse(linea.slice(MARCA_DEL_RESULTADO.length));
    return Object.fromEntries(SECCIONES_DEL_HIJO.map((nombre) => [nombre, datos[nombre]]));
  } catch (error) {
    const detalle = String(error?.stderr || error?.message || error)
      .trim()
      .split("\n")[0];
    return Object.fromEntries(
      SECCIONES_DEL_HIJO.map((nombre) => [
        nombre,
        { error: `no se pudo cargar el código: ${detalle}` },
      ]),
    );
  }
}

/**
 * Lee un árbol (la base o el PR) y arma su instantánea. Es lo único que toca el disco.
 * @param {string} raiz
 */
function capturar(raiz) {
  const leerTexto = (relativa) => {
    try {
      return fs.readFileSync(path.join(raiz, relativa), "utf8");
    } catch {
      return null;
    }
  };
  const textoDeCi = leerTexto(ARCHIVOS.ci);
  const ci = textoDeCi === null ? { ausente: true } : leerCi(textoDeCi);
  const textoDeExcepciones = leerTexto(ARCHIVOS.excepciones);
  return {
    ...extraerEnProceso(raiz, ci.valor === undefined ? [] : [...ci.valor.keys()]),
    retiros: leerRetiros(leerTexto(ARCHIVOS.retiros)),
    plazo: leerConstante(textoDeExcepciones, "PLAZO_MAXIMO_DIAS"),
    aviso: leerConstante(textoDeExcepciones, "DIAS_DE_AVISO"),
    ci,
    paquete: leerPaquete(leerTexto(ARCHIVOS.paquete)),
  };
}

// ---------------------------------------------------------------------------------------------
// Chequeos: funciones puras (base, pr, contexto) → hallazgos. `donde` lo resuelve el ubicador sobre el PR.
// ---------------------------------------------------------------------------------------------

/**
 * Qué archivo corresponde a cada sección de la instantánea, dónde ubicar un problema de lectura (`texto`:
 * la primera línea que lo contiene; sin él, la línea 1) y si la base la necesita para comparar.
 */
const SECCIONES = Object.freeze([
  { nombre: "registro", archivo: ARCHIVOS.registro, enBase: true },
  { nombre: "codigos", archivo: ARCHIVOS.codigos, enBase: true },
  { nombre: "clases", archivo: ARCHIVOS.clasificacion, enBase: true },
  { nombre: "retiros", archivo: ARCHIVOS.retiros, enBase: true },
  { nombre: "plazo", archivo: ARCHIVOS.excepciones, enBase: true, texto: "PLAZO_MAXIMO_DIAS" },
  { nombre: "aviso", archivo: ARCHIVOS.excepciones, enBase: true, texto: "DIAS_DE_AVISO" },
  { nombre: "gate", archivo: ARCHIVOS.evaluarGate, enBase: false },
  { nombre: "ci", archivo: ARCHIVOS.ci, enBase: false },
  { nombre: "paquete", archivo: ARCHIVOS.paquete, enBase: false },
  // La matriz de invariantes puede no existir (todavía): "ausente" no es ilegible, lo decide el chequeo (h).
  { nombre: "invariantes", archivo: ARCHIVOS.invariantes, enBase: true, puedeFaltar: true },
]);

const motivoDeSeccion = (seccion) =>
  seccion.ausente === true ? "el archivo no existe" : String(seccion.error);

/**
 * Lo que no se pudo leer es una falla, no un «pasa»: del PR (`arbol-ilegible`) y de la base
 * (`base-ilegible`, solo de lo que hace falta para comparar). Las secciones ilegibles se saltean en los
 * demás chequeos, así cada problema se reporta una vez.
 */
function chequearLectura(base, pr) {
  const hallazgos = [];
  for (const { nombre, archivo, enBase, texto, puedeFaltar } of SECCIONES) {
    const donde = texto === undefined ? enArchivo() : enTexto(texto);
    const delPr = pr[nombre] ?? { error: "no se leyó" };
    if (!tiene(delPr) && !(puedeFaltar === true && delPr.ausente === true)) {
      hallazgos.push(
        hallazgo(
          "arbol-ilegible",
          archivo,
          `No se pudo leer «${nombre}» del árbol del PR: ${motivoDeSeccion(delPr)}. Sin eso no se puede comprobar que no se debilitó nada.`,
          "Dejá el archivo legible y con la forma de siempre, o corregí el error que muestra el motivo.",
          { donde },
        ),
      );
    }
    const deLaBase = base[nombre] ?? { error: "no se leyó" };
    if (enBase && !tiene(deLaBase) && !(puedeFaltar === true && deLaBase.ausente === true)) {
      hallazgos.push(
        hallazgo(
          "base-ilegible",
          archivo,
          `No se pudo leer «${nombre}» de la base: ${motivoDeSeccion(deLaBase)}. No hay con qué comparar el PR.`,
          "Corregí la base (rama principal) o ejecutá este verificador desde una base sana.",
          { donde },
        ),
      );
    }
  }
  return hallazgos;
}

/** (a) Contratos retirados, retiros válidos y retiros permanentes. */
function chequearRetiros(base, pr, { ahora }) {
  if (!tiene(base.registro) || !tiene(pr.registro) || !tiene(pr.retiros) || !tiene(base.retiros)) {
    return [];
  }
  const hoy = ahora.toISOString().slice(0, 10);
  const hallazgos = [];
  const enElPr = new Set(pr.registro.valor.map((c) => c.id));
  const retirosDelPr = pr.retiros.valor;
  const idsDeRetiros = new Set(retirosDelPr.map((r) => (esObjeto(r) ? r.id : undefined)));

  const idsVistos = new Set();
  retirosDelPr.forEach((retiro, indice) => {
    const problema = (campo, motivo) =>
      hallazgos.push(
        hallazgo(
          "retiro-invalido",
          ARCHIVOS.retiros,
          `La entrada ${indice + 1} de retiros.json ${motivo}.`,
          "Cada retiro lleva exactamente: id, motivo, responsable, aprobadoPor y creada (AAAA-MM-DD, no futura).",
          { donde: enJson(...(campo === undefined ? [indice] : [indice, campo])) },
        ),
      );
    if (!esObjeto(retiro)) return problema(undefined, "no es un objeto");
    for (const clave of Object.keys(retiro)) {
      if (!CAMPOS_DE_RETIRO.includes(clave)) {
        problema(clave, `trae «${clave}», que no es un campo permitido`);
      }
    }
    for (const campo of CAMPOS_DE_RETIRO) {
      if (!esTexto(retiro[campo])) problema(campo, `no tiene «${campo}» (falta o está vacío)`);
    }
    if (esTexto(retiro.creada)) {
      if (!esFechaValida(retiro.creada)) {
        problema(
          "creada",
          `tiene «creada» («${retiro.creada}») que no es una fecha AAAA-MM-DD real`,
        );
      } else if (retiro.creada > hoy) {
        problema("creada", `tiene «creada» (${retiro.creada}) posterior a hoy (${hoy})`);
      }
    }
    if (esTexto(retiro.id)) {
      if (idsVistos.has(retiro.id)) problema("id", `repite el id «${retiro.id}»`);
      idsVistos.add(retiro.id);
    }
  });

  for (const contrato of base.registro.valor) {
    if (contrato.id === null || enElPr.has(contrato.id)) continue;
    if (!idsDeRetiros.has(contrato.id)) {
      hallazgos.push(
        hallazgo(
          "retiro-sin-registro",
          ARCHIVOS.registro,
          `El contrato «${contrato.id}» estaba en el registro de la base y ya no está, y no hay un retiro registrado: sería quitar un contrato en silencio.`,
          "Si el retiro es una decisión, agregá a retiros.json { id, motivo, responsable, aprobadoPor, creada }; si no, devolvé el contrato.",
          { contrato: contrato.id, donde: enTexto("module.exports") },
        ),
      );
    }
  }
  for (const retiro of base.retiros.valor) {
    const id = esObjeto(retiro) ? retiro.id : undefined;
    if (esTexto(id) && !idsDeRetiros.has(id)) {
      hallazgos.push(
        hallazgo(
          "retiro-borrado",
          ARCHIVOS.retiros,
          `El retiro de «${id}», que registraba la base, ya no está: retiros.json es un registro histórico y una entrada no se borra.`,
          "Devolvé la entrada a retiros.json.",
          { contrato: id, donde: enArchivo() },
        ),
      );
    }
  }
  return hallazgos;
}

/** El contrato declara `sinDetectorDeDefinicion` (el resumen trae el motivo como texto o `null`). */
const declaraSinDefinicion = (contrato) => typeof contrato.sinDefinicion === "string";

/** (b) Contratos presentes en ambos: detectores, clases y fuente de verdad. */
function chequearContratos(base, pr) {
  if (!tiene(base.registro) || !tiene(pr.registro)) return [];
  const hallazgos = [];
  const delPr = new Map(pr.registro.valor.filter((c) => c.id !== null).map((c) => [c.id, c]));
  const deLaBase = new Map(base.registro.valor.filter((c) => c.id !== null).map((c) => [c.id, c]));
  // Un contrato que declara no poder tener detector de definición, y la base no lo declaraba (sea nuevo o
  // existente): copiar su valor en otro archivo no fallaría. Es un debilitamiento, no un cambio de rutina.
  for (const nuevo of delPr.values()) {
    const antes = deLaBase.get(nuevo.id);
    if (!declaraSinDefinicion(nuevo) || (antes !== undefined && declaraSinDefinicion(antes))) {
      continue;
    }
    hallazgos.push(
      hallazgo(
        "sin-definicion-nueva",
        ARCHIVOS.registro,
        `El contrato «${nuevo.id}» declara «sinDetectorDeDefinicion» y la base no lo declaraba: un valor copiado en otro archivo no se detectaría para ese contrato.`,
        "Agregá un detector de tipo «definicion». Que un contrato no pueda tenerlo es una decisión del dueño que se habilita a propósito, no un cambio de rutina.",
        { contrato: nuevo.id, donde: enContrato(nuevo.id) },
      ),
    );
  }
  for (const viejo of base.registro.valor) {
    const nuevo = delPr.get(viejo.id);
    if (viejo.id === null || nuevo === undefined) continue;
    const donde = enContrato(viejo.id);
    for (const tipo of TIPOS_DE_DETECTOR) {
      const antes = viejo.detectores.filter((d) => d.tipo === tipo);
      const ahora = nuevo.detectores.filter((d) => d.tipo === tipo);
      if (ahora.length < antes.length) {
        hallazgos.push(
          hallazgo(
            "detectores-perdidos",
            ARCHIVOS.registro,
            `El contrato «${viejo.id}» tenía ${antes.length} detectores de tipo «${tipo}» y ahora tiene ${ahora.length}: reconocería menos usos que antes.`,
            "Devolvé el detector, o retirá el contrato con un retiro registrado.",
            { contrato: viejo.id, donde },
          ),
        );
      }
      const clasesAntes = new Set(antes.flatMap((d) => d.clases));
      const clasesAhora = new Set(ahora.flatMap((d) => d.clases));
      const perdidas = [...clasesAntes].filter((clase) => !clasesAhora.has(clase)).sort();
      if (perdidas.length > 0) {
        hallazgos.push(
          hallazgo(
            "clases-de-detector-perdidas",
            ARCHIVOS.registro,
            `Los detectores de tipo «${tipo}» del contrato «${viejo.id}» dejaron de mirar las clases: ${perdidas.join(", ")}. Un uso ahí ya no se vería.`,
            "Devolvé las clases al detector (se puede agregar clases, no quitarlas).",
            { contrato: viejo.id, donde },
          ),
        );
      }
    }
    const igual = (campo) => viejo.fuente[campo] === nuevo.fuente[campo];
    const fuenteIgual = igual("archivo") && igual("exportacion") && igual("variable");
    if (!fuenteIgual && !versionMayor(nuevo.version, viejo.version)) {
      hallazgos.push(
        hallazgo(
          "fuente-cambiada-sin-version",
          ARCHIVOS.registro,
          `El contrato «${viejo.id}» cambió su fuente de verdad pero su versión sigue en ${nuevo.version ?? "(ninguna)"} (la base: ${viejo.version ?? "(ninguna)"}): un cambio de fuente es un cambio de contrato.`,
          "Subí la versión del contrato en el mismo cambio (y actualizá sus consumidores y pruebas, §6).",
          { contrato: viejo.id, donde },
        ),
      );
    }
  }
  return hallazgos;
}

/** (c) Los códigos de falla de la base siguen existiendo. */
function chequearCodigos(base, pr) {
  if (!tiene(base.codigos) || !tiene(pr.codigos)) return [];
  return faltantes(base.codigos.valor, pr.codigos.valor).map((codigo) =>
    hallazgo(
      "chequeo-borrado",
      ARCHIVOS.codigos,
      `El código de falla «${codigo}» existía en la base y ya no: se borró un chequeo del guardián.`,
      "Devolvé el chequeo y su código; un chequeo se puede agregar, no quitar.",
      { donde: enTexto("const CODIGOS_DE_FALLA") },
    ),
  );
}

/** (d) Las constantes de rigor de las excepciones no empeoran. */
function chequearRigor(base, pr) {
  const hallazgos = [];
  const reglas = [
    {
      clave: "plazo",
      nombre: "PLAZO_MAXIMO_DIAS",
      empeora: (antes, ahora) => ahora > antes,
      falla: "tope-de-excepciones-subio",
      que: (antes, ahora) =>
        `El tope de las excepciones subió de ${antes} a ${ahora} días: las excepciones durarían más que lo que decidió el dueño.`,
      correccion: "Dejá el tope como estaba (puede bajar, no subir).",
    },
    {
      clave: "aviso",
      nombre: "DIAS_DE_AVISO",
      empeora: (antes, ahora) => ahora < antes,
      falla: "aviso-de-excepciones-bajo",
      que: (antes, ahora) =>
        `El aviso previo al vencimiento bajó de ${antes} a ${ahora} días: avisaría más tarde.`,
      correccion: "Dejá el aviso como estaba (puede subir, no bajar).",
    },
  ];
  for (const regla of reglas) {
    const delPr = pr[regla.clave];
    if (!tiene(base[regla.clave]) || !tiene(delPr)) continue;
    if (regla.empeora(base[regla.clave].valor, delPr.valor)) {
      hallazgos.push(
        hallazgo(
          regla.falla,
          ARCHIVOS.excepciones,
          regla.que(base[regla.clave].valor, delPr.valor),
          regla.correccion,
          { linea: delPr.linea },
        ),
      );
    }
  }
  return hallazgos;
}

/** (e) Las clases esperadas no se reducen y las excluibles no se amplían. */
function chequearClases(base, pr) {
  if (!tiene(base.clases) || !tiene(pr.clases)) return [];
  const hallazgos = [];
  const quitadas = faltantes(base.clases.valor.esperadas, pr.clases.valor.esperadas);
  if (quitadas.length > 0) {
    hallazgos.push(
      hallazgo(
        "clases-esperadas-reducidas",
        ARCHIVOS.clasificacion,
        `Dejaron de esperarse las clases: ${quitadas.join(", ")}. Si quedaran sin rutas, el guardián diría «pasó» sin haber mirado nada de ellas.`,
        "Devolvé las clases a CLASES_ESPERADAS (se pueden agregar clases, no quitarlas).",
        { donde: enTexto("const CLASES_ESPERADAS") },
      ),
    );
  }
  const nuevas = faltantes(pr.clases.valor.excluibles, base.clases.valor.excluibles);
  if (nuevas.length > 0) {
    hallazgos.push(
      hallazgo(
        "clases-excluibles-ampliadas",
        ARCHIVOS.clasificacion,
        `Ahora se pueden excluir del análisis las clases: ${nuevas.join(", ")}. Era una decisión cerrada a «${base.clases.valor.excluibles.join(", ")}».`,
        "Devolvé CLASES_EXCLUIBLES a lo que era; ampliarlo es una decisión del dueño que se registra aparte.",
        { donde: enTexto("const CLASES_EXCLUIBLES") },
      ),
    );
  }
  hallazgos.push(...chequearPermitidas(base.clases.valor.permitidas ?? null, pr.clases.valor));
  return hallazgos;
}

/**
 * (e) Lo permitido dentro de una clase excluida no crece: una extensión o ruta nueva en `docs` o `generado`
 * dejaría esconder más archivos del análisis. Si la base todavía no tiene la lista (`null`) no hay con qué
 * comparar; si la tenía y el PR la borró, el PR ya no tiene lo vigilado.
 */
function chequearPermitidas(deLaBase, clasesDelPr) {
  const donde = enTexto("const PERMITIDO_EN_CLASE_EXCLUIDA");
  if (deLaBase === null) return [];
  const delPr = clasesDelPr.permitidas ?? null;
  if (delPr === null) {
    return [
      hallazgo(
        "arbol-ilegible",
        ARCHIVOS.clasificacion,
        "La clasificación del PR ya no define PERMITIDO_EN_CLASE_EXCLUIDA, que la base usaba para limitar qué puede haber en las clases excluidas del análisis.",
        "Devolvé la constante PERMITIDO_EN_CLASE_EXCLUIDA con lo que la base permitía.",
        { donde: enArchivo() },
      ),
    ];
  }
  const nuevas = Object.entries(delPr).flatMap(([clase, entradas]) =>
    faltantes(entradas, deLaBase[clase] ?? []).map((entrada) => `${clase} → ${entrada}`),
  );
  if (nuevas.length === 0) return [];
  return [
    hallazgo(
      "extensiones-permitidas-ampliadas",
      ARCHIVOS.clasificacion,
      `Una clase excluida del análisis ahora admite más tipos de archivo que en la base: ${nuevas.join(", ")}. Código u otros archivos nuevos podrían quedar fuera del análisis.`,
      "Devolvé PERMITIDO_EN_CLASE_EXCLUIDA a lo que era; ampliarlo es una decisión del dueño que se registra aparte.",
      { donde },
    ),
  ];
}

/**
 * Lo que puede dejar pasar el fallo del guardián: `continue-on-error` en el job o en el paso que lo corre,
 * un `if` en el job o en ese paso. Un `if` o un `continue-on-error` de OTRO paso (subir el informe, por
 * ejemplo) no puede silenciar al guardián y no cuenta. Sin job (`null`): nada, que es lo más estricto.
 */
function saltos(job) {
  if (job === null) return { continuas: [], si: undefined, siDelPaso: undefined };
  const deOtroPaso = (n) =>
    job.pasos.some((paso) => !paso.ejecutaGuardian && n >= paso.desde && n <= paso.hasta);
  return {
    continuas: job.continuaConError.filter((n) => !deOtroPaso(n)),
    si: job.si === undefined ? undefined : { valor: job.si, linea: job.lineaSi },
    siDelPaso: job.pasos.find((paso) => paso.ejecutaGuardian)?.si,
  };
}

/** (f) El job `guardian` existe, el Gate lo espera y lo exige, y no se puede saltear. */
function chequearCi(base, pr) {
  if (!tiene(pr.ci)) return [];
  const hallazgos = [];
  const jobsDelPr = pr.ci.valor;
  const deLaBase = tiene(base.ci) ? base.ci.valor.get(JOB_DEL_GUARDIAN) : undefined;
  const guardian = jobsDelPr.get(JOB_DEL_GUARDIAN);
  const salto = (motivo, linea) =>
    hallazgos.push(
      hallazgo(
        "ci-guardian-con-salto",
        ARCHIVOS.ci,
        `El job guardian ${motivo}: un fallo suyo, o el job entero, se podría saltear.`,
        "Sacá la línea: el guardián tiene que correr siempre y su fallo tiene que frenar el Gate.",
        { linea },
      ),
    );

  if (guardian === undefined) {
    hallazgos.push(
      hallazgo(
        "ci-sin-job-guardian",
        ARCHIVOS.ci,
        "ci.yml no tiene el job «guardian»: el guardián de contratos no correría en la CI.",
        "Devolvé el job guardian (y que el Gate lo espere).",
        { linea: pr.ci.lineaDeJobs },
      ),
    );
  } else {
    if (!guardian.pasos.some((paso) => paso.ejecutaGuardian)) {
      hallazgos.push(
        hallazgo(
          "ci-guardian-sin-ejecutar",
          ARCHIVOS.ci,
          "El job guardian ya no ejecuta `node arquitectura/contratos/guardian.cjs` tal cual (sin `|| true` ni otro operador): pasaría sin analizar.",
          "Devolvé el paso que corre el guardián.",
          { linea: guardian.linea },
        ),
      );
    }
    const nuevo = saltos(guardian);
    const viejo = deLaBase === undefined ? saltos(null) : saltos(deLaBase);
    for (const linea of nuevo.continuas.slice(viejo.continuas.length)) {
      salto("tiene `continue-on-error`, que la base no tenía", linea);
    }
    if (nuevo.si !== undefined && nuevo.si.valor !== viejo.si?.valor) {
      salto(`tiene \`if: ${nuevo.si.valor}\`, que la base no tenía`, nuevo.si.linea);
    }
    if (nuevo.siDelPaso !== undefined && nuevo.siDelPaso.valor !== viejo.siDelPaso?.valor) {
      salto(
        `tiene \`if: ${nuevo.siDelPaso.valor}\` en el paso que corre guardian.cjs, que la base no tenía`,
        nuevo.siDelPaso.linea,
      );
    }
  }

  const gate = jobsDelPr.get(JOB_DEL_GATE);
  if (gate === undefined) {
    hallazgos.push(
      hallazgo(
        "ci-gate-no-espera-guardian",
        ARCHIVOS.ci,
        "ci.yml no tiene el job «gate»: nadie espera al guardián.",
        "Devolvé el job gate.",
        { linea: pr.ci.lineaDeJobs },
      ),
    );
  } else if (!gate.needs.includes(JOB_DEL_GUARDIAN)) {
    hallazgos.push(
      hallazgo(
        "ci-gate-no-espera-guardian",
        ARCHIVOS.ci,
        "El job gate ya no espera a «guardian» en `needs`: un guardián rojo no frenaría el Gate.",
        "Devolvé «guardian» a la lista `needs` del gate.",
        { linea: gate.lineaNeeds ?? gate.linea },
      ),
    );
  }
  return hallazgos;
}

/** (f) `evaluar-gate.cjs` marca en rojo un guardián caído, saltado o cancelado (se prueba su comportamiento). */
function chequearGate(_base, pr) {
  if (!tiene(pr.gate)) return [];
  const sinDetectar = RESULTADOS_QUE_NO_SON_VERDE.filter(
    (resultado) =>
      !pr.gate.valor.conGuardianCaido[resultado]?.some((problema) =>
        problema.startsWith(`${JOB_DEL_GUARDIAN}:`),
      ),
  );
  if (sinDetectar.length === 0) return [];
  return [
    hallazgo(
      "gate-no-exige-guardian",
      ARCHIVOS.evaluarGate,
      `evaluarGate deja pasar un guardián «${sinDetectar.join("», «")}»: ya no lo trata como un job obligatorio.`,
      "Devolvé «guardian» a OBLIGATORIOS en evaluar-gate.cjs.",
      { donde: enTexto("const OBLIGATORIOS") },
    ),
  ];
}

/** (g) `package.json` sigue encadenando y apuntando al guardián. */
function chequearPaquete(base, pr) {
  if (!tiene(pr.paquete)) return [];
  const { arquitectura, guardian } = pr.paquete.valor;
  const hallazgos = [];
  const encadena =
    typeof arquitectura === "string" &&
    arquitectura.split("&&").some((paso) => paso.trim() === "npm run guardian");
  if (!encadena) {
    hallazgos.push(
      hallazgo(
        "script-arquitectura-desviado",
        ARCHIVOS.paquete,
        `El script «arquitectura» (${JSON.stringify(arquitectura ?? null)}) ya no encadena \`&& npm run guardian\`: \`npm run gate\` no correría el guardián.`,
        "Devolvé `&& npm run guardian` al final del script arquitectura.",
        { donde: enJson("scripts", "arquitectura") },
      ),
    );
  }
  const apunta = typeof guardian === "string" && esComandoDelGuardian(guardian.trim().split(" "));
  if (!apunta) {
    hallazgos.push(
      hallazgo(
        "script-guardian-desviado",
        ARCHIVOS.paquete,
        `El script «guardian» (${JSON.stringify(guardian ?? null)}) ya no ejecuta \`node arquitectura/contratos/guardian.cjs\`: \`npm run guardian\` no analizaría nada.`,
        "Devolvé el script guardian a `node arquitectura/contratos/guardian.cjs`.",
        { donde: enJson("scripts", "guardian") },
      ),
    );
  }
  return hallazgos;
}

/** (h) Los invariantes y mutaciones de la matriz de la base siguen en el PR. */
function chequearInvariantes(base, pr) {
  if (!tiene(base.invariantes) || pr.invariantes === undefined) return [];
  if (!tiene(pr.invariantes)) {
    if (pr.invariantes.ausente !== true) return [];
    return [
      hallazgo(
        "invariante-borrada",
        ARCHIVOS.invariantes,
        "La matriz de invariantes (invariantes.cjs) existía en la base y ya no existe en el PR.",
        "Devolvé la matriz: se pueden agregar invariantes y mutaciones, no quitarlas.",
        { donde: enArchivo() },
      ),
    ];
  }
  const hallazgos = [];
  const idsDelPr = pr.invariantes.valor.ids;
  const mutacionesDelPr = new Set(
    pr.invariantes.valor.mutaciones.map((m) => `${m.invariante}/${m.id}`),
  );
  for (const id of faltantes(base.invariantes.valor.ids, idsDelPr)) {
    hallazgos.push(
      hallazgo(
        "invariante-borrada",
        ARCHIVOS.invariantes,
        `El invariante «${id}» de la matriz de la base ya no está: su protección dejó de probarse.`,
        "Devolvé el invariante con sus mutaciones.",
        { donde: enTexto("const INVARIANTES") },
      ),
    );
  }
  for (const mutacion of base.invariantes.valor.mutaciones) {
    if (!idsDelPr.includes(mutacion.invariante)) continue;
    if (!mutacionesDelPr.has(`${mutacion.invariante}/${mutacion.id}`)) {
      hallazgos.push(
        hallazgo(
          "mutacion-borrada",
          ARCHIVOS.invariantes,
          `La mutación «${mutacion.id}» del invariante «${mutacion.invariante}» estaba en la base y ya no: ese debilitamiento dejó de probarse.`,
          "Devolvé la mutación (la matriz solo crece).",
          { donde: enTexto(`id: "${mutacion.invariante}"`) },
        ),
      );
    }
  }
  return hallazgos;
}

/** Avisos: lo que se saltea y se dice. */
function avisarSaltos(base) {
  if (base.invariantes?.ausente !== true) return [];
  return [
    hallazgo(
      "invariantes-sin-base",
      ARCHIVOS.invariantes,
      "La base no trae la matriz de invariantes (invariantes.cjs): se saltea el chequeo (h). Es esperable solo hasta que la matriz entre a la rama principal.",
      "Nada por ahora; cuando la base la tenga, el chequeo (h) se activa solo.",
      { donde: enArchivo() },
    ),
  ];
}

const CHEQUEOS = Object.freeze([
  chequearLectura,
  chequearRetiros,
  chequearContratos,
  chequearCodigos,
  chequearRigor,
  chequearClases,
  chequearCi,
  chequearGate,
  chequearPaquete,
  chequearInvariantes,
]);

function esFechaValida(texto) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (partes === null) return false;
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
  );
}

const ordenar = (lista) =>
  [...lista].sort(
    (a, b) =>
      orden(a.archivo, b.archivo) ||
      a.linea - b.linea ||
      orden(a.codigo, b.codigo) ||
      orden(a.motivo, b.motivo),
  );

/**
 * Compara la instantánea de la base con la del PR.
 *
 * @param {{ base: object, pr: object, ahora?: Date, leerPr: (ruta: string) => Buffer | string | null }} datos
 *   `leerPr` es la lectura del árbol del PR: con ella el ubicador calcula la línea de cada hallazgo.
 * @returns {{ fallas: object[], avisos: object[] }}
 */
function verificar({ base, pr, ahora = new Date(), leerPr }) {
  const ubicar = crearUbicador(leerPr);
  const completar = (h) => {
    const completo = ubicar(h);
    return Number.isInteger(completo.linea) && completo.linea >= 1
      ? completo
      : { ...completo, linea: 1 };
  };
  const fallas = CHEQUEOS.flatMap((chequeo) => chequeo(base, pr, { ahora })).map(completar);
  const avisos = avisarSaltos(base).map(completar);
  return { fallas: ordenar(fallas), avisos: ordenar(avisos) };
}

/** Una línea: `archivo:línea · contrato · motivo · corrección sugerida` (el mismo formato del guardián). */
const formatear = (h) =>
  `${h.archivo}:${h.linea} · ${h.contrato ?? "-"} · ${h.motivo} · ${h.correccion}`;

function valorDe(argumentos, nombre) {
  const exacto = argumentos.indexOf(nombre);
  if (exacto >= 0) return argumentos[exacto + 1];
  const con = argumentos.find((a) => a.startsWith(`${nombre}=`));
  return con === undefined ? undefined : con.slice(nombre.length + 1);
}

function principal(argumentos) {
  if (argumentos[0] === "--extraer") {
    const datos = extraer(argumentos[1], JSON.parse(argumentos[2] ?? "[]"));
    process.stdout.write(`\n${MARCA_DEL_RESULTADO}${JSON.stringify(datos)}\n`);
    return;
  }
  const arbol = valorDe(argumentos, "--arbol");
  if (arbol === undefined || arbol === "" || arbol.startsWith("--")) {
    process.stderr.write(
      "Uso: node <base>/arquitectura/contratos/no-debilitar.cjs --arbol <carpeta del árbol del PR>\n",
    );
    process.exitCode = 2;
    return;
  }
  const raizDelPr = path.resolve(arbol);
  if (!fs.existsSync(raizDelPr) || !fs.statSync(raizDelPr).isDirectory()) {
    process.stderr.write(`--arbol: «${arbol}» no es una carpeta.\n`);
    process.exitCode = 2;
    return;
  }
  const raizDeLaBase = path.resolve(__dirname, "../..");
  const leerPr = (ruta) => {
    try {
      return fs.readFileSync(path.join(raizDelPr, ruta));
    } catch {
      return null;
    }
  };
  const { fallas, avisos } = verificar({
    base: capturar(raizDeLaBase),
    pr: capturar(raizDelPr),
    ahora: new Date(),
    leerPr,
  });
  for (const aviso of avisos) process.stdout.write(`AVISO ${formatear(aviso)}\n`);
  for (const falla of fallas) process.stderr.write(`FALLA ${formatear(falla)}\n`);
  if (fallas.length > 0) {
    process.stderr.write(
      `Vigilancia de la versión anterior: ${fallas.length} debilitamientos, ${avisos.length} avisos (base: ${raizDeLaBase}).\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Vigilancia de la versión anterior: OK · nada de lo que exigía la base se debilitó · ${avisos.length} avisos.\n`,
  );
}

/**
 * Lo que esta vigilancia NO ve (los límites se dicen, no se esconden):
 *  - Un PR que borra el job `guardian` y el paso que corre este verificador no lo ejecuta: en un pull
 *    request manda el `ci.yml` del PR. Lo cubre que `Gate` y «Guardián de contratos» sean checks
 *    REQUERIDOS en la protección de `main` (configuración de GitHub, no del repo: G4 la vigila).
 *  - Compara cantidades, clases, versiones y constantes, no la lógica: un detector vaciado por dentro
 *    (misma cantidad, `reconoce` que no reconoce nada) y un `guardian.cjs` que sale 0 sin analizar no se
 *    ven acá; los cubren la matriz de invariantes y la mutación (Stryker) del código del guardián.
 *  - Un PR que vacía este mismo archivo no se detecta hasta que ese archivo es la base del PR siguiente.
 *  - Los jobs que no son el guardián, y los pasos del job `guardian` que no sean los vigilados, no se
 *    comparan (los `if`, `continue-on-error` y `timeout-minutes` de los demás jobs los cubre
 *    `test/arquitectura/gate-coincide-con-ci.test.ts`).
 *  - Quitar un chequeo legítimamente (una regla obsoleta) no tiene retiro: (c) lo bloquea siempre. Y un
 *    contrato retirado con un retiro registrado pasa: la decisión humana queda escrita, no se juzga.
 *  - `ci.yml` se lee como texto con el estilo de Prettier; YAML con anclas o alias se rechaza o no se ve.
 *  - La primera vez que se incorpora (la base no trae este archivo) no hay versión anterior que corra.
 */
const limites = Object.freeze([
  "un PR que quita el job y el paso que corre el verificador no lo ejecuta: lo cubre exigir los checks en la protección de main (G4)",
  "compara cantidades, clases, versiones y constantes, no la lógica de cada detector",
  "un PR que vacía este archivo se ve recién cuando es la base del PR siguiente",
  "los demás jobs de ci.yml los cubre gate-coincide-con-ci.test.ts",
]);

module.exports = {
  ARCHIVOS,
  CODIGOS_DE_AVISO,
  DESCRIPCION_DE_CODIGOS,
  CODIGOS_DE_FALLA: Object.freeze(Object.keys(DESCRIPCION_DE_CODIGOS)),
  CHEQUEOS,
  capturar,
  chequearRetiros,
  chequearContratos,
  chequearCodigos,
  chequearRigor,
  chequearClases,
  chequearCi,
  chequearGate,
  chequearPaquete,
  chequearInvariantes,
  chequearLectura,
  ejecutaElGuardian,
  extraerInvariantes,
  formatear,
  leerCi,
  leerConstante,
  leerPaquete,
  leerRetiros,
  limites,
  versionMayor,
  verificar,
};

if (require.main === module) principal(process.argv.slice(2));
