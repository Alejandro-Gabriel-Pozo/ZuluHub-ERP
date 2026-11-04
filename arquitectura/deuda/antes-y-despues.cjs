/**
 * La deuda ANTES y DESPUÉS de un cambio (contratos-arquitectonicos.md §10, G5): compara el libro de la rama
 * base (`main`, extraída aparte) con el del árbol del cambio. Pagar deuda nunca bloquea; lo que bloquea es:
 *  (a) un archivo TOCADO por el cambio (su contenido es distinto del de la base) que conserva deuda que ya tenía:
 *      se paga o lleva una excepción vigente. `bloqueaDeudaEnArchivoTocado: false` lo deja en aviso;
 *  (b) un marcador (en un tipo y archivo donde no había) o un hallazgo nuevos sin excepción vigente;
 *  (c) el total de marcadores de un archivo que sube sin excepción vigente;
 *  (d) una entrada del registro que desaparece mientras el problema sigue (el detector sigue encontrando el
 *      marcador, o la verificación del hallazgo sigue viendo su texto): se «borró» la deuda sin pagarla.
 * Una excepción VIGENTE es una entrada del cambio con motivo, aprobación y vencimiento sin problemas (no
 * vencida, ≤ 60 días) para ese tipo y ese archivo.
 *
 * LÍMITES: un marcador que se MUEVE dentro del mismo archivo (se paga uno y se agrega otro) mantiene la cuenta y
 * no sube el total; un hallazgo sin `verificacion` no tiene forma de saberse resuelto, así que su desaparición
 * solo se avisa; y la comparación usa el detector DEL CAMBIO sobre los dos árboles (el de la base lo vigila
 * `no-debilitar.cjs`).
 */
const { Buffer } = require("node:buffer");
const { enArchivo, enJson } = require("../contratos/ubicacion.cjs");
const { TIPOS_DE_MARCADOR } = require("./marcadores.cjs");
const {
  CONTRATO,
  TIPOS_DE_HALLAZGO,
  claveDe,
  delRegistro,
  lineaCon,
  textoDe,
  totales,
} = require("./libro.cjs");

/** El contenido de un archivo del árbol como `Buffer`, o `null`. */
function contenidoDe({ leer }, archivo) {
  const contenido = leer(archivo);
  return contenido === null ? null : Buffer.from(contenido);
}

/** Un hallazgo en un archivo y línea concretos (el marcador), con el motivo y la corrección. */
const enElMarcador = (codigo, archivo, linea, motivo, correccion) => ({
  codigo,
  archivo,
  linea,
  contrato: CONTRATO,
  motivo,
  correccion,
});

/**
 * Compara el árbol de la base con el del cambio.
 *
 * @param {{ base: object, pr: object, bloquea: boolean }} datos `base` y `pr` son lo que devuelve `evaluarArbol`
 *   más su `arbol`; `bloquea` es `bloqueaDeudaEnArchivoTocado` de la configuración DEL CAMBIO.
 * @returns {{ fallas: object[], avisos: object[], tendencia: object }}
 */
