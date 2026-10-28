/**
 * Batería de evasión (red team) del guardián: validación del catálogo y evaluación de cada caso
 * (contratos-arquitectonicos.md §11 y §11.1, G6).
 *
 * El catálogo es `arquitectura/contratos/evasiones.json`: una lista de CASOS, cada uno un intento de
 * evadir al guardián (qué se le hace a un repositorio sintético, qué debería detectarlo y en qué
 * estado está). Una ruta de evasión nueva es una entrada nueva: no hay código nuevo por caso.
 *
 * Tres ESTADOS, con campos propios (cualquier otro campo es una falla: un caso `exigido` no puede
 * traer campos de brecha o de riesgo):
 *  - `exigido`: el cambio DEBE bloquearse como dice `esperado`. Si pasa, o se bloquea de otra forma, falla.
 *  - `brecha-abierta`: hoy el cambio PASA sin detección (el caso lo prueba y tiene que seguir pasando).
 *    Campos: `responsable`, `severidad`, `justificacion`, `mitigacion`, `creada`, `vence` (como mucho
 *    PLAZO_DE_BRECHA días después de `creada`). Se PERMITE pero se REPORTA en cada corrida (aviso con el id,
 *    la severidad y los días que faltan; aviso especial desde DIAS_DE_AVISO_DE_BRECHA días); falla si
 *    venció, y falla si el caso deja de pasar («la brecha se cerró: pasalo a `exigido`»).
 *  - `riesgo-aceptado`: lo aceptó el dueño (§11.1) para lo que exige editar la maquinaria o para los
 *    límites declarados de los detectores de texto. Campos: `aprobadoPor`, `motivo`, `creada`,
 *    `revisar` (como mucho PLAZO_DE_RIESGO días después de `creada`; aviso desde
 *    DIAS_DE_AVISO_DE_RIESGO días antes; falla si pasó). Mismo contrato que la brecha: tiene que seguir
 *    pasando sin detección y, si deja de hacerlo, hay que pasarlo a `exigido`.
 *
 * Dos mitades, las dos con falla localizada en el JSON (archivo y línea de la clave ofensora):
 *  - `validarCatalogo`: la forma del catálogo, los campos de cada estado y los vencimientos. La corre el
 *    guardián en cada corrida, así que las brechas se reportan siempre.
 *  - `evaluarResultado`: compara lo que pasó al correr el caso (`pasa` o `bloquea`, con las fallas) con lo
 *    que su estado exige. La corre la prueba de la batería (`test/arquitectura/guardian-evasion.test.ts`),
 *    que arma el repositorio sintético de cada caso y corre guardián y vigilancia como la CI.
 *
 * Puro: recibe los datos y el reloj; no toca el disco ni el entorno.
 */
const { esFechaValida, diaDe, diasEntre } = require("./excepciones.cjs");
const { enJson } = require("./ubicacion.cjs");

const ARCHIVO_DEL_CATALOGO = "arquitectura/contratos/evasiones.json";

/** Las vías de evasión del catálogo (§11): cada una tiene que tener al menos un caso. */
const VIAS = Object.freeze([
  "workflow-ci",
  "filtros",
  "exclusiones",
  "renombrar-mover",
  "formato-no-soportado",
  "declaraciones-excepciones",
  "modificar-guardian",
  "ruta-alternativa",
  "no-se-pudo-interpretar",
]);
const ESTADOS = Object.freeze(["exigido", "brecha-abierta", "riesgo-aceptado"]);
const SEVERIDADES = Object.freeze(["baja", "media", "alta", "critica"]);
const TIPOS_DE_ESPERADO = Object.freeze(["bloquea", "exige-excepcion"]);
/** Con qué repositorio sintético arranca el caso (los arma la prueba): sano, o con un contrato de ejemplo. */
const PLANTILLAS = Object.freeze(["sano", "con-contrato", "con-contrato-y-pruebas"]);
/** Operaciones declarativas sobre el repositorio sintético (la prueba las aplica; ver `arquitectura/LEEME-evasiones.md`). */
const OPERACIONES = Object.freeze([
  "escribir",
  "reemplazar",
  "borrar",
  "renombrar",
  "symlink",
  "anexar",
  "json-poner",
  "json-agregar",
  "commit",
  "checkout",
]);

