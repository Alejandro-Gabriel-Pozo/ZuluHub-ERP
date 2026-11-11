/**
 * Control del REGISTRO DE DECISIONES (`arquitectura/decisiones/registro.json`): que ninguna decisión de negocio quede sin que el dueño la vea.
 *
 *     node arquitectura/decisiones/decisiones.cjs [--base=<carpeta de la base>]
 *
 * Previene: decisiones de permisos, dinero, lo que ve un cliente o lo comercial tomadas por una sesión y anotadas solo como «SUPUESTO» en un
 * comentario o en un PR (caso real, 11/11/2026: `presentacion_de_producto` pasó de catálogo a compras contra el diseño aprobado). Dos reglas:
 *  (a) todo marcador `SUPUESTO` de código, SQL de migraciones y pruebas cita un `DEC-0000` que está en el registro, y todo `DEC-0000` citado
 *      existe. Una migración que ya está en la base no se puede editar (su checksum cambiaría): se cubre con una entrada cuyo `donde` nombra
 *      el archivo; una migración nueva cita en la línea;
 *  (b) con `--base`: si el cambio toca un archivo sensible (`archivos-sensibles.json`, un solo lugar y ampliable), el registro trae al menos
 *      una entrada nueva o cambiada. Una entrada del registro no se borra: se corrige con otra (trazabilidad).
 * Sin `--base` solo corre (a) y la forma. Sale 0 sin fallas, 1 con fallas, 2 si el uso es incorrecto. Si la base todavía no trae el registro
 * (la primera vez que se incorpora) avisa y no compara; si lo trae y no se puede leer, falla (nunca «pasa» porque no se pudo mirar).
 *
 * LÍMITES: es una alarma para errores honestos, no un límite de seguridad. Solo ve `SUPUESTO` en MAYÚSCULAS (la convención del repo; «supuesto»
 * en prosa no cuenta), por línea y sin separar comentario de código; una entrada del registro cualquiera alcanza para (b) (que sea la
 * correcta lo mira quien revisa el PR); una migración ya aplicada queda cubierta con solo nombrarla en un `donde`.
 */
const { Buffer } = require("node:buffer");
const fs = require("node:fs");
const path = require("node:path");
const { cargarArbol, dentroDeLaRaiz } = require("../deuda/deuda.cjs");
const { problemasDeLosSensibles, problemasDelRegistro, TIPO_SIN_DECISION } = require("./forma.cjs");

const ARCHIVO_DEL_REGISTRO = "arquitectura/decisiones/registro.json";
const ARCHIVO_DE_LOS_SENSIBLES = "arquitectura/decisiones/archivos-sensibles.json";
const USO = "Uso: node arquitectura/decisiones/decisiones.cjs [--base=<carpeta de la base>]";

/** Los archivos donde se busca el marcador: programa y SQL (las pruebas incluidas). La documentación (`.md`) no se mira. */
const ES_ESCANEADO = /\.(?:[cm]?[jt]sx?|sql)$/;
/** Exentos del escaneo, por prefijo: este control y sus pruebas nombran el marcador como ejemplo. */
const EXENTOS = Object.freeze(["arquitectura/decisiones/", "test/arquitectura/decisiones"]);
const ES_DE_PRUEBA = /\.test\.[cm]?[jt]sx?$/;
const MARCADOR = /(?<![\p{L}\p{N}_])SUPUESTOS?(?![\p{L}\p{N}_])/u;
const CITA = /\bDEC-\d{4}\b/g;
const MIGRACION = /^migraciones\/[^/]+\.sql$/;

const texto = (contenido) => Buffer.from(contenido).toString("utf8");
const enLinea = (archivo, linea, motivo) => ({ archivo, linea, motivo });

/** Lee un JSON del árbol: `{ ausente }`, `{ error }` o `{ valor }`. */
function leerJson(arbol, ruta) {
  const contenido = arbol.leer(ruta);
  if (contenido === null) return { ausente: true };
  try {
    return { valor: JSON.parse(texto(contenido)) };
  } catch (error) {
    return { error: `${ruta}: no se puede leer (${error.message}).` };
  }
}

/** Instrucción exacta de qué entrada falta y cómo agregarla (los PR que tocan permisos, módulos o textos la ven en el error). */
const COMO_AGREGAR =
  `Agregá una entrada a ${ARCHIVO_DEL_REGISTRO} (id nuevo, el siguiente libre; fecha AAAA-MM-DD): ` +
  '{ "id": "DEC-0000", "fecha": "AAAA-MM-DD", "quien": "sesión", "tipo": "PERMISOS", "estado": "PENDIENTE_DE_OK", ' +
  '"decision": "lo que se decidió, en una línea de negocio", "que_cambia": "qué ve el negocio si se corrige", "donde": "archivo o especificación" }. ' +
  `Si el cambio es puramente técnico: "tipo": "${TIPO_SIN_DECISION}" y un "motivo" que lo explique.`;

