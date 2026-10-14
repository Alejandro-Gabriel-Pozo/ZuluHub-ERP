import { generateKeyPairSync, createPrivateKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve } from "node:path";
import { aPem, certificadoDePrueba } from "./cms.ts";
import { Grabadora, HOMOLOGACION, HOMOLOGACION_ARCA_GOB_AR } from "./arca.ts";
import { paraEscribir } from "./saneamiento.ts";
import { levantarServidorFalso } from "./servidor-falso.ts";
import {
  correrVerificaciones,
  type Alias,
  type Configuracion,
  type Verificacion,
} from "./verificaciones.ts";

/**
 * El espía contra homologación de ARCA (spec H7 facturación §B.5.6, tramo F0). RAMA DESCARTABLE: no se integra.
 *
 *   npm run espia                 contra homologación (en la computadora del dueño: desde la nube no hay salida a ARCA)
 *   npm run espia -- --seco       contra un ARCA falso local (prueba el script, no a ARCA)
 *
 * Lee rutas y datos de variables de entorno (ver `LEEME-DEL-DUEÑO.md`), escribe en la carpeta de salida un informe en
 * castellano con cada verificación E1-E14 y las respuestas grabadas SIN `Token` ni `Sign`. Nunca imprime ni guarda
 * la clave privada, el ticket de acceso ni la firma: todo lo que sale pasa por el saneamiento y por una verificación
 * contra las credenciales de la corrida.
 */

export const VARIABLES = {
  certificado: "ZULUHUB_ESPIA_CERTIFICADO",
  clave: "ZULUHUB_ESPIA_CLAVE",
  cuit: "ZULUHUB_ESPIA_CUIT",
  cuitTitular: "ZULUHUB_ESPIA_CUIT_TITULAR",
  puntoDeVenta: "ZULUHUB_ESPIA_PUNTO_DE_VENTA",
  cuitReceptor: "ZULUHUB_ESPIA_CUIT_RECEPTOR",
  salida: "ZULUHUB_ESPIA_SALIDA",
  certificado2: "ZULUHUB_ESPIA_CERTIFICADO_2",
  clave2: "ZULUHUB_ESPIA_CLAVE_2",
  cadena: "ZULUHUB_ESPIA_CADENA",
  organizacion: "ZULUHUB_ESPIA_ORGANIZACION",
  aliasNuevo: "ZULUHUB_ESPIA_ALIAS_NUEVO",
  claveNueva: "ZULUHUB_ESPIA_CLAVE_NUEVA",
} as const;

type Entorno = Readonly<Record<string, string | undefined>>;

const USO = "uso: npm run espia [-- --seco]";

function leer(ruta: string, que: string): string {
  try {
    return readFileSync(ruta, "utf8");
  } catch {
    throw new ErrorDeConfiguracion(`no se pudo leer ${que} en la ruta indicada`);
  }
}

export class ErrorDeConfiguracion extends Error {
  override name = "ErrorDeConfiguracion";
}

function alias(nombre: string, cert: string, clave: string): Alias {
  const certificadoPem = leer(cert, `el certificado (${nombre})`);
  let objeto;
  try {
    objeto = createPrivateKey(leer(clave, `la clave (${nombre})`));
  } catch {
    throw new ErrorDeConfiguracion(`la clave (${nombre}) no es una clave privada PEM legible`);
  }
  return { nombre, certificadoPem, clave: objeto };
}