const PLAZO_DE_BRECHA = 60;
const DIAS_DE_AVISO_DE_BRECHA = 14;
const PLAZO_DE_RIESGO = 180;
const DIAS_DE_AVISO_DE_RIESGO = 30;

const PATRON_DE_ID = /^EV-\d{3}$/;
const CAMPOS_COMUNES = Object.freeze([
  "id",
  "via",
  "titulo",
  "construccion",
  "controlEsperado",
  "esperado",
  "estado",
]);
const CAMPOS_OPCIONALES = Object.freeze(["plantilla", "construccionBase", "reloj", "sinGit"]);
const CAMPOS_DE_ESTADO = Object.freeze({
  exigido: Object.freeze([]),
  "brecha-abierta": Object.freeze([
    "responsable",
    "severidad",
    "justificacion",
    "mitigacion",
    "creada",
    "vence",
  ]),
  "riesgo-aceptado": Object.freeze(["aprobadoPor", "motivo", "creada", "revisar"]),
});
const CAMPOS_DE_ESPERADO = Object.freeze({
  bloquea: Object.freeze(["tipo", "codigo", "archivo", "linea"]),
  "exige-excepcion": Object.freeze(["tipo"]),
});

const esTextoNoVacio = (valor) => typeof valor === "string" && valor.trim() !== "";
const esObjetoPlano = (valor) =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

/** Un problema de forma del caso: `campo` es la clave ofensora (sin `campo`, el caso entero). */
const invalida = (motivo, correccion, campo) => ({
  codigo: "evasion-invalida",
  motivo,
  correccion,
  campo,
});

/** Los problemas de `esperado` (vacío = válido). */
function problemasDeEsperado(esperado) {
  if (!esObjetoPlano(esperado) || !TIPOS_DE_ESPERADO.includes(esperado.tipo)) {
    return [
      invalida(
        `«esperado» tiene que ser un objeto con «tipo» ${TIPOS_DE_ESPERADO.join(" o ")}.`,
        'Escribí, por ejemplo, { "tipo": "bloquea", "codigo": "ruta-sin-clase", "archivo": "x.ts" } o { "tipo": "exige-excepcion" }.',
        "esperado",
      ),
    ];
  }
  const permitidos = CAMPOS_DE_ESPERADO[esperado.tipo];
  const problemas = Object.keys(esperado)
    .filter((clave) => !permitidos.includes(clave))
    .map((clave) =>
      invalida(
        `«esperado» trae «${clave}», que no corresponde al tipo «${esperado.tipo}».`,
        `Dejá en «esperado» solo: ${permitidos.join(", ")}.`,
        "esperado",
      ),
    );
  if (esperado.tipo === "bloquea") {
    for (const campo of ["codigo", "archivo"]) {
      if (!esTextoNoVacio(esperado[campo])) {
        problemas.push(
          invalida(
            `«esperado» de tipo «bloquea» no tiene «${campo}» (falta o está vacío).`,
            `Decí qué ${campo} tiene que tener la falla que bloquea el cambio.`,
            "esperado",
          ),
        );
      }
    }
    if (
      esperado.linea !== undefined &&
      !(Number.isInteger(esperado.linea) && esperado.linea >= 1)
    ) {
      problemas.push(
        invalida(
          "«esperado.linea» tiene que ser un entero desde 1 (o no estar).",
          "Poné la línea exacta de la falla o sacá «linea».",
          "esperado",
        ),
      );
    }
  }
  return problemas;
}

/** Los problemas de las operaciones de una construcción (`campo`: cuál de las dos listas es). */
function problemasDeConstruccion(operaciones, campo) {
  if (!Array.isArray(operaciones) || !operaciones.every(esObjetoPlano)) {
    return [
      invalida(
        `«${campo}» tiene que ser una lista de operaciones (objetos).`,
        "Escribí una lista, vacía si el caso no cambia nada.",
        campo,
      ),
    ];
  }
  return operaciones
    .filter((operacion) => !OPERACIONES.includes(operacion.op))
    .map((operacion) =>
      invalida(
        `«${campo}» trae una operación desconocida («${String(operacion.op)}»).`,
        `Las operaciones son: ${OPERACIONES.join(", ")}.`,
        campo,
      ),
    );
}

