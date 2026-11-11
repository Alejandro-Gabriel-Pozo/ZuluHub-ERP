/**
 * CUOTA de decisiones por PR: cuántas decisiones nuevas sin OK puede traer un cambio (`arquitectura/decisiones/cuota.json`).
 *
 * Previene: sesiones que acumulan decisiones sin consultar al dueño (caso real: 94 pendientes el 11/11/2026). Decisión del dueño,
 * 11/11/2026: como límite, 5 decisiones de negocio y 10 técnicas por PR; un PR que se pasa no se mergea hasta que el dueño decida.
 *
 * Qué cuenta: las entradas PENDIENTE_DE_OK con `fecha` desde `vigente_desde` que el PR agrega respecto de la base, o cuyo `tipo` cambia
 * respecto de la base (así recalificar una decisión no la saca ni la mete de la cuenta sin que se vea). Negocio = DINERO, PERMISOS,
 * COMERCIAL; técnicas = todo otro tipo (lista de permitidos: lo que no es de negocio cuenta como técnica). Una entrada con una excepción
 * del dueño en `excepciones` (id, fecha y fuente) no cuenta. Los topes y la vigencia se leen de la BASE cuando ya los trae, para que un
 * PR no afloje su propia cuota; las excepciones se leen del cambio.
 *
 * LÍMITES: es una alarma para errores honestos, no un límite de seguridad. La `fecha` de una entrada nueva la declara quien la escribe
 * (una fecha anterior a la vigencia la saca de la cuenta) y una decisión puede dejarse sin registrar; eso lo mira quien revisa el PR.
 */

const TIPOS_DE_NEGOCIO = Object.freeze(["DINERO", "PERMISOS", "COMERCIAL"]);
const ESTADO_QUE_CUENTA = "PENDIENTE_DE_OK";

const esDeNegocio = (entrada) => TIPOS_DE_NEGOCIO.includes(entrada.tipo);

/** Las entradas que cuentan contra la cuota: `{ negocio: [id], tecnicas: [id] }`. */
function contar({ registro, registroBase, cuota, excepciones }) {
  const tiposBase = new Map(registroBase.map((entrada) => [entrada.id, entrada.tipo]));
  const exceptuadas = new Set(excepciones.map((excepcion) => excepcion.id));
  const cuentan = registro.filter(
    (entrada) =>
      entrada.estado === ESTADO_QUE_CUENTA &&
      entrada.fecha >= cuota.vigente_desde &&
      !exceptuadas.has(entrada.id) &&
      tiposBase.get(entrada.id) !== entrada.tipo,
  );
  return {
    negocio: cuentan.filter(esDeNegocio).map((entrada) => entrada.id),
    tecnicas: cuentan.filter((entrada) => !esDeNegocio(entrada)).map((entrada) => entrada.id),
  };
}

const COMO_SALIR =
  "Qué hacer: preguntale al dueño antes de construir, reusá una decisión que ya exista o pedile su excepción " +
  "(se agrega a «excepciones» de arquitectura/decisiones/cuota.json con id, fecha y fuente del mensaje del dueño).";

/** Los mensajes de falla de la cuota (vacío si el cambio entra). `archivo` es el de la cuota, para que el mensaje lo nombre. */
function fallasDeLaCuota({ registro, registroBase, cuota, excepciones, archivo }) {
  const cuentan = contar({ registro, registroBase, cuota, excepciones });
  const fallas = [];
  const revisar = (ids, tope, que) => {
    if (ids.length > tope) {
      fallas.push(
        `Cuota de decisiones: este cambio agrega ${ids.length} ${que} (${ids.join(", ")}) y el tope es ${tope} por PR (${archivo}, vigente desde ${cuota.vigente_desde}). ${COMO_SALIR}`,
      );
    }
  };
  revisar(cuentan.negocio, cuota.negocio, "decisiones de negocio");
  revisar(cuentan.tecnicas, cuota.tecnicas, "decisiones técnicas");
  return fallas;
}

module.exports = { fallasDeLaCuota };
