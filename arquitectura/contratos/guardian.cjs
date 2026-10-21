/**
 * Guardián de contratos arquitectónicos (contratos-arquitectonicos.md §2.5 y §8, G1).
 *
 * Orquesta las piezas: carga el registro (`registro.cjs`), clasifica toda ruta versionada
 * (`clasificacion.cjs`), valida las exclusiones y las excepciones (`excepciones.cjs`), descubre las
 * unidades y lee su declaración (`declaraciones.cjs`) y compara la declaración con el uso real que
 * detectan los detectores del registro (`comparacion.cjs`).
 *
 * Es puro y determinista: `ejecutar` recibe las rutas, la función que lee archivos y el reloj, y no
 * toca el disco ni el entorno. El CLI (`node arquitectura/contratos/guardian.cjs`) arma esas entradas
 * desde el repositorio (`git ls-files`), imprime cada falla como
 * `archivo:línea · contrato · motivo · corrección sugerida`, escribe el informe de evidencia
 * (`arquitectura/contratos/informe.json`, que NO se commitea) y sale 0 si todo pasa, 1 si algo falla.
 *
 * Distingue «pasó» de «no encontró nada que analizar»: falla si una clase que el repo debe tener
 * quedó con cero rutas, o si un detector declara una clase de la que no analizó ni un archivo.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  CLASES,
  CLASES_ESPERADAS,
  ARCHIVO_DE_REGLAS,
  NIVELES,
  clasificar,
} = require("./clasificacion.cjs");
const { cargarRegistro, ErrorDeRegistro } = require("./registro.cjs");
const { descubrirUnidades, leerDeclaraciones, unidadDe } = require("./declaraciones.cjs");
const {
  ARCHIVO_DE_EXCEPCIONES,
  ARCHIVO_DE_EXCLUSIONES,
  aplicarExcepciones,
  procesarExclusiones,
} = require("./excepciones.cjs");
const { comparar } = require("./comparacion.cjs");
const contratos = require("./contratos.cjs");

const ARCHIVO_DEL_REGISTRO = "arquitectura/contratos/contratos.cjs";
const ARCHIVO_DEL_INFORME = "arquitectura/contratos/informe.json";
const VERSION_DEL_INFORME = 1;

/** Qué comprueba el guardián: queda en el informe como «reglas ejecutadas». */
const CHEQUEOS = Object.freeze([
  ["ruta-sin-clase", "toda ruta versionada cae en una clase; si no, falla"],
  ["clasificacion-ambigua", "dos reglas del mismo nivel que clasifican distinto fallan"],
  ["clase-sin-rutas", "una clase que el repo debe tener no puede quedar vacía"],
  [
    "registro-invalido",
    "un contrato con campos faltantes, vacíos o mal formados invalida el registro",
  ],
  ["unidad-sin-declaracion", "cada unidad tiene su contratos.json"],
  ["declaracion-invalida", "el contratos.json declara usa y/o noUsa con la forma correcta"],
  ["declara-contrato-inexistente", "los ids de usa existen en el registro"],
  ["uso-sin-declarar", "la unidad que usa un contrato lo declara"],
  ["no-usa-falso", "la unidad que declara no usar nada no usa ningún contrato"],
  ["declaracion-falsa", "la unidad que declara un contrato lo usa de verdad"],
  ["definicion-fuera-de-la-fuente", "un valor de contrato solo se define en su fuente de verdad"],
  ["contrato-sin-fuente", "la fuente de verdad existe y contiene lo que dice"],
  [
    "detector-sin-rutas",
    "un detector no puede declarar una clase de la que no analizó ni un archivo",
  ],
  ["detector-en-clase-excluida", "ningún detector apunta a una clase excluida del análisis"],
  ["excepcion-invalida", "las excepciones y exclusiones traen todos sus campos, sin sobrantes"],
  ["excepcion-vencida", "ninguna excepción o exclusión está vencida"],
  [
    "excepcion-plazo-excesivo",
    "ninguna excepción o exclusión dura más de 60 días (vence - creada)",
  ],
  ["excepcion-vence-antes-de-creada", "el vencimiento no es anterior a la creación"],
  ["excepcion-creada-futura", "la fecha de creación no es futura respecto del reloj"],
  ["excepcion-ruta-no-exacta", "la ruta de una excepción es un archivo exacto, sin comodines"],
  ["excepcion-huella-cambiada", "la huella aprobada coincide con la línea (o el archivo) actual"],
  ["excepcion-obsoleta", "toda excepción o exclusión silencia algo"],
  ["excepcion-contrato-inexistente", "la excepción apunta a un contrato del registro"],
]);

