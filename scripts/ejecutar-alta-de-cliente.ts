import { ocultarSecretos } from "../src/adaptadores/postgres/describir-falla-de-base";
import { PEDERNAL_CLAVE_CONTEXTO } from "../src/adaptadores/postgres/contexto-firmado";
import { leerPedidoDeVercel } from "../src/adaptadores/vercel/plan-de-variables";
import {
  PEDERNAL_SECRETO_INVITACIONES,
  leerSecretoDeInvitaciones,
} from "../src/adaptadores/tokens/tokens-hmac";
import { CATALOGO_DE_MODULOS, type ClaveModulo } from "../src/capacidades/modulos/catalogo";
import {
  PEDERNAL_DB_PLATAFORMA,
  PEDERNAL_HOSTS_PROTEGIDOS,
} from "../src/composicion/entorno-de-plataforma";
import { emailDesdeTexto } from "../src/modulos/identidad/publico";
import { leerHostsProtegidos } from "../src/modulos/marcas/publico";
import { armarEntradaDelCaso, type NombreDeCaso } from "../src/plataforma/dominio/pedido-de-caso";
import { VARIABLE_DE_LA_CADENA } from "./ejecutar-crear-primer-admin";
import { VARIABLE_DEL_HOST_DE_LA_BASE, hostDeLaBaseCoincide } from "./host-de-la-base";
import {
  ID_DE_RELLENO,
  MARCA_NEUTRA,
  MARGEN_DE_VIGENCIA_EN_MS,
  UUID,
  esObjeto,
  leerSeccion,
  type EjecutorDeCaso,
  type Objeto,
  type Salida,
} from "./ejecutar-preparar-empresa-de-pruebas";
import { MENSAJES_DE_MOTIVO, textoDeProblema } from "./mensajes-de-plataforma";

/**
 * El alta de un CLIENTE con base propia (workflow `alta-de-cliente.yml`; PRIMER-DESPLIEGUE.md, H.4 y H.8): el primer administrador de plataforma, el plan (crear, borrador, publicar), la marca (crear,
 * borrador, confirmar), cada dominio (agregar, verificar, activar) en la base DEL CLIENTE, la empresa con la invitación al primer gerente y cada módulo del plan. NO reescribe ninguna regla de plataforma: arma
 * el JSON de cada paso y se lo pasa a lo que ya existe (`ejecutarCreacionDelPrimerAdmin` y `ejecutarCasoDePlataforma`, que validan, autorizan, auditan y guardan la clave de idempotencia), igual que
 * `ejecutar-preparar-empresa-de-pruebas.ts` (la de preview), de donde reutiliza la lectura de secciones, el ejecutor de casos y la marca neutra. Lo que cambia respecto de preview: varios dominios y módulos, el
 * ambiente en la clave de idempotencia, ninguna clave de contexto propia de la corrida y ningún pedido al cron (la cola de mails la despacha el cron del proyecto del cliente cuando corra).
 *
 * Lo personal sale de UNA variable (`PEDERNAL_ALTA_DE_CLIENTE`, un JSON que en GitHub es un secreto del Environment del cliente: así no figura en la interfaz de la corrida y el runner lo enmascara); lo demás, del archivo versionado `scripts/clientes/<codigo>.json`; y la hora de `vigenteDesde` y `verificadoEn`, del reloj de la corrida. Cada dato
 * personal se tapa en todo lo que sale. Idempotente: la clave de cada paso es fija (`alta-cliente-v1-<codigo>-<paso>`); repetir con los MISMOS datos devuelve lo ya hecho sin duplicar nada (ni administrador, ni
 * empresa, ni dominios); con datos distintos el caso rechaza `CLAVE_REUTILIZADA` y no cambia nada. Antes de abrir ninguna conexión se revisa la forma de TODOS los pasos (con ids de relleno): un dato mal
 * escrito no deja el alta a medias. Código de salida: 0 todo hecho, 1 un paso rechazó o falló, 2 datos o uso incorrectos.
 *
 * Los MÓDULOS del plan: si el paquete no trae `plan.modulos`, son TODOS los del catálogo con estado `disponible` HOY (lo que se sume después a `main` entra solo en el próximo alta), y se activan en la empresa en
 * el orden que piden sus `requiere`. Cambiar el plan o los módulos después del alta NO se hace con este flujo: los datos distintos se rechazan (`CLAVE_REUTILIZADA`).
 */

