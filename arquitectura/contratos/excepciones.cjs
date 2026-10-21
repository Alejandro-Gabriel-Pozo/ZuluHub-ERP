/**
 * Excepciones gobernadas y exclusiones del análisis (contratos-arquitectonicos.md §2.4).
 *
 * Una EXCEPCIÓN silencia un hallazgo concreto de un contrato:
 *   { id, contrato, ruta, huella, motivo, responsable, aprobadoPor, creada, vence }
 *  - `ruta`: un archivo exacto (nada de comodines ni carpetas);
 *  - `huella`: SHA-256 del texto de la línea afectada (sin espacios en los extremos). Identifica la
 *    línea por lo que dice, no por su número: si la línea cambia, la excepción deja de calzar; si
 *    solo se mueve dentro del mismo archivo, sigue calzando; si pasa a otro archivo, no calza;
 *  - `creada` y `vence`: AAAA-MM-DD. Decisión del dueño: una excepción dura como máximo
 *    PLAZO_MAXIMO_DIAS (60) días. Falla si `vence` es anterior a `creada`, si `vence - creada` supera
 *    ese plazo o si `creada` es futura respecto del reloj. No hay excepciones eternas.
 * Una excepción silencia UN hallazgo (el primero que calce por archivo, contrato y huella), nunca más:
 * si la misma línea aparece dos veces en el archivo, hacen falta dos excepciones.
 *
 * Una EXCLUSIÓN saca archivos del análisis y usa el mismo rigor (motivo, responsable, aprobación,
 * vencimiento). Hay dos alcances: una clase entera (solo `generado` y `docs`) o un archivo exacto
 * cuya huella es la del archivo completo (si el archivo cambia, hay que volver a aprobarlo).
 *
 * El reloj es un parámetro (`ahora`): las pruebas lo inyectan. La fecha de hoy se toma en UTC.
 */
const crypto = require("node:crypto");
const { esRutaExacta } = require("./globs.cjs");
const { CLASES_EXCLUIBLES } = require("./clasificacion.cjs");

const ARCHIVO_DE_EXCEPCIONES = "arquitectura/contratos/excepciones.json";
const ARCHIVO_DE_EXCLUSIONES = "arquitectura/contratos/exclusiones.json";
const PLAZO_MAXIMO_DIAS = 60;
const PATRON_DE_HUELLA = /^[0-9a-f]{64}$/;

const CAMPOS_DE_EXCEPCION = [
  "id",
  "contrato",
  "ruta",
  "huella",
  "motivo",
  "responsable",
  "aprobadoPor",
  "creada",
  "vence",
];
const CAMPOS_COMUNES_DE_EXCLUSION = [
  "id",
  "alcance",
  "motivo",
  "responsable",
  "aprobadoPor",
  "creada",
  "vence",
];
const CAMPOS_DE_EXCLUSION_DE_CLASE = [...CAMPOS_COMUNES_DE_EXCLUSION, "clase"];
const CAMPOS_DE_EXCLUSION_DE_RUTA = [...CAMPOS_COMUNES_DE_EXCLUSION, "ruta", "huella"];

const esTextoNoVacio = (valor) => typeof valor === "string" && valor.trim() !== "";
const esObjetoPlano = (valor) =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

const sha256 = (contenido) => crypto.createHash("sha256").update(contenido).digest("hex");

/** Huella de una línea: SHA-256 de su texto sin espacios en los extremos. */
const huellaDeLinea = (texto) => sha256(texto.trim());

/** Huella de un archivo entero (Buffer o texto). */
const huellaDeArchivo = (contenido) => sha256(contenido);

/** Día de hoy (AAAA-MM-DD, UTC) a partir del reloj inyectado. */
function diaDe(ahora) {
  if (!(ahora instanceof Date) || Number.isNaN(ahora.getTime())) {
    throw new Error("el reloj («ahora») tiene que ser una fecha válida");
  }
  return ahora.toISOString().slice(0, 10);
}

/** `true` si el texto es una fecha real del calendario con forma AAAA-MM-DD. */
function esFechaValida(texto) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (partes === null) return false;
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
  );
}

