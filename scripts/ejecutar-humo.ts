import { contarDominiosConSufijo } from "../src/adaptadores/postgres/contar-dominios-con-sufijo";

/**
 * Lo que hace `npm run humo` (`scripts/humo.ts`), separado de su arranque para probarlo con todo inyectado: las pruebas de humo de SOLO LECTURA contra un despliegue (plan de pruebas de humo del
 * 25/11/2026): H0 (la app en pantalla, la dirección técnica y los hosts desconocidos caen a la página neutra, el cron rechaza sin secreto, nunca «En mantenimiento»), H1 parcial (rechazos
 * genéricos y nada que se cuele entre empresas con lo que se puede pedir SIN sesión) y H12 parcial (solo se sirve lo activo; lo retirado cae a la neutra), más el aislamiento del hotel en la base compartida.
 *
 * Reglas:
 *  - SOLO LECTURA: únicamente pedidos GET, sin cuerpo, sin cookies y sin credenciales. Nunca se manda un secreto: el cron se pide SIN secreto (y con uno inventado) justamente para ver que rechaza.
 *  - NADA en el repositorio: las direcciones y la cadena de lectura entran por variables de entorno que carga el dueño (solo NOMBRES acá). La salida nombra variables, rutas y estados; nunca imprime
 *    una dirección, un valor del entorno ni el cuerpo de una respuesta.
 *  - Cada chequeo da PASA, FALLA u OMITIDO (con el motivo: falta su variable). El código de salida es 0 solo si no hay ninguna FALLA (H0 siempre corre: su variable es obligatoria); 1 si algo falla; 2 si falta lo mínimo o una variable no sirve.
 *  - Una falla de red o un tiempo vencido es una FALLA del chequeo (nunca un «pasa»).
 * Previene: llegar a un despliegue (o a un cliente) sin haber visto lo básico (neutra, cron cerrado, nada de mantenimiento ni de fugas entre hosts); lo mide cada chequeo con su violación inyectada en
 * `test/humo/ejecutar-humo.test.ts`.
 */

// ---- las variables (solo nombres; los valores los carga el dueño) -------------------------------------------------------------------------------------------------------------------

/** OBLIGATORIA. La dirección técnica del despliegue (`https://<proyecto>.vercel.app`): para la puerta es un host desconocido. */
export const VARIABLE_URL_TECNICA = "PEDERNAL_HUMO_URL_TECNICA";
/** La dirección de la aplicación de una marca (`https://app.…`). Sin ella se omiten los chequeos de la aplicación. */
export const VARIABLE_URL_APP = "PEDERNAL_HUMO_URL_APP";
/** La dirección de una carta ACTIVA y el código de una carta activa de ese host. Sin las dos se omiten los chequeos de la carta. */
export const VARIABLE_URL_CARTA = "PEDERNAL_HUMO_URL_CARTA";
export const VARIABLE_CODIGO_DE_CARTA = "PEDERNAL_HUMO_CODIGO_DE_CARTA";
/** La dirección de un host RETIRADO o no registrado, que tiene que caer a la neutra. Sin ella se omiten esos chequeos. */
export const VARIABLE_URL_RETIRADA = "PEDERNAL_HUMO_URL_RETIRADA";
/** La cadena del rol de LECTURA PÚBLICA de la base compartida (`pedernal_publico`). Sin ella el aislamiento del hotel es un paso manual. */
export const VARIABLE_DB_LECTURA = "PEDERNAL_HUMO_DB_LECTURA";

/** Los hosts del hotel (base propia): no pueden figurar en la base compartida. */
export const SUFIJO_DEL_HOTEL = "hotelesdelneuquen.com.ar";

/** El SQL del paso manual (lo mismo que cuenta el chequeo automático). */
export const SQL_MANUAL_DEL_HOTEL = `SELECT count(*) FROM dominio WHERE host LIKE '%${SUFIJO_DEL_HOTEL}';`;

