import { X509Certificate, type KeyObject } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as pkijs from "pkijs";
import {
  TIEMPOS,
  cuerpoDeAutorizacion,
  leerAutorizacion,
  llamarWsfe,
  loginCms,
  type Credencial,
  type DatosDelComprobante,
  type Extremos,
  type Grabadora,
  type Llamada,
} from "./arca.ts";
import { armarTra, desdePem, firmarTra, generarPedido, leerCertificado, type Hash } from "./cms.ts";
import { enviar } from "./transporte.ts";
import { buscar, buscarTodos, textoDe } from "./xml.ts";

/**
 * Las verificaciones E1-E14 del espía (h7 facturación §B.5.6), en el orden en que se pueden hacer. Cada una devuelve
 * su estado y lo que encontró, en castellano y SIN credenciales (el `Token`, el `Sign` y la clave nunca entran en
 * `detalle`). E13 queda «pendiente: necesita despliegue»: desde la computadora del dueño se registra igual el TLS.
 */

type Estado = "APROBADA" | "FALLIDA" | "INFORMATIVA" | "OMITIDA" | "PENDIENTE";

export type Verificacion = Readonly<{
  id: string;
  titulo: string;
  estado: Estado;
  detalle: string[];
}>;

export type Alias = Readonly<{ nombre: string; certificadoPem: string; clave: KeyObject }>;

export type Configuracion = Readonly<{
  modo: "REAL" | "SECO";
  extremos: Extremos;
  /** Los del dominio nuevo (arca.gob.ar), para E13; en seco, el mismo falso. */
  extremosAlternativos: Extremos;
  salida: string;
  /** El CUIT representado (el del emisor): va en `Auth.Cuit`. */
  cuit: string;
  /** El CUIT de la persona física titular del certificado (WSASS): va en el sujeto del CSR y del certificado. */
  cuitTitular: string;
  puntoDeVenta: number;
  cuitReceptor: string;
  alias1: Alias;
  alias2: Alias | null;
  cadenaPem: string | null;
  /** E1: dónde guardar la clave nueva (fuera de la salida, permisos 600). En seco no se guarda. */
  pedidoNuevo: Readonly<{
    organizacion: string;
    alias: string;
    rutaDeLaClave: string | null;
  }> | null;
  /** El reloj de la corrida (las fechas de los comprobantes salen de acá). */
  ahora: () => Date;
}>;

/** Lo que una verificación deja para las siguientes. */
type Estado_ = {
  credencial: Credencial | null;
  llamadas: Llamada[];
  facturaB: DatosDelComprobante | null;
};

const describir = (l: Llamada): string => {
  const partes = [`${l.operacion}: ${l.ms} ms`];
  if (l.falla !== null) partes.push(`sin respuesta (${l.falla.fase}, ${l.falla.motivo})`);
  if (l.estadoHttp !== null) partes.push(`HTTP ${l.estadoHttp}`);
  if (l.faltaSoap !== null) partes.push(`falla SOAP ${l.faltaSoap.codigo}: ${l.faltaSoap.texto}`);
  if (l.errores.length > 0)
    partes.push(`Errors ${l.errores.map((e) => `${e.codigo} (${e.texto})`).join("; ")}`);
  if (l.observaciones.length > 0) {
    partes.push(
      `Observaciones ${l.observaciones.map((e) => `${e.codigo} (${e.texto})`).join("; ")}`,
    );
  }
  if (l.eventos.length > 0) partes.push(`Events ${l.eventos.map((e) => e.codigo).join(", ")}`);
  return partes.join(" · ");
};

/** La fecha del día en Argentina, `AAAAMMDD` (CbteFch). */
const fechaArca = (ahora: Date) =>
  new Date(ahora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10).replaceAll("-", "");

// --------------------------------------------------------------------------------------------------

