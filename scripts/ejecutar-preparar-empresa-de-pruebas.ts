import { ocultarSecretos } from "../src/adaptadores/postgres/describir-falla-de-base";
import { PEDERNAL_CLAVE_CONTEXTO } from "../src/adaptadores/postgres/contexto-firmado";
import { PEDERNAL_SECRETO_INVITACIONES } from "../src/adaptadores/tokens/tokens-hmac";
import { PEDERNAL_DB_PLATAFORMA } from "../src/composicion/entorno-de-plataforma";
import { armarEntradaDelCaso, type NombreDeCaso } from "../src/plataforma/dominio/pedido-de-caso";
import { emailDesdeTexto } from "../src/modulos/identidad/publico";
import { VARIABLE_DE_LA_CADENA } from "./ejecutar-crear-primer-admin";
import { ejecutarCasoDePlataforma, type EntradaDeEjecucion } from "./ejecutar-caso-desde-archivo";
import { textoDeProblema } from "./mensajes-de-plataforma";

/**
 * Lo que hace `scripts/preparar-empresa-de-pruebas.ts` (workflow `preparar-empresa-de-pruebas.yml`), separado de su
 * arranque para probarlo con todo inyectado. NO reescribe ninguna regla de plataforma: arma el JSON de cada paso y
 * se lo pasa a lo que ya existe (`ejecutarCreacionDelPrimerAdmin` y `ejecutarCasoDePlataforma`), que valida, autoriza,
 * audita y guarda la clave de idempotencia. Una regla, un lugar.
 *
 * Orden: administrador de plataforma → plan (crear, borrador, publicar) → marca (crear, borrador, confirmar) →
 * dominio → alta de la empresa (invitación al gerente) → módulo `facturacion` de la empresa. Los ids que un paso
 * produce (planId, marcaId, versión del borrador, empresaId) los lee de la salida del caso anterior.
 *
 * Los datos salen de UNA variable (`PEDERNAL_PREPARAR_PREVIEW`, un JSON): en GitHub es un secreto del Environment,
 * así no figuran en la interfaz de la corrida (las entradas de un `workflow_dispatch` sí se ven) y el runner los
 * enmascara. Falla que previene: que un CUIT, una razón social o un email queden en el registro de la corrida
 * (PRIMER-DESPLIEGUE.md §E). Cada dato personal se tapa en todo lo que sale y se entrega al runner con `::add-mask::`.
 *
 * Idempotente: la clave de cada paso es fija (`preparar-prueba-v1-<paso>`). Repetir con los MISMOS datos devuelve
 * lo ya hecho sin duplicar nada; con datos distintos el caso rechaza `CLAVE_REUTILIZADA` y no cambia nada (cierra).
 * Antes de abrir ninguna conexión se revisa la forma de TODOS los pasos (con ids de relleno): un dato mal escrito
 * no deja la preparación a medias. Código de salida: 0 todo hecho, 1 un paso rechazó o falló, 2 datos o uso
 * incorrectos.
 */

export const VARIABLE_DEL_PAQUETE = "PEDERNAL_PREPARAR_PREVIEW";

/** El módulo que se activa en la empresa de pruebas. */
export const MODULO_A_ACTIVAR = "facturacion";

/** El texto que queda en la auditoría de plataforma como motivo de los pasos que lo piden. */
const MOTIVO = "Preparación del entorno de pruebas (preview)";

/** Los nombres de variable que el flujo exige (solo NOMBRES: los valores nunca se muestran). */
export const VARIABLES_OBLIGATORIAS = [
  VARIABLE_DEL_PAQUETE,
  VARIABLE_DE_LA_CADENA,
  PEDERNAL_DB_PLATAFORMA,
  PEDERNAL_CLAVE_CONTEXTO,
  PEDERNAL_SECRETO_INVITACIONES,
] as const;

type Objeto = Readonly<Record<string, unknown>>;

export type Paquete = Readonly<{
  adminEmail: string;
  marca: Readonly<{
    codigo: string;
    nombreVisible: string;
    tema?: Objeto;
    aspecto?: Objeto;
  }>;
  plan: Readonly<{
    codigo: string;
    nombreComercial: string;
    modulos: readonly string[];
    perillas: Objeto;
  }>;
  vigenteDesde: string;
  dominio: Readonly<{ host: string; titular: string }>;
  empresa: Readonly<{
    nombreDeTenant: string;
    cuit: string;
    razonSocial: string;
    zonaHoraria: string;
    moneda: string;
    emailGerente: string;
  }>;
}>;