export const VARIABLE_DEL_PAQUETE_DE_CLIENTE = "PEDERNAL_ALTA_DE_CLIENTE";

/** Las superficies que un dominio de un cliente puede tener hoy: la aplicación y la carta. */
const SUPERFICIES_DEL_CLIENTE = ["APP", "CARTA"] as const;

/** El texto que queda en la auditoría de plataforma como motivo de los pasos que lo piden. */
const MOTIVO = "Alta de un cliente con base propia";

/** Módulos iniciales de la marca: ninguno. `validarModulosIniciales` solo admite claves disponibles y NO obligatorias (los obligatorios están siempre; `[]` es válido); los demás se activan por paso en la empresa. */
export const MODULOS_INICIALES_DE_LA_MARCA: readonly string[] = [];

/** Las variables que se exigen antes de abrir el login temporal (la corrida de validación solo las revisa). */
export const VARIABLES_ANTES_DEL_LOGIN_DE_CLIENTE = [
  VARIABLE_DEL_PAQUETE_DE_CLIENTE,
  VARIABLE_DE_LA_CADENA,
  VARIABLE_DEL_HOST_DE_LA_BASE,
  PEDERNAL_HOSTS_PROTEGIDOS,
] as const;
/** Las de la corrida completa: las dos que entrega el paso que abre el login y la que entrega el paso del secreto de invitaciones. */
export const VARIABLES_OBLIGATORIAS_DE_CLIENTE = [
  ...VARIABLES_ANTES_DEL_LOGIN_DE_CLIENTE,
  PEDERNAL_DB_PLATAFORMA,
  PEDERNAL_CLAVE_CONTEXTO,
  PEDERNAL_SECRETO_INVITACIONES,
] as const;

const MENSAJE_ADMIN_Y_GERENTE =
  "adminEmail y empresa.emailGerente tienen que ser DISTINTOS: el administrador de plataforma no puede ser gerente ni miembro de ninguna empresa (hacen falta dos cuentas de correo)";

export type DominioDeCliente = Readonly<{
  host: string;
  superficie: (typeof SUPERFICIES_DEL_CLIENTE)[number];
  titular: string;
  verificadoEn: string;
}>;

export type PaqueteDeCliente = Readonly<{
  adminEmail: string;
  vigenteDesde: string;
  marca: Readonly<{
    codigo: string;
    nombreVisible: string;
    tema?: Objeto;
    aspecto?: Objeto;
    logo?: string;
  }>;
  plan: Readonly<{
    codigo: string;
    nombreComercial: string;
    /** Siempre completa: la del paquete o, si no vino, todos los módulos disponibles del catálogo. */
    modulos: readonly string[];
    perillas: Objeto;
  }>;
  dominios: readonly DominioDeCliente[];
  empresa: Readonly<{
    nombreDeTenant: string;
    cuit: string;
    razonSocial: string;
    zonaHoraria: string;
    moneda: string;
    emailGerente: string;
  }>;
}>;

/** Todos los módulos del catálogo que están disponibles hoy (los que se pueden encender). */
export function modulosDisponibles(): readonly string[] {
  return (Object.keys(CATALOGO_DE_MODULOS) as ClaveModulo[]).filter(
    (clave) => CATALOGO_DE_MODULOS[clave].estado === "disponible",
  );
}

/** Los módulos del plan que se ACTIVAN por paso: los obligatorios (administración, clientes) están siempre y activarlos se rechaza (`MODULO_OBLIGATORIO`). */
export function modulosParaActivar(modulos: readonly string[]): readonly string[] {
  const catalogo = CATALOGO_DE_MODULOS as Readonly<Record<string, { obligatorio?: boolean }>>;
  return modulos.filter((m) => catalogo[m]?.obligatorio !== true);
}

/**
 * Los módulos en el orden en que se pueden ACTIVAR: cada uno después de los que `requiere` (activar uno cuyo requerido está inactivo se rechaza). Es estable (sigue el orden del catálogo) y un módulo
 * que no está en el catálogo se deja donde cae: lo rechaza el caso, que es quien decide.
 */