function compararConLaBase({ base, pr, bloquea }) {
  const fallas = [];
  const avisos = [];
  const vigente = (tipo, archivo) =>
    pr.entradas.some((e) => e.vigente && e.tipo === tipo && e.archivos.includes(archivo));
  const registrada = (tipo, archivo) =>
    pr.entradas.some((e) => e.tipo === tipo && e.archivos.includes(archivo));
  const tocado = (archivo) => {
    const antes = contenidoDe(base.arbol, archivo);
    const despues = contenidoDe(pr.arbol, archivo);
    return antes === null || despues === null || !antes.equals(despues);
  };
  const delCambio = new Map(pr.entradas.map((e) => [e.id, e]));

  // (a) archivo tocado que conserva su deuda: falla o, con `bloqueaDeudaEnArchivoTocado: false`, avisa
  const enArchivoTocado = (hallazgo) => {
    if (bloquea) fallas.push(hallazgo);
    else avisos.push({ ...hallazgo, codigo: "deuda-en-archivo-tocado-sin-bloqueo" });
  };
  for (const { tipo, archivo } of base.medicion.lista) {
    const ahora = pr.medicion.porClave.get(claveDe(tipo, archivo));
    if (ahora === undefined || !tocado(archivo) || vigente(tipo, archivo)) continue;
    enArchivoTocado(
      enElMarcador(
        "deuda-en-archivo-tocado",
        archivo,
        ahora.lineas[0],
        `El cambio toca este archivo y conserva su deuda «${tipo}» (${ahora.lineas.length} marcadores): la regla es resolverla en el mismo cambio.`,
        "Pagá la deuda en este cambio, o pedí una excepción (motivo, aprobadoPor y vence ≤ 60 días) en el registro.",
      ),
    );
  }
  for (const antes of base.entradas) {
    const ahora = delCambio.get(antes.id);
    if (antes.verificacion === null || ahora === undefined) continue;
    const archivo = antes.archivos.find(
      (candidato) =>
        tocado(candidato) &&
        textoDe(pr.arbol.leer, candidato)?.includes(antes.verificacion) === true,
    );
    if (archivo === undefined || vigente(ahora.tipo, archivo)) continue;
    enArchivoTocado(
      delRegistro(
        "deuda-en-archivo-tocado",
        `El cambio toca «${archivo}» y la deuda «${antes.id}» sigue abierta (el archivo todavía contiene «${antes.verificacion}»): la regla es resolverla en el mismo cambio.`,
        "Resolvela en este cambio, o pedí una excepción (motivo, aprobadoPor y vence ≤ 60 días) en el registro.",
        enJson(ahora.indice, "id"),
      ),
    );
  }

  // (b) marcadores y hallazgos nuevos, y (c) el total que sube
  for (const { tipo, archivo, lineas, tamano } of pr.medicion.lista) {
    const antes = base.medicion.porClave.get(claveDe(tipo, archivo));
    if (vigente(tipo, archivo)) continue;
    if (antes === undefined) {
      fallas.push(
        enElMarcador(
          "deuda-nueva-sin-excepcion",
          archivo,
          lineas[0],
          `Aparece deuda nueva «${tipo}» (${lineas.length} marcadores) que la base no tenía en este archivo, sin una excepción vigente.`,
          "No la introduzcas, o pedí una excepción (motivo, aprobadoPor y vence ≤ 60 días) en el registro.",
        ),
      );
    } else if (tamano !== undefined) {
      // un archivo sobre el tope: lo que cuenta es su tamaño, que solo puede bajar
      if (tamano > antes.tamano) {
        fallas.push(
          enElMarcador(
            "deuda-total-sube",
            archivo,
            antes.tamano + 1,
            `El tamaño de este archivo (deuda «${tipo}») sube de ${antes.tamano} a ${tamano} líneas sin una excepción vigente.`,
            "Achicalo (el trinquete solo baja), o pedí una excepción (motivo, aprobadoPor y vence ≤ 60 días) en el registro.",
          ),
        );
      }
    } else if (lineas.length > antes.lineas.length) {
      fallas.push(
        enElMarcador(
          "deuda-total-sube",
          archivo,
          lineas[antes.lineas.length],
          `El total de «${tipo}» en este archivo sube de ${antes.lineas.length} a ${lineas.length} sin una excepción vigente.`,
          "Sacá el marcador de más, o pedí una excepción (motivo, aprobadoPor y vence ≤ 60 días) en el registro.",
        ),
      );
    }
  }
  const idsDeLaBase = new Set(base.entradas.map((e) => e.id));
  for (const entrada of pr.entradas) {
    if (
      TIPOS_DE_HALLAZGO.includes(entrada.tipo) &&
      !idsDeLaBase.has(entrada.id) &&
      !entrada.excepcion
    ) {
      fallas.push(
        delRegistro(
          "deuda-nueva-sin-excepcion",
          `La entrada «${entrada.id}» es deuda nueva (la base no la tenía) y no lleva excepción: motivo, aprobadoPor y vence.`,
          "Una deuda nueva necesita una excepción (≤ 60 días) aprobada por el dueño.",
          enJson(entrada.indice, "id"),
        ),
      );
    }
  }

  // (d) una entrada que desaparece sin que el problema se haya resuelto
  for (const antes of base.entradas) {
    if (delCambio.has(antes.id)) continue;
    if (TIPOS_DE_MARCADOR.includes(antes.tipo)) {
      const sigue = pr.medicion.porClave.get(claveDe(antes.tipo, antes.archivos[0]));
      if (sigue !== undefined && !registrada(antes.tipo, antes.archivos[0])) {
        fallas.push(
          enElMarcador(
            "deuda-entrada-borrada",
            antes.archivos[0],
            sigue.lineas[0],
            `La entrada «${antes.id}» ya no está en el registro y el marcador «${antes.tipo}» sigue acá: se borró la deuda sin pagarla.`,
            "Devolvé la entrada al registro, o resolvé el marcador.",
          ),
        );
      }
    } else if (antes.verificacion !== null) {
      for (const archivo of antes.archivos) {
        const texto = textoDe(pr.arbol.leer, archivo);
        const linea = texto === null ? null : lineaCon(texto, antes.verificacion);
        if (linea !== null) {
          fallas.push(
            enElMarcador(
              "deuda-entrada-borrada",
              archivo,
              linea,
              `La entrada «${antes.id}» ya no está en el registro y el problema sigue (acá todavía está «${antes.verificacion}»): se borró la deuda sin pagarla.`,
              "Devolvé la entrada al registro, o resolvé el problema.",
            ),
          );
          break;
        }
      }
    } else {
      avisos.push(
        delRegistro(
          "deuda-borrada-sin-verificar",
          `La entrada «${antes.id}» ya no está en el registro y no tiene verificación: la máquina no puede saber si se pagó.`,
          "Que quien revisa el cambio confirme que la deuda se resolvió de verdad.",
          enArchivo(),
        ),
      );
    }
  }

  return {
    fallas,
    avisos,
    tendencia: { base: totales(base), pr: totales(pr) },
  };
}

module.exports = { compararConLaBase };
