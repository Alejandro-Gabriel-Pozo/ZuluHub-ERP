/**
 * El libro de deuda técnica de UN árbol (contratos-arquitectonicos.md §10, G5): qué marcadores hay, qué
 * entradas tiene el registro y si coinciden. Es puro: recibe las rutas y una función que lee archivos.
 *
 * EL REGISTRO (`arquitectura/deuda/registro.json`) es una lista de entradas:
 *   { id, archivos, descripcion, tipo, responsable, creada, [verificacion], [motivo, aprobadoPor, vence] }
 *  - `archivos`: rutas exactas (nada de carpetas ni comodines) que existen en el repositorio;
 *  - `tipo`: un tipo de marcador de `marcadores.cjs` (la entrada REGISTRA los marcadores de ese tipo en ese
 *    archivo: lleva UN solo archivo, así hay una entrada por tipo y archivo) o un hallazgo que ninguna máquina
 *    detecta (`auditoria`, `backlog`, `intermitente`, `riesgo-aceptado`, `brecha`);
 *  - `verificacion: { contiene }` (solo en un hallazgo): mientras alguno de sus `archivos` contenga ese texto, el
 *    problema sigue abierto. Sin ella, la máquina no puede saber si un hallazgo se resolvió;
 *  - `motivo`, `aprobadoPor` y `vence` juntos (o ninguno) hacen de la entrada una EXCEPCIÓN: permite que ese tipo
 *    siga o aparezca en ese archivo hasta `vence` (como máximo 60 días después de `creada`, el mismo control
 *    que las excepciones del guardián: `problemasComunes`).
 * `configuracion.json` trae `topeDeExcepciones` (cuántas excepciones abiertas a la vez) y
 * `bloqueaDeudaEnArchivoTocado` (si tocar un archivo con deuda sin pagarla bloquea o solo avisa).
 *
 * Una falla trae SIEMPRE archivo y línea: o la línea real del marcador, o un descriptor `donde` de
 * `ubicacion.cjs` (la línea de una clave del JSON) que `deuda.cjs` resuelve.
 */
const { avisoDeVencimiento, diaDe, problemasComunes } = require("../contratos/excepciones.cjs");
const { enJson } = require("../contratos/ubicacion.cjs");
const {
  ARCHIVO_DE_LA_CONFIGURACION,
  ARCHIVO_DEL_REGISTRO,
  CAMPOS_DE_EXCEPCION,
  CONTRATO,
  TIPOS,
  TIPOS_DE_HALLAZGO,
  esObjeto,
  esTamano,
  esTexto,
  formaDeLaEntrada,
  leerConfiguracion,
  leerJson,
} = require("./entradas.cjs");
const { TIPOS_DE_MARCADOR, detectar, familiaDe } = require("./marcadores.cjs");
const { OPCIONES_POR_DEFECTO } = require("./tamano.cjs");

/** Las opciones de medición (tope y exclusiones de tamaño) de una configuración leída. */
const opcionesDeMedicion = (configuracion) => ({
  topeDeLineas: configuracion.topeDeLineasPorArchivo,
  excluidos: new Set(configuracion.excluidosDelTope.map((excluido) => excluido.ruta)),
});

const claveDe = (tipo, archivo) => `${tipo}\0${archivo}`;
/** El texto de un archivo del árbol, o `null` si no se puede leer. */
const textoDe = (leer, archivo) => leer(archivo)?.toString() ?? null;
/** La primera línea (desde 1) del texto que contiene `buscado`, o `null`. */
function lineaCon(texto, buscado) {
  const indice = texto.split("\n").findIndex((renglon) => renglon.includes(buscado));
  return indice === -1 ? null : indice + 1;
}

/** Una falla o un aviso del registro: `donde` lo resuelve `deuda.cjs` con `ubicacion.cjs`. */
const delRegistro = (codigo, motivo, correccion, donde) => ({
  codigo,
  archivo: ARCHIVO_DEL_REGISTRO,
  contrato: CONTRATO,
  motivo,
  correccion,
  donde,
});