const diasEntre = (desde, hasta) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);

/**
 * Chequeos que comparten excepciones y exclusiones: campos, vencimiento y forma de la huella.
 * Devuelve problemas `{ codigo, motivo, correccion }` (vacío = válida).
 */
function problemasComunes(entrada, campos, hoy, nombre) {
  if (!esObjetoPlano(entrada)) {
    return [
      {
        codigo: "excepcion-invalida",
        motivo: `${nombre} no es un objeto.`,
        correccion: "Corregí el formato del archivo.",
      },
    ];
  }
  const problemas = [];
  const rotulo = esTextoNoVacio(entrada.id) ? `${nombre} «${entrada.id}»` : nombre;
  for (const clave of Object.keys(entrada)) {
    if (!campos.includes(clave)) {
      problemas.push({
        codigo: "excepcion-invalida",
        motivo: `${rotulo}: «${clave}» no es un campo permitido (una ampliación escondida no vale).`,
        correccion: `Dejá solo estos campos: ${campos.join(", ")}.`,
      });
    }
  }
  for (const campo of campos) {
    if (!esTextoNoVacio(entrada[campo])) {
      problemas.push({
        codigo: "excepcion-invalida",
        motivo: `${rotulo}: el campo «${campo}» falta o está vacío.`,
        correccion: `Completá «${campo}»: toda ${nombre.toLowerCase()} lleva motivo, responsable, aprobación y vencimiento.`,
      });
    }
  }
  const creadaValida = esTextoNoVacio(entrada.creada) && esFechaValida(entrada.creada);
  const venceValida = esTextoNoVacio(entrada.vence) && esFechaValida(entrada.vence);
  for (const campo of ["creada", "vence"]) {
    if (esTextoNoVacio(entrada[campo]) && !esFechaValida(entrada[campo])) {
      problemas.push({
        codigo: "excepcion-invalida",
        motivo: `${rotulo}: «${campo}» («${entrada[campo]}») no es una fecha válida AAAA-MM-DD.`,
        correccion: "Poné una fecha real con el formato AAAA-MM-DD.",
      });
    }
  }
  if (creadaValida && entrada.creada > hoy) {
    problemas.push({
      codigo: "excepcion-creada-futura",
      motivo: `${rotulo}: «creada» (${entrada.creada}) es posterior a hoy (${hoy}).`,
      correccion: "Poné la fecha en que realmente se aprobó, no una futura.",
    });
  }
  if (creadaValida && venceValida) {
    if (entrada.vence < entrada.creada) {
      problemas.push({
        codigo: "excepcion-vence-antes-de-creada",
        motivo: `${rotulo}: vence el ${entrada.vence}, antes de su creación (${entrada.creada}).`,
        correccion: "Corregí las fechas: «vence» tiene que ser igual o posterior a «creada».",
      });
    } else if (diasEntre(entrada.creada, entrada.vence) > PLAZO_MAXIMO_DIAS) {
      problemas.push({
        codigo: "excepcion-plazo-excesivo",
        motivo: `${rotulo}: dura ${diasEntre(entrada.creada, entrada.vence)} días (de ${entrada.creada} a ${entrada.vence}) y el máximo es ${PLAZO_MAXIMO_DIAS}.`,
        correccion: `Acortá el vencimiento: toda excepción o exclusión dura como máximo ${PLAZO_MAXIMO_DIAS} días.`,
      });
    }
  }
  if (venceValida && entrada.vence < hoy) {
    problemas.push({
      codigo: "excepcion-vencida",
      motivo: `${rotulo}: venció el ${entrada.vence} (hoy es ${hoy}).`,
      correccion:
        "Corregí lo que silenciaba, o renovala con nueva aprobación y un vencimiento próximo.",
    });
  }
  if (
    campos.includes("huella") &&
    esTextoNoVacio(entrada.huella) &&
    !PATRON_DE_HUELLA.test(entrada.huella)
  ) {
    problemas.push({
      codigo: "excepcion-invalida",
      motivo: `${rotulo}: «huella» no es un SHA-256 en hexadecimal minúscula (64 caracteres).`,
      correccion: "Copiá la huella que imprime el guardián junto al hallazgo.",
    });
  }
  if (campos.includes("ruta") && esTextoNoVacio(entrada.ruta) && !esRutaExacta(entrada.ruta)) {
    problemas.push({
      codigo: "excepcion-ruta-no-exacta",
      motivo: `${rotulo}: «ruta» («${entrada.ruta}») no es un archivo exacto (sin comodines, sin carpetas, sin «..»).`,
      correccion:
        "Una excepción cubre un solo archivo: escribí su ruta completa. Si son varios, una excepción por hallazgo.",
    });
  }
  return problemas;
}

