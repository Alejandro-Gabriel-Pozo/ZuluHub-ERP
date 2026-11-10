import { describe, expect, it } from "vitest";
import { clavesDe, esClaveDe } from "../../../capacidades/modulos/activos";
import { CATALOGO_DE_MODULOS, type ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../../capacidades/permisos/roles";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { empresaId, personaId } from "../../../primitivas/identificadores/marca";
import type { CargaDeAutorizacion, DatosDelActor } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import { crearConsultasDeCaja, type ConsultasDeCaja } from "../consultas/consultas";
import type { TxDeConsultasDeCaja } from "../consultas/contrato";
import { DECLARACIONES_DE_CONSULTAS } from "../consultas/declaraciones";
import { crearCasosDeUsoDeCaja, type CasosDeUsoDeCaja } from "./casos-de-uso";
import type { TxDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

/**
 * P7 para caja: ningún caso de uso ni consulta se salta el guard, y el orden fijo de e3 §3.2 empieza por él. Corren contra una transacción
 * VIGILADA: solo `autorizacion` responde y cualquier otro acceso (un repositorio, la auditoría, los estados de la empresa, los derechos)
 * queda registrado y corta la ejecución. Un caso que lee o escribe antes de autorizar, o que no autoriza, se delata solo. Sin base de datos.
 * Las reglas son las reales con `caja` ya construida (hoy está «en desarrollo» y el guard rechazaría todo con `MODULO_EN_DESARROLLO`).
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date(0),
};

/** El guard dejó pasar: la transacción vigilada corta en el primer acceso que no es la autorización. */
class AccesoFueraDelGuard extends Error {}

type Vigilada = Readonly<{ tx: TxDeCaja & TxDeConsultasDeCaja; accesos: string[] }>;

const CAJA_DISPONIBLE: ReglasDeEmpresa = {
  catalogo: { ...CATALOGO_DE_MODULOS, caja: { ...CATALOGO_DE_MODULOS.caja, estado: "disponible" } },
  permisos: PERMISOS_DE_EMPRESA,
};

/** Un actor (o nadie, con `rol: null`) en una empresa con `caja` activada y dentro de su plan: así el rechazo es solo por el rol. */
const conCaja = (rol: RolDeEmpresa | null): DatosDelActor => ({
  rol,
  modulosActivados: ["caja"],
  modulosHabilitados: ["caja"],
});

function vigilar(actor: DatosDelActor): Vigilada {
  const accesos: string[] = [];
  const autorizacion: CargaDeAutorizacion = {
    delActor: () => Promise.resolve(actor),
    sucursalesDelActor: () => Promise.resolve("TODAS"),
  };
  const tx = new Proxy({} as TxDeCaja & TxDeConsultasDeCaja, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacion") return autorizacion;
      throw new AccesoFueraDelGuard(String(propiedad));
    },
  });
  return { tx, accesos };
}

const casosCon = (vigilada: Vigilada, reglas: ReglasDeEmpresa = CAJA_DISPONIBLE) => {
  const transacciones: Transacciones<TxDeCaja> = {
    ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx),
  };
  return crearCasosDeUsoDeCaja({ transacciones, reglas });
};

const consultasCon = (vigilada: Vigilada, reglas: ReglasDeEmpresa = CAJA_DISPONIBLE) => {
  const transacciones: Transacciones<TxDeConsultasDeCaja> = {
    ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx),
  };
  return crearConsultasDeCaja({ transacciones, reglas });
};

type Declaraciones = typeof DECLARACIONES;
type ConAccion = {
  [K in keyof Declaraciones]: Declaraciones[K] extends { accion: ClaveAccion } ? K : never;
}[keyof Declaraciones];

const UUID = "11111111-1111-4111-8111-111111111111";
const NADA = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };

/** Cómo se llama a cada caso de uso. Un caso de uso nuevo con acción obliga a sumar su fila. */
const LLAMADAS: Record<ConAccion, (casos: CasosDeUsoDeCaja) => Promise<unknown>> = {
  crearCaja: (c) => c.crearCaja(contexto, { sucursalId: UUID, nombre: "Caja 2" }),
  asegurarCajaPorDefecto: (c) => c.asegurarCajaPorDefecto(contexto, { sucursalId: UUID }),
  editarCaja: (c) => c.editarCaja(contexto, { cajaId: UUID, versionEsperada: 1, nombre: "Caja 3" }),
  desactivarCaja: (c) => c.desactivarCaja(contexto, { cajaId: UUID }),
  reactivarCaja: (c) => c.reactivarCaja(contexto, { cajaId: UUID }),
  crearMedioDePago: (c) => c.crearMedioDePago(contexto, { tipo: "QR", nombre: null }),
  editarMedioDePago: (c) =>
    c.editarMedioDePago(contexto, {
      medioDePagoId: UUID,
      versionEsperada: 1,
      nombre: null,
      datos: NADA,
    }),
  desactivarMedioDePago: (c) => c.desactivarMedioDePago(contexto, { medioDePagoId: UUID }),
  reactivarMedioDePago: (c) => c.reactivarMedioDePago(contexto, { medioDePagoId: UUID }),
  crearCuentaDeCobro: (c) =>
    c.crearCuentaDeCobro(contexto, {
      tipo: "TERMINAL",
      nombre: "Terminal 1",
      identificadorExterno: null,
      sucursalId: UUID,
    }),
  editarCuentaDeCobro: (c) =>
    c.editarCuentaDeCobro(contexto, {
      cuentaDeCobroId: UUID,
      versionEsperada: 1,
      nombre: "Terminal 2",
      identificadorExterno: null,
      sucursalId: UUID,
    }),
  desactivarCuentaDeCobro: (c) => c.desactivarCuentaDeCobro(contexto, { cuentaDeCobroId: UUID }),
  reactivarCuentaDeCobro: (c) => c.reactivarCuentaDeCobro(contexto, { cuentaDeCobroId: UUID }),
};

type DeclaracionesDeConsultas = typeof DECLARACIONES_DE_CONSULTAS;
const LLAMADAS_DE_CONSULTAS: Record<
  keyof DeclaracionesDeConsultas,
  (consultas: ConsultasDeCaja) => Promise<unknown>
> = {
  listarCajas: (c) => c.listarCajas(contexto, { sucursalId: UUID }),
  listarMediosDePago: (c) => c.listarMediosDePago(contexto),
  listarCuentasDeCobro: (c) => c.listarCuentasDeCobro(contexto),
};

/** Pasar el guard = tocar algo que no es la autorización (la transacción vigilada corta ahí). */
const pasoElGuard = async (llamada: Promise<unknown>): Promise<boolean> => {
  try {
    await llamada;
    return false;
  } catch (e) {
    if (e instanceof AccesoFueraDelGuard) return true;
    throw e;
  }
};

type Entrada = Readonly<{
  nombre: string;
  accion: ClaveAccion;
  llamar: (vigilada: Vigilada, reglas?: ReglasDeEmpresa) => Promise<unknown>;
}>;

const casos: Entrada[] = Object.entries(DECLARACIONES).flatMap(([nombre, declaracion]) => {
  if (!esClaveDe(LLAMADAS, nombre)) return [];
  const llamada = LLAMADAS[nombre];
  return [
    {
      nombre,
      accion: declaracion.accion,
      llamar: (vigilada, reglas) => llamada(casosCon(vigilada, reglas)),
    },
  ];
});
const consultas: Entrada[] = Object.entries(DECLARACIONES_DE_CONSULTAS).flatMap(
  ([nombre, declaracion]) => {
    if (!esClaveDe(LLAMADAS_DE_CONSULTAS, nombre)) return [];
    const llamada = LLAMADAS_DE_CONSULTAS[nombre];
    return [
      {
        nombre,
        accion: declaracion.accion,
        llamar: (vigilada, reglas) => llamada(consultasCon(vigilada, reglas)),
      },
    ];
  },
);
const todos: Entrada[] = [...casos, ...consultas];