function e2(c: Configuracion): Verificacion {
  const detalle: string[] = [];
  try {
    const cert = new X509Certificate(c.alias1.certificadoPem);
    detalle.push(`Sujeto: ${cert.subject.replaceAll("\n", ", ")}`);
    detalle.push(`Emisor: ${cert.issuer.replaceAll("\n", ", ")}`);
    detalle.push(`Vence: ${cert.validTo}`);
    const conCuit = cert.subject.includes(c.cuit);
    detalle.push(
      conCuit
        ? "El sujeto nombra el CUIT configurado."
        : "OJO: el sujeto NO nombra el CUIT configurado.",
    );
    const corresponde = cert.checkPrivateKey(c.alias1.clave);
    detalle.push(
      corresponde
        ? "La clave corresponde al certificado."
        : "La clave NO corresponde al certificado.",
    );
    let cadena = true;
    if (c.cadenaPem === null) {
      detalle.push("Sin cadena de homologación configurada: la cadena no se verificó.");
    } else {
      const bloques =
        c.cadenaPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
      const autoridades = bloques.map((b) => new X509Certificate(b));
      const emisor = autoridades.find((a) => cert.checkIssued(a) && cert.verify(a.publicKey));
      cadena = emisor !== undefined;
      detalle.push(
        cadena
          ? `La cadena verifica: firmado por ${emisor?.subject.replaceAll("\n", ", ") ?? ""}.`
          : "La cadena NO verifica con los certificados dados.",
      );
    }
    detalle.push("Todo con node:crypto (X509Certificate): sin librería extra.");
    return {
      id: "E2",
      titulo: "Leer el certificado con node:crypto",
      estado: corresponde && cadena ? "APROBADA" : "FALLIDA",
      detalle,
    };
  } catch {
    return {
      id: "E2",
      titulo: "Leer el certificado con node:crypto",
      estado: "FALLIDA",
      detalle: ["El certificado no se pudo leer (¿es PEM?)."],
    };
  }
}

async function e1(c: Configuracion): Promise<Verificacion> {
  const titulo = "Clave RSA 2048 y CSR con pkijs";
  if (c.pedidoNuevo === null) {
    return {
      id: "E1",
      titulo,
      estado: "OMITIDA",
      detalle: ["No se configuró el alias nuevo (ZULUHUB_ESPIA_ALIAS_NUEVO)."],
    };
  }
  const { organizacion, alias, rutaDeLaClave } = c.pedidoNuevo;
  const { pedidoPem, clave } = await generarPedido({ organizacion, alias, cuit: c.cuitTitular });
  const pedido = pkijs.CertificationRequest.fromBER(desdePem(pedidoPem, "CERTIFICATE REQUEST"));
  const firmaValida = await pedido.verify();
  const archivo = `pedido-${alias}.csr`;
  writeFileSync(join(c.salida, archivo), pedidoPem, { mode: 0o644 });
  const detalle = [
    `CSR generado en ${archivo} (sujeto C=AR, O=${organizacion}, CN=${alias}, serialNumber=CUIT ${c.cuitTitular}).`,
    firmaValida ? "La firma del CSR verifica (SHA-256)." : "La firma del CSR NO verifica.",
  ];
  if (rutaDeLaClave !== null) {
    // `wx`: nunca pisa un archivo; 600: solo el dueño la lee. Nunca se imprime.
    writeFileSync(rutaDeLaClave, clave.export({ format: "pem", type: "pkcs8" }), {
      mode: 0o600,
      flag: "wx",
    });
    detalle.push(
      "La clave quedó en la ruta que indicaste (permisos 600); no se copió a la salida.",
    );
  } else {
    detalle.push("Modo seco: la clave no se guardó en ningún lado.");
  }
  detalle.push(
    "Falta el paso manual: subir el CSR al WSASS de homologación y bajar el certificado (ver LEEME).",
  );
  return { id: "E1", titulo, estado: firmaValida ? "APROBADA" : "FALLIDA", detalle };
}

async function e3(c: Configuracion, g: Grabadora, s: Estado_): Promise<Verificacion> {
  const detalle: string[] = [];
  const cert = leerCertificado(c.alias1.certificadoPem);
  let alguna = false;
  for (const hash of ["SHA-256", "SHA-1"] as Hash[]) {
    const ahora = c.ahora();
    const cms = await firmarTra(armarTra(ahora), cert, c.alias1.clave, hash, ahora);
    const r = await loginCms(g, c.extremos, cms, `E3-loginCms-${hash}`);
    s.llamadas.push(r.llamada);
    if (r.ticket !== null) {
      alguna = true;
      if (s.credencial === null) s.credencial = { ticket: r.ticket, cuit: c.cuit };
      detalle.push(
        `${hash}: ticket de acceso OBTENIDO (generado ${r.ticket.generacion ?? "?"}, vence ${r.ticket.expiracion ?? "?"}).`,
      );
    } else {
      const codigo = r.llamada.faltaSoap?.codigo ?? "";
      if (/alreadyAuthenticated/i.test(codigo)) {
        alguna = alguna || hash === "SHA-1";
        detalle.push(
          `${hash}: ${describir(r.llamada)} — ya hay un ticket vigente para este certificado: WSAA aceptó la firma y frenó por el ticket (inferido).`,
        );
      } else {
        detalle.push(`${hash}: ${describir(r.llamada)}`);
      }
    }
  }
  detalle.push("El ticket queda SOLO en memoria durante esta corrida; no se guarda ni se muestra.");
  return {
    id: "E3",
    titulo: "Firmar el TRA en CMS (SHA-256 y SHA-1) y loginCms",
    estado: alguna ? "APROBADA" : "FALLIDA",
    detalle,
  };
}