/** Un valor claramente inválido: el cron tiene que rechazarlo igual que a la falta de secreto, sin dar pistas. */
const SECRETO_INVENTADO = "humo-sin-permiso";
const CODIGO_INEXISTENTE = "humo-codigo-que-no-existe";
const FORMA_DE_CODIGO = /^[A-Za-z0-9_-]{1,64}$/;

// ---- los pedidos ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

export type RespuestaDeHumo = Readonly<{
  estado: number;
  /** Nombres en minúscula. `set-cookie` junta todos sus valores. */
  encabezados: Readonly<Record<string, string>>;
  /** El cuerpo como texto (acotado por quien pide). */
  cuerpo: string;
}>;

/** UN pedido GET, sin seguir redirecciones. Lanza si la red falla o vence el tiempo. */
export type Pedir = (
  url: string,
  encabezados?: Readonly<Record<string, string>>,
) => Promise<RespuestaDeHumo>;

export type ContarDominios = (cadena: string, sufijo: string) => Promise<number>;

export type EntradaDeHumo = Readonly<{
  entorno: Readonly<Record<string, string | undefined>>;
  pedir: Pedir;
  /** Por defecto, la lectura real de la base compartida. */
  contarDominios?: ContarDominios;
  salida: (linea: string) => void;
}>;

type Resultado =
  | Readonly<{ ok: true; detalle: string }>
  | Readonly<{ ok: false; detalle: string }>
  | Readonly<{ omitido: string }>;

type Direcciones = Readonly<{
  tecnica: string;
  app: string | null;
  carta: string | null;
  codigoDeCarta: string | null;
  retirada: string | null;
}>;

type Contexto = Readonly<{
  d: Direcciones;
  /** Pide y deja la respuesta anotada (para la comprobación final de «nunca en mantenimiento»). */
  ver: (url: string, encabezados?: Readonly<Record<string, string>>) => Promise<RespuestaDeHumo>;
  dbDeLectura: string | null;
  contarDominios: ContarDominios;
}>;

type Chequeo = Readonly<{
  id: string;
  grupo: string;
  nombre: string;
  correr: (c: Contexto) => Promise<Resultado>;
}>;

const pasa = (detalle: string): Resultado => ({ ok: true, detalle });
const falla = (detalle: string): Resultado => ({ ok: false, detalle });
const omite = (motivo: string): Resultado => ({ omitido: motivo });

/** El origen (`https://host[:puerto]`) de una variable: nada de rutas, consultas, credenciales ni texto de más. `http` solo para el propio equipo. */
export function leerOrigen(texto: string | undefined): string | null {
  const valor = (texto ?? "").trim();
  if (valor === "") return null;
  try {
    const url = new URL(valor);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const protocoloBueno = url.protocol === "https:" || (url.protocol === "http:" && local);
    const soloOrigen =
      (url.pathname === "/" || url.pathname === "") &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === "";
    return protocoloBueno && soloOrigen && url.hostname !== "" ? url.origin : null;
  } catch {
    return null;
  }
}

const sinCuerpo = (r: RespuestaDeHumo): boolean => r.cuerpo.trim() === "";
const esHtml = (r: RespuestaDeHumo): boolean =>
  (r.encabezados["content-type"] ?? "").toLowerCase().startsWith("text/html");
const sinCookies = (r: RespuestaDeHumo): boolean => (r.encabezados["set-cookie"] ?? "") === "";
const noSeIndexa = (r: RespuestaDeHumo): boolean =>
  (r.encabezados["x-robots-tag"] ?? "").toLowerCase().includes("noindex");
const esMantenimiento = (r: RespuestaDeHumo): boolean =>
  r.estado === 503 || /en mantenimiento/i.test(r.cuerpo);
const esNeutra = (r: RespuestaDeHumo): boolean =>
  r.estado === 404 && sinCookies(r) && noSeIndexa(r);