/** La configuración real, desde las variables de entorno. Valida forma, no contenido (eso es E2). */
export function configuracionReal(entorno: Entorno, ahora: () => Date): Configuracion {
  const exigir = (v: keyof typeof VARIABLES) => {
    const valor = entorno[VARIABLES[v]]?.trim();
    if (valor === undefined || valor === "")
      throw new ErrorDeConfiguracion(`falta la variable ${VARIABLES[v]}`);
    return valor;
  };
  const opcional = (v: keyof typeof VARIABLES) => {
    const valor = entorno[VARIABLES[v]]?.trim();
    return valor === undefined || valor === "" ? null : valor;
  };
  const cuit = exigir("cuit");
  const cuitReceptor = exigir("cuitReceptor");
  const cuitTitular = opcional("cuitTitular") ?? cuit;
  for (const [nombre, valor] of [
    ["ZULUHUB_ESPIA_CUIT", cuit],
    ["ZULUHUB_ESPIA_CUIT_RECEPTOR", cuitReceptor],
  ]) {
    if (!/^\d{11}$/.test(valor ?? ""))
      throw new ErrorDeConfiguracion(`${nombre} tiene que ser un CUIT de 11 dígitos, sin guiones`);
  }
  const pv = Number(exigir("puntoDeVenta"));
  if (!Number.isInteger(pv) || pv < 1 || pv > 99_999) {
    throw new ErrorDeConfiguracion(
      "ZULUHUB_ESPIA_PUNTO_DE_VENTA tiene que ser un número de 1 a 99999",
    );
  }
  const salida = resolve(
    opcional("salida") ?? `espia-salida-${ahora().toISOString().slice(0, 19).replaceAll(":", "-")}`,
  );
  const cert2 = opcional("certificado2");
  const clave2 = opcional("clave2");
  if ((cert2 === null) !== (clave2 === null)) {
    throw new ErrorDeConfiguracion(
      "el segundo alias necesita las dos variables: ZULUHUB_ESPIA_CERTIFICADO_2 y ZULUHUB_ESPIA_CLAVE_2",
    );
  }
  const aliasNuevo = opcional("aliasNuevo");
  const rutaDeLaClave = opcional("claveNueva");
  if (aliasNuevo !== null) {
    if (!/^[A-Za-z0-9]{1,30}$/.test(aliasNuevo))
      throw new ErrorDeConfiguracion("ZULUHUB_ESPIA_ALIAS_NUEVO: solo letras y números, hasta 30");
    if (rutaDeLaClave === null)
      throw new ErrorDeConfiguracion(
        "con ZULUHUB_ESPIA_ALIAS_NUEVO hace falta ZULUHUB_ESPIA_CLAVE_NUEVA (dónde guardar la clave nueva)",
      );
    const dentro = relative(salida, resolve(rutaDeLaClave));
    if (!dentro.startsWith("..") && !isAbsolute(dentro)) {
      throw new ErrorDeConfiguracion(
        "la clave nueva no puede quedar dentro de la carpeta de salida (se comparte)",
      );
    }
    if (existsSync(rutaDeLaClave))
      throw new ErrorDeConfiguracion("ZULUHUB_ESPIA_CLAVE_NUEVA ya existe: no se pisa una clave");
  }
  const rutaCadena = opcional("cadena");
  return {
    modo: "REAL",
    extremos: HOMOLOGACION,
    extremosAlternativos: HOMOLOGACION_ARCA_GOB_AR,
    salida,
    cuit,
    cuitTitular,
    puntoDeVenta: pv,
    cuitReceptor,
    alias1: alias("alias 1", exigir("certificado"), exigir("clave")),
    alias2: cert2 === null || clave2 === null ? null : alias("alias 2", cert2, clave2),
    cadenaPem: rutaCadena === null ? null : leer(rutaCadena, "la cadena de homologación"),
    pedidoNuevo:
      aliasNuevo === null
        ? null
        : {
            organizacion: opcional("organizacion") ?? "ZuluHub espia",
            alias: aliasNuevo,
            rutaDeLaClave,
          },
    ahora,
  };
}

/** Un alias de prueba (clave y certificado autofirmado), solo en memoria: para el modo seco. */
async function aliasDePrueba(nombre: string, cuit: string): Promise<Alias> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const cert = await certificadoDePrueba(
    privateKey,
    new Uint8Array(publicKey.export({ format: "der", type: "spki" })),
    cuit,
  );
  return {
    nombre,
    certificadoPem: aPem(cert.toSchema().toBER(false), "CERTIFICATE"),
    clave: privateKey,
  };
}

export async function configuracionSeca(
  url: string,
  salida: string,
  ahora: () => Date,
): Promise<Configuracion> {
  const cuit = "20111111112";
  const extremos = { wsaa: `${url}/ws/services/LoginCms`, wsfe: `${url}/wsfev1/service.asmx` };
  return {
    modo: "SECO",
    extremos,
    extremosAlternativos: extremos,
    salida,
    cuit,
    cuitTitular: cuit,
    puntoDeVenta: 1,
    cuitReceptor: "30500010912",
    alias1: await aliasDePrueba("alias 1 (seco)", cuit),
    alias2: await aliasDePrueba("alias 2 (seco)", cuit),
    cadenaPem: null,
    pedidoNuevo: { organizacion: "ZuluHub espia", alias: "espiaseco", rutaDeLaClave: null },
    ahora,
  };
}

const MARCA: Record<Verificacion["estado"], string> = {
  APROBADA: "✅ aprobada",
  FALLIDA: "❌ fallida",
  INFORMATIVA: "ℹ️ informativa",
  OMITIDA: "⏭️ omitida",
  PENDIENTE: "⏳ pendiente",
};

