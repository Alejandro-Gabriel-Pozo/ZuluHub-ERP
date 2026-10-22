/**
 * Control de deuda técnica que baja de verdad (contratos-arquitectonicos.md §10, G5).
 *
 * Una pieza del guardián: mismo estilo (`archivo:línea · contrato · motivo · corrección`, códigos de una lista
 * cerrada, autocomprobación de la ubicación, informe de evidencia) y la misma comparación con la rama base.
 *
 *     node arquitectura/deuda/deuda.cjs [--base=<carpeta de la base>] [--informe=<ruta>] [--sin-informe]
 *
 * SIN `--base`: evalúa el árbol del repositorio (`marcadores.cjs`, `libro.cjs`): todo marcador de deuda está en
 * el registro, las excepciones son válidas (≤ 60 días) y no pasan del tope. CON `--base`: además compara la deuda
 * con la de la rama base (la carpeta donde se extrajo `main`, un checkout de git; `antes-y-despues.cjs`): ni
 * deuda nueva ni deuda que sube sin excepción, ni entradas borradas sin pagar, y un archivo tocado no conserva
 * su deuda. Si la base todavía no trae el registro (la primera vez que se incorpora) avisa y no compara.
 *
 * SALIDA. Fallas, avisos y el RESUMEN salen por stderr (total por tipo, antigüedad, excepciones abiertas con su
 * vencimiento y tendencia respecto de la base); el detalle va a `arquitectura/deuda/informe.json` (no se
 * commitea). Código de salida: 0 sin fallas, 1 con fallas, 2 si `--base` no es una carpeta.
 *
 * LÍMITES que se dicen de entrada: la deuda sin marcar y sin registrar no la ve ninguna máquina; la «zona» es el
 * archivo, no el módulo; y `aprobadoPor` queda escrito pero no prueba quién lo escribió.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { diaDe, diasEntre } = require("../contratos/excepciones.cjs");
const { crearUbicador, enArchivo } = require("../contratos/ubicacion.cjs");
const { compararConLaBase } = require("./antes-y-despues.cjs");
const { CODIGOS_DE_AVISO, CODIGOS_DE_FALLA } = require("./codigos.cjs");
const { ARCHIVO_DEL_REGISTRO, CONTRATO, evaluarArbol, totales } = require("./libro.cjs");

/** Cuánto puede pesar la lista de archivos de git: 256 MiB, por si el repositorio crece mucho. */
const TOPE_DE_LA_LISTA = 268435456;
const ARCHIVO_DEL_INFORME = "arquitectura/deuda/informe.json";
const VERSION_DEL_INFORME = 1;

const orden = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ordenar = (lista) =>
  [...lista].sort(
    (a, b) =>
      orden(a.archivo, b.archivo) ||
      a.linea - b.linea ||
      orden(a.codigo, b.codigo) ||
      orden(a.motivo, b.motivo),
  );

const tieneArchivo = (hallazgo) => typeof hallazgo.archivo === "string" && hallazgo.archivo !== "";
const tieneLinea = (hallazgo) => Number.isInteger(hallazgo.linea) && hallazgo.linea >= 1;

/**
 * AUTOCOMPROBACIÓN (M3): ningún hallazgo sale sin archivo y sin una línea entera desde 1, ni con un código fuera
 * de la lista cerrada. Uno que no cumple se reemplaza por una falla propia que nombra el código ofensor.
 */