/** Los problemas de los campos de cada estado (vacío = en regla). */
function problemasDelEstado(caso) {
  const propios = CAMPOS_DE_ESTADO[caso.estado];
  const problemas = [];
  for (const clave of Object.keys(caso)) {
    const permitido =
      CAMPOS_COMUNES.includes(clave) ||
      CAMPOS_OPCIONALES.includes(clave) ||
      propios.includes(clave);
    if (!permitido) {
      problemas.push(
        invalida(
          `«${clave}» no es un campo permitido en un caso «${caso.estado}».`,
          `Un caso «${caso.estado}» lleva solo estos campos propios: ${propios.length === 0 ? "ninguno" : propios.join(", ")}.`,
          clave,
        ),
      );
    }
  }
  for (const campo of propios) {
    if (!esTextoNoVacio(caso[campo])) {
      problemas.push(
        invalida(
          `El campo «${campo}» falta o está vacío.`,
          `Un caso «${caso.estado}» lleva «${campo}».`,
          campo,
        ),
      );
    }
  }
  if (caso.estado === "brecha-abierta" && !SEVERIDADES.includes(caso.severidad)) {
    problemas.push(
      invalida(
        `La severidad («${String(caso.severidad)}») no es una de ${SEVERIDADES.join(", ")}.`,
        `Elegí una severidad: ${SEVERIDADES.join(", ")}.`,
        "severidad",
      ),
    );
  }
  return problemas;
}

/** Los problemas de forma de un caso (todos juntos: el guardián los muestra de una vez). */
function problemasDelCaso(caso) {
  if (!esObjetoPlano(caso)) {
    return [
      invalida("El caso no es un objeto.", "Cada caso del catálogo es un objeto JSON.", undefined),
    ];
  }
  if (!ESTADOS.includes(caso.estado)) {
    return [
      invalida(
        `El estado («${String(caso.estado)}») no es uno de ${ESTADOS.join(", ")}.`,
        "Un caso es «exigido», «brecha-abierta» o «riesgo-aceptado».",
        "estado",
      ),
    ];
  }
  const problemas = [];
  if (!PATRON_DE_ID.test(caso.id)) {
    problemas.push(invalida("El id no tiene la forma EV-000.", "Usá EV- y tres dígitos.", "id"));
  }
  if (!VIAS.includes(caso.via)) {
    problemas.push(
      invalida(
        `La vía («${String(caso.via)}») no es una de las del catálogo.`,
        `Las vías son: ${VIAS.join(", ")}.`,
        "via",
      ),
    );
  }
  for (const campo of ["titulo", "controlEsperado"]) {
    if (!esTextoNoVacio(caso[campo])) {
      problemas.push(
        invalida(`El campo «${campo}» falta o está vacío.`, `Todo caso dice su «${campo}».`, campo),
      );
    }
  }
  problemas.push(...problemasDeConstruccion(caso.construccion, "construccion"));
  if (caso.construccionBase !== undefined) {
    problemas.push(...problemasDeConstruccion(caso.construccionBase, "construccionBase"));
  }
  if (caso.plantilla !== undefined && !PLANTILLAS.includes(caso.plantilla)) {
    problemas.push(
      invalida(
        `La plantilla («${String(caso.plantilla)}») no existe.`,
        `Las plantillas son: ${PLANTILLAS.join(", ")}.`,
        "plantilla",
      ),
    );
  }
  if (caso.reloj !== undefined && !(Number.isInteger(caso.reloj) && caso.reloj >= 0)) {
    problemas.push(
      invalida(
        "«reloj» tiene que ser un entero de días desde 0.",
        "Poné los días que se adelanta.",
        "reloj",
      ),
    );
  }
  if (caso.sinGit !== undefined && typeof caso.sinGit !== "boolean") {
    problemas.push(
      invalida("«sinGit» tiene que ser verdadero o falso.", "Poné true o false.", "sinGit"),
    );
  }
  problemas.push(...problemasDeEsperado(caso.esperado));
  problemas.push(...problemasDelEstado(caso));
  return problemas;
}