const orden = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const ordenarFallas = (lista) =>
  [...lista].sort(
    (a, b) =>
      orden(a.archivo, b.archivo) ||
      (a.linea ?? 0) - (b.linea ?? 0) ||
      orden(a.codigo, b.codigo) ||
      orden(a.contrato ?? "", b.contrato ?? "") ||
      orden(a.motivo, b.motivo),
  );

/** Quita los campos internos de un hallazgo y lo deja con la forma de una falla. */
const comoFalla = (hallazgo) => ({
  codigo: hallazgo.codigo,
  archivo: hallazgo.archivo,
  linea: hallazgo.linea,
  contrato: hallazgo.contrato,
  motivo: hallazgo.motivo,
  correccion: hallazgo.correccion,
  huella: hallazgo.huella,
});

/**
 * Ejecuta el guardián sobre un árbol descrito por sus rutas y una función de lectura.
 *
 * @param {{
 *   rutas: string[],
 *   leer: (ruta: string) => Buffer | string | null,
 *   contratos: unknown,
 *   excepciones: unknown,
 *   exclusiones: unknown,
 *   ahora?: Date,
 *   niveles?: { nombre: string, reglas: { clase: string, glob: string }[] }[],
 *   clasesEsperadas?: string[],
 *   previas?: { fallas?: object[], avisos?: object[] },
 * }} opciones
 */
