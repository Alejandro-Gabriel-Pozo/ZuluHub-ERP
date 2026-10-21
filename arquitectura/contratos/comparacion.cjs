/**
 * Comparación entre lo que cada unidad DECLARA y lo que el código REALMENTE usa
 * (contratos-arquitectonicos.md §2.3 y §3).
 *
 * Los detectores del registro devuelven hallazgos línea por línea sobre cada archivo cuya clase
 * analizan. De ahí se deduce el uso real: agregar una etiqueta en `contratos.json` NO silencia un uso
 * real, y declarar sin usar es una declaración falsa. Se reportan:
 *  - uso-sin-declarar: la unidad usa el contrato y no lo declara (archivo:línea del uso);
 *  - no-usa-falso: la unidad declara no depender de nada (`noUsa`) y hay un uso;
 *  - declaracion-falsa: declarada en `usa` y sin ningún uso (falla si el contrato lo exige, si no es aviso);
 *  - definicion-fuera-de-la-fuente: un detector de `definicion` encuentra la definición en un archivo
 *    que no es la fuente de verdad;
 *  - contrato-sin-fuente: el archivo de la fuente no existe (o no contiene el nombre que dice).
 *
 * Límite general: los detectores son de texto (ver `detectores.cjs`); lo que ningún detector reconoce
 * no se ve, y cada contrato dice en `limites` cómo se cubre.
 */
const { huellaDeLinea } = require("./excepciones.cjs");
const { unidadDe } = require("./declaraciones.cjs");
const { ARCHIVO_DEL_REGISTRO } = require("./registro.cjs");
const { enArchivo, enContrato, enJson } = require("./ubicacion.cjs");

/** Archivos que no son texto: se clasifican pero un detector de texto no los lee. */
const EXTENSIONES_BINARIAS = /\.(png|jpe?g|webp|gif|ico|heic|woff2?|ttf|otf|pdf|zip)$/i;
const LARGO_MAXIMO_DEL_TEXTO = 120;

const recortar = (texto) => {
  const limpio = texto.trim();
  return limpio.length > LARGO_MAXIMO_DEL_TEXTO
    ? `${limpio.slice(0, LARGO_MAXIMO_DEL_TEXTO)}…`
    : limpio;
};

const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ¿El archivo de la fuente menciona la exportación o la variable que dice contener? */
function mencionaLaFuente(contenido, fuente) {
  if (fuente.variable !== undefined) return contenido.includes(fuente.variable);
  return new RegExp(`(?<![\\w$])${escapar(fuente.exportacion)}(?![\\w$])`).test(contenido);
}

function validarCoincidencias(coincidencias, lineas) {
  if (!Array.isArray(coincidencias)) return "devolvió algo que no es una lista";
  for (const coincidencia of coincidencias) {
    if (
      typeof coincidencia !== "object" ||
      coincidencia === null ||
      !Number.isInteger(coincidencia.linea) ||
      coincidencia.linea < 1 ||
      coincidencia.linea > lineas.length
    ) {
      return `devolvió una línea fuera del archivo (tiene ${lineas.length} líneas): ${JSON.stringify(coincidencia)}`;
    }
  }
  return null;
}

/**
 * @param {{
 *   registro: { contratos: object[] },
 *   porRuta: Map<string, string>,
 *   rutas: Set<string>,
 *   leer: (ruta: string) => Buffer | string | null,
 *   declaraciones: Map<string, { usa: string[], noUsa: string | null }>,
 *   clasesExcluidas: Set<string>,
 *   rutasExcluidas: Set<string>,
 * }} datos
 */