const aFalla = (problema, archivo, contrato) => ({
  codigo: problema.codigo,
  archivo,
  contrato,
  motivo: problema.motivo,
  correccion: problema.correccion,
});

/**
 * Valida las excepciones y las aplica a los hallazgos. Solo silencia lo que cumple TODO; una
 * excepción inválida no silencia nada y además falla.
 *
 * @param {unknown} lista Contenido de `excepciones.json`.
 * @param {{
 *   rutas: Set<string>,
 *   idsDeContratos: Set<string>,
 *   ahora: Date,
 *   hallazgos: { codigo: string, contrato: string, archivo: string, linea?: number, huella?: string }[],
 * }} contexto
 */
function aplicarExcepciones(lista, contexto) {
  const { rutas, idsDeContratos, ahora, hallazgos } = contexto;
  const fallas = [];
  const aplicadas = [];
  const consumidos = new Set();
  if (!Array.isArray(lista)) {
    fallas.push({
      codigo: "excepcion-invalida",
      archivo: ARCHIVO_DE_EXCEPCIONES,
      contrato: null,
      motivo: "El archivo de excepciones tiene que ser una lista.",
      correccion: "Dejalo como una lista JSON (vacía si no hay excepciones).",
    });
    return { fallas, aplicadas, restantes: hallazgos };
  }
  const hoy = diaDe(ahora);
  const ids = new Set();
  for (const entrada of lista) {
    const contrato =
      esObjetoPlano(entrada) && esTextoNoVacio(entrada.contrato) ? entrada.contrato : null;
    const problemas = problemasComunes(entrada, CAMPOS_DE_EXCEPCION, hoy, "Excepción");
    if (esObjetoPlano(entrada) && esTextoNoVacio(entrada.id)) {
      if (ids.has(entrada.id)) {
        problemas.push({
          codigo: "excepcion-invalida",
          motivo: `Excepción «${entrada.id}»: el id está repetido.`,
          correccion: "Cada excepción lleva un id propio.",
        });
      }
      ids.add(entrada.id);
    }
    if (problemas.length > 0) {
      for (const problema of problemas)
        fallas.push(aFalla(problema, ARCHIVO_DE_EXCEPCIONES, contrato));
      continue;
    }
    if (!idsDeContratos.has(entrada.contrato)) {
      fallas.push({
        codigo: "excepcion-contrato-inexistente",
        archivo: ARCHIVO_DE_EXCEPCIONES,
        contrato: entrada.contrato,
        motivo: `La excepción «${entrada.id}» apunta al contrato «${entrada.contrato}», que no está en el registro.`,
        correccion: "Borrala o corregí el id del contrato.",
      });
      continue;
    }
    if (!rutas.has(entrada.ruta)) {
      fallas.push({
        codigo: "excepcion-obsoleta",
        archivo: ARCHIVO_DE_EXCEPCIONES,
        contrato: entrada.contrato,
        motivo: `La excepción «${entrada.id}» apunta a «${entrada.ruta}», que ya no es un archivo versionado.`,
        correccion: "Borrá la excepción (el archivo se movió o se eliminó).",
      });
      continue;
    }
    const delArchivo = hallazgos
      .map((hallazgo, posicion) => ({ hallazgo, posicion }))
      .filter(
        ({ hallazgo }) =>
          hallazgo.archivo === entrada.ruta &&
          hallazgo.contrato === entrada.contrato &&
          hallazgo.huella !== undefined,
      );
    const elegido = delArchivo.find(
      ({ hallazgo, posicion }) => hallazgo.huella === entrada.huella && !consumidos.has(posicion),
    );
    if (elegido !== undefined) {
      consumidos.add(elegido.posicion);
      aplicadas.push({
        id: entrada.id,
        contrato: entrada.contrato,
        ruta: entrada.ruta,
        linea: elegido.hallazgo.linea,
        huella: entrada.huella,
        creada: entrada.creada,
        vence: entrada.vence,
        motivo: entrada.motivo,
        responsable: entrada.responsable,
        aprobadoPor: entrada.aprobadoPor,
      });
    } else if (delArchivo.length > 0) {
      fallas.push({
        codigo: "excepcion-huella-cambiada",
        archivo: entrada.ruta,
        contrato: entrada.contrato,
        motivo: `La excepción «${entrada.id}» ya no calza: la línea afectada cambió o ya está cubierta por otra excepción (la huella aprobada no coincide con la de ningún hallazgo del archivo).`,
        correccion:
          "Revisá el hallazgo nuevo; si sigue justificado, pedí una nueva aprobación y actualizá la huella.",
      });
    } else {
      fallas.push({
        codigo: "excepcion-obsoleta",
        archivo: entrada.ruta,
        contrato: entrada.contrato,
        motivo: `La excepción «${entrada.id}» no silencia ningún hallazgo: el archivo ya no tiene el problema.`,
        correccion:
          "Borrá la excepción: las excepciones que no se usan quedan como puertas abiertas.",
      });
    }
  }
  const restantes = hallazgos.filter((_, posicion) => !consumidos.has(posicion));
  return { fallas, aplicadas, restantes };
}

