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
 * Toda falla y todo aviso traen archivo y línea (M3): los del código analizado, con la línea del
 * detector; los demás, con la que calcula `ubicacion.cjs` (regla por código en `REGLAS_DE_LINEA`).
 * Una AUTOCOMPROBACIÓN reemplaza cualquier hallazgo sin archivo o sin línea entera desde 1 (o con un
 * código fuera de la lista cerrada de `codigos.cjs`) por una falla propia que nombra el código ofensor.
 *
 * Distingue «pasó» de «no encontró nada que analizar»: falla si una clase que el repo debe tener
 * quedó con cero rutas, o si un detector declara una clase de la que no analizó ni un archivo.
 */
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  CLASES,
  CLASES_ESPERADAS,
  ARCHIVO_DE_REGLAS,
  NIVELES,
  clasificar,
} = require("./clasificacion.cjs");
const { ARCHIVO_DEL_REGISTRO, cargarRegistro, ErrorDeRegistro } = require("./registro.cjs");
const { descubrirUnidades, leerDeclaraciones, unidadDe } = require("./declaraciones.cjs");
const {
  ARCHIVO_DE_EXCEPCIONES,
  ARCHIVO_DE_EXCLUSIONES,
  aplicarExcepciones,
  procesarExclusiones,
} = require("./excepciones.cjs");
const { comparar } = require("./comparacion.cjs");
const contratos = require("./contratos.cjs");
const { CODIGOS_DE_AVISO, CODIGOS_DE_FALLA, DESCRIPCION_DE_CODIGOS } = require("./codigos.cjs");
const {
  REGLAS_DE_LINEA,
  crearUbicador,
  enArchivo,
  enContrato,
  enJson,
  enTexto,
} = require("./ubicacion.cjs");

const ARCHIVO_DEL_GUARDIAN = "arquitectura/contratos/guardian.cjs";
const ARCHIVO_DEL_INFORME = "arquitectura/contratos/informe.json";
const VERSION_DEL_INFORME = 1;

/** Qué comprueba el guardián y cómo ubica cada falla: queda en el informe como «reglas ejecutadas». */
const CHEQUEOS = Object.freeze(
  CODIGOS_DE_FALLA.map((codigo) => [
    codigo,
    DESCRIPCION_DE_CODIGOS[codigo],
    REGLAS_DE_LINEA[codigo],
  ]),
);

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

const tieneArchivo = (hallazgo) => typeof hallazgo.archivo === "string" && hallazgo.archivo !== "";
const tieneLinea = (hallazgo) => Number.isInteger(hallazgo.linea) && hallazgo.linea >= 1;

/**
 * AUTOCOMPROBACIÓN (M3): ningún hallazgo sale sin archivo y sin una línea entera desde 1, ni con un
 * código fuera de la lista cerrada (`codigos.cjs`). Un hallazgo que no cumple se reemplaza por una
 * falla propia que nombra el código ofensor: el guardián falla en vez de imprimir una falla que nadie
 * puede ubicar. Así M3 no depende de la memoria de quien agrega un chequeo.
 */
