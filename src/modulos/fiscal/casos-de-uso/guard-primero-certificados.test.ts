import { describe, expect, it } from "vitest";
import { clavesDe } from "../../../capacidades/modulos/activos";
import { CATALOGO_DE_MODULOS, type ClaveAccion } from "../../../capacidades/modulos/catalogo";
import {
  PERMISOS_DE_EMPRESA,
  REGLAS_DE_EMPRESA,
  type ReglasDeEmpresa,
} from "../../../capacidades/permisos/empresa";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../../capacidades/permisos/roles";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { empresaId, personaId } from "../../../primitivas/identificadores/marca";
import type { CargaDeAutorizacion, DatosDelActor } from "../../../puertos/autorizacion";
import type { CifradorDeSecretos } from "../../../puertos/cifrado-de-secretos";
import type { GeneradorDeCredenciales } from "../../../puertos/generador-de-credenciales";
import type { LectorDeCertificados } from "../../../puertos/lector-de-certificados";
import type { Transacciones } from "../../../puertos/transacciones";
import { certificadoId, emisorId } from "../dominio/identificadores";
import * as publico from "../publico";
import {
  crearCasosDeUsoDeCertificados,
  type CasosDeUsoDeCertificados,
} from "./casos-de-uso-de-certificados";
import type { TxDeCertificados } from "./contrato-de-certificados";
import { DECLARACIONES_DE_CERTIFICADOS } from "./declaraciones-de-certificados";

/**
 * P7 para los certificados (spec H7 facturación §B.4 y §C, F7): ningún caso de uso se salta el guard. Corren contra una
 * transacción VIGILADA: solo `autorizacion` responde y cualquier otro acceso corta. Y la matriz: solo el gerente
 * (`certificados.gestionar`), y en solo lectura no se genera ni se carga nada.
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date(0),
};
const contextoDeSistema: ContextoOperativo = { ...contexto, personaId: null, marcaDeEntrada: null };
const ID = "0b3a0c5e-8f7d-4c1b-9a2e-1d2c3b4a5f60";

class AccesoFueraDelGuard extends Error {}

type Vigilada = Readonly<{ tx: TxDeCertificados; accesos: string[] }>;

function vigilar(actor: DatosDelActor): Vigilada {
  const accesos: string[] = [];
  const autorizacion: CargaDeAutorizacion = {
    delActor: () => Promise.resolve(actor),
    sucursalesDelActor: () => Promise.resolve("TODAS"),
  };
  const tx = new Proxy({} as TxDeCertificados, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacion") return autorizacion;
      throw new AccesoFueraDelGuard(String(propiedad));
    },
  });
  return { tx, accesos };
}

const CON_FACTURACION: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    facturacion: { ...CATALOGO_DE_MODULOS.facturacion, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

/** Los servicios no se tocan antes del guard: si alguno se llama, la prueba falla. */
const inalcanzable = (nombre: string) => () => {
  throw new Error(`se usó ${nombre} antes del guard`);
};
const cifrador: CifradorDeSecretos = {
  cifrar: inalcanzable("el cifrador"),
  descifrar: inalcanzable("el cifrador"),
};
const generador: GeneradorDeCredenciales = { generar: inalcanzable("el generador") };
const lector: LectorDeCertificados = {
  leer: inalcanzable("el lector"),
  correspondeALaClave: inalcanzable("el lector"),
  cadenaCierra: inalcanzable("el lector"),
};

const casosCon = (
  vigilada: Vigilada,
  reglas: ReglasDeEmpresa = CON_FACTURACION,
): CasosDeUsoDeCertificados => {
  const transacciones: Transacciones<TxDeCertificados> = {
    ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx),
  };
  return crearCasosDeUsoDeCertificados({ transacciones, reglas, cifrador, generador, lector });
};

const actor = (rol: RolDeEmpresa | null, soloLectura = false): DatosDelActor => ({
  rol,
  modulosActivados: ["facturacion"],
  modulosHabilitados: soloLectura ? [] : ["facturacion"],
});

type Nombre = keyof typeof DECLARACIONES_DE_CERTIFICADOS;

const LLAMADAS: Record<Nombre, (casos: CasosDeUsoDeCertificados) => Promise<unknown>> = {
  generarPedidoDeCertificado: (c) =>
    c.generarPedidoDeCertificado(contexto, {
      id: ID,
      emisorId: emisorId("emisor-1"),
      ambiente: "HOMOLOGACION",
      alias: "pedernal",
      cuitTitular: "20123456786",
      organizacion: "Coop Pampa SA",
    }),
  cargarCertificado: (c) =>
    c.cargarCertificado(contexto, { certificadoId: certificadoId(ID), certificadoPem: "x" }),
};
const NOMBRES = clavesDe(LLAMADAS);

const pasoElGuard = async (llamada: Promise<unknown>): Promise<boolean> => {
  try {
    await llamada;
    return false;
  } catch (e) {
    if (e instanceof AccesoFueraDelGuard) return true;
    throw e;
  }
};