/** Hallazgo de un caso, ubicado en la clave `campo` de su entrada del catálogo (la entrada entera si falta). */
const hallazgo = (indice, codigo, motivo, correccion, campo) => ({
  codigo,
  archivo: ARCHIVO_DEL_CATALOGO,
  contrato: null,
  motivo,
  correccion,
  donde: enJson(indice, ...(campo === undefined ? [] : [campo])),
});

const rotulo = (caso) => `${caso.id} («${caso.titulo}»)`;

const REGLAS_DE_BRECHA = Object.freeze({
  campo: "vence",
  plazo: { dias: PLAZO_DE_BRECHA, codigo: "brecha-plazo-excesivo" },
  vencida: {
    codigo: "brecha-vencida",
    texto: "la brecha venció el",
    correccion:
      "Cerrala (pasá el caso a «exigido» con el arreglo) o, si el dueño decide, registrá una brecha nueva con su propio plazo: no se extiende.",
  },
  // Se reporta en cada corrida; desde DIAS_DE_AVISO_DE_BRECHA días antes, con el aviso especial.
  avisos: Object.freeze([
    { hasta: DIAS_DE_AVISO_DE_BRECHA, codigo: "brecha-por-vencer" },
    { hasta: Infinity, codigo: "brecha-abierta" },
  ]),
  detalle: (caso) =>
    `brecha abierta de severidad ${caso.severidad}, vence el ${caso.vence} (responsable: ${caso.responsable})`,
  correccionDeAviso:
    "Cerrala antes de que venza: pasá el caso a «exigido» cuando el guardián lo bloquee.",
});

const REGLAS_DE_RIESGO = Object.freeze({
  campo: "revisar",
  plazo: { dias: PLAZO_DE_RIESGO, codigo: "riesgo-plazo-excesivo" },
  vencida: {
    codigo: "riesgo-vencido",
    texto: "la revisión del riesgo aceptado era el",
    correccion:
      "El dueño tiene que volver a decidir: registrá la aceptación de nuevo con fecha y plazo nuevos, o cerrá el hueco y pasá el caso a «exigido».",
  },
  // Solo avisa desde DIAS_DE_AVISO_DE_RIESGO días antes de la revisión.
  avisos: Object.freeze([{ hasta: DIAS_DE_AVISO_DE_RIESGO, codigo: "riesgo-por-revisar" }]),
  detalle: (caso) => `riesgo aceptado por ${caso.aprobadoPor}, a revisar el ${caso.revisar}`,
  correccionDeAviso:
    "Revisalo con el dueño antes de la fecha: vuelve a decidirse o se cierra el hueco.",
});

/** Qué estados tienen fecha límite y con qué reglas (el estado `exigido` no tiene). */
const REGLAS_DE_FECHAS = new Map([
  ["brecha-abierta", REGLAS_DE_BRECHA],
  ["riesgo-aceptado", REGLAS_DE_RIESGO],
]);

/**
 * Las fechas de un caso con límite (`vence` de la brecha, `revisar` del riesgo): válidas, en orden, dentro
 * del plazo, vigentes y, si faltan pocos días, con aviso. `reglas` dice los códigos y los plazos del estado.
 */