describe("P7: el guard va primero en cada caso de uso y consulta de caja", () => {
  it("hay casos de uso y consultas con acción que probar, uno por cada declarado", () => {
    expect(casos).toHaveLength(Object.keys(DECLARACIONES).length);
    expect(casos).toHaveLength(13);
    expect(consultas.map((c) => c.nombre).sort()).toEqual([
      "listarCajas",
      "listarCuentasDeCobro",
      "listarMediosDePago",
    ]);
  });

  it.each(todos)(
    "$nombre: sin rol da SIN_PERMISO sin leer ni escribir nada más",
    async ({ llamar }) => {
      const vigilada = vigilar(conCaja(null));
      expect(await llamar(vigilada)).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(vigilada.accesos).toEqual(["autorizacion"]);
    },
  );

  it.each(todos.flatMap((c) => ROLES_DE_EMPRESA.map((rol) => ({ ...c, rol }))))(
    "$nombre con $rol: la matriz decide; si no lo incluye da SIN_PERMISO sin tocar nada más, y si lo incluye pasa el guard y recién ahí toca lo demás",
    async ({ llamar, accion, rol }) => {
      const vigilada = vigilar(conCaja(rol));
      const llamada = llamar(vigilada);
      if (!(PERMISOS_DE_EMPRESA[accion] as readonly RolDeEmpresa[]).includes(rol)) {
        expect(await llamada).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(vigilada.accesos).toEqual(["autorizacion"]);
        return;
      }
      expect(await pasoElGuard(llamada)).toBe(true);
      expect(vigilada.accesos[0]).toBe("autorizacion");
    },
  );

  it("el guard se pide en cada llamada: nada se guarda entre una operación y la siguiente", async () => {
    // Misma transacción vigilada, dos operaciones; el actor cambia entre ambas (lo apagaron).
    let actor: DatosDelActor = conCaja("GERENTE");
    const accesos: string[] = [];
    const tx = new Proxy({} as TxDeCaja & TxDeConsultasDeCaja, {
      get(_objetivo, propiedad) {
        accesos.push(String(propiedad));
        if (propiedad === "autorizacion") return { delActor: () => Promise.resolve(actor) };
        throw new AccesoFueraDelGuard(String(propiedad));
      },
    });
    const casosDeUso = casosCon({ tx, accesos });
    expect(await pasoElGuard(LLAMADAS.crearCaja(casosDeUso))).toBe(true);
    actor = conCaja(null);
    expect(await LLAMADAS.crearCaja(casosDeUso)).toEqual({ ok: false, error: "SIN_PERMISO" });
  });
});

describe("cada caso de uso y cada consulta exigen SU acción (no la de otro)", () => {
  /** Reglas en las que SOLO el gerente puede `accion`, y nadie puede las demás. */
  const soloElGerentePuede = (accion: ClaveAccion): ReglasDeEmpresa => {
    const roles = (a: ClaveAccion): readonly RolDeEmpresa[] => (a === accion ? ["GERENTE"] : []);
    const permisos = Object.fromEntries(
      clavesDe(PERMISOS_DE_EMPRESA).map((a) => [a, roles(a)]),
    ) as unknown as ReglasDeEmpresa["permisos"];
    return { catalogo: CAJA_DISPONIBLE.catalogo, permisos };
  };

  for (const propio of todos) {
    for (const otro of todos) {
      // Las tres consultas comparten `cajas.ver` y las acciones de cada caso son propias: con ese permiso pasa solo quien lo exige.
      const pasa = propio.accion === otro.accion;
      it(`con permiso solo para ${propio.accion} (${propio.nombre}): ${otro.nombre} ${pasa ? "pasa el guard" : "da SIN_PERMISO"}`, async () => {
        const vigilada = vigilar(conCaja("GERENTE"));
        const reglas = soloElGerentePuede(propio.accion);
        if (pasa) {
          expect(await pasoElGuard(otro.llamar(vigilada, reglas))).toBe(true);
        } else {
          expect(await otro.llamar(vigilada, reglas)).toEqual({ ok: false, error: "SIN_PERMISO" });
          expect(vigilada.accesos).toEqual(["autorizacion"]);
        }
      });
    }
  }

  it("cada caso de uso exige una acción distinta, del módulo caja, y cada consulta cajas.ver", () => {
    const delCatalogo = Object.keys(CATALOGO_DE_MODULOS.caja.acciones);
    for (const { accion } of todos) expect(delCatalogo).toContain(accion);
    expect(new Set(casos.map((c) => c.accion)).size).toBe(casos.length);
    for (const consulta of consultas) expect(consulta.accion).toBe("cajas.ver");
  });

  it("las acciones de cada caso son las de la tabla de e3 §3.8", () => {
    const acciones = Object.fromEntries(casos.map((c) => [c.nombre, c.accion]));
    expect(acciones).toEqual({
      crearCaja: "cajas.crear",
      asegurarCajaPorDefecto: "sesiones_caja.abrir",
      editarCaja: "cajas.editar",
      desactivarCaja: "cajas.desactivar",
      reactivarCaja: "cajas.reactivar",
      crearMedioDePago: "medios_de_pago.crear",
      editarMedioDePago: "medios_de_pago.editar",
      desactivarMedioDePago: "medios_de_pago.desactivar",
      reactivarMedioDePago: "medios_de_pago.reactivar",
      crearCuentaDeCobro: "cuentas_de_cobro.crear",
      editarCuentaDeCobro: "cuentas_de_cobro.editar",
      desactivarCuentaDeCobro: "cuentas_de_cobro.desactivar",
      reactivarCuentaDeCobro: "cuentas_de_cobro.reactivar",
    });
  });
});