function comparar(datos) {
  const { registro, porRuta, rutas, leer, declaraciones, clasesExcluidas, rutasExcluidas } = datos;
  const hallazgos = [];
  const avisos = [];
  const fallas = [];
  const escaneadasPorClase = {};
  const omitidasPorClase = {};
  const usosFueraDeUnidades = [];

  // (e) La fuente de verdad tiene que existir.
  for (const contrato of registro.contratos) {
    const { archivo } = contrato.fuenteDeVerdad;
    const nombre = contrato.fuenteDeVerdad.exportacion ?? contrato.fuenteDeVerdad.variable;
    const contenido = rutas.has(archivo) ? leer(archivo) : null;
    if (contenido === null) {
      fallas.push({
        codigo: "contrato-sin-fuente",
        archivo,
        contrato: contrato.id,
        motivo: `El archivo de la fuente de verdad del contrato «${contrato.id}» no existe.`,
        correccion: `Creá ${archivo} con «${nombre}» o corregí fuenteDeVerdad.archivo en el registro.`,
        donde: enArchivo(),
      });
    } else if (!mencionaLaFuente(contenido.toString(), contrato.fuenteDeVerdad)) {
      fallas.push({
        codigo: "contrato-sin-fuente",
        archivo,
        contrato: contrato.id,
        motivo: `El archivo existe pero no contiene «${nombre}», la fuente de verdad que declara el contrato «${contrato.id}».`,
        correccion: `Definí «${nombre}» en ${archivo} o corregí la fuente en el registro.`,
        donde: enArchivo(),
      });
    }
  }

  // Detectores por clase.
  const reglas = [];
  const paresPorClase = new Map();
  for (const contrato of registro.contratos) {
    contrato.deteccion.forEach((detector, indice) => {
      reglas.push({
        contrato: contrato.id,
        detector: detector.nombre ?? `detector ${indice + 1}`,
        tipo: detector.tipo,
        clases: [...detector.clases],
      });
      for (const clase of detector.clases) {
        if (!paresPorClase.has(clase)) paresPorClase.set(clase, []);
        paresPorClase.get(clase).push({ contrato, detector, indice });
      }
    });
  }

  const usos = new Map(); // `${unidad}\u0000${contrato}` → usos[]
  const hallazgosVistos = new Set();
  const definiciones = [];
  for (const ruta of [...porRuta.keys()].sort()) {
    const clase = porRuta.get(ruta);
    if (clasesExcluidas.has(clase) || rutasExcluidas.has(ruta)) continue;
    const pares = paresPorClase.get(clase) ?? [];
    if (pares.length === 0) continue;
    if (EXTENSIONES_BINARIAS.test(ruta)) {
      omitidasPorClase[clase] = (omitidasPorClase[clase] ?? 0) + 1;
      continue;
    }
    const contenido = rutas.has(ruta) ? leer(ruta) : null;
    if (contenido === null) {
      fallas.push({
        codigo: "ruta-ilegible",
        archivo: ruta,
        contrato: null,
        motivo: "No se pudo leer el archivo para analizarlo.",
        correccion: "Verificá que el archivo exista en el árbol de trabajo.",
        donde: enArchivo(),
      });
      continue;
    }
    const texto = contenido.toString();
    const lineas = texto.split(/\r\n|\n/);
    escaneadasPorClase[clase] = (escaneadasPorClase[clase] ?? 0) + 1;
    const unidad = unidadDe(ruta);
    for (const { contrato, detector, indice } of pares) {
      let coincidencias;
      try {
        coincidencias = detector.reconoce(texto, ruta);
      } catch (error) {
        fallas.push({
          codigo: "detector-invalido",
          archivo: ARCHIVO_DEL_REGISTRO,
          contrato: contrato.id,
          motivo: `El detector ${indice + 1} del contrato «${contrato.id}» lanzó un error con «${ruta}»: ${String(error?.message ?? error)}.`,
          correccion:
            "Corregí el detector: tiene que ser una función pura que no falla con ningún archivo.",
          donde: enContrato(contrato.id),
        });
        continue;
      }
      const problema = validarCoincidencias(coincidencias, lineas);
      if (problema !== null) {
        fallas.push({
          codigo: "detector-invalido",
          archivo: ARCHIVO_DEL_REGISTRO,
          contrato: contrato.id,
          motivo: `El detector ${indice + 1} del contrato «${contrato.id}» ${problema} (en «${ruta}»).`,
          correccion:
            "Corregí el detector: tiene que devolver [{linea, texto}] con líneas reales (desde 1).",
          donde: enContrato(contrato.id),
        });
        continue;
      }
      for (const { linea } of coincidencias) {
        const clave = `${contrato.id}\u0000${detector.tipo}\u0000${ruta}\u0000${linea}`;
        if (hallazgosVistos.has(clave)) continue;
        hallazgosVistos.add(clave);
        const hallazgo = {
          contrato: contrato.id,
          archivo: ruta,
          linea,
          huella: huellaDeLinea(lineas[linea - 1]),
          texto: recortar(lineas[linea - 1]),
          unidad,
        };
        if (detector.tipo === "definicion") {
          definiciones.push(hallazgo);
        } else {
          if (unidad === null) usosFueraDeUnidades.push(hallazgo);
          const clave2 = `${unidad}\u0000${contrato.id}`;
          if (!usos.has(clave2)) usos.set(clave2, []);
          usos.get(clave2).push(hallazgo);
        }
      }
    }
  }

  const sugerirExcepcion = (hallazgo) =>
    ` Si fuera una excepción aprobada y con vencimiento: contrato «${hallazgo.contrato}», huella ${hallazgo.huella}.`;

  // (d) Definiciones fuera de la fuente de verdad.
  for (const definicion of definiciones) {
    const contrato = registro.porId.get(definicion.contrato);
    if (definicion.archivo === contrato.fuenteDeVerdad.archivo) continue;
    hallazgos.push({
      ...definicion,
      codigo: "definicion-fuera-de-la-fuente",
      motivo: `El contrato «${contrato.id}» se define acá (${definicion.texto}) y su única fuente de verdad es ${contrato.fuenteDeVerdad.archivo}.`,
      correccion: `Importá el valor desde ${contrato.fuenteDeVerdad.archivo} en vez de copiarlo.${sugerirExcepcion(definicion)}`,
    });
  }

  // (a)(c) Usos reales contra la declaración, y (b) declaraciones sin uso.
  for (const [unidad, declaracion] of declaraciones) {
    const declarados = new Set(declaracion.usa);
    for (const contrato of registro.contratos) {
      const delContrato = usos.get(`${unidad}\u0000${contrato.id}`) ?? [];
      if (declarados.size === 0) {
        for (const uso of delContrato) {
          hallazgos.push({
            ...uso,
            codigo: "no-usa-falso",
            motivo: `La unidad «${unidad}» declara no depender de ningún contrato («${declaracion.noUsa}») pero usa «${contrato.id}» (${uso.texto}).`,
            correccion: `Declaralo en "usa" de ${unidad}/contratos.json y quitá el "noUsa", o eliminá el uso.${sugerirExcepcion(uso)}`,
          });
        }
      } else if (!declarados.has(contrato.id)) {
        for (const uso of delContrato) {
          hallazgos.push({
            ...uso,
            codigo: "uso-sin-declarar",
            motivo: `La unidad «${unidad}» usa el contrato «${contrato.id}» (${uso.texto}) y no lo declara.`,
            correccion: `Agregá «${contrato.id}» a "usa" en ${unidad}/contratos.json, o eliminá el uso.${sugerirExcepcion(uso)}`,
          });
        }
      } else if (delContrato.length === 0) {
        const falla = {
          codigo: "declaracion-falsa",
          archivo: `${unidad}/contratos.json`,
          contrato: contrato.id,
          motivo: `La unidad «${unidad}» declara usar «${contrato.id}» pero el código no tiene ningún uso detectable.`,
          correccion: `Quitá «${contrato.id}» de "usa" en ${unidad}/contratos.json (una etiqueta sin uso real es una declaración falsa).`,
          donde: enJson("usa", declaracion.usa.indexOf(contrato.id)),
        };
        if (contrato.bloqueaDeclaracionFalsa) fallas.push(falla);
        else avisos.push(falla);
      }
    }
  }

  return {
    hallazgos,
    fallas,
    avisos,
    reglas,
    escaneadasPorClase,
    omitidasPorClase,
    usosFueraDeUnidades,
  };
}

module.exports = { comparar };