/** (a) Los marcadores `SUPUESTO` sin cita y las citas a un `DEC` que no existe. */
function controlarMarcadores({ pr, base, registro }) {
  const fallas = [];
  const ids = new Set(registro.map((entrada) => entrada.id));
  for (const ruta of pr.rutas) {
    if (!ES_ESCANEADO.test(ruta) || EXENTOS.some((prefijo) => ruta.startsWith(prefijo))) continue;
    const contenido = pr.leer(ruta);
    if (contenido === null) continue;
    const cubierta =
      MIGRACION.test(ruta) &&
      (base === null || base.leer(ruta) !== null) &&
      registro.some((entrada) => entrada.donde.includes(ruta));
    texto(contenido)
      .split("\n")
      .forEach((linea, posicion) => {
        const citas = linea.match(CITA) ?? [];
        for (const cita of citas.filter((c) => !ids.has(c))) {
          fallas.push(
            enLinea(
              ruta,
              posicion + 1,
              `cita ${cita}, que no está en ${ARCHIVO_DEL_REGISTRO}. ${COMO_AGREGAR}`,
            ),
          );
        }
        if (MARCADOR.test(linea) && citas.length === 0 && !cubierta) {
          fallas.push(
            enLinea(
              ruta,
              posicion + 1,
              MIGRACION.test(ruta) && base !== null && base.leer(ruta) !== null
                ? `SUPUESTO en una migración que ya está en la base (no se edita: cambiaría su checksum). Nombrá ${ruta} en el campo donde de una entrada del registro. ${COMO_AGREGAR}`
                : `SUPUESTO sin decisión registrada: escribí al lado «(DEC-0000)» con el id de la entrada. ${COMO_AGREGAR}`,
            ),
          );
        }
      });
  }
  return fallas;
}

const estaEn = (ruta, sensible) =>
  sensible.endsWith("/") ? ruta.startsWith(sensible) : ruta === sensible;
const iguales = (a, b) => a !== null && b !== null && Buffer.from(a).equals(Buffer.from(b));
/** La entrada con sus claves en orden alfabético: dos entradas son la misma si esto es igual. */
const canonica = (entrada) => JSON.stringify(entrada, Object.keys(entrada).sort());

/** (b) Un archivo sensible tocado sin una entrada nueva o cambiada, y las entradas borradas. */
function controlarContraLaBase({ pr, base, registro, registroBase, sensibles }) {
  const fallas = [];
  const porId = new Map(registroBase.map((entrada) => [entrada.id, canonica(entrada)]));
  for (const id of porId.keys()) {
    if (!registro.some((entrada) => entrada.id === id)) {
      fallas.push(
        enLinea(
          ARCHIVO_DEL_REGISTRO,
          1,
          `${id} estaba en la base y ya no está: una decisión no se borra, se corrige con una entrada nueva (estado CORREGIDA).`,
        ),
      );
    }
  }
  const hayEntradaNueva = registro.some((entrada) => porId.get(entrada.id) !== canonica(entrada));
  if (hayEntradaNueva) return fallas;
  const rutas = new Set([...pr.rutas, ...base.rutas]);
  for (const sensible of sensibles) {
    const tocados = [...rutas]
      .filter((ruta) => estaEn(ruta, sensible.ruta) && !ES_DE_PRUEBA.test(ruta))
      .filter((ruta) => !iguales(pr.leer(ruta), base.leer(ruta)))
      .sort();
    if (tocados.length === 0) continue;
    const cuantos =
      tocados.length > 3
        ? `${tocados.slice(0, 3).join(", ")} y ${tocados.length - 3} más`
        : tocados.join(", ");
    fallas.push(
      enLinea(
        tocados[0],
        1,
        `tocaste ${sensible.que} (${cuantos}) y ${ARCHIVO_DEL_REGISTRO} no trae ninguna entrada nueva ni cambiada en este cambio. ${COMO_AGREGAR}`,
      ),
    );
  }
  return fallas;
}