describe("los demás motivos del guard salen tal cual", () => {
  const cajaComo = (estado: "disponible" | "en_desarrollo"): ReglasDeEmpresa => ({
    catalogo: { ...CATALOGO_DE_MODULOS, caja: { ...CATALOGO_DE_MODULOS.caja, estado } },
    permisos: PERMISOS_DE_EMPRESA,
  });

  it("el catálogo real lo tiene en desarrollo: todo se rechaza con MODULO_EN_DESARROLLO, casos y consultas (todo nace cerrado)", async () => {
    expect(CATALOGO_DE_MODULOS.caja.estado).toBe("en_desarrollo");
    for (const entrada of todos) {
      const vigilada = vigilar(conCaja("GERENTE"));
      expect(await entrada.llamar(vigilada, cajaComo("en_desarrollo")), entrada.nombre).toEqual({
        ok: false,
        error: "MODULO_EN_DESARROLLO",
      });
      expect(vigilada.accesos).toEqual(["autorizacion"]);
    }
  });

  it("un módulo no activado en la empresa da MODULO_NO_ACTIVO (y el rol ya no importa)", async () => {
    for (const entrada of todos) {
      const vigilada = vigilar({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] });
      expect(await entrada.llamar(vigilada), entrada.nombre).toEqual({
        ok: false,
        error: "MODULO_NO_ACTIVO",
      });
      expect(vigilada.accesos).toEqual(["autorizacion"]);
    }
  });

  it("activado pero fuera del plan (solo lectura): bloquea lo que crea o amplía y deja pasar lo que cierra y lo que mira", async () => {
    const soloLectura: DatosDelActor = {
      rol: "GERENTE",
      modulosActivados: ["caja"],
      modulosHabilitados: [],
    };
    const creaOAmplia = new Set<ClaveAccion>([
      "sesiones_caja.abrir",
      "cajas.crear",
      "cajas.editar",
      "cajas.reactivar",
      "medios_de_pago.crear",
      "medios_de_pago.editar",
      "medios_de_pago.reactivar",
      "cuentas_de_cobro.crear",
      "cuentas_de_cobro.editar",
      "cuentas_de_cobro.reactivar",
    ]);
    for (const entrada of todos) {
      const vigilada = vigilar(soloLectura);
      const llamada = entrada.llamar(vigilada);
      if (creaOAmplia.has(entrada.accion)) {
        expect(await llamada, entrada.nombre).toEqual({
          ok: false,
          error: "MODULO_EN_SOLO_LECTURA",
        });
        expect(vigilada.accesos).toEqual(["autorizacion"]);
      } else {
        expect(await pasoElGuard(llamada), entrada.nombre).toBe(true);
      }
    }
    // Los que bloquea son exactamente los CREA_AMPLIA del catálogo de caja que figuran entre los casos.
    const delCatalogo = Object.entries(CATALOGO_DE_MODULOS.caja.acciones)
      .filter(([, definicion]) => definicion.efecto === "CREA_AMPLIA")
      .map(([accion]) => accion);
    for (const accion of creaOAmplia) expect(delCatalogo).toContain(accion);
  });
});

describe("el detector (con la violación inyectada)", () => {
  /** Un caso de uso mal hecho: lee un repositorio ANTES de pedir el permiso. */
  async function casoQueLeeAntes(tx: TxDeCaja) {
    await tx.cajas.obtener(contexto.empresaId, UUID);
    return exigirAccion(CAJA_DISPONIBLE, "cajas.crear", () => tx.autorizacion.delActor(contexto));
  }

  /** Otro mal hecho: no pide el permiso. */
  async function casoQueNoAutoriza(tx: TxDeCaja) {
    await tx.cajas.obtener(contexto.empresaId, UUID);
    return { ok: true as const, valor: null };
  }

  /** Uno bien hecho: pide el permiso y se detiene. */
  async function casoBienHecho(tx: TxDeCaja) {
    return exigirAccion(CAJA_DISPONIBLE, "cajas.crear", () => tx.autorizacion.delActor(contexto));
  }

  const guardVaPrimero = async (caso: (tx: TxDeCaja) => Promise<unknown>) => {
    const { tx, accesos } = vigilar(conCaja(null));
    try {
      await caso(tx);
    } catch (e) {
      if (!(e instanceof AccesoFueraDelGuard)) throw e;
    }
    return accesos.length === 1 && accesos[0] === "autorizacion";
  };

  it("detecta un caso de uso que lee antes de autorizar", async () => {
    expect(await guardVaPrimero(casoQueLeeAntes)).toBe(false);
  });

  it("detecta un caso de uso que no autoriza", async () => {
    expect(await guardVaPrimero(casoQueNoAutoriza)).toBe(false);
  });

  it("deja pasar uno que autoriza primero", async () => {
    expect(await guardVaPrimero(casoBienHecho)).toBe(true);
  });
});
