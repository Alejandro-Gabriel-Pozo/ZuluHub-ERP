import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { REGLAS_DE_EMPRESA } from "../../../capacidades/permisos/empresa";
import { empresaId, personaId, sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok } from "../../../primitivas/resultado/resultado";
import { horaDelDiaDesdeTexto } from "../../../primitivas/tiempo/hora-del-dia";
import type { RegistroDeAuditoria } from "../../../puertos/auditoria";
import type { Transacciones } from "../../../puertos/transacciones";
import type { Sucursal } from "../dominio/sucursal";
import type { GanchoAlDesactivarSucursal } from "../ganchos-de-sucursal";
import { crearCasosDeUsoDeEmpresas } from "./casos-de-uso";
import type { TxDeEmpresas } from "./contrato";

/**
 * Decisión 178: los ganchos de desactivación corren dentro de la transacción de `desactivarSucursal`, ANTES de cambiar la sucursal, con la
 * zona y el corte de la sucursal, y solo si había que desactivar. Sin base de datos: una transacción en memoria que revierte ante un error.
 */

const EMPRESA = empresaId("e-1");
const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: EMPRESA,
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date(0),
};
const corte = horaDelDiaDesdeTexto("04:00");
if (!corte.ok) throw new Error("la hora de prueba es válida");
const CORTE = corte.valor;

const sucursalDe = (id: string, activa: boolean): Sucursal => ({
  id: sucursalId(id),
  empresaId: EMPRESA,
  nombre: `Sucursal ${id}`,
  activa,
  horaDeCorte: CORTE,
  contacto: { telefono: null, correo: null, web: null },
  version: 1,
});

type Estado = { sucursales: Sucursal[]; auditoria: RegistroDeAuditoria[]; eventos: string[] };

function entornoEnMemoria(inicial: readonly Sucursal[]) {
  let estado: Estado = { sucursales: [...inicial], auditoria: [], eventos: [] };
  const armarTx = (): TxDeEmpresas =>
    ({
      empresas: { obtener: () => Promise.resolve({ estado: "ACTIVE" }) },
      tenants: { obtener: () => Promise.resolve({ estado: "ACTIVE" }) },
      autorizacion: {
        delActor: () =>
          Promise.resolve({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] }),
        sucursalesDelActor: () => Promise.resolve("TODAS"),
      },
      sucursales: {
        obtener: (_e: unknown, id: string) =>
          Promise.resolve(estado.sucursales.find((s) => s.id === id) ?? null),
        listarActivas: () => Promise.resolve(estado.sucursales.filter((s) => s.activa)),
        jornadaDe: (id: string) =>
          Promise.resolve(
            estado.sucursales.some((s) => s.id === id)
              ? { zonaHoraria: "America/Argentina/Buenos_Aires", horaDeCorte: CORTE }
              : null,
          ),
        cambiarActiva(_e: unknown, id: string, _version: number, activa: boolean) {
          const actual = estado.sucursales.find((s) => s.id === id);
          if (actual === undefined) return Promise.resolve(null);
          const cambiada = { ...actual, activa, version: actual.version + 1 };
          estado.sucursales = estado.sucursales.map((s) => (s.id === id ? cambiada : s));
          estado.eventos.push("sucursal");
          return Promise.resolve(cambiada);
        },
      },
      auditoria: {
        registrar(registro: RegistroDeAuditoria) {
          estado.auditoria.push(registro);
          estado.eventos.push(`auditoria:${registro.accion}`);
          return Promise.resolve();
        },
      },
    }) as unknown as TxDeEmpresas;
  const transacciones: Transacciones<TxDeEmpresas> = {
    async ejecutar(_opciones, trabajo) {
      const previo: Estado = {
        sucursales: [...estado.sucursales],
        auditoria: [...estado.auditoria],
        eventos: [...estado.eventos],
      };
      try {
        const resultado = await trabajo(armarTx());
        if (!resultado.ok) estado = previo;
        return resultado;
      } catch (e) {
        estado = previo;
        throw e;
      }
    },
  };
  return { transacciones, estado: () => estado };
}

type Invocacion = {
  sucursalId: string;
  nombre: string;
  zona: string;
  corte: string;
  eventosPrevios: string[];
};

function ganchoFalso(
  entorno: ReturnType<typeof entornoEnMemoria>,
  resultado: Awaited<
    ReturnType<GanchoAlDesactivarSucursal<TxDeEmpresas>["alDesactivarSucursalEnTx"]>
  > = ok(null),
) {
  const invocaciones: Invocacion[] = [];
  const gancho: GanchoAlDesactivarSucursal<TxDeEmpresas> = {
    alDesactivarSucursalEnTx(_tx, _contexto, sucursal, jornada) {
      invocaciones.push({
        sucursalId: sucursal.sucursalId,
        nombre: sucursal.nombre,
        zona: jornada.zonaHoraria,
        corte: String(jornada.horaDeCorte),
        eventosPrevios: [...entorno.estado().eventos],
      });
      entorno.estado().eventos.push("gancho");
      return Promise.resolve(resultado);
    },
  };
  return { gancho, invocaciones };
}