function comprobarUbicaciones(fallas, avisos) {
  const propias = [];
  const revisar = (lista, nombre, validos) =>
    lista.filter((hallazgo) => {
      const problemas = [];
      if (!tieneArchivo(hallazgo) || !tieneLinea(hallazgo)) {
        problemas.push([
          "falla-sin-ubicacion",
          "salió sin ubicación completa (archivo y línea desde 1)",
        ]);
      }
      if (!validos.includes(hallazgo.codigo)) {
        problemas.push([
          "codigo-fuera-de-la-lista",
          "usa un código que no está en la lista cerrada de deuda",
        ]);
      }
      for (const [codigo, queOcurrio] of problemas) {
        propias.push({
          codigo,
          archivo: tieneArchivo(hallazgo) ? hallazgo.archivo : ARCHIVO_DEL_REGISTRO,
          linea: 1,
          contrato: CONTRATO,
          motivo: `${nombre} con código «${hallazgo.codigo}» ${queOcurrio}: ${hallazgo.motivo}`,
          correccion:
            "Hacé que el chequeo diga el archivo y la línea, y anotá su código en codigos.cjs.",
        });
      }
      return problemas.length === 0;
    });
  const fallasValidas = revisar(fallas, "Una falla", CODIGOS_DE_FALLA);
  const avisosValidos = revisar(avisos, "Un aviso", CODIGOS_DE_AVISO);
  return { fallas: [...fallasValidas, ...propias], avisos: avisosValidos };
}

/**
 * Evalúa el árbol del cambio y, si hay base, lo compara con ella.
 *
 * @param {{
 *   pr: { rutas: string[], leer: (ruta: string) => Buffer | string | null },
 *   base?: { rutas: string[], leer: (ruta: string) => Buffer | string | null } | null,
 *   ahora?: Date,
 * }} datos
 */
function ejecutar({ pr, base = null, ahora = new Date() }) {
  const hoy = diaDe(ahora);
  const delCambio = { ...evaluarArbol({ arbol: pr, ahora }), arbol: pr };
  const fallas = [...delCambio.fallas];
  const avisos = [...delCambio.avisos];
  let tendencia = null;
  if (base !== null) {
    if (base.leer(ARCHIVO_DEL_REGISTRO) === null) {
      avisos.push({
        codigo: "deuda-base-sin-registro",
        archivo: ARCHIVO_DEL_REGISTRO,
        contrato: CONTRATO,
        motivo:
          "La rama base todavía no trae el registro de deuda (es la primera vez que se incorpora): no hay con qué comparar.",
        correccion: "Nada por ahora: cuando la base lo tenga, la comparación se activa sola.",
        donde: enArchivo(),
      });
    } else {
      const deLaBase = { ...evaluarArbol({ arbol: base, ahora }), arbol: base };
      const comparacion = compararConLaBase({
        base: deLaBase,
        pr: delCambio,
        bloquea: delCambio.configuracion.bloqueaDeudaEnArchivoTocado,
      });
      fallas.push(...comparacion.fallas);
      avisos.push(...comparacion.avisos);
      tendencia = comparacion.tendencia;
    }
  }
  const ubicar = crearUbicador(pr.leer);
  const comprobadas = comprobarUbicaciones(fallas.map(ubicar), avisos.map(ubicar));
  const resultadoFallas = ordenar(comprobadas.fallas);
  const resultadoAvisos = ordenar(comprobadas.avisos);

  const resumen = totales(delCambio);
  const abiertas = delCambio.entradas.filter((entrada) => entrada.excepcion);
  const edades = delCambio.entradas.map((entrada) => ({
    id: entrada.id,
    dias: diasEntre(entrada.creada, hoy),
  }));
  const masVieja = edades.reduce(
    (vieja, e) => (vieja === null || e.dias > vieja.dias ? e : vieja),
    null,
  );
  const informe = {
    version: VERSION_DEL_INFORME,
    generadoEn: ahora.toISOString(),
    resultado: resultadoFallas.length === 0 ? "pasa" : "falla",
    conBase: tendencia !== null,
    configuracion: delCambio.configuracion,
    total: resumen,
    antiguedad: {
      entradas: edades.length,
      promedioEnDias:
        edades.length === 0
          ? 0
          : Math.round(edades.reduce((suma, e) => suma + e.dias, 0) / edades.length),
      masVieja,
    },
    excepciones: {
      abiertas: abiertas.length,
      tope: delCambio.configuracion.topeDeExcepciones,
      lista: abiertas.map((entrada) => ({
        id: entrada.id,
        tipo: entrada.tipo,
        archivos: entrada.archivos,
        vence: entrada.vence,
        diasQueFaltan: diasEntre(hoy, entrada.vence),
      })),
    },
    tendencia:
      tendencia === null
        ? null
        : {
            base: tendencia.base,
            pr: tendencia.pr,
            diferencia: tendencia.pr.total - tendencia.base.total,
          },
    marcadores: delCambio.medicion.lista,
    archivosAnalizados: delCambio.medicion.analizados,
    fallas: resultadoFallas,
    avisos: resultadoAvisos,
  };
  return { fallas: resultadoFallas, avisos: resultadoAvisos, informe };
}