const esObjeto = (valor: unknown): valor is Objeto =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

/** Lee un objeto con exactamente estos campos de texto (y estos opcionales de objeto): lo que sobra o falta se anota. */
function leerSeccion(
  valor: unknown,
  ruta: string,
  textos: readonly string[],
  opcionalesObjeto: readonly string[],
  problemas: string[],
): Record<string, unknown> {
  if (!esObjeto(valor)) {
    problemas.push(`${ruta}: tiene que ser un objeto`);
    return {};
  }
  const salida: Record<string, unknown> = {};
  for (const campo of textos) {
    const dato = valor[campo];
    if (typeof dato !== "string" || dato.trim() === "") {
      problemas.push(`${ruta}.${campo}: falta o no es un texto`);
    } else {
      salida[campo] = dato.trim();
    }
  }
  for (const campo of opcionalesObjeto) {
    if (!Object.hasOwn(valor, campo)) continue;
    if (esObjeto(valor[campo])) salida[campo] = valor[campo];
    else problemas.push(`${ruta}.${campo}: tiene que ser un objeto`);
  }
  for (const campo of Object.keys(valor)) {
    if (!textos.includes(campo) && !opcionalesObjeto.includes(campo)) {
      problemas.push(`${ruta}.${campo}: no se esperaba este campo`);
    }
  }
  return salida;
}

/**
 * Lee y revisa el paquete de datos. Devuelve TODOS los problemas juntos y NUNCA el valor que los causó (podría ser un
 * dato personal): solo el nombre del campo. Un campo que sobra se rechaza (un error de tipeo no se pierde en silencio).
 */