async function e4(c: Configuracion, g: Grabadora, s: Estado_): Promise<Verificacion> {
  const detalle: string[] = [];
  const ahora = c.ahora();
  const cms = await firmarTra(
    armarTra(ahora),
    leerCertificado(c.alias1.certificadoPem),
    c.alias1.clave,
    "SHA-256",
    ahora,
  );
  const otra = await loginCms(g, c.extremos, cms, "E4-otro-ticket-mismo-alias");
  s.llamadas.push(otra.llamada);
  detalle.push(
    otra.ticket === null
      ? `Mismo certificado con un ticket vigente: ${describir(otra.llamada)}`
      : "Mismo certificado con un ticket vigente: ARCA emitió OTRO ticket (no rechaza).",
  );
  if (c.alias2 === null) {
    detalle.push(
      "Segundo alias: no configurado (ZULUHUB_ESPIA_CERTIFICADO_2 y ZULUHUB_ESPIA_CLAVE_2).",
    );
  } else {
    const ahora2 = c.ahora();
    const cms2 = await firmarTra(
      armarTra(ahora2),
      leerCertificado(c.alias2.certificadoPem),
      c.alias2.clave,
      "SHA-256",
      ahora2,
    );
    const segundo = await loginCms(g, c.extremos, cms2, "E4-segundo-alias");
    s.llamadas.push(segundo.llamada);
    if (segundo.ticket !== null) {
      detalle.push(
        "Segundo alias del mismo CUIT: obtuvo SU PROPIO ticket mientras el primero sigue vigente.",
      );
      if (s.credencial === null) s.credencial = { ticket: segundo.ticket, cuit: c.cuit };
    } else {
      detalle.push(`Segundo alias: ${describir(segundo.llamada)}`);
    }
  }
  return {
    id: "E4",
    titulo: "Otro ticket con uno vigente; segundo alias",
    estado: "INFORMATIVA",
    detalle,
  };
}

const PARAMETROS = [
  "FEParamGetTiposCbte",
  "FEParamGetTiposDoc",
  "FEParamGetTiposIva",
  "FEParamGetCondicionIvaReceptor",
  "FEParamGetTiposConcepto",
  "FEParamGetTiposMonedas",
] as const;

async function e5(c: Configuracion, g: Grabadora, s: Estado_): Promise<Verificacion> {
  const detalle: string[] = [];
  const dummy = await llamarWsfe(g, c.extremos, "FEDummy", null, "", TIEMPOS.consultaMs);
  s.llamadas.push(dummy);
  detalle.push(
    `FEDummy: AppServer=${textoDe(dummy.xml ?? undefined, "AppServer") ?? "?"}, DbServer=${textoDe(dummy.xml ?? undefined, "DbServer") ?? "?"}, AuthServer=${textoDe(dummy.xml ?? undefined, "AuthServer") ?? "?"}`,
  );
  if (s.credencial === null) {
    detalle.push("Sin ticket de acceso: las seis FEParamGet* no se pudieron llamar (ver E3/E4).");
    return { id: "E5", titulo: "FEDummy y FEParamGet*", estado: "FALLIDA", detalle };
  }
  let bien = dummy.falla === null && dummy.faltaSoap === null;
  const tablas: Record<string, string[]> = {};
  for (const op of PARAMETROS) {
    const l = await llamarWsfe(g, c.extremos, op, s.credencial, "", TIEMPOS.consultaMs);
    s.llamadas.push(l);
    if (l.falla !== null || l.faltaSoap !== null || l.errores.length > 0) bien = false;
    const items = [
      ...buscarTodos(buscar(l.xml ?? undefined, "ResultGet"), "Item"),
      ...buscarTodos(buscar(l.xml ?? undefined, "ResultGet"), "CondicionIvaReceptor"),
      ...buscarTodos(buscar(l.xml ?? undefined, "ResultGet"), "Moneda"),
    ];
    tablas[op] = items.map((i) =>
      [textoDe(i, "Id"), textoDe(i, "Desc"), textoDe(i, "Cmp_Clase")]
        .filter((x) => x !== null)
        .join(" | "),
    );
    detalle.push(`${describir(l)} · ${tablas[op]?.length ?? 0} filas`);
  }
  writeFileSync(join(c.salida, "tablas-de-arca.json"), `${JSON.stringify(tablas, null, 2)}\n`);
  detalle.push(
    "Las tablas quedaron en tablas-de-arca.json: con ellas se corrigen las de §B.3 (alícuotas 5 % y 2,5 %, documentos, condiciones por clase).",
  );
  return {
    id: "E5",
    titulo: "FEDummy y FEParamGet*",
    estado: bien ? "APROBADA" : "FALLIDA",
    detalle,
  };
}

