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
import type { GanchoDeSucursal } from "../ganchos-de-sucursal";
import { crearCasosDeUsoDeEmpresas } from "./casos-de-uso";
import type { TxDeEmpresas } from "./contrato";

/**
 * Decisión 165 (E0-T7): los ganchos de sucursal corren dentro de la transacción de `crearSucursal`. Sin
 * base de datos: una transacción en memoria que serializa y revierte (como la real ante un error o un
 * conflicto) y un gancho falso que anota qué vio.
 */

const EMPRESA = empresaId("e-1");
const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: EMPRESA,
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date(0),
};
const hora = horaDelDiaDesdeTexto("00:00");
if (!hora.ok) throw new Error("la hora de prueba es válida");
const MEDIANOCHE = hora.valor;

type Estado = { sucursales: Sucursal[]; auditoria: RegistroDeAuditoria[]; eventos: string[] };

/** Una base en memoria: una transacción por vez (serializable) y, ante un error o una excepción, vuelve al estado previo. */
function entornoEnMemoria() {
  let estado: Estado = { sucursales: [], auditoria: [], eventos: [] };
  let cola: Promise<unknown> = Promise.resolve();
  let proximoId = 0;

  const armarTx = (): TxDeEmpresas => {
    const tx = {
      empresas: { obtener: () => Promise.resolve({ estado: "ACTIVE" }) },
      tenants: { obtener: () => Promise.resolve({ estado: "ACTIVE" }) },
      autorizacion: {
        delActor: () =>
          Promise.resolve({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] }),
        sucursalesDelActor: () => Promise.resolve("TODAS"),
      },
      sucursales: {
        async crearSiNoExiste(_empresa: unknown, nombre: string) {
          await Promise.resolve();
          const existente = estado.sucursales.find(
            (s) => s.nombre.toLowerCase() === nombre.toLowerCase(),
          );
          if (existente !== undefined) return { creada: false, sucursal: existente };
          proximoId += 1;
          const sucursal: Sucursal = {
            id: sucursalId(`s-${proximoId}`),
            empresaId: EMPRESA,
            nombre,
            activa: true,
            horaDeCorte: MEDIANOCHE,
            contacto: { telefono: null, correo: null, web: null },
            version: 1,
          };
          estado.sucursales.push(sucursal);
          estado.eventos.push("sucursal");
          return { creada: true, sucursal };
        },
      },
      auditoria: {
        registrar(registro: RegistroDeAuditoria) {
          estado.auditoria.push(registro);
          estado.eventos.push(`auditoria:${registro.accion}`);
          return Promise.resolve();
        },
      },
    };
    return tx as unknown as TxDeEmpresas;
  };

  const transacciones: Transacciones<TxDeEmpresas> = {
    ejecutar(_opciones, trabajo) {
      const turno = cola.then(async () => {
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
      });
      cola = turno.catch(() => undefined);
      return turno;
    },
  };
  return { transacciones, estado: () => estado };
}

/** Un gancho falso: anota cada invocación (con lo que ya había hecho la transacción) y falla si se le pide. */
function ganchoFalso(entorno: ReturnType<typeof entornoEnMemoria>, falla = false) {
  const invocaciones: { nombre: string; eventosPrevios: string[]; sucursalId: string }[] = [];
  const gancho: GanchoDeSucursal<TxDeEmpresas> = {
    alCrearSucursalEnTx(_tx, _contexto, sucursal) {
      invocaciones.push({
        nombre: sucursal.nombre,
        sucursalId: sucursal.sucursalId,
        eventosPrevios: [...entorno.estado().eventos],
      });
      entorno.estado().eventos.push("gancho");
      return Promise.resolve(falla ? err("GANCHO_DE_SUCURSAL_FALLIDO") : ok(null));
    },
  };
  return { gancho, invocaciones };
}

const casosCon = (
  entorno: ReturnType<typeof entornoEnMemoria>,
  ganchos: GanchoDeSucursal<TxDeEmpresas>[],
) =>
  crearCasosDeUsoDeEmpresas({
    transacciones: entorno.transacciones,
    reglas: REGLAS_DE_EMPRESA,
    ganchosDeSucursal: ganchos,
  });