function versionDe(paquete: string): string {
  try {
    const requerir = createRequire(import.meta.url);
    const ruta = requerir.resolve(paquete);
    const raiz = ruta.slice(
      0,
      ruta.lastIndexOf(`node_modules/${paquete}`) + `node_modules/${paquete}`.length,
    );
    return (JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")) as { version: string })
      .version;
  } catch {
    return "?";
  }
}

export function armarInforme(
  c: Configuracion,
  resultados: readonly Verificacion[],
  inicio: Date,
): string {
  const lineas = [
    "# Informe del espía contra homologación de ARCA (F0)",
    "",
    `- Modo: **${c.modo === "REAL" ? "homologación real" : "SECO (ARCA falso local: prueba el script, NO es evidencia de ARCA)"}**`,
    `- Empezó: ${inicio.toISOString()} · Node ${process.version}`,
    `- Librerías (solo en esta rama): pkijs ${versionDe("pkijs")}, asn1js ${versionDe("asn1js")}, fast-xml-parser ${versionDe("fast-xml-parser")}`,
    `- CUIT emisor (representado) ${c.cuit} · titular del certificado ${c.cuitTitular} · punto de venta ${c.puntoDeVenta} · CUIT receptor de prueba ${c.cuitReceptor}`,
    "- Las respuestas grabadas están en `grabaciones/`, sin `Token`, `Sign` ni el CMS firmado (dicen `[OCULTO]`).",
    "",
    "| # | Verificación | Resultado |",
    "|---|---|---|",
    ...resultados.map((r) => `| ${r.id} | ${r.titulo} | ${MARCA[r.estado]} |`),
    "",
  ];
  for (const r of resultados) {
    lineas.push(
      `## ${r.id}. ${r.titulo} — ${MARCA[r.estado]}`,
      "",
      ...r.detalle.map((d) => `- ${d}`),
      "",
    );
  }
  return `${lineas.join("\n")}\n`;
}

export type Salida = Readonly<{ codigo: number; informe: string | null }>;

/** Corre todo y escribe el informe. Devuelve el código de salida (0: ninguna fallida). */
export async function ejecutarEspia(
  argumentos: readonly string[],
  entorno: Entorno,
  mostrar: (linea: string) => void,
  ahora: () => Date = () => new Date(),
): Promise<Salida> {
  const seco = argumentos.includes("--seco");
  if (argumentos.some((a) => a !== "--seco")) {
    mostrar(USO);
    return { codigo: 2, informe: null };
  }
  const inicio = ahora();
  let servidor: Awaited<ReturnType<typeof levantarServidorFalso>> | null = null;
  try {
    let c: Configuracion;
    if (seco) {
      servidor = await levantarServidorFalso();
      const salida = resolve(
        entorno[VARIABLES.salida]?.trim() ||
          `espia-seco-${inicio.toISOString().slice(0, 19).replaceAll(":", "-")}`,
      );
      c = await configuracionSeca(servidor.url, salida, ahora);
    } else {
      c = configuracionReal(entorno, ahora);
    }
    mkdirSync(c.salida, { recursive: true });
    const grabadora = new Grabadora(c.salida);
    mostrar(
      `Espía ${c.modo === "SECO" ? "en modo SECO (ARCA falso local)" : "contra homologación"}; salida: ${c.salida}`,
    );
    const resultados = await correrVerificaciones(c, grabadora);
    const informe = paraEscribir(
      armarInforme(c, resultados, inicio),
      grabadora.secretos,
      "informe.md",
    );
    writeFileSync(join(c.salida, "informe.md"), informe);
    const json = paraEscribir(
      `${JSON.stringify(resultados, null, 2)}\n`,
      grabadora.secretos,
      "resultados.json",
    );
    writeFileSync(join(c.salida, "resultados.json"), json);
    for (const r of resultados) mostrar(`${r.id} ${MARCA[r.estado]} — ${r.titulo}`);
    mostrar(`Informe: ${join(c.salida, "informe.md")}`);
    return { codigo: resultados.some((r) => r.estado === "FALLIDA") ? 1 : 0, informe };
  } catch (falla) {
    // Nunca el texto crudo de una excepción: podría traer una ruta con datos o un pedazo de un PEM.
    mostrar(
      falla instanceof ErrorDeConfiguracion
        ? `ERROR: ${falla.message}`
        : `ERROR inesperado (${falla instanceof Error ? falla.name : "desconocido"}); no se escribió ninguna credencial.`,
    );
    return { codigo: 1, informe: null };
  } finally {
    await servidor?.cerrar();
  }
}

// Ejecución directa (`npm run espia`): no corre al importarlo desde las pruebas.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { codigo } = await ejecutarEspia(process.argv.slice(2), process.env, (l) => console.log(l));
  process.exitCode = codigo;
  setTimeout(() => process.exit(codigo), 5_000).unref();
}