export function ordenarPorRequisitos(modulos: readonly string[]): readonly string[] {
  const pedidos = new Set(modulos);
  const salida: string[] = [];
  const visitando = new Set<string>();
  const visitar = (modulo: string): void => {
    if (salida.includes(modulo) || visitando.has(modulo)) return;
    visitando.add(modulo);
    const definicion = (
      CATALOGO_DE_MODULOS as Readonly<Record<string, { requiere?: readonly string[] }>>
    )[modulo];
    for (const requerido of definicion?.requiere ?? []) {
      if (pedidos.has(requerido)) visitar(requerido);
    }
    visitando.delete(modulo);
    salida.push(modulo);
  };
  for (const modulo of modulos) visitar(modulo);
  return salida;
}

/**
 * Lee y revisa el paquete de datos. Devuelve TODOS los problemas juntos y NUNCA el valor que los causó (podría ser un dato personal): solo el nombre del campo. Un campo que sobra se rechaza (un error de
 * tipeo no se pierde en silencio).
 */
export function leerPaqueteDeCliente(
  texto: string | undefined,
):
  | Readonly<{ ok: true; paquete: PaqueteDeCliente }>
  | Readonly<{ ok: false; problemas: readonly string[] }> {
  const nombre = VARIABLE_DEL_PAQUETE_DE_CLIENTE;
  if (texto === undefined || texto.trim() === "") {
    return { ok: false, problemas: [`falta la variable ${nombre}`] };
  }
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return { ok: false, problemas: [`${nombre} no es un JSON válido`] };
  }
  if (!esObjeto(json)) return { ok: false, problemas: [`${nombre} tiene que ser un objeto JSON`] };

  const problemas: string[] = [];
  const raiz = leerSeccion(
    { adminEmail: json["adminEmail"], vigenteDesde: json["vigenteDesde"] },
    "(raíz)",
    ["adminEmail", "vigenteDesde"],
    [],
    problemas,
  );
  for (const campo of Object.keys(json)) {
    if (!["adminEmail", "vigenteDesde", "marca", "plan", "dominios", "empresa"].includes(campo)) {
      problemas.push(`${campo}: no se esperaba este campo`);
    }
  }
  const marca = leerSeccion(
    json["marca"],
    "marca",
    ["codigo", "nombreVisible"],
    ["tema", "aspecto"],
    problemas,
    ["logo"],
  );

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
  let modulos: readonly string[] = modulosDisponibles();
  if (planCrudo !== null && Object.hasOwn(planCrudo, "modulos")) {
    const lista = planCrudo["modulos"];
    if (Array.isArray(lista) && lista.length > 0 && lista.every((m) => typeof m === "string")) {
      modulos = lista;
    } else {
      problemas.push(
        "plan.modulos: tiene que ser una lista de textos (o no ir: entonces son todos los disponibles)",
      );
    }
  }
  if (!esObjeto(planCrudo?.["perillas"])) problemas.push("plan.perillas: tiene que ser un objeto");
  for (const campo of Object.keys(planCrudo ?? {})) {
    if (!["codigo", "nombreComercial", "modulos", "perillas"].includes(campo)) {
      problemas.push(`plan.${campo}: no se esperaba este campo`);
    }
  }

  const dominios: DominioDeCliente[] = [];
  const crudos = json["dominios"];
  if (!Array.isArray(crudos) || crudos.length === 0) {
    problemas.push("dominios: tiene que ser una lista con al menos un dominio");
  } else {
    crudos.forEach((crudo, i) => {
      const d = leerSeccion(
        crudo,
        `dominios[${String(i)}]`,
        ["host", "titular", "verificadoEn", "superficie"],
        [],
        problemas,
      );
      if (!(SUPERFICIES_DEL_CLIENTE as readonly string[]).includes(d["superficie"] as string)) {
        problemas.push(
          `dominios[${String(i)}].superficie: tiene que ser ${SUPERFICIES_DEL_CLIENTE.join(" o ")}`,
        );
      }
      dominios.push(d as DominioDeCliente);
    });
    const hosts = dominios.map((d) => String(d.host ?? "").toLowerCase());
    if (new Set(hosts).size !== hosts.length) problemas.push("dominios: hay hosts repetidos");
    const porSuperficie = (s: string) => dominios.filter((d) => d.superficie === s).length;
    if (porSuperficie("APP") !== 1) {
      problemas.push(
        "dominios: tiene que haber exactamente un dominio de la superficie APP (el alta exige el canónico de la aplicación)",
      );
    }
    if (porSuperficie("CARTA") > 1)
      problemas.push("dominios: no puede haber más de un dominio de la superficie CARTA");
  }

  const empresa = leerSeccion(
    json["empresa"],
    "empresa",
    ["nombreDeTenant", "cuit", "razonSocial", "zonaHoraria", "moneda", "emailGerente"],
    [],
    problemas,
  );

  const normal = (valor: unknown) =>
    typeof valor === "string" ? valor.trim().toLowerCase() : null;
  if (
    normal(raiz["adminEmail"]) !== null &&
    normal(raiz["adminEmail"]) === normal(empresa["emailGerente"])
  ) {
    problemas.push(MENSAJE_ADMIN_Y_GERENTE);
  }

  if (problemas.length > 0) return { ok: false, problemas };
  return {
    ok: true,
    paquete: {
      adminEmail: raiz["adminEmail"] as string,
      vigenteDesde: raiz["vigenteDesde"] as string,
      marca: marca as PaqueteDeCliente["marca"],
      plan: {
        ...(planBase as { codigo: string; nombreComercial: string }),
        modulos,
        perillas: planCrudo?.["perillas"] as Objeto,
      },
      dominios,
      empresa: empresa as PaqueteDeCliente["empresa"],
    },
  };
}

