import { randomUUID } from "node:crypto";
import { codigoAlAzar, crearStockFalso } from "./carta-publica-apoyo";
import pg from "pg";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeCatalogo,
  cotizarParaVender,
  crearConsultasDeCatalogo,
  type DependenciasDeCatalogo,
} from "../../src/modulos/catalogo/publico";
import {
  empresaId,
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../src/primitivas/identificadores/marca";
import {
  comoEmpresa,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
} from "./entorno";
import type { BaseDePruebas } from "./global";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  sucursalDe,
  type RolDePrueba,
} from "./fixtures-identidad";
import { nombreDeLetrasUnico } from "./unicos";

/**
 * Apoyo de las pruebas de integración del catálogo (E2): armar con SQL directo del dueño de la base (que evade RLS: es solo para montar
 * el escenario) los productos, grupos, opciones y precios que cada prueba necesita. Lo que se prueba pasa siempre por el rol real o por
 * los casos de uso, nunca por estos atajos.
 */

export type ClaseDeUsoDePrueba = "MATERIA_PRIMA" | "INSUMO" | "REVENTA" | "ELABORADO" | "VENDIBLE";

export const nombreAlAzarDeProducto = (prefijo = "Producto"): string =>
  nombreDeLetrasUnico(prefijo);

export type DatosDeProducto = Readonly<{
  id?: string;
  nombre?: string;
  clase?: ClaseDeUsoDePrueba;
  unidadBase?: string;
  dimension?: string;
  unidadDeVenta?: string;
  paso?: string;
  alicuota?: string | null;
  faltaCompletar?: boolean;
  activo?: boolean;
  persona?: string | null;
}>;

/** Un producto con lo mínimo para su clase: los que venden llevan alícuota 21; los demás, ninguna. */
export async function productoDeBase(
  c: pg.Client,
  empresa: string,
  datos: DatosDeProducto = {},
): Promise<string> {
  const clase = datos.clase ?? "VENDIBLE";
  const vende = clase === "VENDIBLE" || clase === "REVENTA";
  const id = datos.id ?? randomUUID();
  const nombre = datos.nombre ?? nombreAlAzarDeProducto();
  const unidadBase = datos.unidadBase ?? "UNIDAD";
  await c.query(
    `insert into producto (id, empresa_id, nombre, nombre_clave, tipo, clase_de_uso, unidad_base_id, dimension,
                           unidad_de_venta_id, paso_minimo, alicuota_iva, falta_completar, activo, creado_por)
     values ($1, $2, $3, $4, 'BIEN', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      empresa,
      nombre,
      nombre.normalize("NFC").toLowerCase(),
      clase,
      unidadBase,
      datos.dimension ?? "CONTEO",
      datos.unidadDeVenta ?? unidadBase,
      datos.paso ?? "1",
      datos.alicuota === undefined ? (vende ? "21" : null) : datos.alicuota,
      datos.faltaCompletar ?? false,
      datos.activo ?? true,
      datos.persona ?? null,
    ],
  );
  return id;
}

export async function grupoDeBase(
  c: pg.Client,
  empresa: string,
  producto: string,
  datos: Partial<{
    id: string;
    clase: "VARIANTE" | "INCLUIDA" | "ADICIONAL";
    nombre: string;
    esTamano: boolean;
    esObligatorio: boolean;
    admiteVarias: boolean;
    seMuestraEnCarta: boolean;
    orden: number;
    activo: boolean;
  }> = {},
): Promise<string> {
  const clase = datos.clase ?? "ADICIONAL";
  const id = datos.id ?? randomUUID();
  const nombre = datos.nombre ?? nombreAlAzarDeProducto("Grupo");
  await c.query(
    `insert into grupo_de_elecciones (id, empresa_id, producto_id, clase, es_tamano, nombre, nombre_clave, es_obligatorio,
                                      admite_varias, se_muestra_en_carta, orden, activo)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      empresa,
      producto,
      clase,
      datos.esTamano ?? false,
      nombre,
      nombre.toLowerCase(),
      datos.esObligatorio ?? clase === "VARIANTE",
      datos.admiteVarias ?? false,
      datos.seMuestraEnCarta ?? clase !== "INCLUIDA",
      datos.orden ?? 0,
      datos.activo ?? true,
    ],
  );
  return id;
}