/** Los problemas de forma del registro y de la lista de sensibles de un árbol, como fallas. Devuelve `{ fallas, registro, sensibles }`. */
function leerDeclaraciones(arbol, etiqueta) {
  const fallas = [];
  const delRegistro = leerJson(arbol, ARCHIVO_DEL_REGISTRO);
  const deLosSensibles = leerJson(arbol, ARCHIVO_DE_LOS_SENSIBLES);
  const quien = etiqueta === "" ? "" : `${etiqueta}: `;
  // Stryker disable next-line ArrayDeclaration: con una falla de forma o de lectura `evaluar` corta antes de usar la lista, así que su contenido no se ve.
  let registro = [];
  // Stryker disable next-line ArrayDeclaration: ídem registro.
  let sensibles = [];
  if (delRegistro.ausente) fallas.push(enLinea(ARCHIVO_DEL_REGISTRO, 1, `${quien}no existe.`));
  else if (delRegistro.error !== undefined)
    fallas.push(enLinea(ARCHIVO_DEL_REGISTRO, 1, `${quien}${delRegistro.error}`));
  else {
    const problemas = problemasDelRegistro(delRegistro.valor);
    for (const { id, problema } of problemas)
      fallas.push(enLinea(ARCHIVO_DEL_REGISTRO, 1, `${quien}${id}: ${problema}`));
    registro = delRegistro.valor;
  }
  if (deLosSensibles.ausente)
    fallas.push(enLinea(ARCHIVO_DE_LOS_SENSIBLES, 1, `${quien}no existe.`));
  else if (deLosSensibles.error !== undefined)
    fallas.push(enLinea(ARCHIVO_DE_LOS_SENSIBLES, 1, `${quien}${deLosSensibles.error}`));
  else {
    const problemas = problemasDeLosSensibles(deLosSensibles.valor);
    for (const problema of problemas)
      fallas.push(enLinea(ARCHIVO_DE_LOS_SENSIBLES, 1, `${quien}${problema}`));
    if (problemas.length === 0) sensibles = deLosSensibles.valor.sensibles;
  }
  return { fallas, registro, sensibles, hayRegistro: !delRegistro.ausente };
}

/**
 * Evalúa el árbol del cambio y, si hay base, lo compara con ella. `pr` y `base` son `{ rutas, leer }`.
 * Devuelve `{ fallas, avisos }` con `{ archivo, linea, motivo }`.
 */
function evaluar({ pr, base = null }) {
  const delCambio = leerDeclaraciones(pr, "");
  const fallas = [...delCambio.fallas];
  const avisos = [];
  if (delCambio.fallas.length === 0) {
    fallas.push(...controlarMarcadores({ pr, base, registro: delCambio.registro }));
  }
  if (base === null || delCambio.fallas.length > 0) return { fallas, avisos };
  const deLaBase = leerDeclaraciones(base, "Base");
  if (!deLaBase.hayRegistro) {
    avisos.push(
      enLinea(
        ARCHIVO_DEL_REGISTRO,
        1,
        "la rama base todavía no trae el registro (es la primera vez que se incorpora): no hay con qué comparar.",
      ),
    );
    return { fallas, avisos };
  }
  if (deLaBase.fallas.length > 0) return { fallas: [...fallas, ...deLaBase.fallas], avisos };
  const sensibles = [
    ...new Map([...deLaBase.sensibles, ...delCambio.sensibles].map((s) => [s.ruta, s])).values(),
  ];
  fallas.push(
    ...controlarContraLaBase({
      pr,
      base,
      registro: delCambio.registro,
      registroBase: deLaBase.registro,
      sensibles,
    }),
  );
  return { fallas, avisos };
}

const formatear = (hallazgo) => `${hallazgo.archivo}:${hallazgo.linea} · ${hallazgo.motivo}`;

/** Corre el control sobre el repositorio de `raiz`; devuelve `{ codigo, lineas }`. */
function ejecutar(argumentos, raiz) {
  const base = argumentos.filter((argumento) => argumento.startsWith("--base="));
  if (argumentos.length !== base.length || base.length > 1) return { codigo: 2, lineas: [USO] };
  const carpeta = base.length === 1 ? path.resolve(base[0].slice("--base=".length)) : null;
  if (carpeta !== null && !fs.statSync(carpeta, { throwIfNoEntry: false })?.isDirectory()) {
    return {
      codigo: 2,
      lineas: [`--base: «${base[0].slice("--base=".length)}» no es una carpeta.`],
    };
  }
  // Si la base se extrajo DENTRO del repositorio (`base/`), sus archivos sin versionar no son del cambio.
  const pr = cargarArbol(raiz, carpeta === null ? null : dentroDeLaRaiz(raiz, carpeta));
  const deLaBase = carpeta === null ? null : cargarArbol(carpeta);
  const { fallas, avisos } = evaluar({ pr, base: deLaBase });
  return {
    codigo: fallas.length > 0 ? 1 : 0,
    lineas: [
      ...avisos.map((aviso) => `AVISO ${formatear(aviso)}`),
      ...fallas.map((falla) => `FALLA ${formatear(falla)}`),
      `Registro de decisiones: ${fallas.length} fallas, ${avisos.length} avisos.`,
    ],
  };
}

if (require.main === module) {
  const { codigo, lineas } = ejecutar(process.argv.slice(2), process.cwd());
  for (const linea of lineas) process.stdout.write(`${linea}\n`);
  process.exitCode = codigo;
}

module.exports = {
  ARCHIVO_DE_LOS_SENSIBLES,
  ARCHIVO_DEL_REGISTRO,
  COMO_AGREGAR,
  EXENTOS,
  controlarContraLaBase,
  controlarMarcadores,
  ejecutar,
  evaluar,
};