/**
 * Qué marcadores hay en el árbol. `lista`: un renglón por tipo y archivo, con sus líneas, ordenado por archivo
 * y tipo; `porClave`: lo mismo por (tipo, archivo); `ilegibles`: archivos que se debían analizar y no se
 * pudieron leer o interpretar; `analizados`: cuántos archivos se miraron. Un archivo sobre el tope trae además
 * su `tamano` en líneas.
 *
 * @param {{ rutas: string[], leer: (ruta: string) => Buffer | string | null }} arbol
 * @param {{ topeDeLineas: number, excluidos: ReadonlySet<string> }} [opciones] Tope y exclusiones de tamaño.
 */
function medir({ rutas, leer }, opciones = OPCIONES_POR_DEFECTO) {
  const lista = [];
  const ilegibles = [];
  let analizados = 0;
  for (const archivo of [...rutas].sort()) {
    if (familiaDe(archivo) === null) continue;
    const contenido = leer(archivo);
    if (contenido === null) {
      ilegibles.push({ archivo, linea: 1, motivo: "no se pudo leer el archivo" });
      continue;
    }
    analizados += 1;
    const { marcadores, ilegible } = detectar(archivo, contenido.toString(), opciones);
    if (ilegible !== null) ilegibles.push({ archivo, ...ilegible });
    const porTipo = new Map();
    const tamanos = new Map();
    for (const { tipo, linea, tamano } of marcadores) {
      porTipo.set(tipo, [...(porTipo.get(tipo) ?? []), linea]);
      tamanos.set(tipo, tamano); // (solo el marcador `archivo-grande` lo trae; en los demás queda `undefined`)
    }
    for (const tipo of [...porTipo.keys()].sort()) {
      const tamano = tamanos.get(tipo);
      lista.push({
        tipo,
        archivo,
        lineas: porTipo.get(tipo),
        ...(tamano === undefined ? {} : { tamano }),
      });
    }
  }
  return {
    lista,
    porClave: new Map(lista.map((grupo) => [claveDe(grupo.tipo, grupo.archivo), grupo])),
    ilegibles,
    analizados,
  };
}

/**
 * Evalúa UN árbol: valida el registro y la configuración, y lo compara con los marcadores que hay.
 *
 * @param {{ arbol: { rutas: string[], leer: (ruta: string) => Buffer | string | null }, ahora: Date }} datos
 * @returns {{ fallas: object[], avisos: object[], medicion: ReturnType<typeof medir>,
 *   entradas: object[], configuracion: { topeDeExcepciones: number, bloqueaDeudaEnArchivoTocado: boolean } }}
 *   `entradas`: las entradas bien formadas, ya normalizadas (`indice`, `id`, `tipo`, `archivos`, `excepcion`,
 *   `vigente`, `verificacion`, `creada`, `vence`).
 */