describe("crearSucursal invoca los ganchos de sucursal (decisión 165)", () => {
  it("se invoca una vez al crear, con el id y el nombre de la sucursal nueva", async () => {
    const entorno = entornoEnMemoria();
    const { gancho, invocaciones } = ganchoFalso(entorno);
    const resultado = await casosCon(entorno, [gancho]).crearSucursal(contexto, {
      nombre: "Norte",
    });
    expect(resultado).toEqual({ ok: true, valor: { sucursalId: "s-1", yaExistia: false } });
    expect(invocaciones).toHaveLength(1);
    expect(invocaciones[0]).toMatchObject({ nombre: "Norte", sucursalId: "s-1" });
  });

  it("corre DESPUÉS de la sucursal y de la auditoría SUCURSAL_CREADA", async () => {
    const entorno = entornoEnMemoria();
    const { gancho, invocaciones } = ganchoFalso(entorno);
    await casosCon(entorno, [gancho]).crearSucursal(contexto, { nombre: "Norte" });
    expect(invocaciones[0]?.eventosPrevios).toEqual(["sucursal", "auditoria:SUCURSAL_CREADA"]);
  });

  it("varios ganchos corren en el orden registrado", async () => {
    const entorno = entornoEnMemoria();
    const orden: string[] = [];
    const nombrado = (n: string): GanchoDeSucursal<TxDeEmpresas> => ({
      alCrearSucursalEnTx() {
        orden.push(n);
        return Promise.resolve(ok(null));
      },
    });
    await casosCon(entorno, [nombrado("a"), nombrado("b")]).crearSucursal(contexto, {
      nombre: "Norte",
    });
    expect(orden).toEqual(["a", "b"]);
  });

  it("no se invoca si la sucursal ya existía (repetición idempotente)", async () => {
    const entorno = entornoEnMemoria();
    const { gancho, invocaciones } = ganchoFalso(entorno);
    const casos = casosCon(entorno, [gancho]);
    await casos.crearSucursal(contexto, { nombre: "Norte" });
    const repetida = await casos.crearSucursal(contexto, { nombre: "norte" });
    expect(repetida).toEqual({ ok: true, valor: { sucursalId: "s-1", yaExistia: true } });
    expect(invocaciones).toHaveLength(1);
    expect(entorno.estado().sucursales).toHaveLength(1);
  });

  it("si el gancho falla, el error sale y no queda sucursal ni auditoría (atomicidad)", async () => {
    const entorno = entornoEnMemoria();
    const { gancho, invocaciones } = ganchoFalso(entorno, true);
    const resultado = await casosCon(entorno, [gancho]).crearSucursal(contexto, {
      nombre: "Norte",
    });
    expect(resultado).toEqual({ ok: false, error: "GANCHO_DE_SUCURSAL_FALLIDO" });
    expect(invocaciones).toHaveLength(1);
    expect(entorno.estado().sucursales).toEqual([]);
    expect(entorno.estado().auditoria).toEqual([]);
  });

  it("si un gancho lanza una excepción, tampoco queda sucursal y la excepción no se traga", async () => {
    const entorno = entornoEnMemoria();
    const roto: GanchoDeSucursal<TxDeEmpresas> = {
      alCrearSucursalEnTx: () => Promise.reject(new Error("falla de la base")),
    };
    await expect(
      casosCon(entorno, [roto]).crearSucursal(contexto, { nombre: "Norte" }),
    ).rejects.toThrow("falla de la base");
    expect(entorno.estado().sucursales).toEqual([]);
  });

  it("el primer gancho que falla corta: los siguientes no corren", async () => {
    const entorno = entornoEnMemoria();
    const primero = ganchoFalso(entorno, true);
    const segundo = ganchoFalso(entorno);
    await casosCon(entorno, [primero.gancho, segundo.gancho]).crearSucursal(contexto, {
      nombre: "Norte",
    });
    expect(segundo.invocaciones).toHaveLength(0);
  });

  it("un nombre inválido o sin permiso no invoca ningún gancho", async () => {
    const entorno = entornoEnMemoria();
    const { gancho, invocaciones } = ganchoFalso(entorno);
    const resultado = await casosCon(entorno, [gancho]).crearSucursal(contexto, { nombre: " " });
    expect(resultado.ok).toBe(false);
    expect(invocaciones).toHaveLength(0);
  });

  it("sin ganchos registrados crea la sucursal como antes", async () => {
    const entorno = entornoEnMemoria();
    const resultado = await casosCon(entorno, []).crearSucursal(contexto, { nombre: "Norte" });
    expect(resultado.ok).toBe(true);
    expect(entorno.estado().sucursales).toHaveLength(1);
  });

  it("concurrencia: dos altas simultáneas con el mismo nombre dan una sola sucursal y una sola invocación", async () => {
    const entorno = entornoEnMemoria();
    const { gancho, invocaciones } = ganchoFalso(entorno);
    const casos = casosCon(entorno, [gancho]);
    const [a, b] = await Promise.all([
      casos.crearSucursal(contexto, { nombre: "Norte" }),
      casos.crearSucursal(contexto, { nombre: "NORTE" }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.valor.sucursalId).toBe(b.valor.sucursalId);
    expect([a.valor.yaExistia, b.valor.yaExistia].sort()).toEqual([false, true]);
    expect(entorno.estado().sucursales).toHaveLength(1);
    expect(invocaciones).toHaveLength(1);
  });
});