/**
 * El valor de una opción `--nombre <valor>` o `--nombre=<valor>` (`undefined` si no está). Propio y no el del
 * guardián: el control de deuda no puede depender de que `guardian.cjs` esté entero.
 */
function valorDeOpcion(argumentos, nombre) {
  const posicion = argumentos.indexOf(nombre);
  if (posicion >= 0) return argumentos[posicion + 1] ?? "";
  const conIgual = argumentos.find((argumento) => argumento.startsWith(`${nombre}=`));
  return conIgual === undefined ? undefined : conIgual.slice(nombre.length + 1);
}

/** Una línea: `archivo:línea · contrato · motivo · corrección sugerida`. */
const formatear = (hallazgo) =>
  `${hallazgo.archivo}:${hallazgo.linea} · ${hallazgo.contrato ?? "-"} · ${hallazgo.motivo} · ${hallazgo.correccion}`;

/** El resumen que sale por stderr: total por tipo, antigüedad, excepciones abiertas y tendencia. */
function resumir(informe) {
  const { total, antiguedad, excepciones, tendencia, configuracion } = informe;
  const porTipo = Object.entries(total.porTipo)
    .sort((a, b) => b[1] - a[1] || orden(a[0], b[0]))
    .map(([tipo, cantidad]) => `${tipo} ${cantidad}`)
    .join(" · ");
  const lineas = [
    `Deuda técnica: ${total.total} en total (${total.marcadores} marcadores en ${total.archivosConDeuda} archivos + ${total.hallazgos} hallazgos registrados).`,
    `  por tipo: ${porTipo === "" ? "ninguno" : porTipo}`,
    antiguedad.masVieja === null
      ? "  antigüedad: no hay entradas registradas."
      : `  antigüedad: ${antiguedad.promedioEnDias} días en promedio; la más vieja, «${antiguedad.masVieja.id}» (${antiguedad.masVieja.dias} días).`,
    `  excepciones abiertas: ${excepciones.abiertas} de ${excepciones.tope} permitidas${excepciones.lista
      .map((e) => `\n    - ${e.id}: vence el ${e.vence} (faltan ${e.diasQueFaltan} días)`)
      .join("")}`,
  ];
  if (tendencia === null) {
    lineas.push("  tendencia: sin base contra la que comparar en esta corrida.");
  } else {
    const diferencia = tendencia.diferencia;
    lineas.push(
      `  tendencia respecto de la base: ${tendencia.base.total} → ${tendencia.pr.total} (${diferencia > 0 ? "+" : ""}${diferencia}${diferencia < 0 ? ", baja" : diferencia === 0 ? ", sin cambios" : ", SUBE"}).`,
    );
  }
  if (!configuracion.bloqueaDeudaEnArchivoTocado) {
    lineas.push(
      "  AVISO: `bloqueaDeudaEnArchivoTocado` está en false: tocar un archivo con deuda sin pagarla solo avisa, no bloquea.",
    );
  }
  return lineas.join("\n");
}

// --- El repositorio de verdad ---------------------------------------------------------------------------------