async function ultimo(
  c: Configuracion,
  g: Grabadora,
  s: Estado_,
  tipo: number,
): Promise<bigint | null> {
  if (s.credencial === null) return null;
  const l = await llamarWsfe(
    g,
    c.extremos,
    "FECompUltimoAutorizado",
    s.credencial,
    `<ar:PtoVta>${c.puntoDeVenta}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo>`,
    TIEMPOS.consultaMs,
    `FECompUltimoAutorizado-${tipo}`,
  );
  s.llamadas.push(l);
  const n = textoDe(l.xml ?? undefined, "CbteNro");
  return n !== null && /^\d+$/.test(n) ? BigInt(n) : null;
}

async function e6(c: Configuracion, g: Grabadora, s: Estado_): Promise<Verificacion> {
  const detalle: string[] = [];
  let bien = s.credencial !== null;
  for (const [tipo, nombre] of [
    [1, "Factura A"],
    [6, "Factura B"],
    [8, "Nota de crédito B"],
    [11, "Factura C"],
  ] as const) {
    const n = await ultimo(c, g, s, tipo);
    if (n === null) bien = false;
    detalle.push(
      `${nombre} (${tipo}): último autorizado ${n === null ? "sin dato" : n.toString()}`,
    );
  }
  return {
    id: "E6",
    titulo: "FECompUltimoAutorizado por tipo",
    estado: bien ? "APROBADA" : "FALLIDA",
    detalle,
  };
}

async function autorizar(
  c: Configuracion,
  g: Grabadora,
  s: Estado_,
  datos: Omit<DatosDelComprobante, "numero" | "fecha" | "puntoDeVenta">,
  etiqueta: string,
  numero?: bigint,
): Promise<{ llamada: Llamada | null; datos: DatosDelComprobante | null; texto: string }> {
  if (s.credencial === null) return { llamada: null, datos: null, texto: "sin ticket de acceso" };
  const n = numero ?? ((await ultimo(c, g, s, datos.tipo)) ?? -1n) + 1n;
  if (n <= 0n) return { llamada: null, datos: null, texto: "no se pudo saber el próximo número" };
  const completo: DatosDelComprobante = {
    ...datos,
    puntoDeVenta: c.puntoDeVenta,
    numero: n,
    fecha: fechaArca(c.ahora()),
  };
  const l = await llamarWsfe(
    g,
    c.extremos,
    "FECAESolicitar",
    s.credencial,
    cuerpoDeAutorizacion(completo),
    TIEMPOS.autorizarMs,
    etiqueta,
  );
  s.llamadas.push(l);
  const r = leerAutorizacion(l);
  const cae =
    r.cae === null
      ? ""
      : ` · CAE ${r.cae} (${r.cae.length} dígitos, texto) vence ${r.vence ?? "?"}`;
  return {
    llamada: l,
    datos: completo,
    texto: `número ${n} · Resultado ${r.resultado ?? "?"}${cae} · ${describir(l)}`,
  };
}

const aprobado = (l: Llamada | null) => l !== null && leerAutorizacion(l).resultado === "A";