const casosCon = (
  entorno: ReturnType<typeof entornoEnMemoria>,
  ganchos: GanchoAlDesactivarSucursal<TxDeEmpresas>[],
) =>
  crearCasosDeUsoDeEmpresas({
    transacciones: entorno.transacciones,
    reglas: REGLAS_DE_EMPRESA,
    ganchosDeSucursal: [],
    ganchosAlDesactivarSucursal: ganchos,
  });

const DOS = () => [sucursalDe("s-1", true), sucursalDe("s-2", true)];

describe("desactivarSucursal invoca los ganchos de desactivación (decisión 178)", () => {
  it("se invoca una vez, ANTES de cambiar la sucursal, con su id, su nombre, la zona y el corte", async () => {
    const entorno = entornoEnMemoria(DOS());
    const { gancho, invocaciones } = ganchoFalso(entorno);
    const resultado = await casosCon(entorno, [gancho]).desactivarSucursal(contexto, {
      sucursalId: sucursalId("s-1"),
    });
    expect(resultado).toEqual({ ok: true, valor: { yaEstabaInactiva: false } });
    expect(invocaciones).toEqual([
      {
        sucursalId: "s-1",
        nombre: "Sucursal s-1",
        zona: "America/Argentina/Buenos_Aires",
        corte: String(CORTE),
        eventosPrevios: [],
      },
    ]);
    expect(entorno.estado().eventos).toEqual([
      "gancho",
      "sucursal",
      "auditoria:SUCURSAL_DESACTIVADA",
    ]);
  });

  it("varios ganchos corren en el orden registrado y el primero que rechaza corta a los demás", async () => {
    const entorno = entornoEnMemoria(DOS());
    const orden: string[] = [];
    const nombrado = (n: string, falla = false): GanchoAlDesactivarSucursal<TxDeEmpresas> => ({
      alDesactivarSucursalEnTx() {
        orden.push(n);
        return Promise.resolve(falla ? err("JORNADA_NO_VERIFICABLE") : ok(null));
      },
    });
    const casos = casosCon(entorno, [nombrado("a"), nombrado("b", true), nombrado("c")]);
    const resultado = await casos.desactivarSucursal(contexto, { sucursalId: sucursalId("s-1") });
    expect(resultado).toEqual({ ok: false, error: "JORNADA_NO_VERIFICABLE" });
    expect(orden).toEqual(["a", "b"]);
  });

  it.each([
    "SUCURSAL_CON_JORNADA_EN_AUDITORIA",
    "SUCURSAL_CON_MOVIMIENTO_EN_LA_JORNADA",
    "JORNADA_NO_VERIFICABLE",
  ] as const)(
    "si el gancho rechaza con %s, sale ese código y la sucursal sigue activa sin auditoría",
    async (codigo) => {
      const entorno = entornoEnMemoria(DOS());
      const { gancho } = ganchoFalso(entorno, err(codigo));
      const resultado = await casosCon(entorno, [gancho]).desactivarSucursal(contexto, {
        sucursalId: sucursalId("s-1"),
      });
      expect(resultado).toEqual({ ok: false, error: codigo });
      expect(entorno.estado().sucursales.every((s) => s.activa)).toBe(true);
      expect(entorno.estado().auditoria).toEqual([]);
    },
  );

  it("si un gancho lanza una excepción, la sucursal sigue activa y la excepción no se traga", async () => {
    const entorno = entornoEnMemoria(DOS());
    const roto: GanchoAlDesactivarSucursal<TxDeEmpresas> = {
      alDesactivarSucursalEnTx: () => Promise.reject(new Error("falla de la base")),
    };
    await expect(
      casosCon(entorno, [roto]).desactivarSucursal(contexto, { sucursalId: sucursalId("s-1") }),
    ).rejects.toThrow("falla de la base");
    expect(entorno.estado().sucursales.every((s) => s.activa)).toBe(true);
  });

  it("no se invoca si ya estaba inactiva (desactivar dos veces), si no existe ni si es la última activa", async () => {
    const entorno = entornoEnMemoria([sucursalDe("s-1", true), sucursalDe("s-2", false)]);
    const { gancho, invocaciones } = ganchoFalso(entorno);
    const casos = casosCon(entorno, [gancho]);
    expect(await casos.desactivarSucursal(contexto, { sucursalId: sucursalId("s-2") })).toEqual({
      ok: true,
      valor: { yaEstabaInactiva: true },
    });
    expect(await casos.desactivarSucursal(contexto, { sucursalId: sucursalId("s-1") })).toEqual({
      ok: false,
      error: "ULTIMA_SUCURSAL_ACTIVA",
    });
    expect(await casos.desactivarSucursal(contexto, { sucursalId: sucursalId("s-9") })).toEqual({
      ok: false,
      error: "SUCURSAL_NO_ENCONTRADA",
    });
    expect(invocaciones).toEqual([]);
  });
});