describe("P7: el guard va primero en cada caso de uso de certificados", () => {
  it("hay dos casos y los dos exigen certificados.gestionar (CA, solo el gerente)", () => {
    expect(NOMBRES).toHaveLength(2);
    expect(DECLARACIONES_DE_CERTIFICADOS).toEqual({
      generarPedidoDeCertificado: { accion: "certificados.gestionar" },
      cargarCertificado: { accion: "certificados.gestionar" },
    });
    expect(PERMISOS_DE_EMPRESA["certificados.gestionar"]).toEqual(["GERENTE"]);
    expect(CATALOGO_DE_MODULOS.facturacion.acciones["certificados.gestionar"]).toEqual({
      capacidad: null,
      efecto: "CREA_AMPLIA",
    });
  });

  it.each(NOMBRES)("%s: sin rol da SIN_PERMISO sin leer ni escribir nada más", async (nombre) => {
    const vigilada = vigilar(actor(null));
    expect(await LLAMADAS[nombre](casosCon(vigilada))).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it.each(NOMBRES.flatMap((nombre) => ROLES_DE_EMPRESA.map((rol) => ({ nombre, rol }))))(
    "$nombre con $rol: pasa el guard solo si es el gerente, y recién ahí se toca lo demás",
    async ({ nombre, rol }) => {
      const vigilada = vigilar(actor(rol));
      if (rol === "GERENTE") {
        expect(await pasoElGuard(LLAMADAS[nombre](casosCon(vigilada)))).toBe(true);
        expect(vigilada.accesos[0]).toBe("autorizacion");
      } else {
        expect(await LLAMADAS[nombre](casosCon(vigilada))).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
        expect(vigilada.accesos).toEqual(["autorizacion"]);
      }
    },
  );

  it.each(NOMBRES)("%s con el catálogo REAL da MODULO_EN_DESARROLLO", async (nombre) => {
    const vigilada = vigilar(actor("GERENTE"));
    expect(await LLAMADAS[nombre](casosCon(vigilada, REGLAS_DE_EMPRESA))).toEqual({
      ok: false,
      error: "MODULO_EN_DESARROLLO",
    });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it.each(NOMBRES)(
    "%s en solo lectura (baja de plan): no se genera ni se carga nada",
    async (nombre) => {
      const vigilada = vigilar(actor("GERENTE", true));
      expect(await LLAMADAS[nombre](casosCon(vigilada))).toEqual({
        ok: false,
        error: "MODULO_EN_SOLO_LECTURA",
      });
      expect(vigilada.accesos).toEqual(["autorizacion"]);
    },
  );

  it.each(NOMBRES)("%s exige SU acción: sin ella nadie pasa", async (nombre) => {
    const accion: ClaveAccion = DECLARACIONES_DE_CERTIFICADOS[nombre].accion;
    const sinLaAccion = Object.fromEntries(
      clavesDe(PERMISOS_DE_EMPRESA).map((a) => [a, a === accion ? [] : ROLES_DE_EMPRESA]),
    ) as unknown as ReglasDeEmpresa["permisos"];
    const vigilada = vigilar(actor("GERENTE"));
    expect(
      await LLAMADAS[nombre](casosCon(vigilada, { ...CON_FACTURACION, permisos: sinLaAccion })),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });
});

describe("generar y cargar exigen una persona", () => {
  it.each(NOMBRES)(
    "%s con un contexto de sistema: RangeError sin abrir la transacción",
    async (nombre) => {
      const vigilada = vigilar(actor("GERENTE"));
      const casos = casosCon(vigilada);
      const llamada =
        nombre === "generarPedidoDeCertificado"
          ? casos.generarPedidoDeCertificado(contextoDeSistema, {
              id: ID,
              emisorId: emisorId("emisor-1"),
              ambiente: "HOMOLOGACION",
              alias: "pedernal",
              cuitTitular: "20123456786",
              organizacion: "Coop",
            })
          : casos.cargarCertificado(contextoDeSistema, {
              certificadoId: certificadoId(ID),
              certificadoPem: "x",
            });
      await expect(llamada).rejects.toThrow(RangeError);
      expect(vigilada.accesos).toEqual([]);
    },
  );
});

describe("publico.ts: la puerta de los certificados", () => {
  it("ofrece los casos de uso y los lugares de lo cifrado, y no exporta cuerpos sin guard", () => {
    expect(typeof publico.crearCasosDeUsoDeCertificados).toBe("function");
    expect(typeof publico.dondeSeGuardaLaClave).toBe("function");
    expect(typeof publico.dondeSeGuardaLaCredencial).toBe("function");
    expect(typeof publico.certificadosPorVencer).toBe("function");
    expect(Object.keys(publico).filter((nombre) => /EnTx$/.test(nombre))).toEqual([]);
  });
});