function ejecutar(opciones) {
  const ahora = opciones.ahora ?? new Date();
  const niveles = opciones.niveles ?? NIVELES;
  const clasesEsperadas = opciones.clasesEsperadas ?? CLASES_ESPERADAS;
  const { leer } = opciones;
  const fallas = [...(opciones.previas?.fallas ?? [])];
  const avisos = [...(opciones.previas?.avisos ?? [])];
  const listaDeRutas = [...new Set(opciones.rutas)].sort();
  const rutas = new Set(listaDeRutas);

  if (listaDeRutas.length === 0) {
    fallas.push({
      codigo: "sin-rutas",
      archivo: ARCHIVO_DE_REGLAS,
      contrato: null,
      motivo:
        "No hay ninguna ruta versionada para analizar: «pasó» no significa nada si no se miró nada.",
      correccion: "Corré el guardián dentro de un repositorio git con archivos versionados.",
    });
    return resultado({ fallas, avisos, listaDeRutas, ahora, parcial: true });
  }

  // 1. Clasificación completa.
  const clasificacion = clasificar(listaDeRutas, { niveles });
  fallas.push(...clasificacion.fallas);
  const tablaValida = !clasificacion.fallas.some(
    (f) => f.codigo === "regla-de-clasificacion-invalida",
  );
  if (tablaValida) {
    for (const clase of clasesEsperadas) {
      if (clasificacion.porClase[clase].length === 0) {
        fallas.push({
          codigo: "clase-sin-rutas",
          archivo: ARCHIVO_DE_REGLAS,
          contrato: null,
          motivo: `La clase «${clase}» no tiene ninguna ruta, y este repositorio debería tener archivos de esa clase: el análisis no cubrió nada de ella.`,
          correccion:
            "Revisá las reglas de clasificación (¿se movió o se renombró una carpeta?) o, si la clase ya no existe, quitala de CLASES_ESPERADAS.",
        });
      }
    }
  }

  // 2. Exclusiones del análisis (generado, docs y rutas excluidas a mano).
  const exclusiones = procesarExclusiones(opciones.exclusiones, {
    rutas,
    porRuta: clasificacion.porRuta,
    porClase: clasificacion.porClase,
    leer,
    ahora,
  });
  fallas.push(...exclusiones.fallas);
  const clasesExcluidas = new Set(exclusiones.clases.keys());
  const rutasExcluidas = new Set(exclusiones.archivos.keys());

  // 3. Registro de contratos.
  let registro = null;
  try {
    registro = cargarRegistro(opciones.contratos);
  } catch (error) {
    if (!(error instanceof ErrorDeRegistro)) throw error;
    for (const problema of error.problemas) {
      fallas.push({
        codigo: "registro-invalido",
        archivo: ARCHIVO_DEL_REGISTRO,
        contrato: null,
        motivo: problema,
        correccion:
          "Completá o corregí el contrato en el registro; un contrato roto invalida todo el registro.",
      });
    }
  }

  // 4. Unidades y declaraciones.
  const unidades = descubrirUnidades(listaDeRutas);
  const lectura = leerDeclaraciones(unidades, {
    rutas,
    leer,
    idsDeContratos: registro === null ? null : new Set(registro.porId.keys()),
  });
  fallas.push(...lectura.fallas);

  // 5. Comparación declaración-uso, excepciones y cobertura de los detectores.
  let comparacion = null;
  let excepciones = { aplicadas: [], restantes: [] };
  if (registro !== null) {
    comparacion = comparar({
      registro,
      porRuta: clasificacion.porRuta,
      rutas,
      leer,
      declaraciones: lectura.declaraciones,
      clasesExcluidas,
      rutasExcluidas,
    });
    fallas.push(...comparacion.fallas);
    avisos.push(...comparacion.avisos);
    for (const regla of comparacion.reglas) {
      for (const clase of regla.clases) {
        const analizadas = comparacion.escaneadasPorClase[clase] ?? 0;
        if (clasesExcluidas.has(clase)) {
          fallas.push({
            codigo: "detector-en-clase-excluida",
            archivo: ARCHIVO_DEL_REGISTRO,
            contrato: regla.contrato,
            motivo: `El detector «${regla.detector}» apunta a la clase «${clase}», que está excluida del análisis: nunca va a ver nada.`,
            correccion: "Sacá la clase del detector o quitá la exclusión de esa clase.",
          });
        } else if (
          analizadas === 0 &&
          tablaValida &&
          (clasificacion.porClase[clase].length > 0 || clasesEsperadas.includes(clase))
        ) {
          fallas.push({
            codigo: "detector-sin-rutas",
            archivo: ARCHIVO_DEL_REGISTRO,
            contrato: regla.contrato,
            motivo: `El detector «${regla.detector}» declara la clase «${clase}» pero no analizó ni un archivo de ella (${clasificacion.porClase[clase].length} rutas de esa clase): «sin hallazgos» no sería un resultado.`,
            correccion:
              "Revisá la clasificación y las exclusiones: el detector tiene que alcanzar archivos reales.",
          });
        }
      }
    }
    excepciones = aplicarExcepciones(opciones.excepciones, {
      rutas,
      idsDeContratos: new Set(registro.porId.keys()),
      ahora,
      hallazgos: comparacion.hallazgos,
    });
    fallas.push(...excepciones.fallas);
    fallas.push(...excepciones.restantes.map(comoFalla));
  }

  return resultado({
    fallas,
    avisos,
    listaDeRutas,
    ahora,
    clasificacion,
    exclusiones,
    registro,
    unidades,
    declaraciones: lectura.declaraciones,
    comparacion,
    excepciones,
    clasesEsperadas,
    parcial: false,
  });
}