/**
 * Valida las exclusiones del análisis y dice qué clases y rutas quedan fuera. Una exclusión inválida,
 * vencida u obsoleta NO excluye nada (esa parte del repo se analiza) y además falla.
 *
 * @param {unknown} lista Contenido de `exclusiones.json`.
 * @param {{
 *   rutas: Set<string>,
 *   porRuta: Map<string, string>,
 *   porClase: Record<string, string[]>,
 *   leer: (ruta: string) => Buffer | string | null,
 *   ahora: Date,
 * }} contexto
 */
function procesarExclusiones(lista, contexto) {
  const { rutas, porRuta, porClase, leer, ahora } = contexto;
  const fallas = [];
  const clases = new Map();
  const archivos = new Map();
  if (!Array.isArray(lista)) {
    fallas.push({
      codigo: "excepcion-invalida",
      archivo: ARCHIVO_DE_EXCLUSIONES,
      contrato: null,
      motivo: "El archivo de exclusiones tiene que ser una lista.",
      correccion: "Dejalo como una lista JSON.",
    });
    return { fallas, clases, archivos };
  }
  const hoy = diaDe(ahora);
  const ids = new Set();
  for (const entrada of lista) {
    const alcance = esObjetoPlano(entrada) ? entrada.alcance : undefined;
    const campos = alcance === "ruta" ? CAMPOS_DE_EXCLUSION_DE_RUTA : CAMPOS_DE_EXCLUSION_DE_CLASE;
    const problemas = problemasComunes(entrada, campos, hoy, "Exclusión");
    if (esObjetoPlano(entrada) && alcance !== "clase" && alcance !== "ruta") {
      problemas.push({
        codigo: "excepcion-invalida",
        motivo: "Exclusión: «alcance» tiene que ser «clase» o «ruta».",
        correccion: "Indicá si excluye una clase (generado o docs) o un archivo exacto.",
      });
    }
    if (esObjetoPlano(entrada) && esTextoNoVacio(entrada.id)) {
      if (ids.has(entrada.id)) {
        problemas.push({
          codigo: "excepcion-invalida",
          motivo: `Exclusión «${entrada.id}»: el id está repetido.`,
          correccion: "Cada exclusión lleva un id propio.",
        });
      }
      ids.add(entrada.id);
    }
    if (problemas.length > 0) {
      for (const problema of problemas)
        fallas.push(aFalla(problema, ARCHIVO_DE_EXCLUSIONES, "exclusión"));
      continue;
    }
    if (alcance === "clase") {
      if (!CLASES_EXCLUIBLES.includes(entrada.clase)) {
        fallas.push({
          codigo: "excepcion-invalida",
          archivo: ARCHIVO_DE_EXCLUSIONES,
          contrato: "exclusión",
          motivo: `La exclusión «${entrada.id}» saca la clase «${entrada.clase}» del análisis, y solo se pueden excluir: ${CLASES_EXCLUIBLES.join(", ")}.`,
          correccion:
            "Borrala: el código de aplicación, de pruebas y de configuración siempre se analiza.",
        });
      } else if (clases.has(entrada.clase)) {
        fallas.push({
          codigo: "excepcion-invalida",
          archivo: ARCHIVO_DE_EXCLUSIONES,
          contrato: "exclusión",
          motivo: `La clase «${entrada.clase}» ya está excluida por otra entrada (la «${entrada.id}» la repite).`,
          correccion: "Dejá una sola exclusión por clase.",
        });
      } else if ((porClase[entrada.clase] ?? []).length === 0) {
        fallas.push({
          codigo: "excepcion-obsoleta",
          archivo: ARCHIVO_DE_EXCLUSIONES,
          contrato: "exclusión",
          motivo: `La exclusión «${entrada.id}» no saca nada del análisis: la clase «${entrada.clase}» no tiene archivos.`,
          correccion: "Borrala.",
        });
      } else {
        clases.set(entrada.clase, entrada);
      }
      continue;
    }
    // alcance «ruta»
    const claseDeLaRuta = porRuta.get(entrada.ruta);
    const contenido = rutas.has(entrada.ruta) ? leer(entrada.ruta) : null;
    if (claseDeLaRuta === undefined || contenido === null) {
      fallas.push({
        codigo: "excepcion-obsoleta",
        archivo: ARCHIVO_DE_EXCLUSIONES,
        contrato: "exclusión",
        motivo: `La exclusión «${entrada.id}» apunta a «${entrada.ruta}», que no es un archivo versionado y clasificado.`,
        correccion: "Borrala (el archivo se movió o se eliminó).",
      });
    } else if (CLASES_EXCLUIBLES.includes(claseDeLaRuta)) {
      fallas.push({
        codigo: "excepcion-obsoleta",
        archivo: ARCHIVO_DE_EXCLUSIONES,
        contrato: "exclusión",
        motivo: `La exclusión «${entrada.id}» es innecesaria: «${entrada.ruta}» es de la clase «${claseDeLaRuta}», que ya se excluye por clase.`,
        correccion: "Borrala.",
      });
    } else if (archivos.has(entrada.ruta)) {
      fallas.push({
        codigo: "excepcion-invalida",
        archivo: ARCHIVO_DE_EXCLUSIONES,
        contrato: "exclusión",
        motivo: `«${entrada.ruta}» ya está excluido por otra entrada (la «${entrada.id}» lo repite).`,
        correccion: "Dejá una sola exclusión por archivo.",
      });
    } else if (huellaDeArchivo(contenido) !== entrada.huella) {
      fallas.push({
        codigo: "excepcion-huella-cambiada",
        archivo: entrada.ruta,
        contrato: "exclusión",
        motivo: `La exclusión «${entrada.id}» ya no calza: el archivo cambió desde que se aprobó.`,
        correccion:
          "Revisá el archivo; si sigue justificado, pedí una nueva aprobación y actualizá la huella.",
      });
    } else {
      archivos.set(entrada.ruta, entrada);
    }
  }
  return { fallas, clases, archivos };
}

module.exports = {
  ARCHIVO_DE_EXCEPCIONES,
  ARCHIVO_DE_EXCLUSIONES,
  aplicarExcepciones,
  procesarExclusiones,
  huellaDeLinea,
};