function evaluarArbol({ arbol, ahora }) {
  const { rutas, leer } = arbol;
  const hoy = diaDe(ahora);
  const fallas = [];
  const avisos = [];
  const { configuracion, fallas: fallasDeConfiguracion } = leerConfiguracion(leer);
  const medicion = medir(arbol, opcionesDeMedicion(configuracion));
  for (const { archivo, linea, motivo } of medicion.ilegibles) {
    fallas.push({
      codigo: "deuda-archivo-ilegible",
      archivo,
      linea,
      contrato: CONTRATO,
      motivo: `No se pudo analizar el archivo: ${motivo}. Sin eso no se sabe si tiene deuda.`,
      correccion: "Dejalo legible y con la forma de siempre.",
    });
  }
  fallas.push(...fallasDeConfiguracion);

  const entradas = [];
  const leida = leerJson(leer, ARCHIVO_DEL_REGISTRO);
  if (!Array.isArray(leida.valor)) {
    const motivo =
      leida.ausente === true
        ? "No existe el registro de deuda: sin él no hay a qué comparar los marcadores."
        : leida.error !== undefined
          ? `El registro de deuda no es JSON válido (${leida.error}).`
          : "El registro de deuda tiene que ser una lista.";
    fallas.push(
      delRegistro(
        "deuda-entrada-invalida",
        motivo,
        "Dejalo como una lista JSON (vacía si no hay deuda).",
        enJson(),
      ),
    );
  } else {
    const idsVistos = new Set();
    leida.valor.forEach((crudo, indice) => {
      if (!esObjeto(crudo)) {
        fallas.push(
          delRegistro(
            "deuda-entrada-invalida",
            `La entrada ${indice + 1} del registro no es un objeto.`,
            "Corregí el formato.",
            enJson(indice),
          ),
        );
        return;
      }
      const { problemas, registra } = formaDeLaEntrada(crudo, idsVistos);
      for (const { campo, motivo, correccion } of problemas) {
        fallas.push(
          delRegistro(
            "deuda-entrada-invalida",
            `Entrada ${esTexto(crudo.id) ? `«${crudo.id}»` : indice + 1}: ${motivo}`,
            correccion,
            enJson(indice, campo),
          ),
        );
      }
      const excepcion = CAMPOS_DE_EXCEPCION.some((campo) => crudo[campo] !== undefined);
      const vista = Object.fromEntries(
        ["id", "responsable", "creada", ...(excepcion ? CAMPOS_DE_EXCEPCION : [])].map((campo) => [
          campo,
          crudo[campo],
        ]),
      );
      const delControl = problemasComunes(
        vista,
        Object.keys(vista),
        hoy,
        excepcion ? "Excepción de deuda" : "Deuda",
      );
      for (const { codigo, motivo, correccion, campo } of delControl) {
        fallas.push(
          delRegistro(
            excepcion ? codigo : "deuda-entrada-invalida",
            motivo,
            correccion,
            enJson(indice, campo),
          ),
        );
      }
      // (sin `vence` —lo que pasa si no es una excepción— no hay aviso)
      const aviso = avisoDeVencimiento(
        crudo,
        hoy,
        "Excepción de deuda",
        ARCHIVO_DEL_REGISTRO,
        CONTRATO,
        indice,
      );
      if (aviso !== null) avisos.push(aviso);
      if (registra) {
        entradas.push({
          indice,
          id: crudo.id,
          tipo: crudo.tipo,
          archivos: crudo.archivos,
          excepcion,
          vigente: excepcion && problemas.length === 0 && delControl.length === 0,
          verificacion: crudo.verificacion?.contiene ?? null,
          tamano: crudo.tipo === "archivo-grande" && esTamano(crudo.tamano) ? crudo.tamano : null,
          creada: crudo.creada,
          vence: excepcion ? crudo.vence : null,
        });
      }
    });
  }

  const abierta = (entrada) => {
    if (TIPOS_DE_MARCADOR.includes(entrada.tipo)) {
      return medicion.porClave.has(claveDe(entrada.tipo, entrada.archivos[0]));
    }
    if (entrada.verificacion === null) return true;
    return entrada.archivos.some(
      (archivo) => textoDe(leer, archivo)?.includes(entrada.verificacion) === true,
    );
  };
  for (const entrada of entradas) {
    const faltantes = entrada.archivos.filter((archivo) => !rutas.includes(archivo));
    if (faltantes.length > 0) {
      fallas.push(
        delRegistro(
          "deuda-archivo-inexistente",
          `La entrada «${entrada.id}» apunta a ${faltantes.map((a) => `«${a}»`).join(", ")}, que no es un archivo versionado.`,
          "Corregí la ruta, o borrá la entrada si el archivo ya no existe.",
          enJson(entrada.indice, "archivos"),
        ),
      );
    } else if (!abierta(entrada)) {
      if (entrada.excepcion) {
        fallas.push(
          delRegistro(
            "excepcion-obsoleta",
            `La excepción «${entrada.id}» no cubre nada: el problema ya se resolvió.`,
            "Borrala: una excepción que no se usa queda como una puerta abierta.",
            enJson(entrada.indice, "id"),
          ),
        );
      } else {
        avisos.push(
          delRegistro(
            "deuda-resuelta",
            `La entrada «${entrada.id}» ya no tiene el problema: el detector (o su verificación) no lo encuentra.`,
            "Borrala del registro: la deuda se pagó.",
            enJson(entrada.indice, "id"),
          ),
        );
      }
    } else if (entrada.tamano !== null) {
      // El trinquete: el archivo no puede medir más de lo registrado, y lo registrado baja con él.
      const archivo = entrada.archivos[0];
      const { tamano } = medicion.porClave.get(claveDe(entrada.tipo, archivo));
      if (tamano > entrada.tamano) {
        fallas.push({
          codigo: "deuda-archivo-crece",
          archivo,
          linea: entrada.tamano + 1,
          contrato: CONTRATO,
          motivo: `El archivo mide ${tamano} líneas y el libro registra ${entrada.tamano} («${entrada.id}»): un archivo sobre el tope de ${configuracion.topeDeLineasPorArchivo} líneas no puede crecer.`,
          correccion:
            "Achicá el archivo (el trinquete solo baja), o pedí una excepción (motivo, aprobadoPor y vence ≤ 60 días) en el registro.",
        });
      } else if (tamano < entrada.tamano) {
        avisos.push(
          delRegistro(
            "deuda-tamano-desactualizado",
            `La entrada «${entrada.id}» registra ${entrada.tamano} líneas y el archivo mide ${tamano}: el trinquete tiene que bajar con él.`,
            `Poné "tamano": ${tamano} en la entrada.`,
            enJson(entrada.indice, "tamano"),
          ),
        );
      }
    }
  }

  const excepciones = entradas.filter((entrada) => entrada.excepcion);
  if (excepciones.length > configuracion.topeDeExcepciones) {
    const sobra = excepciones[configuracion.topeDeExcepciones];
    fallas.push(
      delRegistro(
        "deuda-tope-de-excepciones",
        `Hay ${excepciones.length} excepciones abiertas y el tope es ${configuracion.topeDeExcepciones}: la excepción no puede volverse la norma.`,
        "Pagá deuda (que la excepción deje de hacer falta) antes de abrir otra.",
        enJson(sobra.indice, "id"),
      ),
    );
  }

  for (const { tipo, archivo, lineas } of medicion.lista) {
    if (entradas.some((entrada) => entrada.tipo === tipo && entrada.archivos.includes(archivo)))
      continue;
    for (const linea of lineas) {
      fallas.push({
        codigo: "deuda-sin-registrar",
        archivo,
        linea,
        contrato: CONTRATO,
        motivo: `Marcador «${tipo}» sin registrar: no hay una entrada del registro para ese tipo en este archivo.`,
        correccion: `Resolvelo, o registralo en ${ARCHIVO_DEL_REGISTRO} con su excepción (motivo, aprobadoPor y vence, como máximo 60 días).`,
      });
    }
  }
  return { fallas, avisos, medicion, entradas, configuracion };
}