/** Arma el resultado y el informe de evidencia a partir de lo que se ejecutó. */
function resultado(datos) {
  const fallas = ordenarFallas(datos.fallas);
  const avisos = ordenarFallas(datos.avisos);
  const informe = {
    version: VERSION_DEL_INFORME,
    generadoEn: datos.ahora.toISOString(),
    resultado: fallas.length === 0 ? "pasa" : "falla",
    analisisCompleto: !datos.parcial,
    totales: {
      rutas: datos.listaDeRutas.length,
      rutasClasificadas: datos.clasificacion === undefined ? 0 : datos.clasificacion.porRuta.size,
      unidades: datos.unidades === undefined ? 0 : datos.unidades.size,
      unidadesDeclaradas: datos.declaraciones === undefined ? 0 : datos.declaraciones.size,
      contratos:
        datos.registro === null || datos.registro === undefined
          ? 0
          : datos.registro.contratos.length,
      excepcionesAplicadas:
        datos.excepciones === undefined ? 0 : datos.excepciones.aplicadas.length,
      fallas: fallas.length,
      avisos: avisos.length,
    },
    reglasEjecutadas: {
      chequeos: CHEQUEOS.map(([codigo, descripcion]) => ({ codigo, descripcion })),
      clasificacion: datos.clasificacion === undefined ? [] : datos.clasificacion.reglas,
      detectores:
        datos.comparacion === null || datos.comparacion === undefined
          ? []
          : datos.comparacion.reglas,
    },
    clases: {},
    exclusiones: {},
    unidades: [],
    excepcionesAplicadas: datos.excepciones === undefined ? [] : datos.excepciones.aplicadas,
    usosFueraDeUnidades:
      datos.comparacion === null || datos.comparacion === undefined
        ? []
        : datos.comparacion.usosFueraDeUnidades,
    fallas,
    avisos,
  };
  if (datos.clasificacion !== undefined) {
    const excluidasPorClase = {};
    for (const [clase, entrada] of datos.exclusiones.clases) {
      excluidasPorClase[clase] = entrada.id;
    }
    const rutasExcluidas = datos.exclusiones.archivos;
    for (const clase of CLASES) {
      const delaClase = datos.clasificacion.porClase[clase];
      const excluidasAMano = delaClase.filter((ruta) => rutasExcluidas.has(ruta)).length;
      informe.clases[clase] = {
        rutas: delaClase.length,
        esperada: datos.clasesEsperadas.includes(clase),
        excluidas: clase in excluidasPorClase ? delaClase.length : excluidasAMano,
        exclusionPorClase: excluidasPorClase[clase] ?? null,
        analizadasPorDetectores:
          datos.comparacion === null || datos.comparacion === undefined
            ? 0
            : (datos.comparacion.escaneadasPorClase[clase] ?? 0),
        binariasOmitidas:
          datos.comparacion === null || datos.comparacion === undefined
            ? 0
            : (datos.comparacion.omitidasPorClase[clase] ?? 0),
        sinUnidad: delaClase.filter((ruta) => unidadDe(ruta) === null).length,
        listaDeRutas: delaClase,
      };
    }
    informe.exclusiones = {
      porClase: [...datos.exclusiones.clases.values()],
      porRuta: [...datos.exclusiones.archivos.values()],
    };
  }
  if (datos.unidades !== undefined) {
    informe.unidades = [...datos.unidades.entries()].map(([unidad, archivos]) => ({
      unidad,
      archivos: archivos.length,
      declaracion: datos.declaraciones.get(unidad) ?? null,
    }));
  }
  return { fallas, avisos, informe };
}

/** Una falla en una línea: `archivo:línea · contrato · motivo · corrección sugerida`. */
function formatearFalla(falla) {
  const ubicacion = falla.linea === undefined ? falla.archivo : `${falla.archivo}:${falla.linea}`;
  return `${ubicacion} · ${falla.contrato ?? "-"} · ${falla.motivo} · ${falla.correccion}`;
}