function revisarFechas(caso, indice, hoy, reglas) {
  const fallas = [];
  const avisos = [];
  const limite = caso[reglas.campo];
  const creadaValida = esTextoNoVacio(caso.creada) && esFechaValida(caso.creada);
  const limiteValido = esTextoNoVacio(limite) && esFechaValida(limite);
  for (const campo of ["creada", reglas.campo]) {
    if (esTextoNoVacio(caso[campo]) && !esFechaValida(caso[campo])) {
      fallas.push(
        hallazgo(
          indice,
          "evasion-invalida",
          `${rotulo(caso)}: «${campo}» («${caso[campo]}») no es una fecha válida AAAA-MM-DD.`,
          "Poné una fecha real con el formato AAAA-MM-DD.",
          campo,
        ),
      );
    }
  }
  if (creadaValida && caso.creada > hoy) {
    fallas.push(
      hallazgo(
        indice,
        "evasion-invalida",
        `${rotulo(caso)}: «creada» (${caso.creada}) es posterior a hoy (${hoy}).`,
        "Poné la fecha en que realmente se registró, no una futura.",
        "creada",
      ),
    );
  }
  if (creadaValida && limiteValido) {
    if (limite < caso.creada) {
      fallas.push(
        hallazgo(
          indice,
          "evasion-invalida",
          `${rotulo(caso)}: «${reglas.campo}» (${limite}) es anterior a «creada» (${caso.creada}).`,
          `«${reglas.campo}» tiene que ser igual o posterior a «creada».`,
          reglas.campo,
        ),
      );
    } else if (diasEntre(caso.creada, limite) > reglas.plazo.dias) {
      fallas.push(
        hallazgo(
          indice,
          reglas.plazo.codigo,
          `${rotulo(caso)}: «${reglas.campo}» está a ${diasEntre(caso.creada, limite)} días de «creada» (de ${caso.creada} a ${limite}) y el máximo es ${reglas.plazo.dias}.`,
          `Acortá «${reglas.campo}»: como mucho ${reglas.plazo.dias} días desde «creada». No se extiende: se corrige o se vuelve a decidir con una fecha nueva.`,
          reglas.campo,
        ),
      );
    }
  }
  if (limiteValido) {
    const faltan = diasEntre(hoy, limite);
    if (faltan < 0) {
      fallas.push(
        hallazgo(
          indice,
          reglas.vencida.codigo,
          `${rotulo(caso)}: ${reglas.vencida.texto} ${limite} (hoy es ${hoy}).`,
          reglas.vencida.correccion,
          reglas.campo,
        ),
      );
    } else {
      const aviso = reglas.avisos.find((candidato) => faltan <= candidato.hasta);
      if (aviso !== undefined) {
        avisos.push(
          hallazgo(
            indice,
            aviso.codigo,
            `${rotulo(caso)}: ${reglas.detalle(caso)}; faltan ${faltan} días (hoy es ${hoy}).`,
            reglas.correccionDeAviso,
            reglas.campo,
          ),
        );
      }
    }
  }
  return { fallas, avisos };
}

/**
 * Valida el catálogo de evasión: forma de cada caso, ids únicos, campos de cada estado y vencimientos.
 * Devuelve las fallas y los avisos con `donde` (la clave del JSON), listos para el ubicador del guardián.
 *
 * @param {unknown} catalogo Contenido de `evasiones.json`.
 * @param {{ ahora: Date }} contexto
 */
function validarCatalogo(catalogo, { ahora }) {
  if (!Array.isArray(catalogo)) {
    return {
      fallas: [
        {
          codigo: "evasion-invalida",
          archivo: ARCHIVO_DEL_CATALOGO,
          contrato: null,
          motivo: "El catálogo de evasión tiene que ser una lista de casos.",
          correccion: "Dejalo como una lista JSON de casos.",
          donde: enJson(),
        },
      ],
      avisos: [],
    };
  }
  const hoy = diaDe(ahora);
  const fallas = [];
  const avisos = [];
  const vistos = new Set();
  catalogo.forEach((caso, indice) => {
    for (const problema of problemasDelCaso(caso)) {
      fallas.push(
        hallazgo(indice, problema.codigo, problema.motivo, problema.correccion, problema.campo),
      );
    }
    if (esObjetoPlano(caso) && esTextoNoVacio(caso.id)) {
      if (vistos.has(caso.id)) {
        fallas.push(
          hallazgo(
            indice,
            "evasion-invalida",
            `El id ${caso.id} está repetido en el catálogo.`,
            "Cada caso lleva un id propio.",
            "id",
          ),
        );
      }
      vistos.add(caso.id);
    }
    const reglas = REGLAS_DE_FECHAS.get(esObjetoPlano(caso) ? caso.estado : undefined);
    if (reglas !== undefined) {
      const fechas = revisarFechas(caso, indice, hoy, reglas);
      fallas.push(...fechas.fallas);
      avisos.push(...fechas.avisos);
    }
  });
  return { fallas, avisos };
}