/** Lo que viaja en el secreto del Environment: SOLO lo personal. Todo lo demás está en `scripts/clientes/<codigo>.json` (versionado, sin secretos) o lo calcula el flujo. */
export const CAMPOS_PERSONALES = [
  "adminEmail",
  "emailGerente",
  "cuit",
  "razonSocial",
  "nombreDeTenant",
] as const;

/** ¿El secreto trae exactamente lo personal (los cinco campos, ni uno más ni uno menos)? Devuelve los problemas, sin repetir ningún valor. */
export function problemasDelSecretoPersonal(texto: string | undefined): readonly string[] {
  if (texto === undefined || texto.trim() === "")
    return [`falta la variable ${VARIABLE_DEL_PAQUETE_DE_CLIENTE}`];
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return [`${VARIABLE_DEL_PAQUETE_DE_CLIENTE} no es un JSON válido`];
  }
  const problemas: string[] = [];
  leerSeccion(json, VARIABLE_DEL_PAQUETE_DE_CLIENTE, CAMPOS_PERSONALES, [], problemas);
  return problemas;
}

/** Cuánto después de la corrida empieza a regir la marca (la corrida espera ese tiempo antes del alta de la empresa). */
export const MINUTOS_HASTA_QUE_RIGE_LA_MARCA = 6;

const CAMPOS_DEL_ARCHIVO = ["marca", "plan", "dominios", "zonaHoraria", "moneda"] as const;

/**
 * Arma el paquete COMPLETO del alta con tres fuentes: el secreto (solo lo personal), el archivo versionado del cliente (marca, plan, perillas, módulos, dominios, zona horaria y moneda) y el reloj de la
 * corrida (`vigenteDesde` = ahora + 6 minutos y `verificadoEn` de cada dominio = ahora). Cada fuente se revisa con la misma cerradura que antes: todo campo que sobra o falta se rechaza, con todos los
 * problemas juntos y sin repetir ningún valor; el archivo NO puede traer lo personal ni lo que calcula el flujo (así nadie lo fija por error ahí). La revisión profunda es la de `leerPaqueteDeCliente`.
 */