async function e7(c: Configuracion, g: Grabadora, s: Estado_): Promise<Verificacion> {
  const r = await autorizar(
    c,
    g,
    s,
    {
      tipo: 6,
      concepto: 1,
      docTipo: 99,
      docNro: "0",
      condicionIvaReceptor: 5,
      total: 23_150n,
      neto: 20_000n,
      iva: 3_150n,
      alicuotas: [
        { id: 5, base: 10_000n, iva: 2_100n },
        { id: 4, base: 10_000n, iva: 1_050n },
      ],
      asociado: null,
    },
    "E7-factura-B",
  );
  if (aprobado(r.llamada)) s.facturaB = r.datos;
  const sinAvisos =
    r.llamada !== null &&
    !r.llamada.errores.some((e) => e.codigo === "10048" || e.codigo === "10023");
  return {
    id: "E7",
    titulo: "Factura B a consumidor final, IVA incluido en dos alícuotas ($231,50)",
    estado: aprobado(r.llamada) && sinAvisos ? "APROBADA" : "FALLIDA",
    detalle: [
      r.texto,
      "Importes enviados: ImpTotal 231.50, ImpNeto 200.00, ImpIVA 31.50 (21 %: 100.00 + 21.00; 10,5 %: 100.00 + 10.50).",
    ],
  };
}

async function e8(c: Configuracion, g: Grabadora, s: Estado_): Promise<Verificacion> {
  const r = await autorizar(
    c,
    g,
    s,
    {
      tipo: 1,
      concepto: 1,
      docTipo: 80,
      docNro: c.cuitReceptor,
      condicionIvaReceptor: 1,
      total: 12_100n,
      neto: 10_000n,
      iva: 2_100n,
      alicuotas: [{ id: 5, base: 10_000n, iva: 2_100n }],
      asociado: null,
    },
    "E8-factura-A",
  );
  return {
    id: "E8",
    titulo: "Factura A a un CUIT de prueba, IVA discriminado",
    estado: aprobado(r.llamada) ? "APROBADA" : "INFORMATIVA",
    detalle: [r.texto, "Si ARCA exige un CUIT activo en homologación, el error queda arriba."],
  };
}

async function e9(c: Configuracion, g: Grabadora, s: Estado_): Promise<Verificacion> {
  const r = await autorizar(
    c,
    g,
    s,
    {
      tipo: 11,
      concepto: 1,
      docTipo: 99,
      docNro: "0",
      condicionIvaReceptor: 5,
      total: 10_000n,
      neto: 10_000n,
      iva: 0n,
      alicuotas: [],
      asociado: null,
    },
    "E9-factura-C",
  );
  return {
    id: "E9",
    titulo: "Factura C",
    estado: aprobado(r.llamada) ? "APROBADA" : "INFORMATIVA",
    detalle: [r.texto],
  };
}

async function e10(c: Configuracion, g: Grabadora, s: Estado_): Promise<Verificacion> {
  const f = s.facturaB;
  if (f === null)
    return {
      id: "E10",
      titulo: "Notas de crédito B",
      estado: "OMITIDA",
      detalle: ["E7 no autorizó la factura B: no hay a qué asociar."],
    };
  const asociado = {
    tipo: 6,
    puntoDeVenta: f.puntoDeVenta,
    numero: f.numero,
    cuit: c.cuit,
    fecha: f.fecha,
  };
  const base = {
    tipo: 8,
    concepto: 1,
    docTipo: 99,
    docNro: "0",
    condicionIvaReceptor: 5,
    asociado,
  };
  const total = await autorizar(
    c,
    g,
    s,
    { ...base, total: f.total, neto: f.neto, iva: f.iva, alicuotas: f.alicuotas },
    "E10-NC-total",
  );
  const parcial = await autorizar(
    c,
    g,
    s,
    {
      ...base,
      total: 12_100n,
      neto: 10_000n,
      iva: 2_100n,
      alicuotas: [{ id: 5, base: 10_000n, iva: 2_100n }],
    },
    "E10-NC-parcial",
  );
  const mayor = await autorizar(
    c,
    g,
    s,
    {
      ...base,
      total: 50_000n,
      neto: 41_322n,
      iva: 8_678n,
      alicuotas: [{ id: 5, base: 41_322n, iva: 8_678n }],
    },
    "E10-NC-mayor",
  );
  const con10237 = mayor.llamada?.observaciones.some((o) => o.codigo === "10237") === true;
  return {
    id: "E10",
    titulo: "NC B total y parcial con CbtesAsoc; NC mayor que la factura",
    estado:
      aprobado(total.llamada) && aprobado(parcial.llamada) && aprobado(mayor.llamada) && con10237
        ? "APROBADA"
        : "INFORMATIVA",
    detalle: [
      `Total: ${total.texto}`,
      `Parcial: ${parcial.texto}`,
      `Mayor ($500,00): ${mayor.texto}`,
      con10237
        ? "La mayor vino con la observación 10237."
        : "La mayor NO trajo la observación 10237.",
    ],
  };
}

