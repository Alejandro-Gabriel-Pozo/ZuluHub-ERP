/**
 * El RESUMEN para el dueño: `npm run decisiones` imprime, en español de negocio y agrupadas por tipo, las decisiones que esperan su OK
 * (`PENDIENTE_DE_OK`). Una línea por decisión: qué se decidió, quién, qué cambia y dónde. Las `SIN_DECISION` (cambios puramente técnicos) no
 * se listan: no hay nada que el dueño tenga que mirar.
 *
 * Previene: que las decisiones de permisos, dinero, lo que ve un cliente o lo comercial se acumulen en comentarios y PR sin que el dueño
 * tenga un lugar donde verlas todas juntas. Si el registro no es válido NO imprime una lista a medias: falla con el motivo (fail closed).
 */
const fs = require("node:fs");
const path = require("node:path");
const { ARCHIVO_DEL_REGISTRO } = require("./decisiones.cjs");
const { TIPO_SIN_DECISION, TIPOS, problemasDelRegistro } = require("./forma.cjs");

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
  for (const tipo of TIPOS.filter((t) => t in TITULOS)) {
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

if (require.main === module) {
  const archivo = path.resolve(__dirname, "../..", ARCHIVO_DEL_REGISTRO);
  let registro;
  try {
    registro = JSON.parse(fs.readFileSync(archivo, "utf8"));
  } catch (error) {
    process.stderr.write(`${ARCHIVO_DEL_REGISTRO}: no se puede leer (${error.message}).\n`);
    process.exit(1);
  }
  const problemas = problemasDelRegistro(registro);
  if (problemas.length > 0) {
    for (const { id, problema } of problemas)
      process.stderr.write(`${ARCHIVO_DEL_REGISTRO} ${id}: ${problema}\n`);
    process.exit(1);
  }
  process.stdout.write(resumir(registro));
}

module.exports = { QUIEN, TITULOS, resumir };