// ---- los chequeos ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const CHEQUEOS: readonly Chequeo[] = [
  {
    id: "H0-01",
    grupo: "H0",
    nombre:
      "la dirección técnica (*.vercel.app) es un host desconocido: neutra, 404 sin cuerpo, sin cookies y sin indexar",
    correr: async (c) => {
      for (const ruta of ["/", "/ingreso"]) {
        const r = await c.ver(`${c.d.tecnica}${ruta}`);
        if (!esNeutra(r) || !sinCuerpo(r)) {
          return falla(
            `${ruta}: estado ${r.estado}, ${sinCuerpo(r) ? "sin cuerpo" : "con cuerpo"}, ${noSeIndexa(r) ? "noindex" : "SIN noindex"}, ${sinCookies(r) ? "sin cookies" : "CON cookies"}`,
          );
        }
      }
      return pasa("/ y /ingreso: 404 sin cuerpo, noindex, sin cookies");
    },
  },
  {
    id: "H0-02",
    grupo: "H0",
    nombre:
      "el cron rechaza sin secreto y con uno inventado, igual y sin dar pistas (401 sin cuerpo)",
    correr: async (c) => {
      const ruta = `${c.d.tecnica}/api/trabajos/cron`;
      const sin = await c.ver(ruta);
      const inventado = await c.ver(ruta, { authorization: `Bearer ${SECRETO_INVENTADO}` });
      for (const [que, r] of [
        ["sin secreto", sin],
        ["con secreto inventado", inventado],
      ] as const) {
        if (r.estado !== 401 || !sinCuerpo(r)) {
          return falla(
            `${que}: estado ${r.estado}${sinCuerpo(r) ? "" : " y con cuerpo"} (se esperaba 401 sin cuerpo)`,
          );
        }
      }
      return pasa("401 sin cuerpo, con y sin secreto");
    },
  },
  {
    id: "H0-03",
    grupo: "H0",
    nombre: 'la salud responde ok y no dice nada más (200 con solo {"ok":true})',
    correr: async (c) => {
      const r = await c.ver(`${c.d.tecnica}/api/salud`);
      let cuerpo: unknown;
      try {
        cuerpo = JSON.parse(r.cuerpo);
      } catch {
        return falla(`estado ${r.estado} y el cuerpo no es JSON`);
      }
      const claves = typeof cuerpo === "object" && cuerpo !== null ? Object.keys(cuerpo) : [];
      const bien =
        r.estado === 200 && claves.length === 1 && (cuerpo as { ok?: unknown }).ok === true;
      return bien
        ? pasa("200 {ok:true}, sin más datos")
        : falla(`estado ${r.estado}, claves: ${claves.length}`);
    },
  },
  {
    id: "H0-04",
    grupo: "H0",
    nombre:
      "la aplicación está en pantalla (la entrada responde 200 con HTML, con política de contenido y sin cookies)",
    correr: async (c) => {
      if (c.d.app === null) return omite(`falta ${VARIABLE_URL_APP}`);
      const r = await c.ver(`${c.d.app}/ingreso`);
      if (r.estado !== 200 || !esHtml(r))
        return falla(`/ingreso: estado ${r.estado}${esHtml(r) ? "" : ", no es HTML"}`);
      if ((r.encabezados["content-security-policy"] ?? "") === "")
        return falla("/ingreso: sin Content-Security-Policy");
      return pasa("/ingreso: 200 HTML con política de contenido");
    },
  },
  {
    id: "H1-01",
    grupo: "H1",
    nombre:
      "los encabezados internos (x-pd-*) y el host reenviado que manda un cliente no cambian nada ni vuelven en la respuesta",
    correr: async (c) => {
      const url = `${c.d.tecnica}/`;
      const limpio = await c.ver(url);
      const forjado = await c.ver(url, {
        "x-pd-nonce": "AAAAAAAAAAAAAAAAAAAAAA==",
        "x-pd-marca": "forjada",
        "x-pd-empresa": "forjada",
        "x-forwarded-host": `app.${SUFIJO_DEL_HOTEL}`,
      });
      const volvieron = Object.keys(forjado.encabezados).filter(
        (n) => n.startsWith("x-pd-") || n.startsWith("x-middleware-"),
      );
      if (volvieron.length > 0)
        return falla(`la respuesta trae encabezados internos (${volvieron.length})`);
      if (forjado.estado !== limpio.estado || forjado.cuerpo !== limpio.cuerpo) {
        return falla(
          `con encabezados forjados cambió la respuesta (${limpio.estado} → ${forjado.estado})`,
        );
      }
      return pasa("misma respuesta con encabezados forjados y ninguno interno vuelve");
    },
  },
  {
    id: "H1-02",
    grupo: "H1",
    nombre:
      "una ruta interna (/s/…) pedida desde afuera es la neutra, aunque el host sea el de la aplicación",
    correr: async (c) => {
      if (c.d.app === null) return omite(`falta ${VARIABLE_URL_APP}`);
      const real = await c.ver(`${c.d.app}/ingreso`);
      const interna = await c.ver(`${c.d.app}/s/app/ingreso`);
      if (interna.estado !== 404 || interna.cuerpo === real.cuerpo) {
        return falla(
          `/s/app/ingreso: estado ${interna.estado}${interna.cuerpo === real.cuerpo ? " y devuelve la pantalla real" : ""}`,
        );
      }
      return pasa("/s/app/ingreso: 404, no la pantalla real");
    },
  },
  {
    id: "H1-03",
    grupo: "H1",
    nombre:
      "sin sesión no se entra a lo privado (la raíz de la aplicación pide ingresar y la renovación de sesión rechaza, sin 5xx ni cookies)",
    correr: async (c) => {
      if (c.d.app === null) return omite(`falta ${VARIABLE_URL_APP}`);
      const raiz = await c.ver(`${c.d.app}/`);
      const redirige = [301, 302, 303, 307, 308].includes(raiz.estado);
      if (!(raiz.estado === 200 || redirige)) return falla(`/: estado ${raiz.estado}`);
      if (redirige) {
        const destino = raiz.encabezados["location"] ?? "";
        if (!destino.startsWith("/") || destino.startsWith("//"))
          return falla("/: redirige fuera de la aplicación");
      }
      if (!sinCookies(raiz)) return falla("/: pone cookies sin sesión");
      const renovar = await c.ver(`${c.d.app}/api/sesion/renovar`);
      if (renovar.estado < 400 || renovar.estado >= 500 || !sinCookies(renovar)) {
        return falla(
          `/api/sesion/renovar: estado ${renovar.estado}${sinCookies(renovar) ? "" : " y pone cookies"} (se esperaba un rechazo 4xx)`,
        );
      }
      return pasa(`/: ${raiz.estado}; /api/sesion/renovar: ${renovar.estado}`);
    },
  },
  {
    id: "H12-01",
    grupo: "H12",
    nombre:
      "una carta activa se sirve (200 con HTML) y una que no existe es 404, sin nada de otra carta",
    correr: async (c) => {
      if (c.d.carta === null || c.d.codigoDeCarta === null) {
        return omite(`falta ${VARIABLE_URL_CARTA} o ${VARIABLE_CODIGO_DE_CARTA}`);
      }
      const activa = await c.ver(`${c.d.carta}/${c.d.codigoDeCarta}`);
      if (activa.estado !== 200 || !esHtml(activa))
        return falla(
          `la carta activa: estado ${activa.estado}${esHtml(activa) ? "" : ", no es HTML"}`,
        );
      const otra = await c.ver(`${c.d.carta}/${CODIGO_INEXISTENTE}`);
      if (otra.estado !== 404 || otra.cuerpo === activa.cuerpo) {
        return falla(
          `un código inexistente: estado ${otra.estado}${otra.cuerpo === activa.cuerpo ? " y devuelve la carta activa" : ""}`,
        );
      }
      return pasa("activa: 200 HTML; inexistente: 404");
    },
  },
  {
    id: "H12-02",
    grupo: "H12",
    nombre: "la ruta interna de la carta (/s/carta/…) pedida desde afuera es la neutra",
    correr: async (c) => {
      if (c.d.carta === null || c.d.codigoDeCarta === null) {
        return omite(`falta ${VARIABLE_URL_CARTA} o ${VARIABLE_CODIGO_DE_CARTA}`);
      }
      const r = await c.ver(`${c.d.carta}/s/carta/${c.d.codigoDeCarta}`);
      return r.estado === 404 ? pasa("404") : falla(`/s/carta/<código>: estado ${r.estado}`);
    },
  },
  {
    id: "H12-03",
    grupo: "H12",
    nombre:
      "un host retirado o no registrado cae a la neutra: 404 sin cuerpo, sin cookies y sin indexar, para la raíz y para una carta",
    correr: async (c) => {
      if (c.d.retirada === null) return omite(`falta ${VARIABLE_URL_RETIRADA}`);
      const rutas = ["/", `/${c.d.codigoDeCarta ?? CODIGO_INEXISTENTE}`];
      for (const ruta of rutas) {
        const r = await c.ver(`${c.d.retirada}${ruta}`);
        if (!esNeutra(r) || !sinCuerpo(r)) {
          return falla(
            `${ruta === "/" ? "/" : "/<código>"}: estado ${r.estado}, ${sinCuerpo(r) ? "sin cuerpo" : "con cuerpo"}, ${noSeIndexa(r) ? "noindex" : "SIN noindex"}`,
          );
        }
      }
      return pasa("/ y /<código>: 404 sin cuerpo, noindex, sin cookies");
    },
  },
  {
    id: "HDN-01",
    grupo: "Aislamiento",
    nombre: `los hosts del hotel (*.${SUFIJO_DEL_HOTEL}) no figuran como ACTIVOS en la base compartida (los que la web serviría)`,
    correr: async (c) => {
      if (c.dbDeLectura === null) {
        return omite(
          `falta ${VARIABLE_DB_LECTURA}: paso MANUAL, en el SQL Editor de la base compartida: ${SQL_MANUAL_DEL_HOTEL} tiene que dar 0`,
        );
      }
      const cuenta = await c.contarDominios(c.dbDeLectura, SUFIJO_DEL_HOTEL);
      return cuenta === 0
        ? pasa("0 dominios ACTIVOS del hotel en la base compartida")
        : falla(`${cuenta} dominio(s) ACTIVO(s) del hotel en la base compartida (tiene que ser 0)`);
    },
  },
];