async function e11(c: Configuracion, g: Grabadora, s: Estado_): Promise<Verificacion> {
  const f = s.facturaB;
  if (f === null)
    return {
      id: "E11",
      titulo: "Reenviar un número ya autorizado",
      estado: "OMITIDA",
      detalle: ["E7 no autorizó la factura B."],
    };
  const { numero } = f;
  // `autorizar` pisa el punto de venta, el número y la fecha: se le pasa la factura de E7 tal cual.
  const resto = f;
  const mismo = await autorizar(c, g, s, resto, "E11-reenvio-mismos-datos", numero);
  const otros = await autorizar(
    c,
    g,
    s,
    {
      ...resto,
      total: 12_100n,
      neto: 10_000n,
      iva: 2_100n,
      alicuotas: [{ id: 5, base: 10_000n, iva: 2_100n }],
    },
    "E11-reenvio-otros-datos",
    numero,
  );
  const reautorizo = aprobado(mismo.llamada) || aprobado(otros.llamada);
  return {
    id: "E11",
    titulo: "Reenviar un número ya autorizado (mismos datos y otros)",
    estado: "INFORMATIVA",
    detalle: [
      `Mismos datos: ${mismo.texto}`,
      `Otros datos: ${otros.texto}`,
      reautorizo
        ? "ARCA respondió A a un reenvío: un reintento ciego NO se nota en la respuesta. Confirma que hay que consultar antes de reenviar."
        : "ARCA rechazó los dos reenvíos: un reintento ciego deja un rechazo y no un CAE (igual se consulta antes, §B.5.4).",
    ],
  };
}

async function e12(c: Configuracion, g: Grabadora, s: Estado_): Promise<Verificacion> {
  const f = s.facturaB;
  if (f === null || s.credencial === null)
    return {
      id: "E12",
      titulo: "FECompConsultar",
      estado: "OMITIDA",
      detalle: ["Sin la factura B de E7."],
    };
  const consultar = async (n: bigint, etiqueta: string) => {
    const l = await llamarWsfe(
      g,
      c.extremos,
      "FECompConsultar",
      s.credencial,
      `<ar:FeCompConsReq><ar:CbteTipo>6</ar:CbteTipo><ar:CbteNro>${n}</ar:CbteNro><ar:PtoVta>${f.puntoDeVenta}</ar:PtoVta></ar:FeCompConsReq>`,
      TIEMPOS.consultaMs,
      etiqueta,
    );
    s.llamadas.push(l);
    return l;
  };
  const existe = await consultar(f.numero, "E12-consulta-existente");
  const noExiste = await consultar(f.numero + 1000n, "E12-consulta-inexistente");
  const cae = textoDe(existe.xml ?? undefined, "CodAutorizacion");
  const con602 = noExiste.errores.some((e) => e.codigo === "602");
  return {
    id: "E12",
    titulo: "FECompConsultar de un número existente y de uno inexistente",
    estado: cae !== null && con602 ? "APROBADA" : "INFORMATIVA",
    detalle: [
      `Existente: CodAutorizacion ${cae ?? "?"}, FchVto ${textoDe(existe.xml ?? undefined, "FchVto") ?? "?"}, ImpTotal ${textoDe(existe.xml ?? undefined, "ImpTotal") ?? "?"} · ${describir(existe)}`,
      `Inexistente: ${describir(noExiste)}${con602 ? " (602 = no existe: inequívoco)" : ""}`,
    ],
  };
}