function comprobarUbicaciones(fallas, avisos) {
  const propias = [];
  const revisar = (lista, tipo, codigosValidos) =>
    lista.filter((hallazgo) => {
      const problemas = [];
      if (!tieneArchivo(hallazgo) || !tieneLinea(hallazgo)) {
        problemas.push({
          codigo: "falla-sin-ubicacion",
          queOcurrio: `salió sin ubicación completa (archivo: ${JSON.stringify(hallazgo.archivo)}, línea: ${JSON.stringify(hallazgo.linea)})`,
          correccion:
            "Hacé que el chequeo diga el archivo y la línea (o cómo calcularla en ubicacion.cjs): M3 exige archivo:línea en toda falla.",
        });
      }
      if (!codigosValidos.includes(hallazgo.codigo)) {
        problemas.push({
          codigo: "codigo-fuera-de-la-lista",
          queOcurrio: `usa un código que no está en la lista cerrada de ${tipo}s del guardián`,
          correccion:
            "Agregá el código a codigos.cjs (con su regla de línea en ubicacion.cjs) o usá uno existente.",
        });
      }
      for (const problema of problemas) {
        propias.push({
          codigo: problema.codigo,
          archivo: tieneArchivo(hallazgo) ? hallazgo.archivo : ARCHIVO_DEL_GUARDIAN,
          linea: 1,
          contrato: hallazgo.contrato ?? null,
          motivo: `Un ${tipo} con código «${hallazgo.codigo}» ${problema.queOcurrio}: ${hallazgo.motivo}`,
          correccion: problema.correccion,
        });
      }
      return problemas.length === 0;
    });
  const fallasValidas = revisar(fallas, "falla", CODIGOS_DE_FALLA);
  const avisosValidos = revisar(avisos, "aviso", CODIGOS_DE_AVISO);
  return { fallas: [...fallasValidas, ...propias], avisos: avisosValidos };
}

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
      donde: enTexto("const NIVELES"),
    });
    return resultado({ fallas, avisos, listaDeRutas, ahora, leer, parcial: true });
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
          donde: enTexto(`clase: "${clase}"`),
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
  avisos.push(...exclusiones.avisos);
  const clasesExcluidas = new Set(exclusiones.clases.keys());
  const rutasExcluidas = new Set(exclusiones.archivos.keys());

  // 3. Registro de contratos.
  let registro = null;
  try {
    registro = cargarRegistro(opciones.contratos);
  } catch (error) {
    if (!(error instanceof ErrorDeRegistro)) throw error;
    for (const { problema, contrato } of error.detalles) {
      fallas.push({
        codigo: "registro-invalido",
        archivo: ARCHIVO_DEL_REGISTRO,
        contrato: null,
        motivo: problema,
        correccion:
          "Completá o corregí el contrato en el registro; un contrato roto invalida todo el registro.",
        donde: enContrato(contrato),
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
            donde: enContrato(regla.contrato),
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
            donde: enContrato(regla.contrato),
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
    avisos.push(...excepciones.avisos);
    fallas.push(...excepciones.restantes.map(comoFalla));
  }

  return resultado({
    fallas,
    avisos,
    listaDeRutas,
    ahora,
    leer,
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
  const ubicar = crearUbicador(datos.leer);
  const comprobadas = comprobarUbicaciones(datos.fallas.map(ubicar), datos.avisos.map(ubicar));
  const fallas = ordenarFallas(comprobadas.fallas);
  const avisos = ordenarFallas(comprobadas.avisos);
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
      chequeos: CHEQUEOS.map(([codigo, descripcion, reglaDeLinea]) => ({
        codigo,
        descripcion,
        reglaDeLinea,
      })),
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
    // Los contratos que declaran no poder tener un detector de definición (registro.cjs): quedan a la vista.
    contratosSinDetectorDeDefinicion:
      datos.registro === null || datos.registro === undefined
        ? []
        : datos.registro.contratos
            .filter((contrato) => contrato.sinDetectorDeDefinicion !== undefined)
            .map((contrato) => ({
              contrato: contrato.id,
              motivo: contrato.sinDetectorDeDefinicion,
            })),
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
  return `${falla.archivo}:${falla.linea} · ${falla.contrato ?? "-"} · ${falla.motivo} · ${falla.correccion}`;
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
      donde: enJson(),
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
        donde: enArchivo(),
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

/** El valor de una opción `--nombre <valor>` o `--nombre=<valor>` (`undefined` si no está). */
function valorDeOpcion(argumentos, nombre) {
  const posicion = argumentos.indexOf(nombre);
  if (posicion >= 0) return argumentos[posicion + 1] ?? "";
  const conIgual = argumentos.find((argumento) => argumento.startsWith(`${nombre}=`));
  return conIgual === undefined ? undefined : conIgual.slice(nombre.length + 1);
}

/**
 * Vigilancia de la versión anterior: corre el `no-debilitar.cjs` DE LA CARPETA DE LA BASE contra el árbol
 * `raiz` (ver `no-debilitar.cjs`). Devuelve 0 si no hay debilitamientos, ≠ 0 si los hay o si la carpeta no
 * existe. Si la base todavía no trae ese verificador (la primera vez que se incorpora) avisa y devuelve 0:
 * no hay versión anterior que vigile.
 */
function vigilarConLaBase(carpetaDeLaBase, raiz) {
  const base = path.resolve(carpetaDeLaBase);
  if (carpetaDeLaBase === "" || !fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    process.stderr.write(`--base: «${carpetaDeLaBase}» no es una carpeta.\n`);
    return 2;
  }
  const verificador = path.join(base, "arquitectura/contratos/no-debilitar.cjs");
  if (!fs.existsSync(verificador)) {
    process.stdout.write(
      `AVISO ${base} no trae arquitectura/contratos/no-debilitar.cjs: no hay versión anterior que vigile.\n`,
    );
    return 0;
  }
  const resultado = spawnSync(process.execPath, [verificador, "--arbol", raiz], {
    stdio: "inherit",
  });
  return resultado.status ?? 1;
}

/** Corre el guardián sobre el repositorio de `raiz`, imprime y devuelve `true` si pasa. */
function correrGuardian(argumentos, raiz) {
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
    return false;
  }
  process.stdout.write(
    `Guardián de contratos: OK · ${informe.totales.rutasClasificadas} rutas clasificadas (${porClase}) · ` +
      `${informe.totales.unidadesDeclaradas} unidades declaradas · ${informe.totales.contratos} contratos · ` +
      `${avisos.length} avisos (${donde}).\n`,
  );
  return true;
}

/**
 * CLI. Opción `--base <carpeta>` (opcional): además de la corrida normal, corre la vigilancia de la versión
 * anterior (`vigilarConLaBase`) y sale ≠ 0 si cualquiera de las dos falla. Sin `--base` no cambia nada.
 * La CI llama a las dos cosas por separado (dos pasos del job `guardian`, para ver cada una en su registro);
 * esta opción es la forma de hacer lo mismo a mano en un solo comando.
 */
function principal(argumentos) {
  const raiz = path.resolve(__dirname, "../..");
  const base = valorDeOpcion(argumentos, "--base");
  const pasa = correrGuardian(argumentos, raiz);
  const salidaDeLaBase = base === undefined ? 0 : vigilarConLaBase(base, raiz);
  if (!pasa || salidaDeLaBase !== 0) process.exitCode = pasa ? salidaDeLaBase : 1;
}

module.exports = { ejecutar, cargarDelRepo, formatearFalla, vigilarConLaBase, valorDeOpcion };

if (require.main === module) principal(process.argv.slice(2));