/** Cuánta deuda hay: marcadores + hallazgos registrados, por tipo, y en cuántos archivos. */
function totales({ medicion, entradas }) {
  const porTipo = {};
  let marcadores = 0;
  for (const { tipo, lineas } of medicion.lista) {
    porTipo[tipo] = (porTipo[tipo] ?? 0) + lineas.length;
    marcadores += lineas.length;
  }
  const hallazgos = entradas.filter((entrada) => TIPOS_DE_HALLAZGO.includes(entrada.tipo));
  for (const { tipo } of hallazgos) porTipo[tipo] = (porTipo[tipo] ?? 0) + 1;
  return {
    marcadores,
    hallazgos: hallazgos.length,
    total: marcadores + hallazgos.length,
    archivosConDeuda: new Set(medicion.lista.map((grupo) => grupo.archivo)).size,
    porTipo,
  };
}

module.exports = {
  ARCHIVO_DE_LA_CONFIGURACION,
  ARCHIVO_DEL_REGISTRO,
  CONTRATO,
  TIPOS,
  TIPOS_DE_HALLAZGO,
  claveDe,
  delRegistro,
  evaluarArbol,
  leerConfiguracion,
  lineaCon,
  medir,
  opcionesDeMedicion,
  textoDe,
  totales,
};