export function leerPaquete(
  texto: string | undefined,
):
  Readonly<{ ok: true; paquete: Paquete }> | Readonly<{ ok: false; problemas: readonly string[] }> {
  if (texto === undefined || texto.trim() === "") {
    return { ok: false, problemas: [`falta la variable ${VARIABLE_DEL_PAQUETE}`] };
  }
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return { ok: false, problemas: [`${VARIABLE_DEL_PAQUETE} no es un JSON válido`] };
  }
  if (!esObjeto(json)) {
    return { ok: false, problemas: [`${VARIABLE_DEL_PAQUETE} tiene que ser un objeto JSON`] };
  }
  const problemas: string[] = [];
  const raiz = leerSeccion(
    { adminEmail: json["adminEmail"], vigenteDesde: json["vigenteDesde"] },
    "(raíz)",
    ["adminEmail", "vigenteDesde"],
    [],
    problemas,
  );
  for (const campo of Object.keys(json)) {
    if (!["adminEmail", "vigenteDesde", "marca", "plan", "dominio", "empresa"].includes(campo)) {
      problemas.push(`${campo}: no se esperaba este campo`);
    }
  }
  const marca = leerSeccion(
    json["marca"],
    "marca",
    ["codigo", "nombreVisible"],
    ["tema", "aspecto"],
    problemas,
  );
  // Del plan se leen acá los dos textos; la lista de módulos y las perillas, más abajo (los que sobran también).
  const planCrudo = esObjeto(json["plan"]) ? json["plan"] : null;
  const planBase = leerSeccion(
    planCrudo === null
      ? json["plan"]
      : { codigo: planCrudo["codigo"], nombreComercial: planCrudo["nombreComercial"] },
    "plan",
    ["codigo", "nombreComercial"],
    [],
    problemas,
  );
  const dominio = leerSeccion(json["dominio"], "dominio", ["host", "titular"], [], problemas);
  const empresa = leerSeccion(
    json["empresa"],
    "empresa",
    ["nombreDeTenant", "cuit", "razonSocial", "zonaHoraria", "moneda", "emailGerente"],
    [],
    problemas,
  );

  // Del plan, además: la lista de módulos (con el que se va a activar) y las perillas.
  const modulos = planCrudo?.["modulos"];
  const modulosValidos =
    Array.isArray(modulos) && modulos.every((m) => typeof m === "string") ? modulos : null;
  if (modulosValidos === null) problemas.push("plan.modulos: tiene que ser una lista de textos");
  else if (!modulosValidos.includes(MODULO_A_ACTIVAR)) {
    problemas.push(`plan.modulos: tiene que incluir «${MODULO_A_ACTIVAR}»`);
  }
  if (!esObjeto(planCrudo?.["perillas"])) problemas.push("plan.perillas: tiene que ser un objeto");
  for (const campo of Object.keys(planCrudo ?? {})) {
    if (!["codigo", "nombreComercial", "modulos", "perillas"].includes(campo)) {
      problemas.push(`plan.${campo}: no se esperaba este campo`);
    }
  }

  if (problemas.length > 0) return { ok: false, problemas };
  return {
    ok: true,
    paquete: {
      adminEmail: raiz["adminEmail"] as string,
      vigenteDesde: raiz["vigenteDesde"] as string,
      marca: marca as Paquete["marca"],
      plan: {
        ...(planBase as { codigo: string; nombreComercial: string }),
        modulos: modulosValidos as string[],
        perillas: planCrudo?.["perillas"] as Objeto,
      },
      dominio: dominio as Paquete["dominio"],
      empresa: empresa as Paquete["empresa"],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Los pasos
// ---------------------------------------------------------------------------------------------

/** Lo que los pasos anteriores produjeron y los siguientes necesitan. */
type Contexto = {
  planId: string;
  marcaId: string;
  versionDelBorradorDeMarca: number;
  empresaId: string;
};

type Paso = Readonly<{
  /** Nombre corto y estable: forma la clave de idempotencia. */
  nombre: string;
  caso: NombreDeCaso;
  json: (c: Contexto) => Record<string, unknown>;
  /** Anota en el contexto lo que este paso produjo; `false` si la salida no trae lo esperado. */
  leer?: (datos: ReadonlyMap<string, string>, c: Contexto) => boolean;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clave = (nombre: string) => `preparar-prueba-v1-${nombre}`;

function pasosDe(p: Paquete): readonly Paso[] {
  return [
    {
      nombre: "crear-plan",
      caso: "crearPlan",
      json: () => ({ claveDeIdempotencia: clave("crear-plan"), codigo: p.plan.codigo }),
      leer: (d, c) => {
        const id = d.get("planId");
        if (id === undefined || !UUID.test(id)) return false;
        c.planId = id;
        return true;
      },
    },
    {
      nombre: "borrador-de-plan",
      caso: "guardarBorradorDePlan",
      json: (c) => ({
        claveDeIdempotencia: clave("borrador-de-plan"),
        planId: c.planId,
        versionEsperada: null,
        nombreComercial: p.plan.nombreComercial,
        modulos: p.plan.modulos,
        perillas: p.plan.perillas,
      }),
    },
    {
      nombre: "publicar-plan",
      caso: "publicarVersionDePlan",
      json: (c) => ({
        claveDeIdempotencia: clave("publicar-plan"),
        planId: c.planId,
        motivo: MOTIVO,
      }),
    },
    {
      nombre: "crear-marca",
      caso: "crearMarca",
      json: () => ({
        claveDeIdempotencia: clave("crear-marca"),
        codigo: p.marca.codigo,
        marcaPadreId: null,
      }),
      leer: (d, c) => {
        const id = d.get("marcaId");
        if (id === undefined || !UUID.test(id)) return false;
        c.marcaId = id;
        return true;
      },
    },
    {
      nombre: "borrador-de-marca",
      caso: "guardarBorradorDeMarca",
      json: (c) => ({
        claveDeIdempotencia: clave("borrador-de-marca"),
        marcaId: c.marcaId,
        versionEsperada: null,
        nombreVisible: p.marca.nombreVisible,
        planPorDefectoId: c.planId,
        ...(p.marca.tema === undefined ? {} : { tema: p.marca.tema }),
        ...(p.marca.aspecto === undefined ? {} : { aspecto: p.marca.aspecto }),
      }),
      leer: (d, c) => {
        const version = Number(d.get("version"));
        if (!Number.isInteger(version) || version < 1) return false;
        c.versionDelBorradorDeMarca = version;
        return true;
      },
    },
    {
      nombre: "confirmar-marca",
      caso: "confirmarVersionDeMarca",
      json: (c) => ({
        claveDeIdempotencia: clave("confirmar-marca"),
        marcaId: c.marcaId,
        versionEsperada: c.versionDelBorradorDeMarca,
        vigenteDesde: p.vigenteDesde,
        motivo: MOTIVO,
        reemplazaProgramada: false,
      }),
    },
    {
      nombre: "agregar-dominio",
      caso: "agregarDominio",
      json: (c) => ({
        claveDeIdempotencia: clave("agregar-dominio"),
        host: p.dominio.host,
        superficie: "APP",
        titular: p.dominio.titular,
        esCanonico: true,
        duenio: { tipo: "MARCA", marcaId: c.marcaId },
      }),
    },
    {
      nombre: "alta-de-empresa",
      caso: "altaDeEmpresa",
      json: (c) => ({
        claveDeIdempotencia: clave("alta-de-empresa"),
        nombreDeTenant: p.empresa.nombreDeTenant,
        marcaId: c.marcaId,
        cuit: p.empresa.cuit,
        razonSocial: p.empresa.razonSocial,
        zonaHoraria: p.empresa.zonaHoraria,
        moneda: p.empresa.moneda,
        emailGerente: p.empresa.emailGerente,
      }),
      leer: (d, c) => {
        const id = d.get("empresaId");
        if (id === undefined || !UUID.test(id)) return false;
        c.empresaId = id;
        return true;
      },
    },
    {
      nombre: "activar-modulo",
      caso: "activarModuloDeEmpresa",
      json: (c) => ({
        claveDeIdempotencia: clave("activar-modulo"),
        empresaId: c.empresaId,
        modulo: MODULO_A_ACTIVAR,
      }),
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// El ejecutor de un caso (sobre lo que ya existe) y el orquestador
// ---------------------------------------------------------------------------------------------

export type ResultadoDeUnCaso = Readonly<{ codigo: number; datos: ReadonlyMap<string, string> }>;

type Salida = Readonly<{ info: (linea: string) => void; error: (linea: string) => void }>;

export type EjecutorDeCaso = (
  caso: NombreDeCaso,
  json: unknown,
  adminEmail: string,
  salida: Salida,
) => Promise<ResultadoDeUnCaso>;

/**
 * Ejecuta UN caso con `ejecutarCasoDePlataforma` (el mismo de `npm run plataforma:caso`), con el JSON en memoria (no
 * se escribe ningún archivo) y devuelve el código de salida y los pares `clave: valor` de su resultado. Sus líneas de
 * error se reenvían tal cual (ya salen tapadas y sin valores del archivo); las de dato las usa el orquestador.
 */
export function ejecutorDeCasos(
  base: Omit<EntradaDeEjecucion, "argumentos" | "leerArchivo" | "info" | "error">,
): EjecutorDeCaso {
  return async (caso, json, adminEmail, salida) => {
    const datos = new Map<string, string>();
    const codigo = await ejecutarCasoDePlataforma({
      ...base,
      argumentos: [caso, "paquete.json", "--admin-email", adminEmail],
      leerArchivo: () => Promise.resolve(JSON.stringify(json)),
      info: (linea) => {
        const dato = /^ {2}([A-Za-z]+): (.*)$/.exec(linea);
        if (dato !== null) datos.set(dato[1] as string, dato[2] as string);
        else salida.info(linea);
      },
      error: salida.error,
    });
    return { codigo, datos };
  };
}

export type EntradaDePreparacion = Readonly<{
  entorno: Readonly<Record<string, string | undefined>>;
  /** Siembra al primer administrador con la cadena del dueño (`ejecutarCreacionDelPrimerAdmin`); devuelve su código de salida. */
  sembrarAdmin: (email: string, salida: Salida) => Promise<number>;
  /** Ejecuta un caso como ese administrador (ver `ejecutorDeCasos`). */
  ejecutarCaso: EjecutorDeCaso;
  info: (linea: string) => void;
  error: (linea: string) => void;
  /** Una línea tal cual, sin tapar (el `::add-mask::` que lee el runner de GitHub). Solo en Actions. */
  comando: (linea: string) => void;
}>;

const ID_DE_RELLENO = "00000000-0000-4000-8000-000000000000";

export async function prepararEmpresaDePruebas(entrada: EntradaDePreparacion): Promise<number> {
  const { entorno } = entrada;
  // Se tapan las variables sensibles y, apenas se leen, los datos personales del paquete.
  const tapados: Array<string | undefined> = [
    entorno[VARIABLE_DE_LA_CADENA]?.trim(),
    entorno[PEDERNAL_DB_PLATAFORMA]?.trim(),
    entorno[PEDERNAL_CLAVE_CONTEXTO]?.trim().split(":")[1],
    entorno[PEDERNAL_SECRETO_INVITACIONES]?.trim(),
    entorno[VARIABLE_DEL_PAQUETE]?.trim(),
  ];
  const tapar = (linea: string) =>
    tapados.reduce<string>((texto, secreto) => ocultarSecretos(texto, secreto), linea);
  const info = (linea: string) => entrada.info(tapar(linea));
  const error = (linea: string) => entrada.error(tapar(linea));
  const salida = { info, error };

  const faltan = VARIABLES_OBLIGATORIAS.filter((n) => (entorno[n] ?? "").trim() === "");
  if (faltan.length > 0) {
    error(
      `ERROR: faltan estas variables (solo se nombran): ${faltan.join(", ")}. No se hizo nada.`,
    );
    return 2;
  }

  const leido = leerPaquete(entorno[VARIABLE_DEL_PAQUETE]);
  if (!leido.ok) {
    error("ERROR: los datos del paquete no sirven (no se repite ningún valor):");
    for (const problema of leido.problemas) error(`  - ${problema}`);
    error("No se hizo nada.");
    return 2;
  }
  const { paquete } = leido;
  // Datos personales: tapados en todo lo que sale y entregados al runner para que los tape en el resto del registro.
  const personales = [
    paquete.adminEmail,
    paquete.empresa.emailGerente,
    paquete.empresa.cuit,
    paquete.empresa.razonSocial,
    paquete.empresa.nombreDeTenant,
  ];
  for (const dato of personales) {
    tapados.push(dato);
    if (entorno["GITHUB_ACTIONS"] === "true") entrada.comando(`::add-mask::${dato}`);
  }

  // Revisión previa de la forma de TODOS los pasos, sin conexión alguna: nada queda a medias por un dato mal escrito.
  const pasos = pasosDe(paquete);
  const relleno: Contexto = {
    planId: ID_DE_RELLENO,
    marcaId: ID_DE_RELLENO,
    versionDelBorradorDeMarca: 1,
    empresaId: ID_DE_RELLENO,
  };
  const email = emailDesdeTexto(paquete.adminEmail);
  const problemasDeForma: string[] = [];
  if (!email.ok) problemasDeForma.push("adminEmail: no tiene forma de email (algo@dominio)");
  for (const paso of pasos) {
    const armada = armarEntradaDelCaso(paso.caso, paso.json(relleno));
    if (!armada.ok) {
      for (const problema of armada.error) {
        problemasDeForma.push(`${paso.caso}: ${textoDeProblema(problema)}`);
      }
    }
  }
  if (problemasDeForma.length > 0) {
    error("ERROR: los datos no sirven para estos pasos (no se repite ningún valor):");
    for (const problema of problemasDeForma) error(`  - ${problema}`);
    error("No se hizo nada.");
    return 2;
  }

  const total = pasos.length + 1;
  info(`Paso 1 de ${total}: administrador de plataforma.`);
  if ((await entrada.sembrarAdmin(paquete.adminEmail, salida)) !== 0) {
    error("Se detuvo en el paso 1. Repetir el flujo es seguro.");
    return 1;
  }

  const contexto: Contexto = { ...relleno };
  let numero = 1;
  for (const paso of pasos) {
    numero += 1;
    info(`Paso ${numero} de ${total}: ${paso.caso}.`);
    const { codigo, datos } = await entrada.ejecutarCaso(
      paso.caso,
      paso.json(contexto),
      paquete.adminEmail,
      salida,
    );
    if (codigo !== 0) {
      error(
        `Se detuvo en el paso ${numero} («${paso.caso}»). Lo ya hecho queda; repetir el flujo es seguro.`,
      );
      return 1;
    }
    if (paso.leer !== undefined && !paso.leer(datos, contexto)) {
      error(
        `Se detuvo en el paso ${numero} («${paso.caso}»): la salida no trajo el dato que el paso siguiente necesita. Repetir el flujo es seguro.`,
      );
      return 1;
    }
  }

  info(`LISTO: se prepararon los ${total} pasos.`);
  info(
    "Recordá: el mail con la invitación al gerente queda ENCOLADO; este flujo no lo despacha. El dominio queda a verificar y activar aparte.",
  );
  return 0;
}
