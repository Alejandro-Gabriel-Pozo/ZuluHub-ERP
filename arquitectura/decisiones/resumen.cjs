/**
 * El RESUMEN para el dueño: `npm run decisiones` imprime, en español de negocio y agrupadas por tipo, las decisiones que esperan su OK
 * (`PENDIENTE_DE_OK`). Una línea por decisión: qué se decidió, quién, qué cambia y dónde. Las `SIN_DECISION` (cambios puramente técnicos) no
 * se listan: no hay nada que el dueño tenga que mirar.
 *
 * Previene: que las decisiones de permisos, dinero, lo que ve un cliente o lo comercial se acumulen en comentarios y PR sin que el dueño
 * tenga un lugar donde verlas todas juntas. Si el registro no es válido NO imprime una lista a medias: falla con el motivo (fail closed).
 */
const { arbolDelDisco, leerRegistroEnCarpeta } = require("../registros/en-carpeta.cjs");
const { CARPETA_DEL_REGISTRO, MONOLITO_DEL_REGISTRO } = require("./decisiones.cjs");
const { TIPO_SIN_DECISION, problemasDelRegistro } = require("./forma.cjs");

/** Cómo se llama cada tipo para el dueño, en el orden en que se muestran. */
const TITULOS = Object.freeze({
  DINERO: "Dinero",
  PERMISOS: "Permisos (quién puede qué)",
  CLIENTE: "Lo que ve o hace el cliente",
  DATOS: "Datos (qué se guarda y cómo)",
  COMERCIAL: "Lo comercial (planes y extras)",
  INFRAESTRUCTURA: "Infraestructura",
});
const QUIEN = Object.freeze({
  dueño: "el dueño",
  padre: "la sesión padre",
  sesión: "una sesión de código",
});

/** El texto del resumen de un registro ya validado. */
function resumir(registro) {
  const pendientes = registro.filter(
    (e) => e.estado === "PENDIENTE_DE_OK" && e.tipo !== TIPO_SIN_DECISION,
  );
  if (pendientes.length === 0) return "No hay decisiones pendientes de tu OK.\n";
  const lineas = [`Decisiones que esperan tu OK: ${pendientes.length}.`];
  for (const tipo of Object.keys(TITULOS)) {
    const delTipo = pendientes.filter((e) => e.tipo === tipo);
    if (delTipo.length === 0) continue;
    lineas.push("", `${TITULOS[tipo]} (${delTipo.length})`);
    for (const e of delTipo) {
      lineas.push(
        `- ${e.id} · ${e.decision} Lo decidió ${QUIEN[e.quien]} el ${e.fecha}. Si se corrige: ${e.que_cambia} Dónde: ${e.donde}.`,
      );
    }
  }
  return `${lineas.join("\n")}\n`;
}

/** Lee y resume el registro de `raiz`: `{ codigo, salida, errores }` (nada se imprime acá). */
function ejecutar(raiz) {
  const leido = leerRegistroEnCarpeta({
    arbol: arbolDelDisco(raiz, CARPETA_DEL_REGISTRO, MONOLITO_DEL_REGISTRO),
    carpeta: CARPETA_DEL_REGISTRO,
    monolito: MONOLITO_DEL_REGISTRO,
    admiteMonolito: false,
  });
  if (leido.ausente) {
    return { codigo: 1, salida: "", errores: [`${CARPETA_DEL_REGISTRO}: no existe.`] };
  }
  if (leido.errores !== undefined) {
    return {
      codigo: 1,
      salida: "",
      errores: leido.errores.map(({ archivo, motivo }) => `${archivo}: ${motivo}`),
    };
  }
  const registro = leido.valor;
  const problemas = problemasDelRegistro(registro);
  if (problemas.length > 0) {
    const errores = problemas.map(
      ({ id, problema }) => `${CARPETA_DEL_REGISTRO}/${id}.json: ${problema}`,
    );
    return { codigo: 1, salida: "", errores };
  }
  return { codigo: 0, salida: resumir(registro), errores: [] };
}

// Stryker disable next-line ConditionalExpression: importado como biblioteca solo imprimiría el resumen; ningún resultado que una prueba lea cambia (el caso `false` sí lo mata la corrida como programa).
if (require.main === module) {
  const { codigo, salida, errores } = ejecutar(process.cwd());
  process.stdout.write(salida);
  for (const error of errores) process.stderr.write(`${error}\n`);
  process.exitCode = codigo;
}

module.exports = { ejecutar, resumir };