/** Una opción con su versión 1 (nombre, recargo y factor). Devuelve la opción y su versión. */
export async function opcionDeBase(
  c: pg.Client,
  empresa: string,
  producto: string,
  grupo: string,
  datos: Partial<{
    id: string;
    nombre: string;
    recargo: string;
    factor: string;
    persona: string | null;
  }> = {},
): Promise<{ opcion: string; version: string }> {
  const opcion = datos.id ?? randomUUID();
  const version = randomUUID();
  const nombre = datos.nombre ?? nombreAlAzarDeProducto("Opcion");
  await c.query(
    `insert into opcion (id, empresa_id, producto_id, grupo_id, nombre_clave, orden) values ($1, $2, $3, $4, $5, 0)`,
    [opcion, empresa, producto, grupo, nombre.toLowerCase()],
  );
  await c.query(
    `insert into version_de_opcion (id, empresa_id, opcion_id, numero, nombre, recargo, factor_de_tamano, cargada_por, creado_en)
     values ($1, $2, $3, 1, $4, $5, $6, $7, now())`,
    [
      version,
      empresa,
      opcion,
      nombre,
      datos.recargo ?? "0",
      datos.factor ?? "1",
      datos.persona ?? null,
    ],
  );
  return { opcion, version };
}

/** Una fila de precio con la forma de venta que hoy tiene el producto. `desde` en ISO. */
export async function precioDeBase(
  c: pg.Client,
  datos: Readonly<{
    empresa: string;
    producto: string;
    opcion?: string | null;
    sucursal?: string | null;
    precio: string | null;
    desde: string;
    id?: string;
    persona?: string | null;
  }>,
): Promise<string> {
  const id = datos.id ?? randomUUID();
  await c.query(
    `insert into precio_de_venta (id, empresa_id, producto_id, opcion_id, sucursal_id, precio, unidad_id, paso_minimo, vigente_desde, cargado_por)
     select $1, $2, p.id, $3, $4, $5, p.unidad_de_venta_id, p.paso_minimo, $6, $7
       from producto p where p.id = $8 and p.empresa_id = $2`,
    [
      id,
      datos.empresa,
      datos.opcion ?? null,
      datos.sucursal ?? null,
      datos.precio,
      datos.desde,
      datos.persona ?? null,
      datos.producto,
    ],
  );
  return id;
}

// ---- el escenario de los casos de uso -----------------------------------------------------------------------------------------

