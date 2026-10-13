import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DE_DIRECCION,
  armarDestino,
  leerDireccionPegada,
  type DestinoValidado,
  type ErrorDeDireccion,
  type PartesDeDireccion,
} from "./direccion-externa";

/**
 * C-17: el validador de la dirección pegada. Las tablas son el corpus de ataques conocidos: cada línea
 * dice qué entra y por qué código sale. El host de las pruebas es el del spec (`res.cloudinary.com`).
 */

const BASE = "https://res.cloudinary.com/mi-cafe/image/upload/v1712345678/carta/flan.jpg";
const PARTES: PartesDeDireccion = {
  proveedor: "CLOUDINARY",
  cuenta: "mi-cafe",
  idPublico: "carta/flan",
  version: "1712345678",
  extension: "jpg",
};

function rechazo(texto: string): ErrorDeDireccion | "ACEPTADA" {
  const r = leerDireccionPegada(texto);
  return r.ok ? "ACEPTADA" : r.error;
}

describe("leerDireccionPegada: lo que se acepta (golden de normalización)", () => {
  it.each<[string, string, string, boolean]>([
    ["la forma canónica", BASE, BASE, false],
    ["http:// se acepta como texto y se avisa", BASE.replace("https", "http"), BASE, true],
    [
      "esquema y host en mayúsculas",
      "HTTPS://RES.CLOUDINARY.COM/mi-cafe/image/upload/v1712345678/carta/flan.jpg",
      BASE,
      false,
    ],
    [
      "esquema mixto con http",
      "HtTp://Res.Cloudinary.Com/mi-cafe/image/upload/v1712345678/carta/flan.jpg",
      BASE,
      true,
    ],
    ["con espacios y saltos de línea en las puntas", `  \n\t${BASE}\r\n `, BASE, false],
    ["con espacio duro (NBSP) en las puntas", `\u00a0${BASE}\u00a0`, BASE, false],
    ["entre comillas dobles", `"${BASE}"`, BASE, false],
    ["entre comillas simples", `'${BASE}'`, BASE, false],
    ["entre comillas tipográficas dobles", `\u201C${BASE}\u201D`, BASE, false],
    ["entre comillas tipográficas simples", `\u2018${BASE}\u2019`, BASE, false],
    ["comillas con blancos adentro y afuera", ` " ${BASE} " `, BASE, false],
    [
      "con transformaciones: se descartan",
      "https://res.cloudinary.com/mi-cafe/image/upload/c_fill,w_300,h_200/e_blur:300/v1712345678/carta/flan.jpg",
      BASE,
      false,
    ],
    [
      "con transformación firmada",
      "https://res.cloudinary.com/mi-cafe/image/upload/s--AbCd1234--/f_auto,q_auto/v1712345678/carta/flan.jpg",
      BASE,
      false,
    ],
    [
      "sin carpeta",
      "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.png",
      "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.png",
      false,
    ],
    [
      "extensión en mayúsculas pasa a minúsculas",
      "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.JPEG",
      "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpeg",
      false,
    ],
    [
      "webp",
      "https://res.cloudinary.com/mi-cafe/image/upload/v9/a/b/c/d.webp",
      "https://res.cloudinary.com/mi-cafe/image/upload/v9/a/b/c/d.webp",
      false,
    ],
    [
      "id con guiones y guiones bajos, y mayúsculas",
      "https://res.cloudinary.com/c_1-2/image/upload/v1/Foto_Del-Dia.png",
      "https://res.cloudinary.com/c_1-2/image/upload/v1/Foto_Del-Dia.png",
      false,
    ],
    [
      "una cuenta que se llama como una versión",
      "https://res.cloudinary.com/v1/image/upload/v2/flan.jpg",
      "https://res.cloudinary.com/v1/image/upload/v2/flan.jpg",
      false,
    ],
    [
      "una carpeta que parece versión: manda la primera",
      "https://res.cloudinary.com/mi-cafe/image/upload/w_5/v5/v1700000000/flan.jpg",
      "https://res.cloudinary.com/mi-cafe/image/upload/v5/v1700000000/flan.jpg",
      false,
    ],
  ])("%s", (_nombre, texto, normalizada, eraHttp) => {
    const r = leerDireccionPegada(texto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.direccionNormalizada).toBe(normalizada);
    expect(r.valor.eraHttp).toBe(eraHttp);
    // Leer la normalizada da lo mismo, ya sin aviso de http.
    const otra = leerDireccionPegada(r.valor.direccionNormalizada);
    expect(otra.ok && otra.valor.partes).toEqual(r.valor.partes);
    expect(otra.ok && otra.valor.direccionNormalizada).toBe(normalizada);
    expect(otra.ok && otra.valor.eraHttp).toBe(false);
  });

  it("descompone en partes: proveedor, cuenta, id público, versión (solo dígitos) y extensión", () => {
    const r = leerDireccionPegada(BASE);
    expect(r).toEqual({
      ok: true,
      valor: { partes: PARTES, direccionNormalizada: BASE, eraHttp: false },
    });
  });

  it("los límites exactos se aceptan y uno más se rechaza: cuenta de 64, id de 200, versión de 12 dígitos", () => {
    const prefijo = "https://res.cloudinary.com";
    const conCuenta = (c: string): string => `${prefijo}/${c}/image/upload/v1/a.jpg`;
    expect(rechazo(conCuenta("a".repeat(64)))).toBe("ACEPTADA");
    expect(rechazo(conCuenta("a".repeat(65)))).toBe("CUENTA_INVALIDA");
    const conId = (id: string): string => `${prefijo}/x/image/upload/v1/${id}.webp`;
    expect(rechazo(conId("i".repeat(200)))).toBe("ACEPTADA");
    expect(rechazo(conId("i".repeat(201)))).toBe("ID_INVALIDO");
    // Id de 200 repartido en carpetas: las barras cuentan.
    const carpetas = `${"c".repeat(99)}/${"d".repeat(100)}`;
    expect(carpetas).toHaveLength(200);
    expect(rechazo(conId(carpetas))).toBe("ACEPTADA");
    expect(rechazo(conId(`${carpetas}d`))).toBe("ID_INVALIDO");
    const conVersion = (v: string): string => `${prefijo}/x/image/upload/v${v}/a.jpg`;
    expect(rechazo(conVersion("9".repeat(12)))).toBe("ACEPTADA");
    expect(rechazo(conVersion("9".repeat(13)))).toBe("SIN_VERSION");
  });

  it("el largo máximo de la dirección es 300 (después de recortar): 300 pasa, 301 no", () => {
    expect(LARGO_MAXIMO_DE_DIRECCION).toBe(300);
    const relleno = (largo: number): string => {
      const prefijo = "https://res.cloudinary.com/x/image/upload/";
      const faltan = largo - prefijo.length;
      // transformación de relleno + «/v1/a.jpg»
      return `${prefijo}${"t".repeat(faltan - "/v1/a.jpg".length)}/v1/a.jpg`;
    };
    expect(relleno(300)).toHaveLength(300);
    expect(rechazo(relleno(300))).toBe("ACEPTADA");
    expect(rechazo(relleno(301))).toBe("DEMASIADO_LARGA");
  });

  it("versión: sin ceros a la izquierda; de 1 a 12 dígitos", () => {
    const con = (v: string): string => `https://res.cloudinary.com/x/image/upload/${v}/a.jpg`;
    expect(rechazo(con("v1"))).toBe("ACEPTADA");
    expect(rechazo(con("v123456789012"))).toBe("ACEPTADA");
    expect(rechazo(con("v0"))).toBe("SIN_VERSION");
    expect(rechazo(con("v01"))).toBe("SIN_VERSION");
    expect(rechazo(con("v"))).toBe("SIN_VERSION");
    expect(rechazo(con("v1234567890123"))).toBe("SIN_VERSION");
    expect(rechazo(con("V1"))).toBe("SIN_VERSION");
    expect(rechazo(con("v1a"))).toBe("SIN_VERSION");
    expect(rechazo(con("v-1"))).toBe("SIN_VERSION");
  });
});