export function armarPaqueteDeCliente(
  textoDelSecreto: string | undefined,
  archivo: unknown,
  ahora: Date,
):
  | Readonly<{ ok: true; paquete: PaqueteDeCliente }>
  | Readonly<{ ok: false; problemas: readonly string[] }> {
  const nombre = VARIABLE_DEL_PAQUETE_DE_CLIENTE;
  if (textoDelSecreto === undefined || textoDelSecreto.trim() === "") {
    return { ok: false, problemas: [`falta la variable ${nombre}`] };
  }
  let personal: unknown;
  try {
    personal = JSON.parse(textoDelSecreto);
  } catch {
    return { ok: false, problemas: [`${nombre} no es un JSON válido`] };
  }
  if (!esObjeto(personal))
    return { ok: false, problemas: [`${nombre} tiene que ser un objeto JSON`] };
  if (!esObjeto(archivo)) {
    return { ok: false, problemas: ["el archivo del cliente tiene que ser un objeto JSON"] };
  }

  const problemas: string[] = [];
  const datos = leerSeccion(personal, nombre, CAMPOS_PERSONALES, [], problemas);
  for (const campo of Object.keys(archivo)) {
    if (!(CAMPOS_DEL_ARCHIVO as readonly string[]).includes(campo)) {
      problemas.push(`archivo del cliente: ${campo}: no se esperaba este campo`);
    }
  }
  for (const campo of CAMPOS_DEL_ARCHIVO) {
    if (!Object.hasOwn(archivo, campo)) problemas.push(`archivo del cliente: ${campo}: falta`);
  }
  const dominiosDelArchivo = Array.isArray(archivo["dominios"]) ? archivo["dominios"] : [];
  dominiosDelArchivo.forEach((crudo, i) => {
    // El archivo solo trae host, superficie y titular: `verificadoEn` lo pone el flujo (y cualquier otro campo sobra).
    leerSeccion(
      crudo,
      `archivo del cliente: dominios[${String(i)}]`,
      ["host", "superficie", "titular"],
      [],
      problemas,
    );
  });
  if (problemas.length > 0) return { ok: false, problemas };

  const instante = ahora.toISOString();
  const vigenteDesde = new Date(
    ahora.getTime() + MINUTOS_HASTA_QUE_RIGE_LA_MARCA * 60_000,
  ).toISOString();
  return leerPaqueteDeCliente(
    JSON.stringify({
      adminEmail: datos["adminEmail"],
      vigenteDesde,
      marca: archivo["marca"],
      plan: archivo["plan"],
      dominios: dominiosDelArchivo.map((d) => ({ ...(d as Objeto), verificadoEn: instante })),
      empresa: {
        nombreDeTenant: datos["nombreDeTenant"],
        cuit: datos["cuit"],
        razonSocial: datos["razonSocial"],
        zonaHoraria: archivo["zonaHoraria"],
        moneda: archivo["moneda"],
        emailGerente: datos["emailGerente"],
      },
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Los pasos
// ---------------------------------------------------------------------------------------------

type Contexto = {
  planId: string;
  marcaId: string;
  versionDelBorradorDeMarca: number;
  /** El id del dominio de cada host, a medida que se agregan. */
  dominioIds: Record<string, string>;
  empresaId: string;
};

type Paso = Readonly<{
  /** Nombre corto y estable: forma la clave de idempotencia. */
  nombre: string;
  caso: NombreDeCaso;
  json: (c: Contexto) => Record<string, unknown>;
  leer?: (datos: ReadonlyMap<string, string>, c: Contexto) => boolean;
  /** Lleva un dato que sale del reloj de la corrida (`vigenteDesde`, `verificadoEn`): si una corrida anterior ya lo hizo, la clave de idempotencia lo rechaza por OTRO instante y eso es «ya hecho», no un error. */
  delInstante?: true;
}>;

const idDe = (d: ReadonlyMap<string, string>, campo: string): string | null => {
  const id = d.get(campo);
  return id !== undefined && UUID.test(id) ? id : null;
};

/** Los pasos del alta, en orden. `codigo` es el del cliente (`hdn`): forma parte de la clave de cada paso. */
export function pasosDeAltaDeCliente(p: PaqueteDeCliente, codigo: string): readonly Paso[] {
  const clave = (nombre: string) => `alta-cliente-v1-${codigo}-${nombre}`;
  const dominios = [...p.dominios].sort((a, b) =>
    a.superficie === b.superficie ? 0 : a.superficie === "APP" ? -1 : 1,
  );
  const pasos: Paso[] = [
    {
      nombre: "crear-plan",
      caso: "crearPlan",
      json: () => ({ claveDeIdempotencia: clave("crear-plan"), codigo: p.plan.codigo }),
      leer: (d, c) => {
        const id = idDe(d, "planId");
        if (id === null) return false;
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
        const id = idDe(d, "marcaId");
        if (id === null) return false;
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
        // Lo que el paquete no manda, la marca NEUTRA (la misma de preview); lo que manda se respeta y lo valida el caso.
        tema: p.marca.tema ?? MARCA_NEUTRA.tema,
        logo: p.marca.logo ?? MARCA_NEUTRA.logo,
        modulosIniciales: MODULOS_INICIALES_DE_LA_MARCA,
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
      delInstante: true,
      json: (c) => ({
        claveDeIdempotencia: clave("confirmar-marca"),
        marcaId: c.marcaId,
        versionEsperada: c.versionDelBorradorDeMarca,
        vigenteDesde: p.vigenteDesde,
        motivo: MOTIVO,
        reemplazaProgramada: false,
      }),
    },
  ];
  // Los dominios: SOLO en la base del cliente (H.8). Cada uno se agrega, se verifica y se activa; el de la aplicación va primero.
  for (const dominio of dominios) {
    const sufijo = dominio.superficie.toLowerCase();
    pasos.push(
      {
        nombre: `agregar-dominio-${sufijo}`,
        caso: "agregarDominio",
        json: (c) => ({
          claveDeIdempotencia: clave(`agregar-dominio-${sufijo}`),
          host: dominio.host,
          superficie: dominio.superficie,
          titular: dominio.titular,
          esCanonico: true,
          duenio: { tipo: "MARCA", marcaId: c.marcaId },
        }),
        leer: (d, c) => {
          const id = idDe(d, "dominioId");
          if (id === null) return false;
          c.dominioIds[dominio.host] = id;
          return true;
        },
      },
      {
        nombre: `verificar-dominio-${sufijo}`,
        caso: "verificarDominio",
        delInstante: true,
        json: (c) => ({
          claveDeIdempotencia: clave(`verificar-dominio-${sufijo}`),
          dominioId: c.dominioIds[dominio.host],
          verificadoEn: dominio.verificadoEn,
        }),
      },
      {
        nombre: `activar-dominio-${sufijo}`,
        caso: "activarDominio",
        json: (c) => ({
          claveDeIdempotencia: clave(`activar-dominio-${sufijo}`),
          dominioId: c.dominioIds[dominio.host],
        }),
      },
    );
  }
  pasos.push({
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
      const id = idDe(d, "empresaId");
      if (id === null) return false;
      c.empresaId = id;
      return true;
    },
  });
  for (const modulo of ordenarPorRequisitos(modulosParaActivar(p.plan.modulos))) {
    pasos.push({
      nombre: `activar-modulo-${modulo}`,
      caso: "activarModuloDeEmpresa",
      json: (c) => ({
        claveDeIdempotencia: clave(`activar-modulo-${modulo}`),
        empresaId: c.empresaId,
        modulo,
      }),
    });
  }
  return pasos;
}

// ---------------------------------------------------------------------------------------------
// El orquestador
// ---------------------------------------------------------------------------------------------

export type EntradaDeAltaDeCliente = Readonly<{
  /** El ambiente (`cliente-<codigo>`), de la lista cerrada de clientes. */
  ambiente: string | undefined;
  entorno: Readonly<Record<string, string | undefined>>;
  /** Siembra al primer administrador con la cadena del dueño; devuelve su código de salida. */
  sembrarAdmin: (email: string, salida: Salida) => Promise<number>;
  /** Ejecuta un caso como ese administrador (`ejecutorDeCasos`). */
  ejecutarCaso: EjecutorDeCaso;
  info: (linea: string) => void;
  error: (linea: string) => void;
  /** Una línea tal cual, sin tapar (el `::add-mask::` que lee el runner de GitHub). Solo en Actions. */
  comando: (linea: string) => void;
  /** Solo revisa (variables y forma de los datos y de los pasos) y no toca ninguna base. */
  soloValidar?: boolean;
  ahora?: () => Date;
  esperar?: (milisegundos: number) => Promise<void>;
  /** Los datos NO personales del cliente: el contenido de `scripts/clientes/<codigo>.json`. */
  leerDatosDelCliente: (codigo: string) => unknown;
}>;

/** El código corto del cliente (`hdn` de `cliente-hdn`), solo si el ambiente está en la lista cerrada de clientes con base propia. */
export function codigoDelCliente(ambiente: string | undefined): string | null {
  if (leerPedidoDeVercel(ambiente) === null || !ambiente?.startsWith("cliente-")) return null;
  return ambiente.slice("cliente-".length);
}

export async function altaDeCliente(entrada: EntradaDeAltaDeCliente): Promise<number> {
  const { entorno } = entrada;
  // Se tapan las variables sensibles y, apenas se leen, los datos personales del paquete.
  const tapados: Array<string | undefined> = [
    entorno[VARIABLE_DE_LA_CADENA]?.trim(),
    entorno[PEDERNAL_DB_PLATAFORMA]?.trim(),
    entorno[PEDERNAL_CLAVE_CONTEXTO]?.trim().split(":")[1],
    entorno[PEDERNAL_SECRETO_INVITACIONES]?.trim(),
    entorno[VARIABLE_DEL_PAQUETE_DE_CLIENTE]?.trim(),
  ];
  const tapar = (linea: string) =>
    tapados.reduce<string>((texto, secreto) => ocultarSecretos(texto, secreto), linea);
  const info = (linea: string) => entrada.info(tapar(linea));
  const error = (linea: string) => entrada.error(tapar(linea));
  const salida = { info, error };

  const codigo = codigoDelCliente(entrada.ambiente);
  if (codigo === null) {
    error("ERROR: el ambiente no es un cliente de la lista cerrada. No se hizo nada.");
    return 2;
  }
  const exigidas =
    entrada.soloValidar === true
      ? VARIABLES_ANTES_DEL_LOGIN_DE_CLIENTE
      : VARIABLES_OBLIGATORIAS_DE_CLIENTE;
  const faltan = exigidas.filter((n) => (entorno[n] ?? "").trim() === "");
  if (faltan.length > 0) {
    error(
      `ERROR: faltan estas variables (solo se nombran): ${faltan.join(", ")}. No se hizo nada.`,
    );
    return 2;
  }
  const malos: string[] = [];
  if (entrada.soloValidar !== true) {
    try {
      leerSecretoDeInvitaciones(entorno[PEDERNAL_SECRETO_INVITACIONES]);
    } catch {
      malos.push(`${PEDERNAL_SECRETO_INVITACIONES}: tiene que ser hexadecimal de 64 o más dígitos`);
    }
  }
  if (
    !hostDeLaBaseCoincide(entorno[VARIABLE_DE_LA_CADENA], entorno[VARIABLE_DEL_HOST_DE_LA_BASE])
  ) {
    malos.push(
      `${VARIABLE_DE_LA_CADENA}: su host no es el declarado en ${VARIABLE_DEL_HOST_DE_LA_BASE} (no es la base de este cliente)`,
    );
  }
  if (!leerHostsProtegidos(entorno[PEDERNAL_HOSTS_PROTEGIDOS] ?? "").ok) {
    malos.push(
      `${PEDERNAL_HOSTS_PROTEGIDOS}: tiene que ser una lista de hosts distintos separados por comas, sin https:// ni barras`,
    );
  }
  if (malos.length > 0) {
    error("ERROR: estos valores no tienen la forma pedida (no se repite ninguno):");
    for (const problema of malos) error(`  - ${problema}`);
    error("No se hizo nada.");
    return 2;
  }

  const ahora = entrada.ahora ?? (() => new Date());
  let datosDelCliente: unknown;
  try {
    datosDelCliente = entrada.leerDatosDelCliente(codigo);
  } catch {
    error(
      `ERROR: no se pudo leer el archivo de datos del cliente (scripts/clientes/${codigo}.json). No se hizo nada.`,
    );
    return 2;
  }
  const leido = armarPaqueteDeCliente(
    entorno[VARIABLE_DEL_PAQUETE_DE_CLIENTE],
    datosDelCliente,
    ahora(),
  );
  if (!leido.ok) {
    error("ERROR: los datos del alta no sirven (no se repite ningún valor):");
    for (const problema of leido.problemas) error(`  - ${problema}`);
    error("No se hizo nada.");
    return 2;
  }
  const { paquete } = leido;
  // Datos personales: tapados en todo lo que sale y entregados al runner para que los tape en el resto del registro.
  for (const dato of [
    paquete.adminEmail,
    paquete.empresa.emailGerente,
    paquete.empresa.cuit,
    paquete.empresa.razonSocial,
    paquete.empresa.nombreDeTenant,
  ]) {
    tapados.push(dato);
    if (entorno["GITHUB_ACTIONS"] === "true") entrada.comando(`::add-mask::${dato}`);
  }

  // Revisión previa de la forma de TODOS los pasos, sin conexión alguna: nada queda a medias por un dato mal escrito.
  const pasos = pasosDeAltaDeCliente(paquete, codigo);
  const relleno: Contexto = {
    planId: ID_DE_RELLENO,
    marcaId: ID_DE_RELLENO,
    versionDelBorradorDeMarca: 1,
    dominioIds: Object.fromEntries(paquete.dominios.map((d) => [d.host, ID_DE_RELLENO])),
    empresaId: ID_DE_RELLENO,
  };
  const problemasDeForma: string[] = [];
  if (!emailDesdeTexto(paquete.adminEmail).ok)
    problemasDeForma.push("adminEmail: no tiene forma de email (algo@dominio)");
  for (const paso of pasos) {
    const armada = armarEntradaDelCaso(paso.caso, paso.json(relleno));
    if (!armada.ok) {
      for (const problema of armada.error)
        problemasDeForma.push(`${paso.nombre}: ${textoDeProblema(problema)}`);
    }
  }
  if (problemasDeForma.length > 0) {
    error("ERROR: los datos no sirven para estos pasos (no se repite ningún valor):");
    for (const problema of problemasDeForma) error(`  - ${problema}`);
    error("No se hizo nada.");
    return 2;
  }

  if (entrada.soloValidar === true) {
    info("VALIDADO: variables y datos de los pasos están bien. No se tocó ninguna base.");
    return 0;
  }

  const total = pasos.length + 1;
  info(`Paso 1 de ${String(total)}: administrador de plataforma.`);
  if ((await entrada.sembrarAdmin(paquete.adminEmail, salida)) !== 0) {
    error("Se detuvo en el paso 1. Repetir el flujo es seguro.");
    return 1;
  }

  const esperar =
    entrada.esperar ?? ((ms: number) => new Promise<void>((listo) => setTimeout(listo, ms)));
  const contexto: Contexto = { ...relleno, dominioIds: {} };
  let numero = 1;
  let esperarALaMarca = true;
  for (const paso of pasos) {
    numero += 1;
    if (paso.caso === "altaDeEmpresa") {
      // El alta exige la marca VIGENTE: se espera a que llegue `vigenteDesde` (ya validado: no está más lejos que el tope).
      const falta =
        new Date(paquete.vigenteDesde).getTime() + MARGEN_DE_VIGENCIA_EN_MS - ahora().getTime();
      if (esperarALaMarca && falta > 0) {
        info(
          `Esperando ${String(Math.ceil(falta / 1000))} s a que la marca empiece a regir (vigenteDesde).`,
        );
        await esperar(falta);
      }
    }
    info(`Paso ${String(numero)} de ${String(total)}: ${paso.nombre}.`);
    const lineasDeError: string[] = [];
    const { codigo: salidaDelCaso, datos } = await entrada.ejecutarCaso(
      paso.caso,
      paso.json(contexto),
      paquete.adminEmail,
      paso.delInstante === true
        ? {
            info,
            error: (linea) => {
              lineasDeError.push(linea);
              error(linea);
            },
          }
        : salida,
    );
    if (
      salidaDelCaso !== 0 &&
      paso.delInstante === true &&
      lineasDeError.some((l) => l.includes(MENSAJES_DE_MOTIVO["CLAVE_REUTILIZADA"] as string))
    ) {
      // Una corrida anterior ya hizo este paso con su propio instante: repetirlo no cambia nada.
      info(`El paso «${paso.nombre}» ya se hizo en una corrida anterior: se sigue.`);
      if (paso.caso === "confirmarVersionDeMarca") esperarALaMarca = false;
      continue;
    }
    if (salidaDelCaso !== 0) {
      error(
        `Se detuvo en el paso ${String(numero)} («${paso.nombre}»). Lo ya hecho queda; repetir el flujo es seguro.`,
      );
      return 1;
    }
    if (paso.leer !== undefined && !paso.leer(datos, contexto)) {
      error(
        `Se detuvo en el paso ${String(numero)} («${paso.nombre}»): la salida no trajo el dato que el paso siguiente necesita. Repetir el flujo es seguro.`,
      );
      return 1;
    }
  }
  info(`LISTO: se hicieron los ${String(total)} pasos del alta de ${entrada.ambiente ?? ""}.`);
  return 0;
}