const REGLAS_DE_PRUEBA: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "disponible" },
    vidriera: { ...CATALOGO_DE_MODULOS.vidriera, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

export type EscenarioDeCatalogo = Readonly<{
  empresa: string;
  empresaId: EmpresaId;
  /** La sucursal que trae la empresa de prueba («Casa central») y otra más. */
  sucursal: SucursalId;
  otraSucursal: SucursalId;
  gerente: ContextoOperativo;
  administrador: ContextoOperativo;
  /** Un administrador cuyo alcance se FIJA en «Casa central» (`alcances`): hoy el rol administrador tiene TODAS; ver `montarCatalogo`. */
  administradorDeUnaSucursal: ContextoOperativo;
  operador: ContextoOperativo;
  personaDelGerente: PersonaId;
}>;

/**
 * Lo que arma una prueba de casos de uso: una base propia (SERIALIZABLE aborta por falsos positivos cuando otros archivos escriben las
 * mismas tablas), el entorno con el catálogo ACTIVO para la empresa (el módulo real está `en_desarrollo`: se inyectan `reglas` con
 * `catalogo` disponible y la autorización suma el módulo a los activados; el ROL y el ALCANCE salen de la base, como siempre) y los
 * casos de uso y consultas.
 */
export async function montarCatalogo(
  base: BaseDePruebas,
  opciones: Readonly<{
    reglas?: ReglasDeEmpresa;
    /** Enciende de entrada la perilla `venta_por_fracciones_y_peso` del plan (extra de pago, apagada de base): la prueba de fracciones y peso la pide. */
    fraccionesYPeso?: boolean;
    conexiones?: number;
    /** El stock que contesta por existencias y conteos (por defecto, uno FALSO vacío: nada tiene existencia). */
    existencias?: DependenciasDeCatalogo["existencias"];
    /** El puerto de azar del código de la carta (por defecto, 16 bytes al azar en base64url: el real). */
    generarCodigoDeCarta?: DependenciasDeCatalogo["generarCodigoDeCarta"];
  }> = {},
) {
  const propia = await crearBaseAparte(base);
  /**
   * El alcance de sucursales que la base le da a cada rol: TODAS a gerente y administrador (decisión 18, roles fijos). Para probar el
   * alcance restringido de un administrador (cuando los permisos se puedan configurar, después del piloto) una prueba lo fija acá.
   */
  const alcances = new Map<string, readonly SucursalId[]>();
  /**
   * La barrera de la ronda en curso (`armarBarrera`): cada transacción espera tras leer su autorización hasta que llegaron todas, para
   * forzar que las dos hayan EMPEZADO antes de que cualquiera escriba. Vacía por defecto.
   */
  let barrera: () => Promise<void> = () => Promise.resolve();
  /** El plan de las pruebas no enciende extras: la perilla `vidriera_por_qr` (carta en línea) se muestra encendida salvo que la prueba la apague. */
  const plan = { perillaDeCarta: true, fraccionesYPeso: opciones.fraccionesYPeso ?? false };
  const entorno = crearEntornoDePrueba(propia.base, opciones.conexiones ?? 12, (tx) => {
    let primera = true;
    return {
      ...tx,
      derechos: {
        ...tx.derechos,
        deLaEmpresa: async (contexto, ...resto) => {
          const reales = await tx.derechos.deLaEmpresa(contexto, ...resto);
          return {
            ...reales,
            perillas: new Map(
              [...reales.perillas].map(([perilla, valor]) => [
                perilla,
                perilla === "vidriera_por_qr" && valor.tipo === "INTERRUPTOR"
                  ? { ...valor, encendida: plan.perillaDeCarta }
                  : perilla === "venta_por_fracciones_y_peso" && valor.tipo === "INTERRUPTOR"
                    ? { ...valor, encendida: plan.fraccionesYPeso }
                    : valor,
              ]),
            ),
          };
        },
      },
      autorizacion: {
        ...tx.autorizacion,
        sucursalesDelActor: async (contexto, opcionesDeAlcance) => {
          const fijado = contexto.personaId === null ? undefined : alcances.get(contexto.personaId);
          return fijado ?? tx.autorizacion.sucursalesDelActor(contexto, opcionesDeAlcance);
        },
        delActor: async (contexto) => {
          const datos = await tx.autorizacion.delActor(contexto);
          if (primera) {
            primera = false;
            await barrera();
          }
          return datos.rol === null
            ? datos
            : {
                ...datos,
                modulosActivados: [...datos.modulosActivados, "catalogo", "vidriera"],
                modulosHabilitados: [...datos.modulosHabilitados, "catalogo", "vidriera"],
              };
        },
      },
    };
  });
  const dueno = new pg.Client({ connectionString: propia.base.dueno });
  await dueno.connect();
  const reglas = opciones.reglas ?? REGLAS_DE_PRUEBA;
  const stockFalso = crearStockFalso();
  const dependencias = {
    transacciones: entorno,
    reglas,
    existencias: opciones.existencias ?? stockFalso,
    generarCodigoDeCarta: opciones.generarCodigoDeCarta ?? codigoAlAzar,
  } as DependenciasDeCatalogo;
  const casos = crearCasosDeUsoDeCatalogo(dependencias);
  const consultas = crearConsultasDeCatalogo({ transacciones: entorno, reglas });

  const miembro = async (empresa: string, rol: RolDePrueba) => {
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, empresa, p.id, rol);
    return p.id;
  };

  const escenario = async (): Promise<EscenarioDeCatalogo> => {
    const e = await crearEmpresaActiva(entorno);
    const sucursal = sucursalId(await sucursalDe(dueno, e.empresa));
    const { rows } = await dueno.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
      [e.empresa],
    );
    const otraSucursal = sucursalId(rows[0]?.id as string);
    const gerente = personaId(await miembro(e.empresa, "GERENTE"));
    const administrador = personaId(await miembro(e.empresa, "ADMINISTRADOR"));
    const unico = personaId(await miembro(e.empresa, "ADMINISTRADOR"));
    await crearAsignacionDeBase(dueno, e.empresa, unico, sucursal);
    alcances.set(unico, [sucursal]);
    const operador = personaId(await miembro(e.empresa, "OPERADOR"));
    await crearAsignacionDeBase(dueno, e.empresa, operador, sucursal);
    return {
      empresa: e.empresa,
      empresaId: e.empresa,
      sucursal,
      otraSucursal,
      gerente: comoEmpresa(e.empresa, gerente),
      administrador: comoEmpresa(e.empresa, administrador),
      administradorDeUnaSucursal: comoEmpresa(e.empresa, unico),
      operador: comoEmpresa(e.empresa, operador),
      personaDelGerente: gerente,
    };
  };

  const filas = async <T extends Record<string, unknown> = Record<string, unknown>>(
    texto: string,
    p: unknown[] = [],
  ) => (await dueno.query<T>(texto, p)).rows;
  const contar = async (texto: string, p: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, p))[0]?.n);
  const auditoria = (empresa: string, accion?: string) =>
    filas(
      `select accion, actor_persona_id, entidad, entidad_id, antes, despues from auditoria_empresa
        where empresa_id = $1 and ($2::text is null or accion = $2) order by id`,
      [empresa, accion ?? null],
    );

  return {
    propia,
    entorno,
    /** El stock falso por defecto: la prueba dice qué producto tiene existencia o un conteo abierto con cargas. */
    stock: stockFalso,
    /** Enciende o apaga la perilla `vidriera_por_qr` del plan (extra de pago): encendida de entrada. */
    perillaDeCarta: (encendida: boolean) => {
      plan.perillaDeCarta = encendida;
    },
    /** Enciende o apaga la perilla `venta_por_fracciones_y_peso` del plan (extra de pago): apagada de entrada. */
    perillaDeFraccionesYPeso: (encendida: boolean) => {
      plan.fraccionesYPeso = encendida;
    },
    dueno,
    alcances,
    armarBarrera: (participantes: number) => {
      barrera = crearBarrera(participantes);
    },
    soltarBarrera: () => {
      barrera = () => Promise.resolve();
    },
    casos,
    consultas,
    escenario,
    filas,
    contar,
    auditoria,
    cerrar: async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    },
  };
}