/** Las rutas de archivos de `raiz` (versionadas y nuevas que git no ignora), menos las que cuelgan de `excluida`. */
function listarRutas(raiz, excluida = null) {
  const git = (...opciones) =>
    execFileSync("git", ["ls-files", "-z", ...opciones], {
      cwd: raiz,
      maxBuffer: TOPE_DE_LA_LISTA,
      stdio: "pipe", // lo que diga git por stderr no sale por el nuestro (si falla, se avisa con un mensaje propio)
    })
      .toString("utf8")
      .split("\0"); // cada nombre termina en NUL: sobra una cadena vacía, que no es un archivo y el filtro de abajo descarta
  const nuevas = git("--others", "--exclude-standard").filter(
    (nombre) => excluida === null || !nombre.startsWith(`${excluida}/`),
  );
  return [...new Set([...git("--cached"), ...nuevas])]
    .sort()
    .filter(
      (ruta) => fs.statSync(path.join(raiz, ruta), { throwIfNoEntry: false })?.isFile() === true,
    );
}

/** Un árbol (rutas y lectura) del repositorio de `raiz`. */
function cargarArbol(raiz, excluida = null) {
  return {
    rutas: listarRutas(raiz, excluida),
    leer: (ruta) => {
      try {
        return fs.readFileSync(path.join(raiz, ruta));
      } catch {
        return null;
      }
    },
  };
}

/**
 * La ruta (con `/`) de `carpeta` relativa a `raiz` si cuelga de ella, o `null` si es la misma raíz o queda fuera.
 * Una carpeta que se llama `..algo` (nombre válido) cuelga de la raíz: solo `..` y `../…` salen de ella.
 */
function dentroDeLaRaiz(raiz, carpeta) {
  const relativa = path.relative(raiz, carpeta);
  if (relativa === "" || relativa === ".." || relativa.startsWith(`..${path.sep}`)) return null;
  return relativa.split(path.sep).join("/");
}

function principal(argumentos) {
  const raiz = path.resolve(__dirname, "../..");
  const carpetaDeLaBase = valorDeOpcion(argumentos, "--base");
  const absoluta = carpetaDeLaBase === undefined ? null : path.resolve(carpetaDeLaBase);
  if (
    absoluta !== null &&
    (carpetaDeLaBase === "" || !fs.statSync(absoluta, { throwIfNoEntry: false })?.isDirectory())
  ) {
    process.stderr.write(`--base: «${carpetaDeLaBase}» no es una carpeta.\n`);
    process.exitCode = 2;
    return;
  }
  // Si la base se extrajo DENTRO del repositorio (`base/`), sus archivos sin versionar no son del cambio.
  const pr = cargarArbol(raiz, absoluta === null ? null : dentroDeLaRaiz(raiz, absoluta));
  let base = null;
  if (absoluta !== null) {
    try {
      base = cargarArbol(absoluta);
    } catch {
      process.stderr.write(
        `--base: «${carpetaDeLaBase}» no es un checkout de git: no se pueden listar sus archivos.\n`,
      );
      process.exitCode = 2;
      return;
    }
  }
  const { fallas, avisos, informe } = ejecutar({ pr, base });
  const indicado = valorDeOpcion(argumentos, "--informe");
  const destino = path.resolve(raiz, indicado ?? ARCHIVO_DEL_INFORME);
  if (!argumentos.includes("--sin-informe")) {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, `${JSON.stringify(informe, null, 2)}\n`);
  }
  for (const aviso of avisos) process.stderr.write(`AVISO ${formatear(aviso)}\n`);
  for (const falla of fallas) process.stderr.write(`FALLA ${formatear(falla)}\n`);
  process.stderr.write(`${resumir(informe)}\n`);
  const donde = argumentos.includes("--sin-informe")
    ? "sin informe"
    : `informe: ${path.relative(raiz, destino)}`;
  process.stderr.write(
    fallas.length === 0
      ? `Deuda técnica: OK · ${avisos.length} avisos (${donde}).\n`
      : `Deuda técnica: ${fallas.length} fallas, ${avisos.length} avisos (${donde}).\n`,
  );
  process.exitCode = fallas.length === 0 ? 0 : 1;
}

module.exports = {
  ejecutar,
  cargarArbol,
  comprobarUbicaciones,
  dentroDeLaRaiz,
  formatear,
  resumir,
  valorDeOpcion,
};

if (require.main === module) {
  const [, , ...argumentos] = process.argv; // sin el ejecutable ni el script
  principal(argumentos);
}