/** Corpus de rechazos: [qué es, lo pegado, código]. */
const CORPUS: readonly (readonly [string, string, ErrorDeDireccion])[] = [
  // Vacío y largo
  ["vacío", "", "VACIA"],
  ["solo blancos", " \t\r\n ", "VACIA"],
  ["comillas vacías", '""', "VACIA"],
  ["comilla simple vacía", "''", "VACIA"],
  ["comillas tipográficas vacías", "\u201C\u201D", "VACIA"],
  ["una comilla sola", '"', "VACIA"],
  ["largo absurdo", `https://res.cloudinary.com/${"a".repeat(100_000)}`, "DEMASIADO_LARGA"],
  ["un millón de caracteres", "a".repeat(1_000_000), "DEMASIADO_LARGA"],

  // Esquema
  ["ftp", BASE.replace("https", "ftp"), "ESQUEMA_NO_PERMITIDO"],
  ["javascript", "javascript:alert(1)", "ESQUEMA_NO_PERMITIDO"],
  ["file", "file:///etc/passwd", "ESQUEMA_NO_PERMITIDO"],
  ["data", "data:text/html,<script>alert(1)</script>", "ESQUEMA_NO_PERMITIDO"],
  ["gopher", "gopher://res.cloudinary.com/", "ESQUEMA_NO_PERMITIDO"],
  ["sin esquema", "res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg", "ESQUEMA_NO_PERMITIDO"],
  [
    "relativo al protocolo",
    "//res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "ESQUEMA_NO_PERMITIDO",
  ],
  [
    "una sola barra",
    "https:/res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "ESQUEMA_NO_PERMITIDO",
  ],
  [
    "sin barras",
    "https:res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "ESQUEMA_NO_PERMITIDO",
  ],
  ["httpss", BASE.replace("https", "httpss"), "ESQUEMA_NO_PERMITIDO"],
  ["hxxps", BASE.replace("https", "hxxps"), "ESQUEMA_NO_PERMITIDO"],
  ["fragmento de HTML con img", `<img src="${BASE}">`, "CARACTER_NO_PERMITIDO"],
  ["fragmento de HTML sin espacios", `<img/src="${BASE}">`, "ESQUEMA_NO_PERMITIDO"],
  ["fragmento de HTML con img y espacios", `<img src="${BASE}" alt="x">`, "CARACTER_NO_PERMITIDO"],
  ["enlace en markdown", `![foto](${BASE})`, "ESQUEMA_NO_PERMITIDO"],
  ["dos direcciones juntas", `${BASE}${BASE}`, "RUTA_INVALIDA"],
  ["dos direcciones en líneas", `${BASE}\n${BASE}`, "CARACTER_NO_PERMITIDO"],

  // Comillas sin par
  ["comilla doble solo al principio", `"${BASE}`, "ESQUEMA_NO_PERMITIDO"],
  ["comilla simple solo al principio", `'${BASE}`, "ESQUEMA_NO_PERMITIDO"],
  ["comilla tipográfica doble solo al principio", `\u201C${BASE}`, "CARACTER_NO_PERMITIDO"],
  ["comilla tipográfica simple solo al principio", `\u2018${BASE}`, "CARACTER_NO_PERMITIDO"],
  ["comillas que no hacen par", `"${BASE}'`, "ESQUEMA_NO_PERMITIDO"],
  ["comillas tipográficas cruzadas", `\u201C${BASE}\u2019`, "CARACTER_NO_PERMITIDO"],
  ["comilla tipográfica abierta dos veces", `\u201C${BASE}\u201C`, "CARACTER_NO_PERMITIDO"],
  ["comilla solo al final", `${BASE}"`, "EXTENSION_NO_PERMITIDA"],
  ["comilla doble por dentro", `"${BASE}"x"`, "EXTENSION_NO_PERMITIDA"],
  [
    "termina en la palabra undefined",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/undefined",
    "EXTENSION_NO_PERMITIDA",
  ],

  // Caracteres
  ["tab adentro", BASE.replace("flan", "fl\tan"), "CARACTER_NO_PERMITIDO"],
  ["salto de línea adentro", BASE.replace("mi-cafe", "mi\n-cafe"), "CARACTER_NO_PERMITIDO"],
  ["retorno de carro adentro", BASE.replace("/image", "\r/image"), "CARACTER_NO_PERMITIDO"],
  ["NUL al final", `${BASE}\0`, "CARACTER_NO_PERMITIDO"],
  ["NUL adentro", BASE.replace("flan", "fl\0an"), "CARACTER_NO_PERMITIDO"],
  [
    "NUL en el host",
    "https://res.cloudinary.com\0.evil.com/mi-cafe/image/upload/v1/flan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],
  ["DEL", BASE.replace("flan", "fl\u007Fan"), "CARACTER_NO_PERMITIDO"],
  ["control C0", BASE.replace("flan", "fl\u001Fan"), "CARACTER_NO_PERMITIDO"],
  ["control C1", BASE.replace("flan", "fl\u0085an"), "CARACTER_NO_PERMITIDO"],
  [
    "RLO (inversión de dirección)",
    BASE.replace("flan.jpg", "\u202Egpj.nalf"),
    "CARACTER_NO_PERMITIDO",
  ],
  ["RLO al principio de la dirección", `\u202E${BASE}`, "CARACTER_NO_PERMITIDO"],
  ["ancho cero", BASE.replace("res", "r\u200Bes"), "CARACTER_NO_PERMITIDO"],
  ["BOM adentro", BASE.replace("res", "r\uFEFFes"), "CARACTER_NO_PERMITIDO"],
  ["espacio adentro", BASE.replace("flan", "fl an"), "CARACTER_NO_PERMITIDO"],
  ["espacio duro adentro", BASE.replace("flan", "fl\u00a0an"), "CARACTER_NO_PERMITIDO"],
  [
    "separador de línea Unicode adentro",
    BASE.replace("flan", "fl\u2028an"),
    "CARACTER_NO_PERMITIDO",
  ],
  ["barra invertida en la ruta", BASE.replace("/carta/", "\\carta\\"), "CARACTER_NO_PERMITIDO"],
  [
    "barras invertidas después del esquema",
    "https:\\\\res.cloudinary.com\\mi-cafe\\image\\upload\\v1\\flan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],
  [
    "barra invertida y arroba",
    "https://res.cloudinary.com\\@evil.com/mi-cafe/image/upload/v1/flan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],
  [
    "barra invertida con host propio",
    "https://evil.com\\.res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],
  ["letra con tilde en el id", BASE.replace("flan", "flán"), "CARACTER_NO_PERMITIDO"],
  ["emoji", BASE.replace("flan", "flan\u{1F36E}"), "CARACTER_NO_PERMITIDO"],
  [
    "host en anchos completos",
    "https://\uFF52\uFF45\uFF53.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],
  [
    "punto de ancho completo",
    "https://res\uFF0Ecloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],
  [
    "punto ideográfico",
    "https://res\u3002cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],
  [
    "barra de ancho completo",
    "https://res.cloudinary.com\uFF0Fmi-cafe/image/upload/v1/flan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],
  [
    "homógrafo cirílico (с)",
    "https://res.\u0441loudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],
  [
    "homógrafo griego (ο)",
    "https://res.cl\u03BFudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],
  [
    "mezcla de escrituras",
    "https://res.cloudinary.com/mi-caf\u0435/image/upload/v1/flan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],
  [
    "IDN con tilde",
    "https://r\u00E9s.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],
  [
    "cursiva matemática",
    "https://res.\u{1D41C}loudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],
  [
    "K de Kelvin",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/\u212Aflan.jpg",
    "CARACTER_NO_PERMITIDO",
  ],

  // Host: otros sitios y parecidos
  ["otro sitio", "https://evil.com/mi-cafe/image/upload/v1/flan.jpg", "HOST_NO_PERMITIDO"],
  [
    "sufijo engañoso",
    "https://res.cloudinary.com.evil.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "prefijo engañoso",
    "https://evilres.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "evilcloudinary.com",
    "https://evilcloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "res.cloudinary.com como carpeta de otro host",
    "https://evil.com/res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "guion en vez de punto",
    "https://res-cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  ["sin res.", "https://cloudinary.com/mi-cafe/image/upload/v1/flan.jpg", "HOST_NO_PERMITIDO"],
  [
    "otro subdominio de cloudinary",
    "https://api.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "subdominio de res",
    "https://x.res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "CDN numerada de cloudinary",
    "https://res-1.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "dominio propio del comerciante",
    "https://fotos.micafe.com.ar/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "punto final",
    "https://res.cloudinary.com./mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "dos puntos finales",
    "https://res.cloudinary.com../mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "punto inicial",
    "https://.res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "puntos dobles",
    "https://res..cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  ["host vacío", "https:///mi-cafe/image/upload/v1/flan.jpg", "HOST_NO_PERMITIDO"],
  ["solo el esquema", "https://", "HOST_NO_PERMITIDO"],
  ["localhost", "https://localhost/mi-cafe/image/upload/v1/flan.jpg", "HOST_NO_PERMITIDO"],
  [
    "localhost.localdomain",
    "https://localhost.localdomain/x/image/upload/v1/a.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "metadatos de Google",
    "https://metadata.google.internal/computeMetadata/v1/",
    "HOST_NO_PERMITIDO",
  ],
  ["IPv4 de loopback", "https://127.0.0.1/mi-cafe/image/upload/v1/flan.jpg", "HOST_NO_PERMITIDO"],
  ["IPv4 de metadatos", "https://169.254.169.254/latest/meta-data/", "HOST_NO_PERMITIDO"],
  ["IPv4 privada", "http://10.0.0.1/mi-cafe/image/upload/v1/flan.jpg", "HOST_NO_PERMITIDO"],
  ["IPv4 en octal", "https://0177.0.0.1/mi-cafe/image/upload/v1/flan.jpg", "HOST_NO_PERMITIDO"],
  ["IPv4 en hexadecimal", "https://0x7f.1/mi-cafe/image/upload/v1/flan.jpg", "HOST_NO_PERMITIDO"],
  [
    "IPv4 en hexadecimal entera",
    "https://0x7f000001/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "IPv4 decimal entera",
    "https://2130706433/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  ["IPv4 abreviada", "https://127.1/mi-cafe/image/upload/v1/flan.jpg", "HOST_NO_PERMITIDO"],
  [
    "IPv4 con ceros",
    "https://127.000.000.001/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  ["IPv4 de 0.0.0.0", "https://0.0.0.0/mi-cafe/image/upload/v1/flan.jpg", "HOST_NO_PERMITIDO"],
  ["IPv4 pública", "https://104.16.0.1/mi-cafe/image/upload/v1/flan.jpg", "HOST_NO_PERMITIDO"],
  ["IPv6 de loopback", "https://[::1]/mi-cafe/image/upload/v1/flan.jpg", "HOST_NO_PERMITIDO"],
  [
    "IPv6 mapeada",
    "https://[::ffff:127.0.0.1]/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "IPv6 con zona",
    "https://[fe80::1%25eth0]/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "IPv6 con zona sin codificar",
    "https://[fe80::1%eth0]/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  ["corchete sin cerrar", "https://[::1/mi-cafe/image/upload/v1/flan.jpg", "HOST_NO_PERMITIDO"],
  ["corchete sin abrir", "https://::1]/mi-cafe/image/upload/v1/flan.jpg", "PUERTO_NO_PERMITIDO"],
  ["IPv6 sin corchetes", "https://::1/mi-cafe/image/upload/v1/flan.jpg", "PUERTO_NO_PERMITIDO"],
  [
    "corchetes con el host",
    "https://[res.cloudinary.com]/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "host con %2e",
    "https://res.cloudinary%2ecom/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "host con %2e doble",
    "https://res%252ecloudinary%252ecom/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "host con %00",
    "https://res.cloudinary.com%00.evil.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "host con %2f",
    "https://res.cloudinary.com%2f@evil.com/mi-cafe/image/upload/v1/flan.jpg",
    "CREDENCIALES_NO_PERMITIDAS",
  ],
  [
    "host con %40",
    "https://res.cloudinary.com%40evil.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "punycode",
    "https://xn--res-cloudinary-6ib.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "punycode en una etiqueta",
    "https://res.xn--cloudinary-9ib.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "host con subrayado",
    "https://res_cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "host con arroba en la ruta",
    "https://evil.com/@res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "host de otro y el nuestro como fragmento",
    "https://evil.com#@res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "host de otro y el nuestro como consulta",
    "https://evil.com?@res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "HOST_NO_PERMITIDO",
  ],
  [
    "host de otro y el nuestro como puerto",
    "https://evil.com:443/res.cloudinary.com",
    "PUERTO_NO_PERMITIDO",
  ],

  // Credenciales y puertos
  [
    "usuario y host propio",
    "https://res.cloudinary.com@evil.com/mi-cafe/image/upload/v1/flan.jpg",
    "CREDENCIALES_NO_PERMITIDAS",
  ],
  [
    "usuario y contraseña",
    "https://user:pass@res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "CREDENCIALES_NO_PERMITIDAS",
  ],
  [
    "solo usuario",
    "https://user@res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "CREDENCIALES_NO_PERMITIDAS",
  ],
  [
    "arroba vacía",
    "https://@res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "CREDENCIALES_NO_PERMITIDAS",
  ],
  [
    "puerto como contraseña",
    "https://res.cloudinary.com:80@evil.com/mi-cafe/image/upload/v1/flan.jpg",
    "CREDENCIALES_NO_PERMITIDAS",
  ],
  [
    "dos arrobas",
    "https://a@b@res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    "CREDENCIALES_NO_PERMITIDAS",
  ],
  [
    "puerto 443",
    "https://res.cloudinary.com:443/mi-cafe/image/upload/v1/flan.jpg",
    "PUERTO_NO_PERMITIDO",
  ],
  [
    "puerto 80",
    "http://res.cloudinary.com:80/mi-cafe/image/upload/v1/flan.jpg",
    "PUERTO_NO_PERMITIDO",
  ],
  [
    "puerto 8080",
    "https://res.cloudinary.com:8080/mi-cafe/image/upload/v1/flan.jpg",
    "PUERTO_NO_PERMITIDO",
  ],
  [
    "puerto vacío",
    "https://res.cloudinary.com:/mi-cafe/image/upload/v1/flan.jpg",
    "PUERTO_NO_PERMITIDO",
  ],
  [
    "puerto 0",
    "https://res.cloudinary.com:0/mi-cafe/image/upload/v1/flan.jpg",
    "PUERTO_NO_PERMITIDO",
  ],
  [
    "puerto fuera de rango",
    "https://res.cloudinary.com:99999/mi-cafe/image/upload/v1/flan.jpg",
    "PUERTO_NO_PERMITIDO",
  ],
  [
    "puerto con letras",
    "https://res.cloudinary.com:abc/mi-cafe/image/upload/v1/flan.jpg",
    "PUERTO_NO_PERMITIDO",
  ],

  // Consulta y fragmento
  ["consulta de cloudinary", `${BASE}?_a=BAMAAAE0`, "CONSULTA_O_FRAGMENTO"],
  ["consulta vacía", `${BASE}?`, "CONSULTA_O_FRAGMENTO"],
  ["fragmento", `${BASE}#x`, "CONSULTA_O_FRAGMENTO"],
  ["fragmento vacío", `${BASE}#`, "CONSULTA_O_FRAGMENTO"],
  [
    "consulta sin ruta",
    "https://res.cloudinary.com?x=/mi-cafe/image/upload/v1/flan.jpg",
    "CONSULTA_O_FRAGMENTO",
  ],
  [
    "fragmento sin ruta",
    "https://res.cloudinary.com#/mi-cafe/image/upload/v1/flan.jpg",
    "CONSULTA_O_FRAGMENTO",
  ],
  ["consulta en el medio", BASE.replace("/image", "?/image"), "CONSULTA_O_FRAGMENTO"],
  ["fragmento con otra dirección", `${BASE}#https://evil.com`, "CONSULTA_O_FRAGMENTO"],

  // Ruta
  ["sin ruta", "https://res.cloudinary.com", "RUTA_INVALIDA"],
  ["solo barra", "https://res.cloudinary.com/", "RUTA_INVALIDA"],
  ["solo la cuenta", "https://res.cloudinary.com/mi-cafe", "RUTA_INVALIDA"],
  ["cuenta y barra", "https://res.cloudinary.com/mi-cafe/", "RUTA_INVALIDA"],
  ["cuenta e image", "https://res.cloudinary.com/mi-cafe/image", "RUTA_INVALIDA"],
  [
    "recurso desconocido",
    "https://res.cloudinary.com/mi-cafe/audio/upload/v1/flan.jpg",
    "RUTA_INVALIDA",
  ],
  [
    "recurso en mayúsculas",
    "https://res.cloudinary.com/mi-cafe/IMAGE/upload/v1/flan.jpg",
    "RUTA_INVALIDA",
  ],
  [
    "recurso en plural",
    "https://res.cloudinary.com/mi-cafe/images/upload/v1/flan.jpg",
    "RUTA_INVALIDA",
  ],
  [
    "barra doble en la ruta",
    "https://res.cloudinary.com/mi-cafe//image/upload/v1/flan.jpg",
    "RUTA_INVALIDA",
  ],
  [
    "barra doble en el id",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/a//b.jpg",
    "RUTA_INVALIDA",
  ],
  ["barra final", `${BASE}/`, "RUTA_INVALIDA"],
  [
    "barra doble final",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg//",
    "RUTA_INVALIDA",
  ],
  [
    "punto y barra",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/./flan.jpg",
    "RUTA_INVALIDA",
  ],
  ["dos puntos", "https://res.cloudinary.com/mi-cafe/image/upload/v1/../flan.jpg", "RUTA_INVALIDA"],
  [
    "dos puntos antes de la versión",
    "https://res.cloudinary.com/mi-cafe/image/upload/../v1/flan.jpg",
    "RUTA_INVALIDA",
  ],
  [
    "dos puntos dentro de un tramo",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/a..b/flan.jpg",
    "RUTA_INVALIDA",
  ],
  [
    "tres puntos",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/.../flan.jpg",
    "RUTA_INVALIDA",
  ],
  ["%2e%2e", "https://res.cloudinary.com/mi-cafe/image/upload/v1/%2e%2e/flan.jpg", "RUTA_INVALIDA"],
  ["%2E%2E", "https://res.cloudinary.com/mi-cafe/image/upload/v1/%2E%2E/flan.jpg", "RUTA_INVALIDA"],
  [".%2e", "https://res.cloudinary.com/mi-cafe/image/upload/v1/.%2e/flan.jpg", "RUTA_INVALIDA"],
  [
    "%2e%2e en la cuenta",
    "https://res.cloudinary.com/%2e%2e/image/upload/v1/flan.jpg",
    "CUENTA_INVALIDA",
  ],
  ["%2f", "https://res.cloudinary.com/mi-cafe/image/upload/v1/a%2fb.jpg", "RUTA_INVALIDA"],
  ["%2F", "https://res.cloudinary.com/mi-cafe/image/upload/v1/a%2Fb.jpg", "RUTA_INVALIDA"],
  ["%5c", "https://res.cloudinary.com/mi-cafe/image/upload/v1/a%5cb.jpg", "RUTA_INVALIDA"],
  ["%20", "https://res.cloudinary.com/mi-cafe/image/upload/v1/mi%20flan.jpg", "RUTA_INVALIDA"],
  ["%00", "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan%00.jpg", "RUTA_INVALIDA"],
  [
    "%25 (doble codificación)",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/%252e%252e/flan.jpg",
    "RUTA_INVALIDA",
  ],
  ["%252f", "https://res.cloudinary.com/mi-cafe/image/upload/v1/a%252fb.jpg", "RUTA_INVALIDA"],
  ["% suelto", "https://res.cloudinary.com/mi-cafe/image/upload/v1/100%.jpg", "RUTA_INVALIDA"],
  [
    "% en una transformación",
    "https://res.cloudinary.com/mi-cafe/image/upload/l_text:Arial_20:Hola%20Mundo/v1/flan.jpg",
    "RUTA_INVALIDA",
  ],
  [
    "transformación con caracteres raros",
    "https://res.cloudinary.com/mi-cafe/image/upload/w_1;x/v1/flan.jpg",
    "RUTA_INVALIDA",
  ],
  [
    "transformación con paréntesis",
    "https://res.cloudinary.com/mi-cafe/image/upload/w_(1)/v1/flan.jpg",
    "RUTA_INVALIDA",
  ],
  [
    "transformación con arroba",
    "https://res.cloudinary.com/mi-cafe/image/upload/w_1@evil.com/v1/flan.jpg",
    "RUTA_INVALIDA",
  ],
  // Cuenta
  [
    "cuenta en mayúsculas",
    "https://res.cloudinary.com/Mi-Cafe/image/upload/v1/flan.jpg",
    "CUENTA_INVALIDA",
  ],
  [
    "cuenta con punto",
    "https://res.cloudinary.com/mi.cafe/image/upload/v1/flan.jpg",
    "CUENTA_INVALIDA",
  ],
  [
    "cuenta con arroba",
    "https://res.cloudinary.com/@evil.com/image/upload/v1/flan.jpg",
    "CUENTA_INVALIDA",
  ],
  [
    "cuenta con dos puntos",
    "https://res.cloudinary.com/mi:cafe/image/upload/v1/flan.jpg",
    "CUENTA_INVALIDA",
  ],
  [
    "cuenta de 65",
    `https://res.cloudinary.com/${"a".repeat(65)}/image/upload/v1/flan.jpg`,
    "CUENTA_INVALIDA",
  ],
  ["cuenta vacía", "https://res.cloudinary.com//image/upload/v1/flan.jpg", "CUENTA_INVALIDA"],
  [
    "cuenta con porcentaje",
    "https://res.cloudinary.com/%61bc/image/upload/v1/flan.jpg",
    "CUENTA_INVALIDA",
  ],
  [
    "cuenta con coma",
    "https://res.cloudinary.com/mi,cafe/image/upload/v1/flan.jpg",
    "CUENTA_INVALIDA",
  ],

  // Tipos
  ["video", "https://res.cloudinary.com/mi-cafe/video/upload/v1/clip.mp4", "VIDEO_O_ARCHIVO"],
  [
    "video con extensión de imagen",
    "https://res.cloudinary.com/mi-cafe/video/upload/v1/clip.jpg",
    "VIDEO_O_ARCHIVO",
  ],
  ["raw", "https://res.cloudinary.com/mi-cafe/raw/upload/v1/manual.pdf", "VIDEO_O_ARCHIVO"],
  ["tipo fetch", "https://res.cloudinary.com/mi-cafe/image/fetch/v1/flan.jpg", "TIPO_NO_PERMITIDO"],
  [
    "fetch con una dirección adentro",
    "https://res.cloudinary.com/mi-cafe/image/fetch/https://evil.com/x.jpg",
    "TIPO_NO_PERMITIDO",
  ],
  [
    "fetch con transformación y dirección",
    "https://res.cloudinary.com/mi-cafe/image/fetch/w_100/https%3A%2F%2Fevil.com%2Fx.jpg",
    "TIPO_NO_PERMITIDO",
  ],
  [
    "tipo private",
    "https://res.cloudinary.com/mi-cafe/image/private/v1/flan.jpg",
    "TIPO_NO_PERMITIDO",
  ],
  [
    "tipo authenticated",
    "https://res.cloudinary.com/mi-cafe/image/authenticated/v1/flan.jpg",
    "TIPO_NO_PERMITIDO",
  ],
  [
    "tipo facebook",
    "https://res.cloudinary.com/mi-cafe/image/facebook/v1/flan.jpg",
    "TIPO_NO_PERMITIDO",
  ],
  ["tipo list", "https://res.cloudinary.com/mi-cafe/image/list/v1/flan.jpg", "TIPO_NO_PERMITIDO"],
  [
    "Upload con mayúscula",
    "https://res.cloudinary.com/mi-cafe/image/Upload/v1/flan.jpg",
    "TIPO_NO_PERMITIDO",
  ],
  [
    "sin tipo de entrega",
    "https://res.cloudinary.com/mi-cafe/image/v1/flan.jpg",
    "TIPO_NO_PERMITIDO",
  ],

  // Versión, id y extensión
  ["sin nada después de upload", "https://res.cloudinary.com/mi-cafe/image/upload", "SIN_VERSION"],
  [
    "cuenta que parece versión y sin versión",
    "https://res.cloudinary.com/v1/image/upload/flan.jpg",
    "SIN_VERSION",
  ],
  [
    "id con tilde de la eñe en ASCII (~)",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/fl~an.jpg",
    "ID_INVALIDO",
  ],
  [
    "id con signo de exclamación",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/fl!an.jpg",
    "ID_INVALIDO",
  ],
  [
    "el id es solo la extensión jpg",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/jpg",
    "EXTENSION_NO_PERMITIDA",
  ],
  [
    "el id es solo la extensión png",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/png",
    "EXTENSION_NO_PERMITIDA",
  ],
  [
    "el id es solo la extensión webp",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/webp",
    "EXTENSION_NO_PERMITIDA",
  ],
  ["sin versión", "https://res.cloudinary.com/mi-cafe/image/upload/flan.jpg", "SIN_VERSION"],
  [
    "sin versión y con carpeta",
    "https://res.cloudinary.com/mi-cafe/image/upload/carta/flan.jpg",
    "SIN_VERSION",
  ],
  [
    "sin versión y con transformación",
    "https://res.cloudinary.com/mi-cafe/image/upload/w_100/flan.jpg",
    "SIN_VERSION",
  ],
  [
    "versión sin número",
    "https://res.cloudinary.com/mi-cafe/image/upload/vabc/flan.jpg",
    "SIN_VERSION",
  ],
  [
    "versión con ceros",
    "https://res.cloudinary.com/mi-cafe/image/upload/v0123/flan.jpg",
    "SIN_VERSION",
  ],
  [
    "versión demasiado larga",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1234567890123/flan.jpg",
    "SIN_VERSION",
  ],
  [
    "versión como último tramo",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1712345678",
    "ID_INVALIDO",
  ],
  [
    "id vacío con extensión",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/.jpg",
    "ID_INVALIDO",
  ],
  ["id con punto", "https://res.cloudinary.com/mi-cafe/image/upload/v1/fl.an.jpg", "ID_INVALIDO"],
  [
    "id con dos puntos",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/fl:an.jpg",
    "ID_INVALIDO",
  ],
  ["id con coma", "https://res.cloudinary.com/mi-cafe/image/upload/v1/fl,an.jpg", "ID_INVALIDO"],
  ["id con arroba", "https://res.cloudinary.com/mi-cafe/image/upload/v1/fl@an.jpg", "ID_INVALIDO"],
  [
    "id de 201",
    `https://res.cloudinary.com/mi-cafe/image/upload/v1/${"a".repeat(201)}.jpg`,
    "ID_INVALIDO",
  ],
  [
    "carpeta con punto",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/carta.vieja/flan.jpg",
    "ID_INVALIDO",
  ],
  ["id con ':'", "https://res.cloudinary.com/mi-cafe/image/upload/v1/c:/flan.jpg", "ID_INVALIDO"],
  ["gif", "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.gif", "EXTENSION_NO_PERMITIDA"],
  ["svg", "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.svg", "EXTENSION_NO_PERMITIDA"],
  [
    "avif",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.avif",
    "EXTENSION_NO_PERMITIDA",
  ],
  [
    "heic",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.heic",
    "EXTENSION_NO_PERMITIDA",
  ],
  ["pdf", "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.pdf", "EXTENSION_NO_PERMITIDA"],
  [
    "html",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.html",
    "EXTENSION_NO_PERMITIDA",
  ],
  [
    "doble extensión",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg.html",
    "EXTENSION_NO_PERMITIDA",
  ],
  [
    "extensión parecida",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpgx",
    "EXTENSION_NO_PERMITIDA",
  ],
  [
    "extensión con prefijo",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.xjpg",
    "EXTENSION_NO_PERMITIDA",
  ],
  [
    "sin extensión",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan",
    "EXTENSION_NO_PERMITIDA",
  ],
  [
    "punto final sin extensión",
    "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.",
    "EXTENSION_NO_PERMITIDA",
  ],
];

describe("leerDireccionPegada: corpus de rechazos (SSRF y formas confusas)", () => {
  it.each(CORPUS)("%s", (_nombre, texto, codigo) => {
    expect(rechazo(texto)).toBe(codigo);
  });

  it("las transformaciones raras pero bien formadas se descartan sin dejar rastro en lo que se pide", () => {
    const r = leerDireccionPegada(
      "https://res.cloudinary.com/mi-cafe/image/upload/l_fetch:aHR0cHM6Ly9ldmls/v1/flan.jpg",
    );
    expect(r.ok && r.valor.direccionNormalizada).toBe(
      "https://res.cloudinary.com/mi-cafe/image/upload/v1/flan.jpg",
    );
  });

  it("el corpus no repite lo pegado", () => {
    const vistos = new Set<string>();
    const repetidos = CORPUS.filter(([, t]) => vistos.size === vistos.add(t).size).map(([n]) => n);
    expect(repetidos).toEqual([]);
  });

  it("un valor que no es texto se rechaza sin lanzar", () => {
    for (const x of [null, undefined, 42, {}, ["https://res.cloudinary.com"]] as unknown[]) {
      expect(leerDireccionPegada(x as string)).toEqual({ ok: false, error: "VACIA" });
    }
  });

  it("un millón de caracteres hostiles se rechaza en tiempo acotado", () => {
    const ataques = [
      "https://res.cloudinary.com/" + "a/".repeat(500_000),
      "https://" + "@".repeat(1_000_000),
      "%2e".repeat(400_000),
      " ".repeat(1_000_000) + BASE + " ".repeat(1_000_000),
      "\u202E".repeat(1_000_000),
      `${BASE}${"/..".repeat(300_000)}`,
    ];
    const desde = performance.now();
    for (const a of ataques) leerDireccionPegada(a);
    expect(performance.now() - desde).toBeLessThan(1_500);
  });
});

describe("armarDestino", () => {
  const declaradas = ["otra", "mi-cafe"];
  const destinoDe = (variante: 480 | 1200, partes: PartesDeDireccion = PARTES): DestinoValidado => {
    const r = armarDestino(partes, variante, declaradas);
    if (!r.ok) throw new Error(`debía armarse: ${r.error}`);
    return r.valor;
  };

  it("arma el destino de la plantilla (golden) para las dos variantes", () => {
    expect(destinoDe(480)).toEqual({
      proveedor: "CLOUDINARY",
      host: "res.cloudinary.com",
      ruta: "/mi-cafe/image/upload/c_fill,ar_4:3,w_480,f_webp,q_80/v1712345678/carta/flan.jpg",
      url: "https://res.cloudinary.com/mi-cafe/image/upload/c_fill,ar_4:3,w_480,f_webp,q_80/v1712345678/carta/flan.jpg",
      variante: 480,
    });
    expect(destinoDe(1200).url).toBe(
      "https://res.cloudinary.com/mi-cafe/image/upload/c_fill,ar_4:3,w_1200,f_webp,q_80/v1712345678/carta/flan.jpg",
    );
    expect(destinoDe(1200).variante).toBe(1200);
  });

  it("descarta las transformaciones y el esquema de lo pegado: sale siempre https y con las nuestras", () => {
    const r = leerDireccionPegada(
      "HTTP://res.cloudinary.com/mi-cafe/image/upload/e_blur:900,w_9000/v1712345678/carta/flan.JPG",
    );
    if (!r.ok) throw new Error("debía leerse");
    const d = armarDestino(r.valor.partes, 480, declaradas);
    expect(d.ok && d.valor.url).toBe(
      "https://res.cloudinary.com/mi-cafe/image/upload/c_fill,ar_4:3,w_480,f_webp,q_80/v1712345678/carta/flan.jpg",
    );
  });

  it("una cuenta no declarada no arma destino: dice cuál faltaba declarar", () => {
    expect(armarDestino(PARTES, 480, ["otra"])).toEqual({
      ok: false,
      error: "CUENTA_NO_DECLARADA",
    });
    expect(armarDestino(PARTES, 480, [])).toEqual({ ok: false, error: "CUENTA_NO_DECLARADA" });
    expect(armarDestino(PARTES, 480, ["mi-caf"])).toEqual({
      ok: false,
      error: "CUENTA_NO_DECLARADA",
    });
    expect(armarDestino(PARTES, 480, ["mi-cafe2"])).toEqual({
      ok: false,
      error: "CUENTA_NO_DECLARADA",
    });
  });

  it("una variante que no es 480 ni 1200 se rechaza", () => {
    for (const v of [0, 1, 479, 481, 1199, 1201, Number.NaN, -480]) {
      expect(armarDestino(PARTES, v as 480, declaradas)).toEqual({
        ok: false,
        error: "VARIANTE_INVALIDA",
      });
    }
  });

  it("vuelve a validar las partes (vengan de donde vengan)", () => {
    const malas: Partial<Record<keyof PartesDeDireccion, unknown>>[] = [
      { proveedor: "IMAGEKIT" },
      { proveedor: "constructor" },
      { proveedor: undefined },
      { cuenta: "" },
      { cuenta: "Mi-Cafe" },
      { cuenta: "mi-cafe/../x" },
      { cuenta: "a".repeat(65) },
      { cuenta: "mi-cafe@evil.com" },
      { cuenta: 7 },
      { cuenta: ["a"] },
      { version: ["1"] },
      { idPublico: ["a"] },
      { extension: ["jpg"] },
      { idPublico: "" },
      { idPublico: "../etc/passwd" },
      { idPublico: "a/../b" },
      { idPublico: "a//b" },
      { idPublico: "/a" },
      { idPublico: "a/" },
      { idPublico: "a%2fb" },
      { idPublico: "a?x=1" },
      { idPublico: "a#x" },
      { idPublico: "a.b" },
      { idPublico: "a b" },
      { idPublico: "a".repeat(201) },
      { idPublico: null },
      { version: "" },
      { version: "0" },
      { version: "012" },
      { version: "v123" },
      { version: "1".repeat(13) },
      { version: "12/34" },
      { version: 123 },
      { extension: "gif" },
      { extension: "JPG" },
      { extension: "" },
      { extension: "jpg/../x" },
      { extension: "webp?" },
      { extension: undefined },
    ];
    for (const mala of malas) {
      const partes = { ...PARTES, ...mala } as PartesDeDireccion;
      expect(
        armarDestino(partes, 480, [PARTES.cuenta, mala.cuenta as string]),
        JSON.stringify(mala),
      ).toEqual({
        ok: false,
        error: "PARTES_INVALIDAS",
      });
    }
  });

  it("los topes exactos de las partes se aceptan", () => {
    const partes: PartesDeDireccion = {
      proveedor: "CLOUDINARY",
      cuenta: "a".repeat(64),
      idPublico: "x".repeat(200),
      version: "9".repeat(12),
      extension: "webp",
    };
    expect(armarDestino(partes, 1200, [partes.cuenta]).ok).toBe(true);
    const masLarga = { ...partes, cuenta: "a".repeat(65) };
    expect(armarDestino(masLarga, 1200, [masLarga.cuenta]).ok).toBe(false);
  });

  it("jpeg, png y webp se aceptan como extensión", () => {
    for (const extension of ["jpg", "jpeg", "png", "webp"]) {
      expect(armarDestino({ ...PARTES, extension }, 480, declaradas).ok).toBe(true);
    }
  });

  it("DestinoValidado es un tipo con marca: no se fabrica a mano", () => {
    // @ts-expect-error falta la marca: solo `armarDestino` lo construye
    const falso: DestinoValidado = {
      proveedor: "CLOUDINARY",
      host: "evil.com",
      ruta: "/",
      url: "https://evil.com/",
      variante: 480,
    };
    expect(falso.host).toBe("evil.com");
  });
});