/** ¿Esta falla observada es la que el caso espera (código, archivo y, si lo dice, línea)? */
const esLaEsperada = (esperado, falla) =>
  falla.codigo === esperado.codigo &&
  falla.archivo === esperado.archivo &&
  (esperado.linea === undefined || falla.linea === esperado.linea);

const comoTexto = (fallas) =>
  fallas.length === 0
    ? "ninguna falla localizada"
    : fallas.map((f) => `${f.codigo} en ${f.archivo}:${f.linea}`).join("; ");

/** La falla de un caso que no se comporta como su estado dice, y qué sugiere hacer. */
const SI_NO_SE_CUMPLE = Object.freeze({
  exigido: {
    codigo: "evasion-no-bloqueada",
    correccion:
      "Arreglá el control que tiene que detectarlo; si no se puede ahora, registralo como brecha abierta (o riesgo aceptado por el dueño) con su plazo. «esperado» no se afloja para que el caso pase.",
  },
  "brecha-abierta": {
    codigo: "brecha-cerrada",
    correccion:
      "La brecha se cerró: pasá el caso a «exigido» (sin campos de brecha) para que el bloqueo quede protegido.",
  },
  "riesgo-aceptado": {
    codigo: "riesgo-cerrado",
    correccion:
      "El riesgo dejó de existir: pasá el caso a «exigido» (sin campos de riesgo) para que el bloqueo quede protegido.",
  },
});

/**
 * Compara lo que pasó al correr el caso con lo que su estado exige. Devuelve el hallazgo (con `donde`) o
 * `null` si el caso está en regla: un `exigido` tiene que bloquearse (y, si `esperado` es de tipo
 * `bloquea`, con la falla que dice); uno `brecha-abierta` o `riesgo-aceptado` tiene que seguir pasando.
 *
 * @param {object} caso Un caso válido del catálogo.
 * @param {number} indice Su posición en el catálogo (para ubicarlo en el JSON).
 * @param {{ resultado: "pasa" | "bloquea", fallas: { codigo: string, archivo: string, linea?: number }[] }} observado
 */
function evaluarResultado(caso, indice, observado) {
  const exigido = caso.estado === "exigido";
  const bloquea = observado.resultado === "bloquea";
  const comoLoDice =
    caso.esperado.tipo !== "bloquea" ||
    observado.fallas.some((f) => esLaEsperada(caso.esperado, f));
  if (bloquea === exigido && (!exigido || comoLoDice)) return null;
  const { codigo, correccion } = SI_NO_SE_CUMPLE[caso.estado];
  const dijo = `${bloquea ? "se bloqueó" : "pasó sin detección"} (${comoTexto(observado.fallas)})`;
  const quePide = exigido
    ? `tenía que bloquearse con ${caso.esperado.tipo === "bloquea" ? `${caso.esperado.codigo} en ${caso.esperado.archivo}` : "una falla que exija excepción"}`
    : "tenía que seguir pasando sin detección";
  return {
    codigo,
    archivo: ARCHIVO_DEL_CATALOGO,
    contrato: null,
    motivo: `${rotulo(caso)} ${dijo} y ${quePide} (estado «${caso.estado}»).`,
    correccion,
    donde: enJson(indice, "estado"),
  };
}

module.exports = {
  ARCHIVO_DEL_CATALOGO,
  VIAS,
  ESTADOS,
  SEVERIDADES,
  PLANTILLAS,
  OPERACIONES,
  PLAZO_DE_BRECHA,
  PLAZO_DE_RIESGO,
  DIAS_DE_AVISO_DE_BRECHA,
  DIAS_DE_AVISO_DE_RIESGO,
  validarCatalogo,
  evaluarResultado,
};