/** Un `ok` esperado: si falla, el mensaje dice por qué (los errores son datos, no excepciones). */
export function valorDe<T, E>(r: Readonly<{ ok: true; valor: T } | { ok: false; error: E }>): T {
  if (!r.ok) throw new Error(`se esperaba ok y vino ${JSON.stringify(r.error)}`);
  return r.valor;
}

/** Un id nuevo: lo que manda la pantalla (idempotencia) al crear algo. */
export const nuevoId = (): string => randomUUID();

export type { ContextoOperativo };
export const CONTEXTO_CON_AHORA = (
  contexto: ContextoOperativo,
  ahora: string,
): ContextoOperativo => ({ ...contexto, ahora: new Date(ahora) });

/** `cotizarParaVender` dentro de una transacción de solo lectura, como lo llamaría ventas. */
export async function cotizarEnTx(
  c: Awaited<ReturnType<typeof montarCatalogo>>,
  contexto: ContextoOperativo,
  entrada: Readonly<{
    sucursalId: string;
    productoId: string;
    opcionIds?: readonly string[];
    cantidad?: string;
    ahora?: Date;
    /** Cotizar «como» otra empresa (el catálogo filtra por la que le pasan y la RLS por la del contexto). */
    empresaId?: string;
  }>,
) {
  return c.entorno.ejecutar({ contexto, aislamiento: "read committed", soloLectura: true }, (tx) =>
    cotizarParaVender(tx, {
      empresaId: empresaId(entrada.empresaId ?? contexto.empresaId),
      sucursalId: sucursalId(entrada.sucursalId),
      productoId: entrada.productoId,
      opcionIds: entrada.opcionIds ?? [],
      cantidad: entrada.cantidad ?? "1",
      ahora: entrada.ahora ?? new Date("2026-10-12T00:00:00Z"),
    }),
  );
}