/** El último chequeo: sobre TODAS las respuestas que se vieron, ninguna es «En mantenimiento» ni un 503. */
const SIN_MANTENIMIENTO: Chequeo = {
  id: "H0-05",
  grupo: "H0",
  nombre:
    "nunca «En mantenimiento»: ninguna de las respuestas anteriores es un 503 ni dice «En mantenimiento»",
  correr: () => Promise.resolve(omite("se evalúa sobre lo visto")),
};

export const IDENTIFICADORES_DE_CHEQUEOS: readonly string[] = [
  ...CHEQUEOS.map((c) => c.id),
  SIN_MANTENIMIENTO.id,
];

const largo = (n: number) => `${n} chequeo${n === 1 ? "" : "s"}`;

/** Corre todo. 0: nada falló y corrió H0. 1: algo falló. 2: falta lo mínimo o una variable no sirve. */
export async function ejecutarHumo(entrada: EntradaDeHumo): Promise<number> {
  const { entorno, salida } = entrada;
  const problemas: string[] = [];
  const origen = (nombre: string): string | null => {
    const valor = entorno[nombre];
    if (valor === undefined || valor.trim() === "") return null;
    const leido = leerOrigen(valor);
    if (leido === null)
      problemas.push(
        `${nombre}: tiene que ser un origen https://host (sin ruta, consulta ni credenciales)`,
      );
    return leido;
  };
  const tecnica = origen(VARIABLE_URL_TECNICA);
  if ((entorno[VARIABLE_URL_TECNICA] ?? "").trim() === "") {
    problemas.push(`${VARIABLE_URL_TECNICA}: falta (es la única obligatoria)`);
  }
  const app = origen(VARIABLE_URL_APP);
  const carta = origen(VARIABLE_URL_CARTA);
  const retirada = origen(VARIABLE_URL_RETIRADA);
  const codigoTexto = (entorno[VARIABLE_CODIGO_DE_CARTA] ?? "").trim();
  if (codigoTexto !== "" && !FORMA_DE_CODIGO.test(codigoTexto)) {
    problemas.push(`${VARIABLE_CODIGO_DE_CARTA}: solo letras, dígitos, «_» y «-» (hasta 64)`);
  }
  if (problemas.length > 0 || tecnica === null) {
    salida("ERROR: no se pudo empezar (solo se nombran las variables, nunca sus valores):");
    for (const p of problemas) salida(`  - ${p}`);
    salida("No se pidió nada.");
    return 2;
  }
  const cadenaDeLectura = (entorno[VARIABLE_DB_LECTURA] ?? "").trim();
  const vistas: RespuestaDeHumo[] = [];
  const contexto: Contexto = {
    d: { tecnica, app, carta, codigoDeCarta: codigoTexto === "" ? null : codigoTexto, retirada },
    ver: async (url, encabezados) => {
      const r = await entrada.pedir(url, encabezados);
      vistas.push(r);
      return r;
    },
    dbDeLectura: cadenaDeLectura === "" ? null : cadenaDeLectura,
    contarDominios: entrada.contarDominios ?? contarDominiosConSufijo,
  };

  salida("Pruebas de humo (solo lectura)");
  let pasaron = 0;
  let fallaron = 0;
  let omitidos = 0;
  const anotar = (c: Chequeo, r: Resultado) => {
    if ("omitido" in r) {
      omitidos += 1;
      salida(`OMITIDO  ${c.id} ${c.nombre} — ${r.omitido}`);
    } else if (r.ok) {
      pasaron += 1;
      salida(`PASA     ${c.id} ${c.nombre} — ${r.detalle}`);
    } else {
      fallaron += 1;
      salida(`FALLA    ${c.id} ${c.nombre} — ${r.detalle}`);
    }
  };
  const correrUno = async (c: Chequeo): Promise<Resultado> => {
    try {
      return await c.correr(contexto);
    } catch (error) {
      // Solo el tipo de la falla: el mensaje de red o de base puede traer direcciones o pedazos de la cadena.
      const tipo = error instanceof Error ? error.name : "falla que no es un Error";
      return falla(`no se pudo comprobar (${tipo})`);
    }
  };
  for (const c of CHEQUEOS) {
    anotar(c, await correrUno(c));
  }
  const mantenimiento = vistas.filter(esMantenimiento).length;
  const finalR: Resultado =
    vistas.length === 0
      ? omite("no se vio ninguna respuesta que revisar")
      : mantenimiento === 0
        ? pasa(`${vistas.length} respuestas vistas, ninguna en mantenimiento`)
        : falla(`${mantenimiento} de ${vistas.length} respuestas son «En mantenimiento» o 503`);
  anotar(SIN_MANTENIMIENTO, finalR);

  salida(
    `Resumen: ${pasaron} pasan, ${fallaron} fallan, ${omitidos} omitidos (${largo(pasaron + fallaron + omitidos)}).`,
  );
  return fallaron > 0 ? 1 : 0;
}