async function e13(c: Configuracion, g: Grabadora, s: Estado_): Promise<Verificacion> {
  const detalle = [
    "PENDIENTE: necesita despliegue (probar el TLS desde Vercel gru1). Lo de abajo es desde ESTA computadora.",
  ];
  const vistos = new Set<string>();
  for (const l of s.llamadas) {
    if (l.tls === null || vistos.has(l.operacion === "loginCms" ? "wsaa" : "wsfe")) continue;
    vistos.add(l.operacion === "loginCms" ? "wsaa" : "wsfe");
    detalle.push(
      `${l.operacion === "loginCms" ? "WSAA" : "WSFE"}: ${l.tls.protocolo ?? "?"} · ${l.tls.cifrado ?? "?"} · sujeto ${l.tls.sujeto ?? "?"} · emisor ${l.tls.emisor ?? "?"} · vence ${l.tls.vence ?? "?"} · SAN ${l.tls.nombresAlternativos ?? "?"}`,
    );
  }
  if (c.modo === "SECO") detalle.push("Modo seco: sin TLS (servidor falso local).");
  for (const [nombre, url] of [
    ["WSAA en arca.gob.ar", c.extremosAlternativos.wsaa],
    ["WSFE en arca.gob.ar", c.extremosAlternativos.wsfe],
  ] as const) {
    const sobre = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><FEDummy xmlns="http://ar.gov.afip.dif.FEV1/"/></soap:Body></soap:Envelope>`;
    const r = await enviar(
      url,
      sobre,
      {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '"http://ar.gov.afip.dif.FEV1/FEDummy"',
      },
      { totalMs: TIEMPOS.consultaMs },
    );
    g.grabar(
      `E13-${nombre}`,
      r.ok ? r.respuesta.cuerpo : `sin respuesta: ${r.falla.fase} ${r.falla.motivo}`,
    );
    detalle.push(
      r.ok
        ? `${nombre}: HTTP ${r.respuesta.estado}${r.respuesta.tls === null ? "" : ` · ${r.respuesta.tls.protocolo ?? "?"} · SAN ${r.respuesta.tls.nombresAlternativos ?? "?"}`}`
        : `${nombre}: sin respuesta (${r.falla.motivo})`,
    );
  }
  return { id: "E13", titulo: "TLS desde el entorno de Vercel gru1", estado: "PENDIENTE", detalle };
}

function e14(s: Estado_): Verificacion {
  const porOperacion = new Map<string, number[]>();
  for (const l of s.llamadas) {
    if (l.falla !== null) continue;
    porOperacion.set(l.operacion, [...(porOperacion.get(l.operacion) ?? []), l.ms]);
  }
  const detalle = [...porOperacion.entries()].map(([op, ms]) => {
    const o = [...ms].sort((a, b) => a - b);
    return `${op}: ${o.length} llamadas · mínimo ${o[0]} ms · mediana ${o[Math.floor(o.length / 2)]} ms · máximo ${o.at(-1)} ms`;
  });
  return {
    id: "E14",
    titulo: "Latencias",
    estado: "INFORMATIVA",
    detalle: detalle.length > 0 ? detalle : ["Sin llamadas con respuesta."],
  };
}

/** Corre E1-E14 en orden. Una verificación que lanza queda FALLIDA con un motivo sin detalles internos. */
export async function correrVerificaciones(
  c: Configuracion,
  g: Grabadora,
): Promise<Verificacion[]> {
  const s: Estado_ = { credencial: null, llamadas: [], facturaB: null };
  const pasos: [string, string, () => Promise<Verificacion> | Verificacion][] = [
    ["E2", "Leer el certificado", () => e2(c)],
    ["E1", "CSR", () => e1(c)],
    ["E3", "loginCms", () => e3(c, g, s)],
    ["E4", "Otro ticket", () => e4(c, g, s)],
    ["E5", "Parámetros", () => e5(c, g, s)],
    ["E6", "Último autorizado", () => e6(c, g, s)],
    ["E7", "Factura B", () => e7(c, g, s)],
    ["E8", "Factura A", () => e8(c, g, s)],
    ["E9", "Factura C", () => e9(c, g, s)],
    ["E10", "Notas de crédito", () => e10(c, g, s)],
    ["E11", "Reenvío", () => e11(c, g, s)],
    ["E12", "Consultar", () => e12(c, g, s)],
    ["E13", "TLS", () => e13(c, g, s)],
    ["E14", "Latencias", () => e14(s)],
  ];
  const resultados: Verificacion[] = [];
  for (const [id, titulo, paso] of pasos) {
    try {
      resultados.push(await paso());
    } catch (falla) {
      const nombre = falla instanceof Error ? falla.name : "Error";
      resultados.push({
        id,
        titulo,
        estado: "FALLIDA",
        detalle: [
          `El paso se interrumpió (${nombre}). Las grabaciones de arriba muestran hasta dónde llegó.`,
        ],
      });
    }
  }
  return resultados.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}