/** Lista las rutas versionadas y las sin versionar que git no ignora (lo que entraría a un commit). */
function listarRutas(raiz) {
  const salida = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: raiz,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  return [...new Set(salida.split("\0").filter((ruta) => ruta !== ""))].sort();
}

function leerJson(raiz, archivo, previas) {
  try {
    return JSON.parse(fs.readFileSync(path.join(raiz, archivo), "utf8"));
  } catch (error) {
    previas.fallas.push({
      codigo: "excepcion-invalida",
      archivo,
      contrato: null,
      motivo: `No se pudo leer el archivo como JSON: ${String(error?.message ?? error)}.`,
      correccion: "Dejalo como una lista JSON válida.",
    });
    return [];
  }
}

/**
 * Arma las entradas del guardián desde el repositorio de `raiz`: `git ls-files`, lectura del disco y los
 * archivos de datos. Las rutas que git lista pero ya no están en el disco (borradas sin registrar) se
 * avisan y se omiten. Se separa de `ejecutar` para que las pruebas puedan alterar el árbol en memoria.
 */
function cargarDelRepo(raiz) {
  const previas = { fallas: [], avisos: [] };
  const rutas = [];
  for (const ruta of listarRutas(raiz)) {
    if (fs.existsSync(path.join(raiz, ruta))) {
      rutas.push(ruta);
    } else {
      previas.avisos.push({
        codigo: "ruta-ausente-en-disco",
        archivo: ruta,
        contrato: null,
        motivo: "Git la lista pero ya no está en el disco; no se analiza.",
        correccion: "Registrá el borrado (git rm) para que deje de listarse.",
      });
    }
  }
  const leer = (ruta) => {
    try {
      return fs.readFileSync(path.join(raiz, ruta));
    } catch {
      return null;
    }
  };
  return {
    rutas,
    leer,
    contratos,
    excepciones: leerJson(raiz, ARCHIVO_DE_EXCEPCIONES, previas),
    exclusiones: leerJson(raiz, ARCHIVO_DE_EXCLUSIONES, previas),
    previas,
  };
}

function principal(argumentos) {
  const raiz = path.resolve(__dirname, "../..");
  const sinInforme = argumentos.includes("--sin-informe");
  const indicado = argumentos.find((argumento) => argumento.startsWith("--informe="));
  const destino = path.resolve(
    raiz,
    indicado === undefined ? ARCHIVO_DEL_INFORME : indicado.slice("--informe=".length),
  );
  const { fallas, avisos, informe } = ejecutar(cargarDelRepo(raiz));
  if (!sinInforme) {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, `${JSON.stringify(informe, null, 2)}\n`);
  }
  for (const aviso of avisos) process.stdout.write(`AVISO ${formatearFalla(aviso)}\n`);
  for (const falla of fallas) process.stderr.write(`FALLA ${formatearFalla(falla)}\n`);
  const porClase = CLASES.filter((clase) => informe.clases[clase] !== undefined)
    .map((clase) => `${clase} ${informe.clases[clase].rutas}`)
    .join(", ");
  const donde = sinInforme ? "sin informe" : `informe: ${path.relative(raiz, destino)}`;
  if (fallas.length > 0) {
    process.stderr.write(
      `Guardián de contratos: ${fallas.length} fallas, ${avisos.length} avisos (${donde}).\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Guardián de contratos: OK · ${informe.totales.rutasClasificadas} rutas clasificadas (${porClase}) · ` +
      `${informe.totales.unidadesDeclaradas} unidades declaradas · ${informe.totales.contratos} contratos · ` +
      `${avisos.length} avisos (${donde}).\n`,
  );
}

module.exports = { ejecutar, cargarDelRepo, formatearFalla };

if (require.main === module) principal(process.argv.slice(2));
